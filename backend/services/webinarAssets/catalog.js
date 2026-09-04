const { randomUUID: defaultRandomUUID } = require('node:crypto');
const db = require('../../db/connection');
const { MEDIA_RULES, loadAssetConfig, makePublicUrl: defaultMakePublicUrl } = require('./config');
const defaultStorage = require('./storage');
const defaultInspection = require('./inspection');
const { recordAuditEvent: defaultRecordAuditEvent } = require('../webinars/audit');
const { recordOperationalEvent: defaultRecordOperationalEvent } = require('../webinars/observability');
const { runTransaction } = require('../webinars/transaction');

const CLEAN_SCAN_STATUS = 'NO_THREATS_FOUND';
const SAFE_INSPECTION_CODE = /^ASSET_INSPECTION_[A-Z0-9_]{1,43}$/;

class AssetCatalogError extends Error {
  constructor(code, message = 'Webinar asset operation failed', status = 400) {
    super(message);
    this.name = 'AssetCatalogError';
    this.code = code;
    this.status = status;
  }
}

function accessDenied() {
  return new AssetCatalogError(
    'WEBINAR_ACCESS_DENIED',
    'Webinar owner or administrator access required',
    403,
  );
}

function notFound(code, message) {
  return new AssetCatalogError(code, message, 404);
}

function conflict(code, message) {
  return new AssetCatalogError(code, message, 409);
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function text(value, { required = false, maximum = 255 } = {}) {
  if (value === null || value === undefined) {
    if (!required) return null;
    throw new AssetCatalogError('ASSET_INPUT_INVALID', 'Asset input is invalid', 400);
  }
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maximum) {
    throw new AssetCatalogError('ASSET_INPUT_INVALID', 'Asset input is invalid', 400);
  }
  return normalized || null;
}

function uploadMetadata(input) {
  const mimeType = input?.contentType ?? input?.mimeType;
  const declaredBytes = input?.byteSize ?? input?.declaredBytes;
  const rule = MEDIA_RULES[mimeType];
  if (!rule || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > rule.maxBytes) {
    throw new AssetCatalogError('ASSET_INPUT_INVALID', 'Asset upload input is invalid', 400);
  }
  return {
    filename: text(input?.filename, { required: true }),
    mimeType,
    declaredBytes,
    mediaType: rule.mediaType,
  };
}

function mapScanFailure(scanStatus) {
  return scanStatus === 'THREATS_FOUND' ? 'MALWARE_DETECTED' : 'MALWARE_SCAN_FAILED';
}

function inspectionRejectionCode(error) {
  return typeof error?.code === 'string' && SAFE_INSPECTION_CODE.test(error.code)
    ? error.code
    : 'ASSET_INSPECTION_REJECTED';
}

function isImmutableDestinationPresent(error) {
  return error?.name === 'PreconditionFailed'
    || error?.$metadata?.httpStatusCode === 412
    || error?.statusCode === 412;
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function createCatalogService({
  db: connectionPool = db,
  storage = defaultStorage,
  inspection = defaultInspection,
  recordAuditEvent = defaultRecordAuditEvent,
  recordOperationalEvent = defaultRecordOperationalEvent,
  randomUUID = defaultRandomUUID,
  makePublicUrl = defaultMakePublicUrl,
  config = null,
} = {}) {
  function publicUrlFor(key) {
    return makePublicUrl(config || loadAssetConfig(), key);
  }

  function storageInput(input) {
    return config ? { ...input, config } : input;
  }

  async function assertAssetContributor({ actorUserId, isAdmin }) {
    if (!positiveId(actorUserId)) throw accessDenied();
    if (isAdmin === true) return;
    const [rows] = await connectionPool.query(
      `SELECT 1 AS allowed
       FROM webinar_presentations
       WHERE primary_owner_user_id = ? AND archived_at IS NULL
       LIMIT 1`,
      [actorUserId],
    );
    if (!rows[0]) throw accessDenied();
  }

  function safeVersionResult(row) {
    const result = { versionId: row.id, status: row.status };
    if (row.status === 'available') {
      result.sha256 = row.sha256;
      result.publicUrl = publicUrlFor(row.s3_key);
    } else if (row.status === 'rejected') {
      result.rejectionCode = row.rejection_code;
    }
    return result;
  }

  async function selectVersion(queryable, versionId, { lock = false } = {}) {
    const [rows] = await queryable.query(
      `SELECT v.id, v.asset_id, v.version_number, v.original_filename, v.media_type,
              v.mime_type, v.byte_size, v.sha256, v.s3_key, v.width, v.height,
              v.duration_ms, v.status, v.rejection_code, v.uploaded_by_user_id,
              v.created_at, v.archived_at,
              a.created_by_user_id AS family_created_by_user_id,
              a.archived_at AS family_archived_at
       FROM webinar_asset_versions v
       JOIN webinar_assets a ON a.id = v.asset_id
       WHERE v.id = ?${lock ? '\n       FOR UPDATE' : ''}`,
      [versionId],
    );
    if (!rows[0]) throw notFound('ASSET_VERSION_NOT_FOUND', 'Asset version not found');
    return rows[0];
  }

  async function listCatalog(filters = {}) {
    await assertAssetContributor(filters);
    const clauses = [];
    const params = [];
    if (typeof filters.search === 'string' && filters.search.trim()) {
      clauses.push('(a.display_name LIKE ? OR a.description LIKE ?)');
      const search = `%${filters.search.trim()}%`;
      params.push(search, search);
    }
    if (typeof filters.mediaType === 'string' && filters.mediaType.trim()) {
      clauses.push('v.media_type = ?');
      params.push(filters.mediaType.trim());
    }
    if (typeof filters.status === 'string' && filters.status.trim()) {
      clauses.push('v.status = ?');
      params.push(filters.status.trim());
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await connectionPool.query(
      `SELECT a.id AS asset_id, a.display_name, a.description,
              a.created_by_user_id AS family_created_by_user_id,
              a.created_at AS family_created_at, a.archived_at AS family_archived_at,
              v.id AS version_id, v.version_number, v.media_type, v.mime_type,
              v.byte_size, v.sha256, v.s3_key, v.width, v.height, v.duration_ms,
              v.status, v.rejection_code, v.uploaded_by_user_id,
              u.name AS uploader_name, v.created_at AS version_created_at,
              v.archived_at AS version_archived_at
       FROM webinar_assets a
       JOIN webinar_asset_versions v ON v.asset_id = a.id
       LEFT JOIN users u ON u.id = v.uploaded_by_user_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC, v.version_number DESC`,
      params,
    );

    const families = new Map();
    for (const row of rows) {
      let family = families.get(row.asset_id);
      if (!family) {
        family = {
          id: row.asset_id,
          displayName: row.display_name,
          description: row.description,
          createdByUserId: Number(row.family_created_by_user_id),
          createdAt: row.family_created_at,
          archivedAt: row.family_archived_at,
          versions: [],
        };
        families.set(row.asset_id, family);
      }
      const version = {
        id: row.version_id,
        versionNumber: Number(row.version_number),
        mediaType: row.media_type,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        sha256: row.sha256,
        width: numberOrNull(row.width),
        height: numberOrNull(row.height),
        durationMs: numberOrNull(row.duration_ms),
        status: row.status,
        rejectionCode: row.rejection_code,
        uploadedByUserId: Number(row.uploaded_by_user_id),
        uploaderName: row.uploader_name || null,
        createdAt: row.version_created_at,
        archivedAt: row.version_archived_at,
      };
      if (row.status === 'available') version.publicUrl = publicUrlFor(row.s3_key);
      family.versions.push(version);
    }
    for (const family of families.values()) {
      family.versions.sort((left, right) => right.versionNumber - left.versionNumber);
    }
    return [...families.values()];
  }

  async function insertVersion(connection, { assetId, versionId, versionNumber, actorUserId, metadata, intent }) {
    await connection.query(
      `INSERT INTO webinar_asset_versions
         (id, asset_id, version_number, original_filename, media_type, mime_type,
          byte_size, s3_key, status, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
      [
        versionId, assetId, versionNumber, metadata.filename, metadata.mediaType,
        metadata.mimeType, metadata.declaredBytes, intent.key, actorUserId,
      ],
    );
  }

  async function createUploadIntent(input) {
    await assertAssetContributor(input);
    const metadata = uploadMetadata(input);
    const displayName = text(input.displayName, { required: true });
    const description = text(input.description, { maximum: 65535 });
    const assetId = randomUUID();
    const versionId = randomUUID();
    const intent = await storage.createUploadUrl(storageInput({
      versionId,
      filename: metadata.filename,
      mimeType: metadata.mimeType,
      declaredBytes: metadata.declaredBytes,
    }));

    await runTransaction(connectionPool, async connection => {
      await connection.query(
        `INSERT INTO webinar_assets (id, display_name, description, created_by_user_id)
         VALUES (?, ?, ?, ?)`,
        [assetId, displayName, description, input.actorUserId],
      );
      await insertVersion(connection, {
        assetId, versionId, versionNumber: 1, actorUserId: input.actorUserId, metadata, intent,
      });
      await recordAuditEvent(connection, {
        actorUserId: input.actorUserId,
        eventType: 'asset_created',
        targetType: 'asset',
        targetId: assetId,
        metadata: {},
      });
    });

    return {
      assetId,
      versionId,
      uploadUrl: intent.uploadUrl,
      expiresInSeconds: intent.expiresInSeconds,
    };
  }

  async function createVersionIntent(input) {
    await assertAssetContributor(input);
    const metadata = uploadMetadata(input);
    const versionId = randomUUID();
    let intent;
    await runTransaction(connectionPool, async connection => {
      const [families] = await connection.query(
        `SELECT id, created_by_user_id, display_name, description, created_at, archived_at
         FROM webinar_assets
         WHERE id = ? AND archived_at IS NULL
         FOR UPDATE`,
        [input.assetId],
      );
      if (!families[0]) throw notFound('ASSET_NOT_FOUND', 'Asset family not found');
      const [versions] = await connection.query(
        `SELECT COALESCE(MAX(version_number), 0) AS maximum_version
         FROM webinar_asset_versions
         WHERE asset_id = ?`,
        [input.assetId],
      );
      const versionNumber = Number(versions[0]?.maximum_version || 0) + 1;
      intent = await storage.createUploadUrl(storageInput({
        versionId,
        filename: metadata.filename,
        mimeType: metadata.mimeType,
        declaredBytes: metadata.declaredBytes,
      }));
      await insertVersion(connection, {
        assetId: input.assetId,
        versionId,
        versionNumber,
        actorUserId: input.actorUserId,
        metadata,
        intent,
      });
      await recordAuditEvent(connection, {
        actorUserId: input.actorUserId,
        eventType: 'asset_version_created',
        targetType: 'asset_version',
        targetId: versionId,
        metadata: {},
      });
    });

    return {
      assetId: input.assetId,
      versionId,
      uploadUrl: intent.uploadUrl,
      expiresInSeconds: intent.expiresInSeconds,
    };
  }

  async function transitionRejected({ versionId, actorUserId, rejectionCode }) {
    return runTransaction(connectionPool, async connection => {
      const [result] = await connection.query(
        `UPDATE webinar_asset_versions
         SET status = 'rejected', rejection_code = ?
         WHERE id = ? AND status = 'processing'`,
        [rejectionCode, versionId],
      );
      if (result.affectedRows) {
        await recordAuditEvent(connection, {
          actorUserId,
          eventType: 'asset_rejected',
          targetType: 'asset_version',
          targetId: versionId,
          metadata: {},
        });
      }
      const version = await selectVersion(connection, versionId);
      return { result: safeVersionResult(version), transitioned: Boolean(result.affectedRows) };
    });
  }

  async function storeApprovedObject(approvedKey, inspected) {
    if (typeof storage.putOrReuseApprovedObject === 'function') {
      await storage.putOrReuseApprovedObject(storageInput({ approvedKey, inspected }));
      return;
    }
    try {
      await storage.putApprovedObject(storageInput({
        approvedKey,
        body: inspected.approvedBody,
        mimeType: inspected.mimeType,
        byteSize: inspected.byteSize,
      }));
    } catch (error) {
      if (!isImmutableDestinationPresent(error)) throw error;
    }
  }

  async function transitionAvailable({ version, actorUserId, inspected }) {
    return runTransaction(connectionPool, async connection => {
      const locked = await selectVersion(connection, version.id, { lock: true });
      if (locked.status !== 'processing') {
        return { result: safeVersionResult(locked), transitioned: false };
      }
      const [duplicates] = await connection.query(
        `SELECT id, s3_key
         FROM webinar_asset_versions
         WHERE sha256 = ? AND status = 'available' AND archived_at IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE`,
        [inspected.sha256],
      );
      let approvedKey = duplicates[0]?.s3_key;
      if (!approvedKey) {
        approvedKey = storage.makeApprovedKey(inspected.sha256, locked.original_filename);
        await storeApprovedObject(approvedKey, inspected);
      }
      const [result] = await connection.query(
        `UPDATE webinar_asset_versions
         SET status = 'available', sha256 = ?, s3_key = ?, media_type = ?, mime_type = ?,
             byte_size = ?, width = ?, height = ?, duration_ms = ?, rejection_code = NULL
         WHERE id = ? AND status = 'processing'`,
        [
          inspected.sha256,
          approvedKey,
          inspected.mediaType,
          inspected.mimeType,
          inspected.byteSize,
          inspected.width,
          inspected.height,
          inspected.durationMs,
          locked.id,
        ],
      );
      if (result.affectedRows) {
        await recordAuditEvent(connection, {
          actorUserId,
          eventType: 'asset_available',
          targetType: 'asset_version',
          targetId: locked.id,
          metadata: {},
        });
      }
      const current = await selectVersion(connection, locked.id);
      return { result: safeVersionResult(current), transitioned: Boolean(result.affectedRows) };
    });
  }

  function operational(name, actorUserId, versionId, reasonCode) {
    recordOperationalEvent(name, { actorUserId, assetVersionId: versionId, reasonCode });
  }

  async function confirmUpload(input) {
    await assertAssetContributor(input);
    const version = await selectVersion(connectionPool, input.versionId);
    if (version.status !== 'processing') return safeVersionResult(version);

    let scanStatus;
    try {
      scanStatus = await storage.readScanStatus(storageInput({ key: version.s3_key }));
    } catch (error) {
      operational('webinar.asset_scanner_failure', input.actorUserId, version.id, 'ASSET_SCANNER_FAILURE');
      throw error;
    }
    if (!scanStatus) {
      operational('webinar.asset_scan_pending', input.actorUserId, version.id, 'ASSET_SCAN_PENDING');
      return { versionId: version.id, status: 'processing' };
    }
    if (scanStatus !== CLEAN_SCAN_STATUS) {
      const transition = await transitionRejected({
        versionId: version.id,
        actorUserId: input.actorUserId,
        rejectionCode: mapScanFailure(scanStatus),
      });
      if (transition.transitioned) {
        operational('webinar.asset_scan_rejected', input.actorUserId, version.id, 'ASSET_SCAN_REJECTED');
      }
      return transition.result;
    }

    let stream;
    try {
      stream = await storage.readQuarantineObject(storageInput({ key: version.s3_key }));
    } catch (error) {
      operational('webinar.asset_scanner_failure', input.actorUserId, version.id, 'ASSET_SCANNER_FAILURE');
      throw error;
    }

    let inspected;
    try {
      inspected = await inspection.inspectAsset({
        stream,
        declaredMimeType: version.mime_type,
        declaredBytes: Number(version.byte_size),
        filename: version.original_filename,
      });
    } catch (error) {
      const transition = await transitionRejected({
        versionId: version.id,
        actorUserId: input.actorUserId,
        rejectionCode: inspectionRejectionCode(error),
      });
      if (transition.transitioned) {
        operational(
          'webinar.asset_inspection_rejected',
          input.actorUserId,
          version.id,
          'ASSET_INSPECTION_REJECTED',
        );
      }
      return transition.result;
    }

    try {
      const transition = await transitionAvailable({ version, actorUserId: input.actorUserId, inspected });
      if (transition.transitioned) {
        operational('webinar.asset_available', input.actorUserId, version.id, 'ASSET_AVAILABLE');
      }
      return transition.result;
    } catch (error) {
      operational('webinar.asset_scanner_failure', input.actorUserId, version.id, 'ASSET_SCANNER_FAILURE');
      throw error;
    }
  }

  async function versionReferenceRows(connection, versionId) {
    const [live] = await connection.query(
      `SELECT 1
       FROM webinar_asset_references
       WHERE asset_version_id = ?
       LIMIT 1`,
      [versionId],
    );
    const [history] = await connection.query(
      `SELECT 1
       FROM webinar_revision_asset_references
       WHERE asset_version_id = ?
       LIMIT 1`,
      [versionId],
    );
    return { live, history };
  }

  async function archiveVersion(input) {
    await assertAssetContributor(input);
    return runTransaction(connectionPool, async connection => {
      const version = await selectVersion(connection, input.versionId, { lock: true });
      if (version.status === 'archived') return safeVersionResult(version);
      if (input.isAdmin !== true && Number(version.uploaded_by_user_id) !== input.actorUserId) {
        throw accessDenied();
      }
      const { live, history } = await versionReferenceRows(connection, version.id);
      if (live[0]) throw conflict('ASSET_IN_USE', 'Asset version is in current use');
      if (history[0]) {
        throw conflict('ASSET_IN_USE_BY_REVISION', 'Asset version is required by revision history');
      }
      const [result] = await connection.query(
        `UPDATE webinar_asset_versions
         SET status = 'archived', archived_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status <> 'archived'`,
        [version.id],
      );
      if (!result.affectedRows) {
        const current = await selectVersion(connection, version.id);
        if (current.status !== 'archived') {
          throw conflict('ASSET_STATE_CONFLICT', 'Asset version state changed');
        }
        return safeVersionResult(current);
      }
      await recordAuditEvent(connection, {
        actorUserId: input.actorUserId,
        eventType: 'asset_version_archived',
        targetType: 'asset_version',
        targetId: version.id,
        metadata: { archived: true },
      });
      return { versionId: version.id, status: 'archived' };
    });
  }

  async function familyReferenceRows(connection, assetId) {
    const [live] = await connection.query(
      `SELECT 1
       FROM webinar_asset_references ar
       JOIN webinar_asset_versions v ON v.id = ar.asset_version_id
       WHERE v.asset_id = ?
       LIMIT 1`,
      [assetId],
    );
    const [history] = await connection.query(
      `SELECT 1
       FROM webinar_revision_asset_references rar
       JOIN webinar_asset_versions v ON v.id = rar.asset_version_id
       WHERE v.asset_id = ?
       LIMIT 1`,
      [assetId],
    );
    return { live, history };
  }

  async function updateFamily(input) {
    await assertAssetContributor(input);
    return runTransaction(connectionPool, async connection => {
      const [rows] = await connection.query(
        `SELECT id, created_by_user_id, display_name, description, created_at, archived_at
         FROM webinar_assets
         WHERE id = ? AND archived_at IS NULL
         FOR UPDATE`,
        [input.assetId],
      );
      const family = rows[0];
      if (!family) throw notFound('ASSET_NOT_FOUND', 'Asset family not found');
      if (input.isAdmin !== true && Number(family.created_by_user_id) !== input.actorUserId) {
        throw accessDenied();
      }

      if (input.archive === true || input.archived === true) {
        const { live, history } = await familyReferenceRows(connection, family.id);
        if (live[0]) throw conflict('ASSET_IN_USE', 'Asset family is in current use');
        if (history[0]) throw conflict('ASSET_IN_USE_BY_REVISION', 'Asset family is required by revision history');
        const [result] = await connection.query(
          `UPDATE webinar_assets SET archived_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND archived_at IS NULL`,
          [family.id],
        );
        if (!result.affectedRows) throw conflict('ASSET_STATE_CONFLICT', 'Asset family state changed');
        await recordAuditEvent(connection, {
          actorUserId: input.actorUserId,
          eventType: 'asset_archived',
          targetType: 'asset',
          targetId: family.id,
          metadata: { archived: true },
        });
        return { id: family.id, archived: true };
      }

      const displayName = input.displayName === undefined
        ? family.display_name
        : text(input.displayName, { required: true });
      const description = input.description === undefined
        ? family.description
        : text(input.description, { maximum: 65535 });
      await connection.query(
        `UPDATE webinar_assets SET display_name = ?, description = ? WHERE id = ?`,
        [displayName, description, family.id],
      );
      await recordAuditEvent(connection, {
        actorUserId: input.actorUserId,
        eventType: 'asset_updated',
        targetType: 'asset',
        targetId: family.id,
        metadata: {},
      });
      return { id: family.id, displayName, description };
    });
  }

  async function getUsage(input) {
    await assertAssetContributor(input);
    await selectVersion(connectionPool, input.versionId);
    const [currentRows] = await connectionPool.query(
      `SELECT ar.webinar_id, p.title AS webinar_title, ar.slide_id,
              s.title AS slide_title, ar.surface
       FROM webinar_asset_references ar
       JOIN webinar_presentations p ON p.id = ar.webinar_id
       LEFT JOIN webinar_slides s ON s.id = ar.slide_id
       WHERE ar.asset_version_id = ?
       ORDER BY p.title ASC, ar.webinar_id ASC, ar.surface ASC, ar.slide_id ASC`,
      [input.versionId],
    );
    const [historyRows] = await connectionPool.query(
      `SELECT rar.revision_id, r.webinar_id, p.title AS webinar_title,
              r.version AS webinar_version
       FROM webinar_revision_asset_references rar
       JOIN webinar_revisions r ON r.id = rar.revision_id
       JOIN webinar_presentations p ON p.id = r.webinar_id
       WHERE rar.asset_version_id = ?
       ORDER BY r.version DESC, rar.revision_id DESC`,
      [input.versionId],
    );
    return {
      versionId: input.versionId,
      current: currentRows.map(row => ({
        webinarId: Number(row.webinar_id),
        webinarTitle: row.webinar_title,
        slideId: row.slide_id,
        slideTitle: row.slide_title,
        surface: row.surface,
      })),
      history: historyRows.map(row => ({
        revisionId: Number(row.revision_id),
        webinarId: Number(row.webinar_id),
        webinarTitle: row.webinar_title,
        webinarVersion: Number(row.webinar_version),
      })),
    };
  }

  return {
    assertAssetContributor,
    listCatalog,
    createUploadIntent,
    createVersionIntent,
    confirmUpload,
    updateFamily,
    archiveVersion,
    getUsage,
  };
}

const service = createCatalogService();

module.exports = {
  AssetCatalogError,
  mapScanFailure,
  createCatalogService,
  ...service,
};
