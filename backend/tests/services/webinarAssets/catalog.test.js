import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCatalogService } = require('../../../services/webinarAssets/catalog');

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const NEW_ASSET_ID = '44444444-4444-4444-8444-444444444444';
const NEW_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const THIRD_VERSION_ID = '66666666-6666-4666-8666-666666666666';
const SHA256 = 'a'.repeat(64);
const OTHER_SHA256 = 'b'.repeat(64);
const PROCESSING_FAILURE = Object.freeze({
  status: 503,
  code: 'ASSET_SCANNER_FAILURE',
  message: 'Webinar asset processing is temporarily unavailable',
});

function clone(value) {
  return structuredClone(value);
}

function initialState(overrides = {}) {
  return {
    presentations: [{ id: 12, title: 'First-time buyer', primary_owner_user_id: 7, archived_at: null }],
    families: [{
      id: ASSET_ID,
      display_name: 'Brand mark',
      description: 'Primary logo',
      created_by_user_id: 7,
      created_at: '2026-09-04T10:00:00.000Z',
      archived_at: null,
    }],
    versions: [{
      id: VERSION_ID,
      asset_id: ASSET_ID,
      version_number: 1,
      original_filename: 'private-brand-name.png',
      media_type: 'image',
      mime_type: 'image/png',
      byte_size: 68,
      sha256: null,
      s3_key: `quarantine/${VERSION_ID}/private-brand-name.png`,
      width: null,
      height: null,
      duration_ms: null,
      status: 'processing',
      rejection_code: null,
      uploaded_by_user_id: 7,
      uploader_name: 'Owner',
      created_at: '2026-09-04T10:01:00.000Z',
      archived_at: null,
    }],
    liveReferences: [],
    revisionReferences: [],
    audits: [],
    ...clone(overrides),
  };
}

function database(seed = initialState()) {
  let committed = clone(seed);
  let pending = null;
  const stages = [];

  function rowsFor(sql, params, state) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.includes('SELECT 1 AS allowed FROM webinar_presentations')) {
      return [state.presentations.some(row => Number(row.primary_owner_user_id) === Number(params[0]) && !row.archived_at)
        ? [{ allowed: 1 }]
        : []];
    }

    if (normalized.includes('FROM webinar_asset_versions v') && normalized.includes('WHERE v.id = ?')) {
      const version = state.versions.find(row => row.id === params[0]);
      const family = version && state.families.find(row => row.id === version.asset_id);
      return [[version && family ? {
        ...version,
        family_created_by_user_id: family.created_by_user_id,
        family_archived_at: family.archived_at,
      } : null].filter(Boolean)];
    }

    if (normalized.includes('FROM webinar_assets a') && normalized.includes('JOIN webinar_asset_versions v')) {
      return [state.versions.flatMap(version => {
        const family = state.families.find(row => row.id === version.asset_id);
        if (!family) return [];
        return [{
          asset_id: family.id,
          display_name: family.display_name,
          description: family.description,
          family_created_by_user_id: family.created_by_user_id,
          family_created_at: family.created_at,
          family_archived_at: family.archived_at,
          version_id: version.id,
          version_number: version.version_number,
          media_type: version.media_type,
          mime_type: version.mime_type,
          byte_size: version.byte_size,
          sha256: version.sha256,
          s3_key: version.s3_key,
          width: version.width,
          height: version.height,
          duration_ms: version.duration_ms,
          status: version.status,
          rejection_code: version.rejection_code,
          uploaded_by_user_id: version.uploaded_by_user_id,
          uploader_name: version.uploader_name,
          version_created_at: version.created_at,
          version_archived_at: version.archived_at,
        }];
      })];
    }

    if (normalized.includes('FROM webinar_assets') && normalized.includes('WHERE id = ?') && normalized.includes('FOR UPDATE')) {
      stages.push('family-lock');
      return [[state.families.find(row => row.id === params[0] && !row.archived_at)].filter(Boolean)];
    }

    if (normalized.includes('MAX(version_number)')) {
      stages.push('version-number');
      const matching = state.versions.filter(row => row.asset_id === params[0]);
      return [[{ maximum_version: matching.reduce((maximum, row) => Math.max(maximum, row.version_number), 0) }]];
    }

    if (normalized.includes('FROM webinar_asset_versions') && normalized.includes('sha256 = ?')) {
      return [[state.versions.find(row => row.sha256 === params[0] && row.status === 'available' && !row.archived_at)].filter(Boolean)];
    }

    if (normalized.includes('FROM webinar_asset_references ar') && normalized.includes('JOIN webinar_presentations')) {
      return [state.liveReferences.filter(row => row.asset_version_id === params[0]).map(row => ({ ...row }))];
    }

    if (normalized.includes('FROM webinar_revision_asset_references rar') && normalized.includes('JOIN webinar_revisions')) {
      return [state.revisionReferences.filter(row => row.asset_version_id === params[0]).map(row => ({ ...row }))];
    }

    if (normalized.includes('FROM webinar_asset_references ar') && normalized.includes('JOIN webinar_asset_versions v')) {
      stages.push('family-live-reference-check');
      return [state.liveReferences.filter(reference => state.versions.some(version => (
        version.id === reference.asset_version_id && version.asset_id === params[0]
      ))).slice(0, 1)];
    }

    if (normalized.includes('FROM webinar_revision_asset_references rar') && normalized.includes('JOIN webinar_asset_versions v')) {
      stages.push('family-revision-reference-check');
      return [state.revisionReferences.filter(reference => state.versions.some(version => (
        version.id === reference.asset_version_id && version.asset_id === params[0]
      ))).slice(0, 1)];
    }

    if (normalized.includes('FROM webinar_asset_references') && normalized.includes('asset_version_id = ?')) {
      stages.push('live-reference-check');
      return [state.liveReferences.filter(row => row.asset_version_id === params[0]).slice(0, 1)];
    }

    if (normalized.includes('FROM webinar_revision_asset_references') && normalized.includes('asset_version_id = ?')) {
      stages.push('revision-reference-check');
      return [state.revisionReferences.filter(row => row.asset_version_id === params[0]).slice(0, 1)];
    }

    if (normalized.startsWith('INSERT INTO webinar_assets')) {
      state.families.push({
        id: params[0], display_name: params[1], description: params[2], created_by_user_id: params[3],
        created_at: '2026-09-04T11:00:00.000Z', archived_at: null,
      });
      stages.push('family-insert');
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith('INSERT INTO webinar_asset_versions')) {
      state.versions.push({
        id: params[0], asset_id: params[1], version_number: params[2], original_filename: params[3],
        media_type: params[4], mime_type: params[5], byte_size: params[6], sha256: null,
        s3_key: params[7], width: null, height: null, duration_ms: null, status: 'processing',
        rejection_code: null, uploaded_by_user_id: params[8], uploader_name: 'Owner',
        created_at: '2026-09-04T11:01:00.000Z', archived_at: null,
      });
      stages.push('version-insert');
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE webinar_asset_versions SET status = 'available'")) {
      const version = state.versions.find(row => row.id === params[8]);
      if (!version || version.status !== 'processing') return [{ affectedRows: 0 }];
      Object.assign(version, {
        status: 'available', sha256: params[0], s3_key: params[1], media_type: params[2],
        mime_type: params[3], byte_size: params[4], width: params[5], height: params[6],
        duration_ms: params[7],
      });
      stages.push('available-update');
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE webinar_asset_versions SET status = 'rejected'")) {
      const version = state.versions.find(row => row.id === params[1]);
      if (!version || version.status !== 'processing') return [{ affectedRows: 0 }];
      Object.assign(version, { status: 'rejected', rejection_code: params[0] });
      stages.push('rejected-update');
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE webinar_asset_versions SET status = 'archived'")) {
      const version = state.versions.find(row => row.id === params[0]);
      if (!version || version.status === 'archived') return [{ affectedRows: 0 }];
      Object.assign(version, { status: 'archived', archived_at: '2026-09-04T12:00:00.000Z' });
      stages.push('version-archive');
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith('UPDATE webinar_assets SET display_name = ?')) {
      const family = state.families.find(row => row.id === params[2]);
      if (!family) return [{ affectedRows: 0 }];
      family.display_name = params[0];
      family.description = params[1];
      stages.push('family-update');
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith('UPDATE webinar_assets SET archived_at = CURRENT_TIMESTAMP')) {
      const family = state.families.find(row => row.id === params[0]);
      if (!family || family.archived_at) return [{ affectedRows: 0 }];
      family.archived_at = '2026-09-04T12:00:00.000Z';
      stages.push('family-archive');
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unhandled test query: ${normalized}`);
  }

  const connection = {
    beginTransaction: vi.fn(async () => { pending = clone(committed); stages.push('begin'); }),
    commit: vi.fn(async () => { committed = pending; pending = null; stages.push('commit'); }),
    rollback: vi.fn(async () => { pending = null; stages.push('rollback'); }),
    release: vi.fn(() => stages.push('release')),
    destroy: vi.fn(),
    query: vi.fn(async (sql, params = []) => rowsFor(sql, params, pending || committed)),
  };
  const db = {
    query: vi.fn(async (sql, params = []) => rowsFor(sql, params, committed)),
    getConnection: vi.fn().mockResolvedValue(connection),
  };
  return { db, connection, stages, state: () => clone(committed) };
}

function fixture(overrides = {}) {
  const model = database(overrides.state || initialState());
  const uuidValues = [...(overrides.uuidValues || [NEW_ASSET_ID, NEW_VERSION_ID, SECOND_VERSION_ID, THIRD_VERSION_ID])];
  const storage = {
    createUploadUrl: vi.fn(async ({ versionId }) => ({
      uploadUrl: 'https://signed.example/one-time-upload',
      key: `quarantine/${versionId}/private-upload-name.png`,
      expiresInSeconds: 600,
    })),
    readScanStatus: vi.fn().mockResolvedValue(null),
    readQuarantineObject: vi.fn().mockResolvedValue({ privateStream: true }),
    makeApprovedKey: vi.fn((sha256) => `approved/sha256/${sha256}/asset`),
    putApprovedObject: vi.fn().mockResolvedValue(undefined),
    ...overrides.storage,
  };
  const inspection = {
    inspectAsset: vi.fn().mockResolvedValue({
      mediaType: 'image', mimeType: 'image/png', byteSize: 68, sha256: SHA256,
      width: 1, height: 1, durationMs: null, approvedBody: Buffer.from('private approved bytes'),
    }),
    ...overrides.inspection,
  };
  const recordAuditEvent = overrides.recordAuditEvent || vi.fn(async (_connection, event) => {
    model.state().audits?.push(event);
    return { id: 1 };
  });
  const recordOperationalEvent = overrides.recordOperationalEvent || vi.fn();
  const api = createCatalogService({
    db: model.db,
    storage,
    inspection,
    recordAuditEvent,
    recordOperationalEvent,
    randomUUID: () => uuidValues.shift(),
    makePublicUrl: (_config, key) => `https://assets.example/${key}`,
    config: { bucket: 'unused-in-tests', cdnBaseUrl: 'https://assets.example', quarantinePrefix: 'quarantine/' },
  });
  return { ...model, api, storage, inspection, recordAuditEvent, recordOperationalEvent };
}

function safeSerialization(value) {
  return JSON.stringify(value);
}

function expectSafeProcessingFailure(error, cause) {
  expect(error).toMatchObject(PROCESSING_FAILURE);
  expect(error.cause).toBe(cause);
  expect(Object.prototype.propertyIsEnumerable.call(error, 'cause')).toBe(false);
  expect(safeSerialization(error)).not.toMatch(/private|bucket|quarantine|request/i);
}

describe('Webinar Studio shared asset catalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('permits only an administrator or the primary owner of an active webinar to enter the shared catalog', async () => {
    const owner = fixture();
    await expect(owner.api.assertAssetContributor({ actorUserId: 7, isAdmin: false })).resolves.toBeUndefined();

    const admin = fixture({ state: initialState({ presentations: [] }) });
    await expect(admin.api.assertAssetContributor({ actorUserId: 1, isAdmin: true })).resolves.toBeUndefined();

    const outsider = fixture({ state: initialState({ presentations: [] }) });
    await expect(outsider.api.assertAssetContributor({ actorUserId: 8, isAdmin: false }))
      .rejects.toMatchObject({ status: 403, code: 'WEBINAR_ACCESS_DENIED' });
  });

  it('checks contributor access before every shared catalog read or mutation', async () => {
    const { api, db, storage } = fixture({ state: initialState({ presentations: [] }) });
    const calls = [
      () => api.listCatalog({ actorUserId: 8, isAdmin: false }),
      () => api.createUploadIntent({ actorUserId: 8, isAdmin: false, displayName: 'No', filename: 'no.png', contentType: 'image/png', byteSize: 10 }),
      () => api.createVersionIntent({ actorUserId: 8, isAdmin: false, assetId: ASSET_ID, filename: 'no.png', contentType: 'image/png', byteSize: 10 }),
      () => api.confirmUpload({ actorUserId: 8, isAdmin: false, versionId: VERSION_ID }),
      () => api.updateFamily({ actorUserId: 8, isAdmin: false, assetId: ASSET_ID, displayName: 'No' }),
      () => api.archiveVersion({ actorUserId: 8, isAdmin: false, assetId: ASSET_ID, versionId: VERSION_ID }),
      () => api.getUsage({ actorUserId: 8, isAdmin: false, versionId: VERSION_ID }),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ status: 403, code: 'WEBINAR_ACCESS_DENIED' });
    }
    expect(db.getConnection).not.toHaveBeenCalled();
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
    expect(storage.readScanStatus).not.toHaveBeenCalled();
    expect(db.query.mock.calls.every(([sql]) => sql.includes('webinar_presentations'))).toBe(true);
  });

  it('creates a processing family/version transaction and returns only the one-time upload contract', async () => {
    const { api, state, stages } = fixture();
    const result = await api.createUploadIntent({
      actorUserId: 7, isAdmin: false, displayName: 'Closing timeline', description: 'Reusable art',
      filename: 'timeline.png', contentType: 'image/png', byteSize: 68,
    });

    expect(result).toEqual({
      assetId: NEW_ASSET_ID,
      versionId: NEW_VERSION_ID,
      uploadUrl: 'https://signed.example/one-time-upload',
      expiresInSeconds: 600,
    });
    expect(safeSerialization(result)).not.toMatch(/s3|key|filename|private-upload/i);
    expect(state().families.find(row => row.id === NEW_ASSET_ID)).toMatchObject({
      display_name: 'Closing timeline', description: 'Reusable art', created_by_user_id: 7,
    });
    expect(state().versions.find(row => row.id === NEW_VERSION_ID)).toMatchObject({
      asset_id: NEW_ASSET_ID, version_number: 1, status: 'processing', uploaded_by_user_id: 7,
    });
    expect(stages).toEqual(expect.arrayContaining(['begin', 'family-insert', 'version-insert', 'commit']));
  });

  it('serializes new family-version numbers with a row lock', async () => {
    const { api, state, stages } = fixture({ uuidValues: [SECOND_VERSION_ID, THIRD_VERSION_ID] });
    await api.createVersionIntent({
      actorUserId: 7, isAdmin: false, assetId: ASSET_ID,
      filename: 'replacement.png', contentType: 'image/png', byteSize: 68,
    });
    await api.createVersionIntent({
      actorUserId: 7, isAdmin: false, assetId: ASSET_ID,
      filename: 'replacement-again.png', contentType: 'image/png', byteSize: 68,
    });

    expect(state().versions.filter(row => row.asset_id === ASSET_ID).map(row => row.version_number)).toEqual([1, 2, 3]);
    expect(stages.filter(stage => stage === 'family-lock')).toHaveLength(2);
    expect(stages.indexOf('family-lock')).toBeLessThan(stages.indexOf('version-number'));
    expect(stages.indexOf('version-number')).toBeLessThan(stages.indexOf('version-insert'));
  });

  it('keeps an upload processing when the malware scan tag is absent', async () => {
    const { api, inspection, recordOperationalEvent } = fixture();
    await expect(api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .resolves.toEqual({ versionId: VERSION_ID, status: 'processing' });
    expect(inspection.inspectAsset).not.toHaveBeenCalled();
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_scan_pending', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_SCAN_PENDING',
    });
    expect(safeSerialization(recordOperationalEvent.mock.calls)).not.toMatch(/quarantine|filename|upload|privateStream/i);
  });

  it('makes an explicitly clean upload available only after inspection and immutable approved storage', async () => {
    const { api, storage, state, recordOperationalEvent } = fixture({
      storage: { readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND') },
    });

    await expect(api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .resolves.toEqual({
        versionId: VERSION_ID,
        status: 'available',
        sha256: SHA256,
        publicUrl: `https://assets.example/approved/sha256/${SHA256}/asset`,
      });
    expect(safeSerialization(await api.listCatalog({ actorUserId: 7, isAdmin: false })))
      .not.toContain('private-brand-name.png');
    expect(storage.putApprovedObject).toHaveBeenCalledOnce();
    expect(state().versions[0]).toMatchObject({ status: 'available', sha256: SHA256, width: 1, height: 1 });
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_available', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_AVAILABLE',
    });
  });

  it.each([
    ['a legacy filename leaf', `approved/sha256/${SHA256}/private-legacy-name.png`],
    ['a path hash that disagrees with the version SHA-256', `approved/sha256/${OTHER_SHA256}/asset`],
  ])('fails closed before emitting a terminal public URL for %s', async (_scenario, badKey) => {
    const version = {
      ...initialState().versions[0],
      status: 'available',
      sha256: SHA256,
      s3_key: badKey,
    };
    const { api, storage, recordOperationalEvent } = fixture({
      state: initialState({ versions: [version] }),
    });

    let error;
    try {
      await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject(PROCESSING_FAILURE);
    expect(error.cause).toBeUndefined();
    expect(safeSerialization(error)).not.toMatch(/private-legacy-name|approved\/sha256|\.png/i);
    expect(storage.readScanStatus).not.toHaveBeenCalled();
    expect(recordOperationalEvent).toHaveBeenCalledTimes(1);
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_scanner_failure', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_SCANNER_FAILURE',
    });
    expect(Object.getOwnPropertySymbols(error).some(symbol => (
      Object.getOwnPropertyDescriptor(error, symbol)?.enumerable === false
    ))).toBe(true);
    expect(safeSerialization(recordOperationalEvent.mock.calls))
      .not.toMatch(/private-legacy-name|approved\/sha256|\.png|bucket|scanner details/i);
  });

  it('fails closed before listing a legacy filename-bearing available database key', async () => {
    const legacyKey = `approved/sha256/${SHA256}/private-legacy-name.png`;
    const version = {
      ...initialState().versions[0],
      status: 'available',
      sha256: SHA256,
      s3_key: legacyKey,
    };
    const { api, recordOperationalEvent } = fixture({
      state: initialState({ versions: [version] }),
    });

    let error;
    try {
      await api.listCatalog({ actorUserId: 7, isAdmin: false });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject(PROCESSING_FAILURE);
    expect(error.cause).toBeUndefined();
    expect(safeSerialization(error)).not.toMatch(/private-legacy-name|approved\/sha256|\.png/i);
    expect(recordOperationalEvent).toHaveBeenCalledTimes(1);
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_scanner_failure', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_SCANNER_FAILURE',
    });
    expect(safeSerialization(recordOperationalEvent.mock.calls))
      .not.toMatch(/private-legacy-name|approved\/sha256|\.png|bucket|scanner details/i);
  });

  it.each([
    ['THREATS_FOUND', 'MALWARE_DETECTED'],
    ['UNSUPPORTED', 'MALWARE_SCAN_FAILED'],
    ['ACCESS_DENIED', 'MALWARE_SCAN_FAILED'],
    ['FAILED', 'MALWARE_SCAN_FAILED'],
    ['an-unknown-scanner-value', 'MALWARE_SCAN_FAILED'],
  ])('rejects scan status %s without reading or approving the object', async (scanStatus, rejectionCode) => {
    const { api, storage, inspection, state, recordOperationalEvent } = fixture({
      storage: { readScanStatus: vi.fn().mockResolvedValue(scanStatus) },
    });
    await expect(api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .resolves.toEqual({ versionId: VERSION_ID, status: 'rejected', rejectionCode });
    expect(state().versions[0]).toMatchObject({ status: 'rejected', rejection_code: rejectionCode });
    expect(storage.readQuarantineObject).not.toHaveBeenCalled();
    expect(inspection.inspectAsset).not.toHaveBeenCalled();
    expect(storage.putApprovedObject).not.toHaveBeenCalled();
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_scan_rejected', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_SCAN_REJECTED',
    });
  });

  it('fails closed on a scanner read failure and leaves the row processing', async () => {
    const scannerFailure = new Error('private scanner details');
    const { api, state, recordOperationalEvent } = fixture({
      storage: { readScanStatus: vi.fn().mockRejectedValue(scannerFailure) },
    });
    let error;
    try {
      await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    } catch (caught) {
      error = caught;
    }
    expectSafeProcessingFailure(error, scannerFailure);
    expect(state().versions[0].status).toBe('processing');
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_scanner_failure', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_SCANNER_FAILURE',
    });
    expect(recordOperationalEvent).toHaveBeenCalledTimes(1);
    expect(safeSerialization(recordOperationalEvent.mock.calls)).not.toContain('private scanner details');
  });

  it('turns an inspection rejection into a safe terminal result without approved storage', async () => {
    const inspectionFailure = Object.assign(new Error('private decoded bytes'), { code: 'ASSET_INSPECTION_MIME_MISMATCH' });
    const { api, state, storage, recordOperationalEvent } = fixture({
      storage: { readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND') },
      inspection: { inspectAsset: vi.fn().mockRejectedValue(inspectionFailure) },
    });
    await expect(api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .resolves.toEqual({
        versionId: VERSION_ID, status: 'rejected', rejectionCode: 'ASSET_INSPECTION_MIME_MISMATCH',
      });
    expect(state().versions[0]).toMatchObject({
      status: 'rejected', rejection_code: 'ASSET_INSPECTION_MIME_MISMATCH',
    });
    expect(storage.putApprovedObject).not.toHaveBeenCalled();
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_inspection_rejected', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_INSPECTION_REJECTED',
    });
    expect(safeSerialization(recordOperationalEvent.mock.calls)).not.toContain('private decoded bytes');
  });

  it('leaves the row processing when clean-tagged quarantine storage cannot be read', async () => {
    const storageFailure = new Error('private storage failure');
    const { api, state, recordOperationalEvent } = fixture({
      storage: {
        readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND'),
        readQuarantineObject: vi.fn().mockRejectedValue(storageFailure),
      },
    });

    let error;
    try {
      await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    } catch (caught) {
      error = caught;
    }
    expectSafeProcessingFailure(error, storageFailure);
    expect(state().versions[0]).toMatchObject({ status: 'processing', rejection_code: null });
    expect(recordOperationalEvent).toHaveBeenCalledWith('webinar.asset_scanner_failure', {
      actorUserId: 7, assetVersionId: VERSION_ID, reasonCode: 'ASSET_SCANNER_FAILURE',
    });
    expect(recordOperationalEvent).toHaveBeenCalledTimes(1);
    expect(safeSerialization(recordOperationalEvent.mock.calls)).not.toContain('private storage failure');
  });

  it('locks the processing version before attempting the immutable approved write', async () => {
    const current = fixture({
      storage: { readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND') },
    });
    let heldVersionLock = false;
    current.storage.putApprovedObject.mockImplementation(async () => {
      heldVersionLock = current.connection.query.mock.calls.some(([sql]) => (
        sql.includes('FROM webinar_asset_versions v')
        && sql.includes('WHERE v.id = ?')
        && sql.includes('FOR UPDATE')
      ));
    });

    await current.api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    expect(heldVersionLock).toBe(true);
  });

  it('reuses an immutable hash destination left by a prior rolled-back release attempt', async () => {
    const alreadyExists = Object.assign(new Error('private S3 precondition response'), {
      name: 'PreconditionFailed',
      $metadata: { httpStatusCode: 412 },
    });
    const { api, storage, state } = fixture({
      storage: {
        readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND'),
        putApprovedObject: vi.fn().mockRejectedValue(alreadyExists),
      },
    });

    await expect(api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .resolves.toMatchObject({ status: 'available', sha256: SHA256 });
    expect(storage.putApprovedObject).toHaveBeenCalledOnce();
    expect(state().versions[0]).toMatchObject({ status: 'available', sha256: SHA256 });
  });

  it('converts an unknown approved-release failure to the generic trusted processing error', async () => {
    const releaseFailure = Object.assign(new Error('private bucket/key/request details'), {
      bucket: 'private-bucket',
      requestId: 'private-request',
    });
    const { api, state } = fixture({
      storage: {
        readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND'),
        putApprovedObject: vi.fn().mockRejectedValue(releaseFailure),
      },
    });

    let error;
    try {
      await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    } catch (caught) {
      error = caught;
    }
    expectSafeProcessingFailure(error, releaseFailure);
    expect(state().versions[0]).toMatchObject({ status: 'processing', rejection_code: null });
  });

  it('reuses an available approved object with the same SHA-256 instead of storing duplicate bytes', async () => {
    const existing = {
      id: SECOND_VERSION_ID, asset_id: ASSET_ID, version_number: 2,
      original_filename: 'different-private-name.png', media_type: 'image', mime_type: 'image/png',
      byte_size: 68, sha256: SHA256, s3_key: `approved/sha256/${SHA256}/asset`,
      width: 1, height: 1, duration_ms: null, status: 'available', rejection_code: null,
      uploaded_by_user_id: 7, uploader_name: 'Owner', created_at: '2026-09-04T09:00:00.000Z', archived_at: null,
    };
    const state = initialState({ versions: [...initialState().versions, existing] });
    const { api, storage, state: readState } = fixture({
      state,
      storage: { readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND') },
    });

    const result = await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    expect(result.publicUrl).toBe(`https://assets.example/${existing.s3_key}`);
    expect(storage.putApprovedObject).not.toHaveBeenCalled();
    expect(readState().versions.find(row => row.id === VERSION_ID).s3_key).toBe(existing.s3_key);
    expect(safeSerialization(result)).not.toContain('s3_key');
  });

  it('fails closed instead of reusing a legacy filename-bearing approved database key', async () => {
    const legacyKey = `approved/sha256/${SHA256}/private-legacy-name.png`;
    const existing = {
      id: SECOND_VERSION_ID, asset_id: ASSET_ID, version_number: 2,
      original_filename: 'different-private-name.png', media_type: 'image', mime_type: 'image/png',
      byte_size: 68, sha256: SHA256, s3_key: legacyKey,
      width: 1, height: 1, duration_ms: null, status: 'available', rejection_code: null,
      uploaded_by_user_id: 7, uploader_name: 'Owner', created_at: '2026-09-04T09:00:00.000Z', archived_at: null,
    };
    const { api, storage, state } = fixture({
      state: initialState({ versions: [...initialState().versions, existing] }),
      storage: { readScanStatus: vi.fn().mockResolvedValue('NO_THREATS_FOUND') },
    });

    let error;
    try {
      await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject(PROCESSING_FAILURE);
    expect(error.cause).toBeUndefined();
    expect(safeSerialization(error)).not.toMatch(/private-legacy-name|approved\/sha256|\.png/i);
    expect(storage.putApprovedObject).not.toHaveBeenCalled();
    expect(state().versions.find(row => row.id === VERSION_ID)).toMatchObject({
      status: 'processing',
      sha256: null,
    });
  });

  it.each(['available', 'rejected', 'archived'])('does not re-scan or rewrite a terminal %s version', async status => {
    const rejectionCode = status === 'rejected' ? 'MALWARE_DETECTED' : null;
    const archivedAt = status === 'archived' ? '2026-09-04T12:00:00.000Z' : null;
    const version = { ...initialState().versions[0], status, rejection_code: rejectionCode, archived_at: archivedAt };
    if (status === 'available') {
      Object.assign(version, { sha256: SHA256, s3_key: `approved/sha256/${SHA256}/asset` });
    }
    const { api, storage, connection } = fixture({ state: initialState({ versions: [version] }) });

    const result = await api.confirmUpload({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    expect(result.status).toBe(status);
    expect(storage.readScanStatus).not.toHaveBeenCalled();
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('UPDATE webinar_asset_versions'))).toBe(false);
  });

  it('allows only the uploader to archive their unreferenced version, with an administrator override', async () => {
    const deniedVersion = { ...initialState().versions[0], uploaded_by_user_id: 8 };
    const denied = fixture({ state: initialState({ versions: [deniedVersion] }) });
    await expect(denied.api.archiveVersion({ assetId: ASSET_ID, versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .rejects.toMatchObject({ status: 403, code: 'WEBINAR_ACCESS_DENIED' });
    expect(denied.state().versions[0].status).toBe('processing');

    const uploader = fixture();
    await expect(uploader.api.archiveVersion({ assetId: ASSET_ID, versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .resolves.toEqual({ versionId: VERSION_ID, status: 'archived' });

    const admin = fixture({ state: initialState({ presentations: [], versions: [deniedVersion] }) });
    await expect(admin.api.archiveVersion({ assetId: ASSET_ID, versionId: VERSION_ID, actorUserId: 1, isAdmin: true }))
      .resolves.toEqual({ versionId: VERSION_ID, status: 'archived' });
  });

  it('rejects a version that does not belong to the asset family in the URL', async () => {
    const { api, state, stages } = fixture();

    await expect(api.archiveVersion({
      assetId: NEW_ASSET_ID,
      versionId: VERSION_ID,
      actorUserId: 7,
      isAdmin: false,
    })).rejects.toMatchObject({
      status: 404,
      code: 'ASSET_VERSION_NOT_FOUND',
      message: 'Asset version not found',
    });

    expect(state().versions[0].status).toBe('processing');
    expect(stages).toContain('rollback');
    expect(stages).not.toContain('live-reference-check');
    expect(stages).not.toContain('version-archive');
  });

  it('checks both reference stores and denies archive for live use', async () => {
    const liveReference = {
      asset_version_id: VERSION_ID, webinar_id: 12, webinar_title: 'First-time buyer',
      slide_id: null, slide_title: null, surface: 'master_css',
    };
    const { api, state, stages } = fixture({ state: initialState({ liveReferences: [liveReference] }) });
    await expect(api.archiveVersion({ assetId: ASSET_ID, versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .rejects.toMatchObject({ status: 409, code: 'ASSET_IN_USE' });
    expect(state().versions[0].status).toBe('processing');
    expect(stages).toEqual(expect.arrayContaining(['live-reference-check', 'revision-reference-check', 'rollback']));
    expect(stages).not.toContain('version-archive');
  });

  it('checks both reference stores and denies archive for revision-only use', async () => {
    const revisionReference = {
      asset_version_id: VERSION_ID, revision_id: 91, webinar_id: 12,
      webinar_title: 'First-time buyer', webinar_version: 4,
    };
    const { api, state, stages } = fixture({ state: initialState({ revisionReferences: [revisionReference] }) });
    await expect(api.archiveVersion({ assetId: ASSET_ID, versionId: VERSION_ID, actorUserId: 7, isAdmin: false }))
      .rejects.toMatchObject({ status: 409, code: 'ASSET_IN_USE_BY_REVISION' });
    expect(state().versions[0].status).toBe('processing');
    expect(stages).toEqual(expect.arrayContaining(['live-reference-check', 'revision-reference-check', 'rollback']));
  });

  it('classifies current and historical usage without returning source or revision snapshots', async () => {
    const liveReference = {
      asset_version_id: VERSION_ID, webinar_id: 12, webinar_title: 'First-time buyer',
      slide_id: SECOND_VERSION_ID, slide_title: 'Closing', surface: 'slide_html',
      html: '<private>', source: '<private>',
    };
    const revisionReference = {
      asset_version_id: VERSION_ID, revision_id: 91, webinar_id: 12,
      webinar_title: 'First-time buyer', webinar_version: 4,
      snapshot: { masterHtml: '<private>' },
    };
    const { api } = fixture({ state: initialState({
      liveReferences: [liveReference], revisionReferences: [revisionReference],
    }) });

    const usage = await api.getUsage({ versionId: VERSION_ID, actorUserId: 7, isAdmin: false });
    expect(usage).toEqual({
      versionId: VERSION_ID,
      current: [{
        webinarId: 12, webinarTitle: 'First-time buyer', slideId: SECOND_VERSION_ID,
        slideTitle: 'Closing', surface: 'slide_html',
      }],
      history: [{ revisionId: 91, webinarId: 12, webinarTitle: 'First-time buyer', webinarVersion: 4 }],
    });
    expect(safeSerialization(usage)).not.toMatch(/private|snapshot|source|masterHtml|javascript/i);
  });

  it('returns grouped family/version metadata with a public URL only for available versions', async () => {
    const versions = [
      {
        ...initialState().versions[0], status: 'available', sha256: SHA256,
        s3_key: `approved/sha256/${SHA256}/asset`,
      },
      {
        ...initialState().versions[0], id: SECOND_VERSION_ID, version_number: 2,
        status: 'rejected', rejection_code: 'MALWARE_DETECTED', sha256: null,
        s3_key: `quarantine/${SECOND_VERSION_ID}/rejected-private.png`,
      },
      {
        ...initialState().versions[0], id: THIRD_VERSION_ID, version_number: 3,
        status: 'archived', archived_at: '2026-09-04T12:00:00.000Z', sha256: OTHER_SHA256,
        s3_key: `approved/sha256/${OTHER_SHA256}/asset`,
      },
    ];
    const { api } = fixture({ state: initialState({ versions }) });
    const catalog = await api.listCatalog({ actorUserId: 7, isAdmin: false });

    expect(catalog).toEqual([expect.objectContaining({
      id: ASSET_ID,
      displayName: 'Brand mark',
      description: 'Primary logo',
      versions: [
        expect.objectContaining({ id: THIRD_VERSION_ID, versionNumber: 3, status: 'archived' }),
        expect.objectContaining({ id: SECOND_VERSION_ID, versionNumber: 2, status: 'rejected', rejectionCode: 'MALWARE_DETECTED' }),
        expect.objectContaining({
          id: VERSION_ID, versionNumber: 1, status: 'available',
          publicUrl: `https://assets.example/approved/sha256/${SHA256}/asset`,
        }),
      ],
    })]);
    expect(catalog[0].versions[0]).not.toHaveProperty('publicUrl');
    expect(catalog[0].versions[1]).not.toHaveProperty('publicUrl');
    expect(safeSerialization(catalog)).not.toMatch(/s3_key|private-brand-name|rejected-private|archived-private|uploadUrl/i);
  });

  it('limits family metadata changes to the creator or an administrator', async () => {
    const creator = fixture();
    await expect(creator.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 7, isAdmin: false,
      displayName: 'Updated mark', description: 'Updated description',
    })).resolves.toMatchObject({ id: ASSET_ID, displayName: 'Updated mark', description: 'Updated description' });

    const outsider = fixture({ state: initialState({
      presentations: [{ id: 13, primary_owner_user_id: 8, archived_at: null }],
    }) });
    await expect(outsider.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 8, isAdmin: false, displayName: 'Hijacked',
    })).rejects.toMatchObject({ status: 403, code: 'WEBINAR_ACCESS_DENIED' });

    const admin = fixture({ state: initialState({ presentations: [] }) });
    await expect(admin.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 1, isAdmin: true, displayName: 'Admin label',
    })).resolves.toMatchObject({ id: ASSET_ID, displayName: 'Admin label' });
  });

  it('allows the family creator and an administrator to archive an unreferenced family', async () => {
    const creator = fixture();
    await expect(creator.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 7, isAdmin: false, archive: true,
    })).resolves.toEqual({ id: ASSET_ID, archived: true });
    expect(creator.state().families[0].archived_at).not.toBeNull();

    const admin = fixture({ state: initialState({ presentations: [] }) });
    await expect(admin.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 1, isAdmin: true, archive: true,
    })).resolves.toEqual({ id: ASSET_ID, archived: true });
    expect(admin.state().families[0].archived_at).not.toBeNull();
  });

  it('denies family archive to a contributor who did not create the family', async () => {
    const outsider = fixture({ state: initialState({
      presentations: [{ id: 13, primary_owner_user_id: 8, archived_at: null }],
    }) });
    await expect(outsider.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 8, isAdmin: false, archive: true,
    })).rejects.toMatchObject({ status: 403, code: 'WEBINAR_ACCESS_DENIED' });
    expect(outsider.state().families[0].archived_at).toBeNull();
  });

  it('checks both stores and denies family archive for live use', async () => {
    const liveReference = { asset_version_id: VERSION_ID, webinar_id: 12, surface: 'master_css' };
    const current = fixture({ state: initialState({ liveReferences: [liveReference] }) });
    await expect(current.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 7, isAdmin: false, archive: true,
    })).rejects.toMatchObject({ status: 409, code: 'ASSET_IN_USE' });
    expect(current.stages).toEqual(expect.arrayContaining([
      'family-live-reference-check', 'family-revision-reference-check', 'rollback',
    ]));
    expect(current.state().families[0].archived_at).toBeNull();
  });

  it('checks both stores and denies family archive for revision-only use', async () => {
    const revisionReference = { asset_version_id: VERSION_ID, revision_id: 91 };
    const current = fixture({ state: initialState({ revisionReferences: [revisionReference] }) });
    await expect(current.api.updateFamily({
      assetId: ASSET_ID, actorUserId: 7, isAdmin: false, archive: true,
    })).rejects.toMatchObject({ status: 409, code: 'ASSET_IN_USE_BY_REVISION' });
    expect(current.stages).toEqual(expect.arrayContaining([
      'family-live-reference-check', 'family-revision-reference-check', 'rollback',
    ]));
    expect(current.state().families[0].archived_at).toBeNull();
  });
});
