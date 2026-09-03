import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';

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

function user(id, role = 'user') { return { db: { id, role, is_active: 1 }, groups: [role] }; }
function request(method, path, body, identity = user(7)) {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(identity) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
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

  it('uses the authenticated identity for current-user notes', async () => {
    await request('POST', `/api/webinars/2/slides/${uuid}/notes`, { body: 'Private note' });
    expect(services.addNote).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, webinarId: 2, slideId: uuid }));
  });

  it.each([
    ['archived webinars', async () => { services.getPrivateDocument.mockResolvedValueOnce(null); return request('GET', '/api/webinars/2'); }, 404],
    ['missing slides', async () => { services.saveSlide.mockRejectedValueOnce(Object.assign(new Error('Slide not found'), { status: 404, code: 'SLIDE_NOT_FOUND' })); return request('PUT', `/api/webinars/2/slides/${uuid}`, validSlide); }, 404],
    ['another user’s note', async () => { services.updateNote.mockRejectedValueOnce(Object.assign(new Error('Note not found'), { status: 404, code: 'NOTE_NOT_FOUND' })); return request('PUT', '/api/webinars/2/notes/1', { body: 'No access' }); }, 404],
    ['a chunked-size candidate over 2 MB', async () => request('PUT', '/api/webinars/2/master', { ...validMaster, masterHtml: 'x'.repeat(2 * 1024 * 1024 + 1) }), 413],
  ])('returns the controlled status for %s', async (_boundary, run, status) => {
    expect((await run()).status).toBe(status);
  });
});
