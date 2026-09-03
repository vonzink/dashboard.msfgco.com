import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import http from 'node:http';

const services = vi.hoisted(() => ({
  listForRequest: vi.fn(), getPrivateDocument: vi.fn(), listHistory: vi.fn(),
  createWebinar: vi.fn(), archiveWebinar: vi.fn(), saveMaster: vi.fn(), addSlide: vi.fn(),
  duplicateSlide: vi.fn(), saveSlide: vi.fn(), reorderSlides: vi.fn(), archiveSlide: vi.fn(), restoreRevision: vi.fn(), changeOwner: vi.fn(), changeAudienceAccess: vi.fn(),
  listNotes: vi.fn(), addNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(),
  recordOperationalEvent: vi.fn(),
}));

const uuid = '11111111-1111-4111-8111-111111111111';
const validMaster = { expectedVersion: 1, masterHtml: '<main>{{SLIDE_CONTENT}}</main>', masterCss: '' };
const validSlide = { expectedVersion: 1, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' };
const webinar = { id: 2, primaryOwnerUserId: 7, primary_owner_user_id: 7, slides: [{ id: uuid }] };
let app;
let server;
let serverApi;

function user(id, role = 'user') { return { db: { id, role, is_active: 1 }, groups: [role] }; }
function request(method, path, body, identity = user(7)) {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(identity) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  serverApi = require('../../server');
  const observability = require('../../services/webinars/observability');
  services.recordOperationalEvent = vi.spyOn(observability, 'recordOperationalEvent');
  const router = (await import('../../routes/webinars.js')).default;
  const repository = require('../../services/webinars/repository');
  const revisions = require('../../services/webinars/revisions');
  const mutations = require('../../services/webinars/mutations');
  const notes = require('../../services/webinars/notes');
  for (const [name, module] of [
    ['listForRequest', repository], ['getPrivateDocument', repository], ['listHistory', revisions],
    ['createWebinar', mutations], ['archiveWebinar', mutations], ['saveMaster', mutations], ['addSlide', mutations], ['duplicateSlide', mutations], ['saveSlide', mutations], ['reorderSlides', mutations], ['archiveSlide', mutations], ['restoreRevision', mutations], ['changeOwner', mutations], ['changeAudienceAccess', mutations],
    ['listNotes', notes], ['addNote', notes], ['updateNote', notes], ['deleteNote', notes],
  ]) services[name] = vi.spyOn(module, name);
  app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => { req.user = JSON.parse(req.get('x-test-user') || '{}'); next(); });
  app.use('/api/webinars', router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  vi.clearAllMocks();
  services.listForRequest.mockResolvedValue([webinar]);
  services.getPrivateDocument.mockResolvedValue(webinar);
  services.listHistory.mockResolvedValue([]);
  services.createWebinar.mockResolvedValue({ webinarId: 2 });
  [services.archiveWebinar, services.saveMaster, services.addSlide, services.duplicateSlide, services.saveSlide, services.reorderSlides, services.archiveSlide, services.restoreRevision, services.changeOwner, services.changeAudienceAccess].forEach(fn => fn.mockResolvedValue({ webinarId: 2, liveVersion: 2 }));
  services.listNotes.mockResolvedValue([]); services.addNote.mockResolvedValue({ id: 1 }); services.updateNote.mockResolvedValue({ id: 1 }); services.deleteNote.mockResolvedValue({ id: 1 });
});

describe('private webinar API contracts', () => {
  it.each([
    ['GET', '/api/webinars', undefined, 200],
    ['GET', '/api/webinars/2', undefined, 200],
    ['POST', '/api/webinars', { slug: 'intro', title: 'Intro', primaryOwnerUserId: 7 }, 403],
    ['DELETE', '/api/webinars/2', undefined, 403],
    ['PUT', '/api/webinars/2/master', validMaster, 200],
    ['POST', '/api/webinars/2/slides', validSlide, 201],
    ['PUT', `/api/webinars/2/slides/${uuid}`, validSlide, 200],
    ['PUT', '/api/webinars/2/slides/order', { expectedVersion: 1, slideIds: [uuid] }, 200],
    ['DELETE', `/api/webinars/2/slides/${uuid}`, { expectedVersion: 1 }, 200],
    ['GET', '/api/webinars/2/history', undefined, 200],
    ['POST', '/api/webinars/2/history/1/restore', { expectedVersion: 1 }, 200],
    ['PUT', '/api/webinars/2/owner', { primaryOwnerUserId: 8 }, 403],
    ['PUT', '/api/webinars/2/audience-access', { enabled: true }, 403],
    ['GET', '/api/webinars/2/notes', undefined, 200],
    ['POST', `/api/webinars/2/slides/${uuid}/notes`, { body: 'Private note' }, 201],
    ['PUT', '/api/webinars/2/notes/1', { body: 'Updated note' }, 200],
    ['DELETE', '/api/webinars/2/notes/1', undefined, 204],
  ])('%s %s returns its approved owner status contract', async (method, path, body, status) => {
    expect((await request(method, path, body)).status).toBe(status);
  });

  it('allows admin-only create, archive, owner, and audience access', async () => {
    for (const [method, path, body] of [
      ['POST', '/api/webinars', { slug: 'intro', title: 'Intro', primaryOwnerUserId: 7 }],
      ['DELETE', '/api/webinars/2', undefined], ['PUT', '/api/webinars/2/owner', { primaryOwnerUserId: 8 }],
      ['PUT', '/api/webinars/2/audience-access', { enabled: true }],
    ]) expect((await request(method, path, body, user(1, 'admin'))).status).toBe(method === 'POST' ? 201 : 200);
  });

  it('authorizes every webinar document route for owners and administrators only', async () => {
    expect((await request('GET', '/api/webinars/2')).status).toBe(200);
    expect((await request('GET', '/api/webinars/2', undefined, user(8))).status).toBe(403);
    expect((await request('GET', '/api/webinars/2', undefined, user(1, 'admin'))).status).toBe(200);
  });

  it.each([['PUT', '/api/webinars/2/slides/not-a-uuid', validSlide], ['POST', '/api/webinars/2/slides/not-a-uuid/notes', { body: 'Note' }]])('rejects malformed UUID params: %s %s', async (method, path, body) => {
    expect((await request(method, path, body)).status).toBe(400);
  });

  it('records a safe validation event for a rejected request without retaining its body', async () => {
    await request('PUT', `/api/webinars/2/slides/${uuid}`, { ...validSlide, unexpected: '<secret body>' });
    expect(services.recordOperationalEvent).toHaveBeenCalledWith('webinar.validation_rejected', expect.objectContaining({ actorUserId: 7, statusCode: 400, reasonCode: 'VALIDATION_FAILED' }));
    expect(services.recordOperationalEvent.mock.calls.flat().some(value => value === '<secret body>')).toBe(false);
  });

  it('does not let the dynamic webinar id path swallow a literal route', async () => {
    expect((await request('GET', '/api/webinars/presenter-settings')).status).toBe(400);
  });

  it('returns a controlled version conflict without exposing identity for other errors', async () => {
    services.saveMaster.mockRejectedValueOnce(Object.assign(new Error('Webinar has changed'), { status: 409, code: 'VERSION_CONFLICT', currentVersion: 2, updatedAt: 'now', updatedBy: { id: 1, name: 'Admin' } }));
    const response = await request('PUT', '/api/webinars/2/master', validMaster);
    expect(response).toMatchObject({ status: 409, body: { code: 'VERSION_CONFLICT', currentVersion: 2, updatedBy: { id: 1 } } });
  });

  it('records non-version conflicts as conflicts without updater metadata', async () => {
    services.saveSlide.mockRejectedValueOnce(Object.assign(new Error('Anchor is already in use'), { status: 409, code: 'ANCHOR_CONFLICT', updatedBy: { id: 1 } }));
    const response = await request('PUT', `/api/webinars/2/slides/${uuid}`, validSlide);
    expect(response).toEqual({ status: 409, body: { error: 'Anchor is already in use', code: 'ANCHOR_CONFLICT' } });
    expect(services.recordOperationalEvent).toHaveBeenCalledWith('webinar.version_conflict', expect.objectContaining({
      actorUserId: 7, webinarId: 2, statusCode: 409, reasonCode: 'ANCHOR_CONFLICT'
    }));
    expect(services.recordOperationalEvent.mock.calls.flat().some(value => value?.updatedBy)).toBe(false);
  });

  it('never exposes unexpected database errors', async () => {
    services.saveMaster.mockRejectedValueOnce(Object.assign(new Error('ER_ACCESS_DENIED: password=secret'), { code: 'ER_ACCESS_DENIED' }));
    const response = await request('PUT', '/api/webinars/2/master', validMaster);
    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
  });

  it('uses the authenticated identity for current-user notes', async () => {
    await request('POST', `/api/webinars/2/slides/${uuid}/notes`, { body: 'Private note' });
    expect(services.addNote).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, webinarId: 2, slideId: uuid }));
  });

  it.each([
    ['archived webinars', async () => { services.getPrivateDocument.mockResolvedValueOnce(null); return request('GET', '/api/webinars/2'); }, 404],
    ['missing slides', async () => { services.saveSlide.mockRejectedValueOnce(Object.assign(new Error('Slide not found'), { status: 404, code: 'SLIDE_NOT_FOUND' })); return request('PUT', `/api/webinars/2/slides/${uuid}`, validSlide); }, 404],
    ['another user’s note', async () => { services.updateNote.mockRejectedValueOnce(Object.assign(new Error('Note not found'), { status: 404, code: 'NOTE_NOT_FOUND' })); return request('PUT', '/api/webinars/2/notes/1', { body: 'No access' }); }, 404],
    ['a source-content candidate over its Zod limit', async () => request('PUT', '/api/webinars/2/master', { ...validMaster, masterHtml: 'x'.repeat(2 * 1024 * 1024 + 1) }), 400],
  ])('returns the controlled status for %s', async (_boundary, run, status) => {
    expect((await run()).status).toBe(status);
  });
});

describe('mounted Webinar Studio transport and limiter contract', () => {
  let mounted;
  let mountedServer;
  const mountedRequest = (method, path, body, identity = user(7)) => fetch(`http://127.0.0.1:${mountedServer.address().port}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(identity) }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));

  beforeAll(async () => {
    const router = (await import('../../routes/webinars.js')).default;
    const settingsRouter = (await import('../../routes/webinarPresenterSettings.js')).default;
    const { requireActiveDbUser, requireDbUser, requireNonExternal } = createRequire(import.meta.url)('../../middleware/userContext');
    mounted = express();
    mounted.use(serverApi.rejectOversizedWebinarRequest);
    mounted.use(serverApi.webinarRawBodyParser);
    mounted.use(serverApi.parseWebinarRawJson);
    mounted.use(express.json({ limit: '10mb' }));
    mounted.use((req, _res, next) => { req.user = JSON.parse(req.get('x-test-user') || '{}'); next(); });
    mounted.use('/api/', serverApi.writeLimiter);
    mounted.use('/api/webinars', requireDbUser, requireActiveDbUser, requireNonExternal, serverApi.webinarWriteLimiter, router);
    mounted.use('/api/webinar-presenter-settings', requireDbUser, requireActiveDbUser, requireNonExternal, serverApi.webinarWriteLimiter, settingsRouter);
    mounted.post('/api/unrelated', (_req, res) => res.status(201).json({ ok: true }));
    mounted.use((err, req, res, _next) => {
      if (err.code === 'CONTENT_LIMIT_EXCEEDED' || err.type === 'entity.too.large' || err.status === 413) return res.status(413).json({ code: 'CONTENT_LIMIT_EXCEEDED' });
      if (err.type === 'entity.parse.failed') return res.status(400).json({ code: 'VALIDATION_FAILED' });
      return res.status(500).json({ error: 'Internal server error' });
    });
    mountedServer = await new Promise(resolve => { const s = mounted.listen(0, () => resolve(s)); });
  });
  afterAll(() => new Promise(resolve => mountedServer.close(resolve)));

  it('does not let the 200/IP global write limiter shadow identity-keyed webinar writes', async () => {
    for (let count = 0; count < 201; count += 1) {
      expect((await mountedRequest('PUT', '/api/webinars/2/master', validMaster)).status).toBe(200);
    }
    expect((await mountedRequest('PUT', '/api/webinars/2/master', validMaster, user(1, 'admin'))).status).toBe(200);
  }, 30000);

  it('enforces 300 writes per identity and skips read methods', async () => {
    for (let count = 0; count < 99; count += 1) expect((await mountedRequest('PUT', '/api/webinars/2/master', validMaster)).status).toBe(200);
    expect((await mountedRequest('PUT', '/api/webinars/2/master', validMaster)).status).toBe(429);
    expect((await mountedRequest('GET', '/api/webinars/2')).status).toBe(200);
    expect((await mountedRequest('HEAD', '/api/webinars/2')).status).toBe(200);
    expect((await mountedRequest('OPTIONS', '/api/webinars/2')).status).not.toBe(429);
  }, 30000);

  it('enforces raw declared and chunked size without limiting unrelated requests', async () => {
    const oversized = JSON.stringify({ source: 'a'.repeat(2 * 1024 * 1024) });
    expect((await mountedRequest('POST', '/api/webinars', JSON.parse(oversized), user(1, 'admin'))).status).toBe(413);
    const chunked = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: mountedServer.address().port, method: 'POST', path: '/api/webinars', headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user(1, 'admin')), 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write(oversized); req.end();
    });
    expect(chunked).toBe(413);
    expect((await mountedRequest('POST', '/api/unrelated', JSON.parse(oversized))).status).toBe(201);
  }, 30000);

  it('accepts exactly 2 MiB of raw JSON for semantic validation and rejects malformed JSON safely', async () => {
    const prefix = '{"expectedVersion":1,"masterHtml":"';
    const suffix = '","masterCss":""}';
    const exactBoundary = `${prefix}${'x'.repeat((2 * 1024 * 1024) - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
    const exact = await fetch(`http://127.0.0.1:${mountedServer.address().port}/api/webinars/2/master`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user(98, 'admin')) }, body: exactBoundary,
    });
    expect(exact.status).not.toBe(413);
    const malformed = await fetch(`http://127.0.0.1:${mountedServer.address().port}/api/webinars/2/master`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user(97, 'admin')) }, body: '{not-json',
    });
    expect(malformed.status).toBe(400);
  }, 30000);

  it.each(['text/plain', 'application/x-www-form-urlencoded'])('rejects chunked raw bodies over 2 MiB for %s before a handler can see them', async (contentType) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: mountedServer.address().port, method: 'PUT', path: '/api/webinars/2/master', headers: { 'content-type': contentType, 'x-test-user': JSON.stringify(user(99, 'admin')), 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write('x'.repeat(2 * 1024 * 1024 + 1)); req.end();
    });
    expect(status).toBe(413);
    expect(services.saveMaster).not.toHaveBeenCalled();
  }, 30000);

  it('applies the same raw limit before the settings identity gates', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: mountedServer.address().port, method: 'PUT', path: '/api/webinar-presenter-settings/me', headers: { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write('x'.repeat(2 * 1024 * 1024 + 1)); req.end();
    });
    expect(status).toBe(413);
  }, 30000);
});
