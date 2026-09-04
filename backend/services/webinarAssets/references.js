const { loadAssetConfig, makePublicUrl } = require('./config');
const { collectSurfaceTokens } = require('./tokens');

const CANONICAL_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_APPROVED_KEY = /^approved\/sha256\/([a-f0-9]{64})\/asset$/;

class AssetReferenceError extends Error {
  constructor(code, message = 'Webinar asset reference is invalid', status = 422) {
    super(message);
    this.name = 'AssetReferenceError';
    this.code = code;
    this.status = status;
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assertWebinarId(webinarId) {
  if (!Number.isSafeInteger(webinarId) || webinarId <= 0) {
    throw new AssetReferenceError('ASSET_REFERENCE_INVALID', 'Webinar asset reference is invalid', 400);
  }
}

function assertRevisionId(revisionId) {
  if (!Number.isSafeInteger(revisionId) || revisionId <= 0) {
    throw new AssetReferenceError('ASSET_REFERENCE_INVALID', 'Webinar asset reference is invalid', 400);
  }
}

function createReferenceService({
  config = null,
  loadConfig = loadAssetConfig,
  publicUrl = makePublicUrl,
  collectTokens = collectSurfaceTokens,
} = {}) {
  async function selectVersionsForReference(connection, assetVersionIds) {
    if (!assetVersionIds.length) return [];
    const placeholders = assetVersionIds.map(() => '?').join(', ');
    await connection.query(
      `SELECT a.id
       FROM webinar_assets a
       WHERE EXISTS (
         SELECT 1
         FROM webinar_asset_versions family_version
         WHERE family_version.asset_id = a.id
           AND family_version.id IN (${placeholders})
       )
       ORDER BY a.id
       FOR UPDATE`,
      assetVersionIds,
    );
    const [rows] = await connection.query(
      `SELECT v.id, v.status, v.archived_at, v.sha256, v.s3_key,
              a.archived_at AS family_archived_at
       FROM webinar_asset_versions v
       JOIN webinar_assets a ON a.id = v.asset_id
       WHERE v.id IN (${placeholders})
       ORDER BY v.id
       FOR UPDATE`,
      assetVersionIds,
    );
    return rows;
  }

  async function replaceWebinarReferences(connection, webinarId, references) {
    await connection.query('DELETE FROM webinar_asset_references WHERE webinar_id = ?', [webinarId]);
    for (const reference of references) {
      await connection.query(
        'INSERT INTO webinar_asset_references (webinar_id, slide_id, asset_version_id, surface) VALUES (?, ?, ?, ?)',
        [webinarId, reference.slideId ?? null, reference.assetVersionId, reference.surface],
      );
    }
  }

  async function validateAndReplaceReferences(connection, candidate) {
    assertWebinarId(candidate?.webinarId);
    let references;
    try {
      references = collectTokens(candidate);
    } catch (error) {
      if (error?.code === 'ASSET_TOKEN_FORMAT') {
        throw new AssetReferenceError('ASSET_TOKEN_FORMAT', 'Asset token is invalid');
      }
      throw error;
    }
    const assetVersionIds = sortedUnique(references.map(reference => reference.assetVersionId));
    const versions = await selectVersionsForReference(connection, assetVersionIds);
    const versionsById = new Map(versions.map(version => [version.id, version]));

    if (assetVersionIds.some(assetVersionId => !versionsById.has(assetVersionId))) {
      throw new AssetReferenceError('ASSET_NOT_FOUND', 'Asset version not found');
    }
    if (versions.some(version => {
      const approvedKey = typeof version.s3_key === 'string'
        ? CANONICAL_APPROVED_KEY.exec(version.s3_key)
        : null;
      return version.status !== 'available'
        || version.archived_at !== null
        || version.family_archived_at !== null
        || typeof version.sha256 !== 'string'
        || approvedKey?.[1] !== version.sha256;
    })) {
      throw new AssetReferenceError('ASSET_NOT_AVAILABLE', 'Asset version is not available');
    }

    let urlsByVersionId = new Map();
    if (assetVersionIds.length) {
      const resolvedConfig = config || loadConfig();
      urlsByVersionId = new Map(assetVersionIds.map(assetVersionId => {
        const version = versionsById.get(assetVersionId);
        return [assetVersionId, publicUrl(resolvedConfig, version.s3_key)];
      }));
    }

    await replaceWebinarReferences(connection, candidate.webinarId, references);
    return { urlsByVersionId, assetVersionIds };
  }

  async function recordRevisionAssetReferences(connection, revisionId, assetVersionIds = []) {
    assertRevisionId(revisionId);
    const uniqueIds = sortedUnique(assetVersionIds);
    if (uniqueIds.some(assetVersionId => !CANONICAL_VERSION_ID.test(assetVersionId))) {
      throw new AssetReferenceError('ASSET_REFERENCE_INVALID', 'Webinar asset reference is invalid', 400);
    }
    for (const assetVersionId of uniqueIds) {
      await connection.query(
        'INSERT INTO webinar_revision_asset_references (revision_id, asset_version_id) VALUES (?, ?)',
        [revisionId, assetVersionId],
      );
    }
  }

  return { validateAndReplaceReferences, recordRevisionAssetReferences };
}

const service = createReferenceService();

module.exports = {
  AssetReferenceError,
  createReferenceService,
  ...service,
};
