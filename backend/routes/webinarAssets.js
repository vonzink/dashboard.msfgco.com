const express = require('express');
const { getUserId, isAdmin } = require('../middleware/userContext');
const defaultCatalog = require('../services/webinarAssets/catalog');
const schemas = require('../validation/schemas/webinarAssets');

const CONTROLLED_ERRORS = Object.freeze({
  ASSET_INPUT_INVALID: Object.freeze({ status: 400, message: 'Asset input is invalid' }),
  WEBINAR_ACCESS_DENIED: Object.freeze({
    status: 403,
    message: 'Webinar owner or administrator access required',
  }),
  ASSET_NOT_FOUND: Object.freeze({ status: 404, message: 'Asset family not found' }),
  ASSET_VERSION_NOT_FOUND: Object.freeze({ status: 404, message: 'Asset version not found' }),
  ASSET_IN_USE: Object.freeze({ status: 409, message: 'Asset version is in current use' }),
  ASSET_IN_USE_BY_REVISION: Object.freeze({
    status: 409,
    message: 'Asset version is required by revision history',
  }),
  ASSET_STATE_CONFLICT: Object.freeze({ status: 409, message: 'Asset state changed' }),
  ASSET_SCANNER_FAILURE: Object.freeze({
    status: 503,
    message: 'Webinar asset processing is temporarily unavailable',
  }),
});

function pickDefined(source, keys) {
  const output = {};
  for (const key of keys) {
    if (source && source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function safeUploadIntent(result) {
  return pickDefined(result, ['assetId', 'versionId', 'uploadUrl', 'expiresInSeconds']);
}

function safeVersion(result) {
  return pickDefined(result, ['versionId', 'status', 'sha256', 'publicUrl', 'rejectionCode']);
}

function safeFamily(result) {
  const family = pickDefined(result, [
    'id', 'displayName', 'description', 'createdByUserId', 'createdAt', 'archivedAt', 'archived',
  ]);
  if (Array.isArray(result?.versions)) family.versions = result.versions.map(safeCatalogVersion);
  return family;
}

function safeCatalogVersion(result) {
  return pickDefined(result, [
    'id', 'versionNumber', 'mediaType', 'mimeType', 'byteSize', 'sha256', 'width', 'height',
    'durationMs', 'status', 'rejectionCode', 'uploadedByUserId', 'uploaderName', 'createdAt',
    'archivedAt', 'publicUrl',
  ]);
}

function safeUsage(result) {
  return {
    ...pickDefined(result, ['versionId']),
    current: Array.isArray(result?.current)
      ? result.current.map(row => pickDefined(row, [
        'webinarId', 'webinarTitle', 'slideId', 'slideTitle', 'surface',
      ]))
      : [],
    history: Array.isArray(result?.history)
      ? result.history.map(row => pickDefined(row, [
        'revisionId', 'webinarId', 'webinarTitle', 'webinarVersion',
      ]))
      : [],
  };
}

function createWebinarAssetsRouter({ catalog = defaultCatalog } = {}) {
  const router = express.Router();
  const trustedErrorConstructors = [defaultCatalog.AssetCatalogError, catalog.AssetCatalogError]
    .filter((value, index, values) => typeof value === 'function' && values.indexOf(value) === index);

  function operation(req) {
    return { actorUserId: getUserId(req), isAdmin: isAdmin(req) };
  }

  function parseOrRespond(res, schema, value) {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    res.status(400).json({
      error: 'Invalid request',
      code: 'VALIDATION_FAILED',
      issues: parsed.error.issues.map(issue => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    });
    return null;
  }

  function respondWithError(res, error) {
    const trusted = trustedErrorConstructors.some(ErrorType => error instanceof ErrorType);
    const definition = trusted ? CONTROLLED_ERRORS[error.code] : null;
    if (definition && error.status === definition.status) {
      return res.status(definition.status).json({ error: definition.message, code: error.code });
    }
    return res.status(500).json({
      error: 'Webinar asset operation failed',
      code: 'ASSET_OPERATION_FAILED',
    });
  }

  function asyncRoute(handler) {
    return (req, res) => Promise.resolve(handler(req, res)).catch(error => respondWithError(res, error));
  }

  router.get('/', asyncRoute(async (req, res) => {
    const query = parseOrRespond(res, schemas.listCatalog, req.query);
    if (query === null) return;
    const result = await catalog.listCatalog({ ...operation(req), ...query });
    res.json(Array.isArray(result) ? result.map(safeFamily) : []);
  }));

  router.post('/upload-intents', asyncRoute(async (req, res) => {
    const body = parseOrRespond(res, schemas.createUploadIntent, req.body);
    if (body === null) return;
    res.status(201).json(safeUploadIntent(await catalog.createUploadIntent({ ...operation(req), ...body })));
  }));

  router.post('/upload-intents/:id/confirm', asyncRoute(async (req, res) => {
    const versionId = parseOrRespond(res, schemas.versionId, req.params.id);
    if (versionId === null) return;
    const body = parseOrRespond(res, schemas.confirmUpload, req.body);
    if (body === null) return;
    const result = safeVersion(await catalog.confirmUpload({ ...operation(req), versionId }));
    res.status(result.status === 'processing' ? 202 : 200).json(result);
  }));

  router.post('/:assetId/versions', asyncRoute(async (req, res) => {
    const assetId = parseOrRespond(res, schemas.assetId, req.params.assetId);
    if (assetId === null) return;
    const body = parseOrRespond(res, schemas.createVersionIntent, req.body);
    if (body === null) return;
    res.status(201).json(safeUploadIntent(await catalog.createVersionIntent({
      ...operation(req), assetId, ...body,
    })));
  }));

  router.patch('/:assetId', asyncRoute(async (req, res) => {
    const assetId = parseOrRespond(res, schemas.assetId, req.params.assetId);
    if (assetId === null) return;
    const body = parseOrRespond(res, schemas.updateFamily, req.body);
    if (body === null) return;
    res.json(safeFamily(await catalog.updateFamily({ ...operation(req), assetId, ...body })));
  }));

  router.patch('/:assetId/versions/:versionId', asyncRoute(async (req, res) => {
    const assetId = parseOrRespond(res, schemas.assetId, req.params.assetId);
    if (assetId === null) return;
    const versionId = parseOrRespond(res, schemas.versionId, req.params.versionId);
    if (versionId === null) return;
    const body = parseOrRespond(res, schemas.archiveVersion, req.body);
    if (body === null) return;
    res.json(safeVersion(await catalog.archiveVersion({
      ...operation(req), assetId, versionId, ...body,
    })));
  }));

  router.get('/:versionId/usage', asyncRoute(async (req, res) => {
    const versionId = parseOrRespond(res, schemas.versionId, req.params.versionId);
    if (versionId === null) return;
    res.json(safeUsage(await catalog.getUsage({ ...operation(req), versionId })));
  }));

  return router;
}

const router = createWebinarAssetsRouter();

module.exports = router;
module.exports.createWebinarAssetsRouter = createWebinarAssetsRouter;
