import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';

const settings = vi.hoisted(() => ({ getSettings: vi.fn(), upsertSettings: vi.fn(), recordOperationalEvent: vi.fn() }));
let server;
function request(method, path, body, identity = { db: { id: 7, role: 'user', is_active: 1 }, groups: ['user'] }) {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(identity) }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));
}
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const actualSettings = require('../../services/webinars/settings');
  const observability = require('../../services/webinars/observability');
  settings.getSettings = vi.spyOn(actualSettings, 'getSettings');
  settings.upsertSettings = vi.spyOn(actualSettings, 'upsertSettings');
  settings.recordOperationalEvent = vi.spyOn(observability, 'recordOperationalEvent');
  const router = (await import('../../routes/webinarPresenterSettings.js')).default;
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = JSON.parse(req.get('x-test-user') || '{}'); next(); });
  app.use('/api/webinar-presenter-settings', router); app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { vi.clearAllMocks(); settings.getSettings.mockResolvedValue(null); settings.upsertSettings.mockResolvedValue({ shortcuts: {}, preferences: {} }); });

describe('presenter settings API', () => {
  it.each([['GET', undefined, 200], ['PUT', { shortcuts: {}, preferences: { theme: 'dark' } }, 200]])('%s /me returns the specified status', async (method, body, status) => {
    expect((await request(method, '/api/webinar-presenter-settings/me', body)).status).toBe(status);
  });
  it('is account-wide and derives the identity from the mapped user', async () => {
    await request('PUT', '/api/webinar-presenter-settings/me', { shortcuts: {}, preferences: {} });
    expect(settings.upsertSettings).toHaveBeenCalledWith({ userId: 7, shortcuts: {}, preferences: {} });
  });
  it('rejects settings routes other than the literal /me', async () => {
    expect((await request('GET', '/api/webinar-presenter-settings/7')).status).toBe(404);
  });
  it('never exposes settings persistence errors', async () => {
    settings.upsertSettings.mockRejectedValueOnce(Object.assign(new Error('ER_BAD_DB_ERROR password=secret'), { code: 'ER_BAD_DB_ERROR' }));
    expect(await request('PUT', '/api/webinar-presenter-settings/me', { shortcuts: {}, preferences: {} }))
      .toEqual({ status: 500, body: { error: 'Internal server error' } });
  });
  it('keeps trusted settings validation errors structured and records validation once', async () => {
    const { WebinarSettingsError } = createRequire(import.meta.url)('../../services/webinars/settings');
    settings.upsertSettings.mockRejectedValueOnce(new WebinarSettingsError('SHORTCUT_ACTION_UNKNOWN', 'Unknown shortcut action', { status: 400 }));
    expect(await request('PUT', '/api/webinar-presenter-settings/me', { shortcuts: {}, preferences: {} }))
      .toEqual({ status: 400, body: { error: 'Unknown shortcut action', code: 'SHORTCUT_ACTION_UNKNOWN' } });
    expect(settings.recordOperationalEvent).toHaveBeenCalledTimes(1);
    expect(settings.recordOperationalEvent).toHaveBeenCalledWith('webinar.validation_rejected', {
      actorUserId: 7, statusCode: 400, reasonCode: 'SHORTCUT_ACTION_UNKNOWN'
    });
  });
  it('never exposes settings read failures and records a database event', async () => {
    settings.getSettings.mockRejectedValueOnce(Object.assign(new Error('ER_BAD_DB_ERROR password=secret'), { code: 'ER_BAD_DB_ERROR' }));
    expect(await request('GET', '/api/webinar-presenter-settings/me'))
      .toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(settings.recordOperationalEvent).toHaveBeenCalledWith('webinar.database_failure', {
      actorUserId: 7, statusCode: 500, reasonCode: 'DATABASE_FAILURE'
    });
  });
});
