import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
const {
  AssetCatalogError,
  createCatalogService,
} = require('../../services/webinarAssets/catalog');
const { createOperationalEventRecorder } = require('../../services/webinars/observability');

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_URL = `https://assets.example/approved/sha256/${'a'.repeat(64)}/asset`;
const validUpload = {
  displayName: 'Closing timeline',
  description: 'A reusable closing timeline.',
  filename: 'timeline.svg',
  contentType: 'image/svg+xml',
  byteSize: 4096,
};
const safeFamily = {
  id: ASSET_ID,
  displayName: 'Closing timeline',
  description: 'A reusable closing timeline.',
  createdByUserId: 7,
  createdAt: '2026-09-04T10:00:00.000Z',
  archivedAt: null,
  versions: [{
    id: VERSION_ID,
    versionNumber: 1,
    mediaType: 'svg',
    mimeType: 'image/svg+xml',
    byteSize: 4096,
    sha256: 'a'.repeat(64),
    width: 1280,
    height: 720,
    durationMs: null,
    status: 'available',
    rejectionCode: null,
    uploadedByUserId: 7,
    uploaderName: 'Owner',
    createdAt: '2026-09-04T10:01:00.000Z',
    archivedAt: null,
    publicUrl: PUBLIC_URL,
  }],
};

function identity(id, role = 'user', groups = [role]) {
  return { db: { id, role, is_active: 1 }, groups };
}

function authenticateFromHeader(req, _res, next) {
  req.user = JSON.parse(req.get('x-test-user') || '{}');
  next();
}

function makeCatalog() {
  return {
    AssetCatalogError,
    listCatalog: vi.fn().mockResolvedValue([safeFamily]),
    createUploadIntent: vi.fn().mockResolvedValue({
      assetId: ASSET_ID,
      versionId: VERSION_ID,
      uploadUrl: 'https://signed.example/one-time-upload',
      expiresInSeconds: 600,
    }),
    confirmUpload: vi.fn().mockResolvedValue({ versionId: VERSION_ID, status: 'available', publicUrl: PUBLIC_URL, sha256: 'a'.repeat(64) }),
    createVersionIntent: vi.fn().mockResolvedValue({
      assetId: ASSET_ID,
      versionId: VERSION_ID,
      uploadUrl: 'https://signed.example/one-time-upload',
      expiresInSeconds: 600,
    }),
    updateFamily: vi.fn().mockResolvedValue({ id: ASSET_ID, displayName: 'Updated', description: null }),
    archiveVersion: vi.fn().mockResolvedValue({ versionId: VERSION_ID, status: 'archived' }),
    getUsage: vi.fn().mockResolvedValue({
      versionId: VERSION_ID,
      current: [{ webinarId: 12, webinarTitle: 'First Home', slideId: null, slideTitle: null, surface: 'master_html' }],
      history: [{ revisionId: 41, webinarId: 12, webinarTitle: 'First Home', webinarVersion: 3 }],
    }),
  };
}

function makeMalformedPersistedCatalog() {
  const malformed = {
    asset_id: ASSET_ID,
    display_name: 'Legacy asset',
    description: 'Legacy asset description',
    family_created_by_user_id: 7,
    family_created_at: '2026-09-04T10:00:00.000Z',
    family_archived_at: null,
    version_id: VERSION_ID,
    version_number: 1,
    media_type: 'image',
    mime_type: 'image/png',
    byte_size: 4096,
    sha256: 'a'.repeat(64),
    s3_key: `approved/sha256/${'a'.repeat(64)}/private-legacy-name.png`,
    width: 1280,
    height: 720,
    duration_ms: null,
    status: 'available',
    rejection_code: null,
    uploaded_by_user_id: 7,
    uploader_name: 'Owner',
    version_created_at: '2026-09-04T10:01:00.000Z',
    version_archived_at: null,
  };
  const assetDb = {
    query: vi.fn(async sql => {
      if (sql.includes('SELECT 1 AS allowed')) return [[{ allowed: 1 }]];
      if (sql.includes('FROM webinar_assets a')) return [[malformed]];
      throw new Error('unexpected private database query');
    }),
  };
  const service = createCatalogService({
    db: assetDb,
    recordOperationalEvent: createOperationalEventRecorder(operationalLogger),
    makePublicUrl: (_config, key) => `https://assets.example/${key}`,
    config: {
      bucket: 'private-bucket',
      cdnBaseUrl: 'https://assets.example',
      quarantinePrefix: 'quarantine/',
    },
  });
  return { ...makeCatalog(), listCatalog: service.listCatalog };
}

let catalog;
let operationalLogger;
let server;

async function start(overrides = {}) {
  const app = createApp({
    webinarStudioAccessMiddleware: (_req, _res, next) => next(),
    webinarAuthenticate: authenticateFromHeader,
    webinarServices: { assets: catalog },
    webinarWriteLimit: 1000,
    webinarAssetWriteLimit: 1000,
    webinarIpWriteLimit: 1000,
    webinarOperationalLogger: operationalLogger,
    ...overrides,
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
}

beforeEach(async () => {
  catalog = makeCatalog();
  operationalLogger = { info: vi.fn() };
  await start();
});

afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

async function request(method, path, body, user = identity(7), headers = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': JSON.stringify(user),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function approvedRouteContracts() {
  return [
    {
      method: 'GET', path: '/api/webinar-assets?search=logo&mediaType=image&status=available', status: 200,
      target: () => catalog.listCatalog,
      args: [{ actorUserId: 7, isAdmin: false, search: 'logo', mediaType: 'image', status: 'available' }],
    },
    {
      method: 'POST', path: '/api/webinar-assets/upload-intents', body: validUpload, status: 201,
      target: () => catalog.createUploadIntent,
      args: [{ actorUserId: 7, isAdmin: false, ...validUpload }],
    },
    {
      method: 'POST', path: `/api/webinar-assets/upload-intents/${VERSION_ID}/confirm`, body: {}, status: 200,
      target: () => catalog.confirmUpload,
      args: [{ actorUserId: 7, isAdmin: false, versionId: VERSION_ID }],
    },
    {
      method: 'POST', path: `/api/webinar-assets/${ASSET_ID}/versions`, body: {
        filename: 'timeline-v2.svg', contentType: 'image/svg+xml', byteSize: 5000,
      }, status: 201,
      target: () => catalog.createVersionIntent,
      args: [{
        actorUserId: 7, isAdmin: false, assetId: ASSET_ID,
        filename: 'timeline-v2.svg', contentType: 'image/svg+xml', byteSize: 5000,
      }],
    },
    {
      method: 'PATCH', path: `/api/webinar-assets/${ASSET_ID}`, body: { displayName: 'Updated' }, status: 200,
      target: () => catalog.updateFamily,
      args: [{ actorUserId: 7, isAdmin: false, assetId: ASSET_ID, displayName: 'Updated' }],
    },
    {
      method: 'PATCH', path: `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, body: { archive: true }, status: 200,
      target: () => catalog.archiveVersion,
      args: [{ actorUserId: 7, isAdmin: false, assetId: ASSET_ID, versionId: VERSION_ID, archive: true }],
    },
    {
      method: 'GET', path: `/api/webinar-assets/${VERSION_ID}/usage`, status: 200,
      target: () => catalog.getUsage,
      args: [{ actorUserId: 7, isAdmin: false, versionId: VERSION_ID }],
    },
  ];
}

describe('webinar asset API through the production application factory', () => {
  it.each(approvedRouteContracts())('dispatches $method $path with exact authenticated identity', async contract => {
    const response = await request(contract.method, contract.path, contract.body);
    expect(response.status).toBe(contract.status);
    expect(contract.target()).toHaveBeenCalledTimes(1);
    expect(contract.target().mock.calls[0]).toEqual(contract.args);
  });

  it('returns an upload intent only on the one-time 201 response', async () => {
    const response = await request('POST', '/api/webinar-assets/upload-intents', validUpload);
    expect(response).toEqual({ status: 201, body: {
      assetId: ASSET_ID,
      versionId: VERSION_ID,
      uploadUrl: 'https://signed.example/one-time-upload',
      expiresInSeconds: 600,
    } });
  });

  it.each([
    ['processing', { versionId: VERSION_ID, status: 'processing' }, 202],
    ['available', { versionId: VERSION_ID, status: 'available', sha256: 'a'.repeat(64), publicUrl: PUBLIC_URL }, 200],
    ['rejected', { versionId: VERSION_ID, status: 'rejected', rejectionCode: 'MALWARE_DETECTED' }, 200],
  ])('maps terminal/pending confirm state %s to its contract status', async (_label, result, status) => {
    catalog.confirmUpload.mockResolvedValueOnce(result);
    const response = await request('POST', `/api/webinar-assets/upload-intents/${VERSION_ID}/confirm`, {});
    expect(response).toEqual({ status, body: result });
  });

  it.each([
    ['family archive denial', 'updateFamily', `/api/webinar-assets/${ASSET_ID}`, { archive: true }],
    ['version archive denial', 'archiveVersion', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, { archive: true }],
  ])('preserves a trusted 403 for %s', async (_label, method, path, body) => {
    catalog[method].mockRejectedValueOnce(new AssetCatalogError(
      'WEBINAR_ACCESS_DENIED', 'Webinar owner or administrator access required', 403,
    ));
    expect(await request('PATCH', path, body)).toEqual({
      status: 403,
      body: { error: 'Webinar owner or administrator access required', code: 'WEBINAR_ACCESS_DENIED' },
    });
  });

  it.each([
    ['current live reference', 'ASSET_IN_USE', 'Asset is in current use'],
    ['revision reference', 'ASSET_IN_USE_BY_REVISION', 'Asset is required by revision history'],
  ])('preserves a trusted 409 for %s', async (_label, code, message) => {
    catalog.archiveVersion.mockRejectedValueOnce(new AssetCatalogError(code, message, 409));
    expect(await request('PATCH', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, { archive: true }))
      .toEqual({ status: 409, body: { error: message, code } });
  });

  it('uses family-safe wording for a family reference conflict', async () => {
    catalog.updateFamily.mockRejectedValueOnce(new AssetCatalogError(
      'ASSET_IN_USE', 'Asset family is in current use', 409,
    ));
    expect(await request('PATCH', `/api/webinar-assets/${ASSET_ID}`, { archive: true }))
      .toEqual({
        status: 409,
        body: { error: 'Asset is in current use', code: 'ASSET_IN_USE' },
      });
  });

  it('uses the canonical trusted message instead of a dependency-provided private message', async () => {
    catalog.archiveVersion.mockRejectedValueOnce(new AssetCatalogError(
      'ASSET_IN_USE', 'bucket=private quarantine/private source bytes', 409,
    ));
    expect(await request('PATCH', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, { archive: true }))
      .toEqual({
        status: 409,
        body: { error: 'Asset is in current use', code: 'ASSET_IN_USE' },
      });
  });

  it.each([
    {
      label: 'validation', method: 'POST', path: '/api/webinar-assets/upload-intents',
      body: { ...validUpload, actorUserId: 999 },
      setup: () => {},
      expected: {
        event: 'webinar.validation_rejected', actorUserId: 7,
        statusCode: 400, reasonCode: 'VALIDATION_FAILED',
      },
    },
    {
      label: 'authorization', method: 'PATCH', path: `/api/webinar-assets/${ASSET_ID}`,
      body: { archive: true },
      setup: () => catalog.updateFamily.mockRejectedValueOnce(new AssetCatalogError(
        'WEBINAR_ACCESS_DENIED', 'bucket=private authorization context', 403,
      )),
      expected: {
        event: 'webinar.authorization_denied', actorUserId: 7,
        statusCode: 403, reasonCode: 'WEBINAR_ACCESS_DENIED',
      },
    },
    {
      label: 'conflict', method: 'PATCH',
      path: `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`,
      body: { archive: true },
      setup: () => catalog.archiveVersion.mockRejectedValueOnce(new AssetCatalogError(
        'ASSET_IN_USE', 'quarantine/private reference detail', 409,
      )),
      expected: {
        event: 'webinar.version_conflict', actorUserId: 7,
        statusCode: 409, reasonCode: 'VERSION_CONFLICT', assetVersionId: VERSION_ID,
      },
    },
    {
      label: 'unknown service failure', method: 'GET', path: '/api/webinar-assets',
      body: undefined,
      setup: () => catalog.listCatalog.mockRejectedValueOnce(
        new Error('ER_BAD_DB_ERROR bucket=private quarantine/private GuardDuty'),
      ),
      expected: {
        event: 'webinar.database_failure', actorUserId: 7,
        statusCode: 500, reasonCode: 'DATABASE_FAILURE',
      },
    },
  ])('records one safe structured operational event for $label', async contract => {
    contract.setup();
    await request(contract.method, contract.path, contract.body);

    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith(
      contract.expected,
      'webinar operational event',
    );
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/bucket|quarantine|GuardDuty|ER_BAD_DB_ERROR|authorization context|reference detail/i);
  });

  it('records one safe event when a trusted scanner failure reaches the route unrecorded', async () => {
    catalog.confirmUpload.mockRejectedValueOnce(new AssetCatalogError(
      'ASSET_SCANNER_FAILURE',
      'bucket=private quarantine/private scanner details',
      503,
    ));

    expect(await request(
      'POST',
      `/api/webinar-assets/upload-intents/${VERSION_ID}/confirm`,
      {},
    )).toEqual({
      status: 503,
      body: {
        error: 'Webinar asset processing is temporarily unavailable',
        code: 'ASSET_SCANNER_FAILURE',
      },
    });
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.asset_scanner_failure',
      actorUserId: 7,
      assetVersionId: VERSION_ID,
      statusCode: 503,
      reasonCode: 'ASSET_SCANNER_FAILURE',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/bucket|quarantine|scanner details/i);
  });

  it('returns the closed busy response when inspection admission is saturated', async () => {
    catalog.confirmUpload.mockRejectedValueOnce(new AssetCatalogError(
      'ASSET_INSPECTION_BUSY',
      'private capacity and queue details',
      503,
    ));

    expect(await request(
      'POST',
      `/api/webinar-assets/upload-intents/${VERSION_ID}/confirm`,
      {},
    )).toEqual({
      status: 503,
      body: {
        error: 'Webinar asset inspection is busy',
        code: 'ASSET_INSPECTION_BUSY',
      },
    });
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.asset_inspection_busy',
      actorUserId: 7,
      assetVersionId: VERSION_ID,
      statusCode: 503,
      reasonCode: 'ASSET_INSPECTION_BUSY',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/private|capacity|queue/i);
  });

  it('does not double-record a persisted-path failure already recorded by the catalog', async () => {
    await new Promise(resolve => server.close(resolve));
    catalog = makeMalformedPersistedCatalog();
    await start();

    expect(await request('GET', '/api/webinar-assets')).toEqual({
      status: 503,
      body: {
        error: 'Webinar asset processing is temporarily unavailable',
        code: 'ASSET_SCANNER_FAILURE',
      },
    });
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.asset_scanner_failure',
      actorUserId: 7,
      assetVersionId: VERSION_ID,
      reasonCode: 'ASSET_SCANNER_FAILURE',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/private-legacy-name|approved\/sha256|\.png|bucket|quarantine/i);
  });

  it.each([
    ['body actor ID', { ...validUpload, actorUserId: 999 }],
    ['body admin claim', { ...validUpload, isAdmin: true }],
  ])('rejects forged %s instead of dispatching it', async (_label, body) => {
    const response = await request('POST', '/api/webinar-assets/upload-intents', body, identity(7));
    expect(response.status).toBe(400);
    expect(catalog.createUploadIntent).not.toHaveBeenCalled();
  });

  it('ignores forged identity/admin headers and derives authority from authenticated context', async () => {
    const response = await request('PATCH', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, {
      archive: true,
    }, identity(7, 'user', ['user']), {
      'x-actor-user-id': '999',
      'x-is-admin': 'true',
      'x-active-role': 'admin',
    });
    expect(response.status).toBe(200);
    expect(catalog.archiveVersion.mock.calls[0]).toEqual([{
      actorUserId: 7, isAdmin: false, assetId: ASSET_ID, versionId: VERSION_ID, archive: true,
    }]);
  });

  it('derives administrator authority from the authenticated user rather than payload fields', async () => {
    await request('PATCH', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, {
      archive: true,
    }, identity(42, 'admin'));
    expect(catalog.archiveVersion.mock.calls[0]).toEqual([{
      actorUserId: 42, isAdmin: true, assetId: ASSET_ID, versionId: VERSION_ID, archive: true,
    }]);
  });

  it.each([
    ['absent mapped identity', {}, 401],
    ['invalid mapped identity', { db: { id: 0, role: 'user', is_active: 1 }, groups: ['user'] }, 401],
    ['inactive mapped identity', { db: { id: 7, role: 'user', is_active: 0 }, groups: ['user'] }, 403],
    ['external mapped identity', { db: { id: 7, role: 'external', is_active: 1 }, groups: ['external'] }, 403],
  ])('runs the production mapped/active/internal gate for %s', async (_label, user, status) => {
    expect((await request('POST', '/api/webinar-assets/upload-intents', validUpload, user)).status).toBe(status);
    expect(catalog.createUploadIntent).not.toHaveBeenCalled();
  });

  it.each([
    ['bad asset ID', 'POST', '/api/webinar-assets/not-a-uuid/versions', {
      filename: 'timeline.svg', contentType: 'image/svg+xml', byteSize: 4096,
    }, 'createVersionIntent'],
    ['bad confirm ID', 'POST', '/api/webinar-assets/upload-intents/not-a-uuid/confirm', {}, 'confirmUpload'],
    ['bad version ID', 'PATCH', `/api/webinar-assets/${ASSET_ID}/versions/not-a-uuid`, { archive: true }, 'archiveVersion'],
    ['unknown catalog query', 'GET', '/api/webinar-assets?actorUserId=999', undefined, 'listCatalog'],
  ])('returns 400 and does not dispatch for %s', async (_label, method, path, body, target) => {
    expect((await request(method, path, body)).status).toBe(400);
    expect(catalog[target]).not.toHaveBeenCalled();
  });

  it.each([
    ['catalog', 'GET', '/api/webinar-assets', undefined, 'listCatalog', [safeFamily]],
    ['confirm', 'POST', `/api/webinar-assets/upload-intents/${VERSION_ID}/confirm`, {}, 'confirmUpload', {
      versionId: VERSION_ID, status: 'available', publicUrl: PUBLIC_URL, sha256: 'a'.repeat(64),
    }],
    ['usage', 'GET', `/api/webinar-assets/${VERSION_ID}/usage`, undefined, 'getUsage', {
      versionId: VERSION_ID, current: [], history: [],
    }],
  ])('redacts all internal service fields from the normal %s response', async (_label, method, path, body, target, safe) => {
    const contaminated = structuredClone(safe);
    const record = Array.isArray(contaminated) ? contaminated[0] : contaminated;
    record.s3Key = 'approved/private/key';
    record.quarantineKey = 'quarantine/private/key';
    record.scanTag = 'GuardDutyMalwareScanStatus';
    record.originalFilename = 'private-client-name.svg';
    record.sourceBytes = 'secret source';
    record.uploadUrl = 'https://signed.example/leaked';
    catalog[target].mockResolvedValueOnce(contaminated);

    const response = await request(method, path, body);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/s3Key|quarantine|GuardDuty|originalFilename|private-client-name|sourceBytes|secret source|signed\.example/i);
  });

  it.each([
    ['raw dependency error', new Error('ER_BAD_DB_ERROR bucket=private-bucket quarantine/secret scanner=GuardDuty')],
    ['forged catalog-shaped error', Object.assign(new Error('private source bytes'), {
      code: 'ASSET_IN_USE', status: 409, details: { objectKey: 'approved/private' },
    })],
    ['thrown primitive', 'quarantine/private scanner secret'],
  ])('maps %s to one fixed generic trusted API error', async (_label, failure) => {
    catalog.listCatalog.mockRejectedValueOnce(failure);
    const response = await request('GET', '/api/webinar-assets');
    expect(response).toEqual({
      status: 500,
      body: { error: 'Webinar asset operation failed', code: 'ASSET_OPERATION_FAILED' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/database|bucket|quarantine|scanner|source|objectKey|secret/i);
  });

  it('does not trust a controlled-looking error when the injected service omits its constructor', async () => {
    await new Promise(resolve => server.close(resolve));
    catalog = { ...catalog, AssetCatalogError: undefined };
    catalog.listCatalog.mockRejectedValueOnce(Object.assign(
      new Error('private bucket and quarantine key'),
      { code: 'ASSET_IN_USE', status: 409 },
    ));
    await start();

    expect(await request('GET', '/api/webinar-assets')).toEqual({
      status: 500,
      body: { error: 'Webinar asset operation failed', code: 'ASSET_OPERATION_FAILED' },
    });
  });

  it('limits mutations per authenticated database user while GET requests remain uncounted', async () => {
    await new Promise(resolve => server.close(resolve));
    await start({ webinarAssetWriteLimit: 1 });

    expect((await request('GET', '/api/webinar-assets', undefined, identity(7))).status).toBe(200);
    expect((await request('POST', '/api/webinar-assets/upload-intents', validUpload, identity(7))).status).toBe(201);
    expect((await request('POST', '/api/webinar-assets/upload-intents', validUpload, identity(7))).status).toBe(429);
    expect((await request('POST', '/api/webinar-assets/upload-intents', validUpload, identity(8))).status).toBe(201);
  });
});
