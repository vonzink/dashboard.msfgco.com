import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createWebinarEditorWriteGate,
  createWebinarStudioAccess,
} = require('../../middleware/webinarStudioAccess');
const { createApp } = require('../../server');

function requestFor(dbUser) {
  return { user: dbUser ? { db: dbUser, groups: [dbUser.role] } : {} };
}

function responseDouble() {
  const response = { statusCode: 200, body: null };
  response.status = vi.fn(code => {
    response.statusCode = code;
    return response;
  });
  response.json = vi.fn(body => {
    response.body = body;
    return response;
  });
  return response;
}

async function runGate(middleware, request) {
  const response = responseDouble();
  const next = vi.fn();
  await middleware(request, response, next);
  if (next.mock.calls.length) return next.mock.calls[0][0] || 'next';
  return { status: response.statusCode, body: response.body };
}

function accessGate(mode, overrides = {}) {
  return createWebinarStudioAccess({
    environment: mode === undefined ? {} : { WEBINAR_STUDIO_ACCESS: mode },
    database: { query: vi.fn().mockResolvedValue([[]]) },
    configurationLogger: { error: vi.fn() },
    ...overrides,
  });
}

describe('Webinar Studio feature access', () => {
  it('fails closed with a 404 when WEBINAR_STUDIO_ACCESS is absent', async () => {
    const admin = requestFor({ id: 1, role: 'admin', is_active: 1 });
    await expect(runGate(accessGate(undefined), admin)).resolves.toEqual({
      status: 404,
      body: { error: 'Webinar Studio unavailable' },
    });
  });

  it('allows only the server-derived administrator in admins mode', async () => {
    const gate = accessGate('admins');
    await expect(runGate(gate, requestFor({ id: 1, role: 'admin' }))).resolves.toBe('next');
    await expect(runGate(gate, requestFor({ id: 7, role: 'user' }))).resolves.toEqual({
      status: 403,
      body: { error: 'Webinar Studio access required' },
    });
  });

  it('allows an assigned active primary owner and uses only their mapped database ID', async () => {
    const database = { query: vi.fn().mockResolvedValue([[{ assigned: 1 }]]) };
    const gate = accessGate('assigned', { database });

    await expect(runGate(gate, requestFor({ id: 73, role: 'user' }))).resolves.toBe('next');
    expect(database.query).toHaveBeenCalledWith(
      'SELECT 1 FROM webinar_presentations WHERE primary_owner_user_id = ? AND archived_at IS NULL LIMIT 1',
      [73],
    );
  });

  it('allows administrators in assigned mode without querying assignments', async () => {
    const database = { query: vi.fn().mockRejectedValue(new Error('must not query')) };
    const gate = accessGate('assigned', { database });

    await expect(runGate(gate, requestFor({ id: 1, role: 'admin' }))).resolves.toBe('next');
    expect(database.query).not.toHaveBeenCalled();
  });

  it('denies unassigned and invalid mapped users without weakening object authorization', async () => {
    const database = { query: vi.fn().mockResolvedValue([[]]) };
    const gate = accessGate('assigned', { database });

    await expect(runGate(gate, requestFor({ id: 9, role: 'user' }))).resolves.toMatchObject({ status: 403 });
    await expect(runGate(gate, requestFor({ id: '9', role: 'user' }))).resolves.toMatchObject({ status: 403 });
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('forwards assignment database failures to the shared error handler', async () => {
    const error = new Error('database unavailable');
    const gate = accessGate('assigned', {
      database: { query: vi.fn().mockRejectedValue(error) },
    });

    await expect(runGate(gate, requestFor({ id: 7, role: 'user' }))).resolves.toBe(error);
  });

  it('fails unknown modes closed and logs one constant configuration error without identity data', async () => {
    const configurationLogger = { error: vi.fn() };
    const gate = accessGate('owners-and-guests', { configurationLogger });
    const request = requestFor({ id: 82, email: 'private@example.com', role: 'user' });

    await expect(runGate(gate, request)).resolves.toMatchObject({ status: 404 });
    await expect(runGate(gate, request)).resolves.toMatchObject({ status: 404 });
    expect(configurationLogger.error).toHaveBeenCalledTimes(1);
    expect(configurationLogger.error).toHaveBeenCalledWith(
      { code: 'INVALID_WEBINAR_STUDIO_ACCESS' },
      'Invalid Webinar Studio access configuration',
    );
    expect(JSON.stringify(configurationLogger.error.mock.calls)).not.toMatch(/82|private@example\.com|owners-and-guests/);
  });

  it('allows every mapped user in everyone mode without querying assignments', async () => {
    const database = { query: vi.fn().mockRejectedValue(new Error('must not query')) };
    const gate = accessGate('everyone', { database });

    await expect(runGate(gate, requestFor({ id: 1, role: 'admin' }))).resolves.toBe('next');
    await expect(runGate(gate, requestFor({ id: 7, role: 'user' }))).resolves.toBe('next');
    await expect(runGate(gate, requestFor({ id: '7', role: 'user' }))).resolves.toMatchObject({ status: 403 });
    await expect(runGate(gate, requestFor(null))).resolves.toMatchObject({ status: 403 });
    expect(database.query).not.toHaveBeenCalled();
  });

  it.each([
    ['admins', { id: 1, role: 'admin' }, false],
    ['assigned', { id: 73, role: 'user' }, false],
    ['everyone', { id: 7, role: 'user' }, true],
  ])('annotates a granted request with the %s mode and whether reads are open', async (mode, user, readAll) => {
    const gate = accessGate(mode, { database: { query: vi.fn().mockResolvedValue([[{ assigned: 1 }]]) } });
    const request = requestFor(user);

    await expect(runGate(gate, request)).resolves.toBe('next');
    expect(request.webinarStudioAccess).toEqual({ mode, readAll });
    expect(Object.isFrozen(request.webinarStudioAccess)).toBe(true);
  });

  it('never annotates a denied request', async () => {
    const request = requestFor({ id: 7, role: 'user' });
    await expect(runGate(accessGate('admins'), request)).resolves.toMatchObject({ status: 403 });
    expect(request.webinarStudioAccess).toBeUndefined();
  });
});

describe('Webinar Studio editor write gate', () => {
  function writeGate(overrides = {}) {
    return createWebinarEditorWriteGate({
      database: { query: vi.fn().mockResolvedValue([[]]) },
      ...overrides,
    });
  }

  function granted(user, mode, method = 'POST') {
    return { ...requestFor(user), method, webinarStudioAccess: Object.freeze({ mode, readAll: mode === 'everyone' }) };
  }

  it('lets reads through untouched in every mode', async () => {
    const database = { query: vi.fn().mockRejectedValue(new Error('must not query')) };
    const gate = writeGate({ database });
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      await expect(runGate(gate, granted({ id: 7, role: 'user' }, 'everyone', method))).resolves.toBe('next');
    }
    expect(database.query).not.toHaveBeenCalled();
  });

  it('does not add work outside everyone mode because the feature gate already proved editorship', async () => {
    const database = { query: vi.fn().mockRejectedValue(new Error('must not query')) };
    const gate = writeGate({ database });
    await expect(runGate(gate, granted({ id: 7, role: 'user' }, 'assigned'))).resolves.toBe('next');
    await expect(runGate(gate, granted({ id: 7, role: 'user' }, 'admins'))).resolves.toBe('next');
    expect(database.query).not.toHaveBeenCalled();
  });

  it('allows administrators and active primary owners to write in everyone mode', async () => {
    const database = { query: vi.fn().mockResolvedValue([[{ assigned: 1 }]]) };
    const gate = writeGate({ database });

    await expect(runGate(gate, granted({ id: 1, role: 'admin' }, 'everyone'))).resolves.toBe('next');
    expect(database.query).not.toHaveBeenCalled();
    await expect(runGate(gate, granted({ id: 73, role: 'user' }, 'everyone', 'PATCH'))).resolves.toBe('next');
    expect(database.query).toHaveBeenCalledWith(
      'SELECT 1 FROM webinar_presentations WHERE primary_owner_user_id = ? AND archived_at IS NULL LIMIT 1',
      [73],
    );
  });

  it('refuses writes from readers, invalid identities, and requests the feature gate never saw', async () => {
    const gate = writeGate();
    const denied = { status: 403, body: { error: 'Webinar editor access required' } };

    await expect(runGate(gate, granted({ id: 9, role: 'user' }, 'everyone'))).resolves.toEqual(denied);
    await expect(runGate(gate, granted({ id: '9', role: 'user' }, 'everyone'))).resolves.toEqual(denied);
    await expect(runGate(gate, { ...requestFor({ id: 1, role: 'admin' }), method: 'POST' })).resolves.toEqual(denied);
  });

  it('forwards assignment database failures to the shared error handler', async () => {
    const error = new Error('database unavailable');
    const gate = writeGate({ database: { query: vi.fn().mockRejectedValue(error) } });
    await expect(runGate(gate, granted({ id: 7, role: 'user' }, 'everyone'))).resolves.toBe(error);
  });
});

describe('Webinar Studio server route scope', () => {
  let server;

  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    server = null;
  });

  it('runs the feature gate on all three private mounts but never public bundle or runtime routes', async () => {
    const gate = vi.fn((_req, _res, next) => next());
    const slideId = '11111111-1111-4111-8111-111111111111';
    const bundle = {
      schemaVersion: 1,
      webinar: { id: 12, slug: 'demo', title: 'Demo', liveVersion: 1 },
      master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: '' },
      slides: [{ id: slideId, position: 0, anchor: 'opening', title: 'Opening', html: '<p>Hi</p>', css: '', javascript: '' }],
      assets: {},
      resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] },
    };
    const json = JSON.stringify(bundle);
    const app = createApp({
      webinarAuthenticate(req, _res, next) {
        req.user = { db: { id: 1, role: 'admin', is_active: 1 }, groups: ['admin'] };
        next();
      },
      webinarStudioAccessMiddleware: gate,
      webinarServices: {
        repository: { listForRequest: vi.fn().mockResolvedValue([]) },
        settings: { getSettings: vi.fn().mockResolvedValue(null) },
        assets: { listCatalog: vi.fn().mockResolvedValue([]) },
        publicBundle: {
          getLiveBundleBySlug: vi.fn().mockResolvedValue({
            bundle,
            json,
            etag: `"${'a'.repeat(64)}"`,
          }),
        },
      },
      webinarOperationalLogger: { info: vi.fn() },
      webinarWriteLimit: 1000,
      webinarAssetWriteLimit: 1000,
      publicWebinarRuntimeLimit: 1000,
    });
    server = await new Promise(resolve => {
      const listener = app.listen(0, () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    expect((await fetch(`${base}/api/webinars`)).status).toBe(200);
    expect((await fetch(`${base}/api/webinar-presenter-settings/me`)).status).toBe(200);
    expect((await fetch(`${base}/api/webinar-assets`)).status).toBe(200);
    expect(gate).toHaveBeenCalledTimes(3);

    expect((await fetch(`${base}/api/public/webinars/demo/live`)).status).toBe(200);
    expect((await fetch(`${base}/api/public/webinars/demo/runtime-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liveVersion: 1, slideId, code: 'SLIDE_RUNTIME_ERROR' }),
    })).status).toBe(204);
    expect(gate).toHaveBeenCalledTimes(3);
  });
});
