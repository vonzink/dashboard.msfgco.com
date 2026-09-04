import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
const { AssetCatalogError } = require('../../services/webinarAssets/catalog');

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

let catalog;
let server;

async function start(overrides = {}) {
  const app = createApp({
    webinarAuthenticate: authenticateFromHeader,
    webinarServices: { assets: catalog },
    webinarWriteLimit: 1000,
    webinarAssetWriteLimit: 1000,
    webinarIpWriteLimit: 1000,
    ...overrides,
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
}

beforeEach(async () => {
  catalog = makeCatalog();
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
    ['current live reference', 'ASSET_IN_USE', 'Asset version is in current use'],
    ['revision reference', 'ASSET_IN_USE_BY_REVISION', 'Asset version is required by revision history'],
  ])('preserves a trusted 409 for %s', async (_label, code, message) => {
    catalog.archiveVersion.mockRejectedValueOnce(new AssetCatalogError(code, message, 409));
    expect(await request('PATCH', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, { archive: true }))
      .toEqual({ status: 409, body: { error: message, code } });
  });

  it('uses the canonical trusted message instead of a dependency-provided private message', async () => {
    catalog.archiveVersion.mockRejectedValueOnce(new AssetCatalogError(
      'ASSET_IN_USE', 'bucket=private quarantine/private source bytes', 409,
    ));
    expect(await request('PATCH', `/api/webinar-assets/${ASSET_ID}/versions/${VERSION_ID}`, { archive: true }))
      .toEqual({
        status: 409,
        body: { error: 'Asset version is in current use', code: 'ASSET_IN_USE' },
      });
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
