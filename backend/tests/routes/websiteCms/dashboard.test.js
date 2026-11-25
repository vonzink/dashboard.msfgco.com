import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const authPath = require.resolve('../../../middleware/auth');
const originalAuth = require.cache[authPath];
const { authorizeWebsiteAction } = require('../../../services/websiteCms/authz');
const { createDashboardWebsiteCmsRouter } = require('../../../routes/websiteCms/dashboard');
let authLoads = 0;
function mockExistingAuthentication(authenticate) {
  authLoads = 0;
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, get exports() { authLoads++; return { authenticate }; } };
}
afterEach(() => { if (originalAuth) require.cache[authPath] = originalAuth; else delete require.cache[authPath]; });
function createGrantedService(grants = []) {
  return {
    listEntities: async ({ actor }) => { authorizeWebsiteAction(actor, 'read', grants); return { entities: [{ kind: 'page', id: 'home' }] }; },
    getEntity: async () => ({}), saveRevision: async () => ({}),
    publishSelection: async ({ actor }) => { authorizeWebsiteAction(actor, 'website.publish', grants); return { status: 'active' }; },
    getPublication: async () => ({}), rollbackPublication: async () => ({}),
  };
}
/** Invoke actual Express routers in-process; no listening sockets or live auth dependencies. */
function invoke(router, { method = 'GET', url = '/entities', headers = {}, user } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, url, originalUrl: url, headers, query: {}, user };
    const res = {
      code: 200, responseHeaders: {},
      set(name, value) { this.responseHeaders[name.toLowerCase()] = value; return this; },
      status(code) { this.code = code; return this; },
      json(body) { resolve({ status: this.code, body, headers: this.responseHeaders }); return this; },
    };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404 }));
  });
}

describe('dashboard website CMS production-auth composition', () => {
  it('stays disabled without an explicit service and never loads authentication dependencies', () => {
    mockExistingAuthentication(() => { throw Error('must not run'); });
    expect(createDashboardWebsiteCmsRouter()).toBeNull();
    expect(createDashboardWebsiteCmsRouter({ service: null })).toBeNull();
    expect(authLoads).toBe(0);
  });
  it('rejects an incomplete service before loading the real auth chain', () => {
    mockExistingAuthentication(() => {});
    expect(() => createDashboardWebsiteCmsRouter({ service: {} })).toThrow('website_dashboard_service_invalid');
    expect(authLoads).toBe(0);
  });
  it('runs existing authentication before trusting any caller-supplied mapped identity', async () => {
    mockExistingAuthentication((_req, res) => res.status(401).json({ error: 'Invalid token' }));
    const router = createDashboardWebsiteCmsRouter({ service: createGrantedService([{ userId: '1', capabilities: ['website.publish'] }]) });
    const response = await invoke(router, { user: { db: { id: 1, is_active: 1 } }, headers: { 'x-active-role': 'admin' } });
    expect(response.status).toBe(401);
  });
  it.each([
    [undefined, 401], [{ sub: 'verified-but-unmapped' }, 401],
    [{ db: { id: 'local-publisher', is_active: true } }, 401],
    [{ db: { id: 1, is_active: 0 } }, 403],
    [{ db: { id: 1, is_active: 1, role: 'admin' }, groups: ['admin'] }, 403],
  ])('requires real mapped active identity and explicit service grants: %j', async (mapped, status) => {
    mockExistingAuthentication((req, _res, next) => { req.user = mapped; next(); });
    const response = await invoke(createDashboardWebsiteCmsRouter({ service: createGrantedService() }), { headers: { 'x-active-role': 'admin', 'x-actor-id': '1' } });
    expect(response.status).toBe(status);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('allows an active mapped editor to read without inferring a publish grant', async () => {
    mockExistingAuthentication((req, _res, next) => { req.user = { db: { id: 1, is_active: 1, role: 'user' } }; next(); });
    const router = createDashboardWebsiteCmsRouter({ service: createGrantedService([{ userId: '1', capabilities: ['website.edit'] }]) });
    expect((await invoke(router)).body.entities).toEqual([{ kind: 'page', id: 'home' }]);
    expect((await invoke(router, { method: 'POST', url: '/publications' })).status).toBe(403);
  });
  it('allows explicitly granted publishers using the existing verified user mapping', async () => {
    mockExistingAuthentication((req, _res, next) => { req.user = { db: { id: 2, is_active: true, role: 'user' } }; next(); });
    const router = createDashboardWebsiteCmsRouter({ service: createGrantedService([{ userId: '2', capabilities: ['website.publish'] }]) });
    expect(await invoke(router, { method: 'POST', url: '/publications' })).toMatchObject({ status: 200, body: { status: 'active' } });
  });
  it('passes existing authentication failures into safe CMS error handling', async () => {
    mockExistingAuthentication((_req, _res, next) => next(Error('private database connection details')));
    const response = await invoke(createDashboardWebsiteCmsRouter({ service: createGrantedService() }));
    expect(response).toMatchObject({ status: 503, body: { error: 'website_dependency_unavailable' } });
  });
});
