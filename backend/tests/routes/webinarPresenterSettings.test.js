import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
const { WebinarSettingsError } = require('../../services/webinars/settings');

function identity(id, role = 'user') {
  return { db: { id, role, is_active: 1 }, groups: [role] };
}

function authenticateFromHeader(req, _res, next) {
  req.user = JSON.parse(req.get('x-test-user') || '{}');
  next();
}

let settings;
let operationalLogger;
let server;

beforeEach(async () => {
  settings = {
    WebinarSettingsError,
    getSettings: vi.fn().mockResolvedValue(null),
    upsertSettings: vi.fn().mockResolvedValue({ shortcuts: {}, preferences: { theme: 'dark' } }),
  };
  operationalLogger = { info: vi.fn() };
  const app = createApp({
    webinarAuthenticate: authenticateFromHeader,
    webinarServices: { settings },
    webinarOperationalLogger: operationalLogger,
    webinarWriteLimit: 100,
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function request(method, path, body, user = identity(7)) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function expectOneOperationalRecord(expected) {
  expect(operationalLogger.info).toHaveBeenCalledTimes(1);
  expect(operationalLogger.info).toHaveBeenCalledWith(expected, 'webinar operational event');
}

describe('presenter settings API through the production application factory', () => {
  it('dispatches GET /me with the exact authenticated user ID', async () => {
    const response = await request('GET', '/api/webinar-presenter-settings/me', undefined, identity(42));
    expect(response).toEqual({ status: 200, body: { shortcuts: {}, preferences: {} } });
    expect(settings.getSettings).toHaveBeenCalledTimes(1);
    expect(settings.getSettings.mock.calls[0]).toEqual([42]);
  });

  it('dispatches PUT /me with the exact authenticated argument object', async () => {
    const body = { shortcuts: { nextSlide: 'ArrowRight' }, preferences: { theme: 'dark' } };
    expect((await request('PUT', '/api/webinar-presenter-settings/me', body, identity(42))).status).toBe(200);
    expect(settings.upsertSettings).toHaveBeenCalledTimes(1);
    expect(settings.upsertSettings.mock.calls[0]).toEqual([{
      userId: 42,
      shortcuts: { nextSlide: 'ArrowRight' },
      preferences: { theme: 'dark' },
    }]);
  });

  it('rejects payload identity fields instead of letting them select another user', async () => {
    const response = await request('PUT', '/api/webinar-presenter-settings/me', {
      userId: 999,
      shortcuts: {},
      preferences: {},
    }, identity(42));
    expect(response.status).toBe(400);
    expect(settings.upsertSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['missing shortcuts', { preferences: {} }],
    ['missing preferences', { shortcuts: {} }],
    ['unknown top-level field', { shortcuts: {}, preferences: {}, source: 'secret' }],
  ])('rejects the malformed %s body without dispatching settings persistence', async (_label, body) => {
    expect((await request('PUT', '/api/webinar-presenter-settings/me', body)).status).toBe(400);
    expect(settings.upsertSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['absent mapped identity', {}, 401],
    ['inactive mapped identity', { db: { id: 7, role: 'user', is_active: 0 }, groups: ['user'] }, 403],
    ['external mapped identity', { db: { id: 7, role: 'external', is_active: 1 }, groups: ['external'] }, 403],
  ])('runs the production mapped/active/internal gate for %s', async (_label, user, status) => {
    expect((await request('PUT', '/api/webinar-presenter-settings/me', {
      shortcuts: {}, preferences: {},
    }, user)).status).toBe(status);
    expect(settings.upsertSettings).not.toHaveBeenCalled();
  });

  it('rejects every settings path except literal /me', async () => {
    expect((await request('GET', '/api/webinar-presenter-settings/7')).status).toBe(404);
    expect(settings.getSettings).not.toHaveBeenCalled();
  });

  it('retains a trusted settings validation code in the final logger record exactly once', async () => {
    settings.upsertSettings.mockRejectedValueOnce(new WebinarSettingsError(
      'SHORTCUT_ACTION_UNKNOWN',
      'Unknown shortcut action',
      { status: 400 },
    ));
    const response = await request('PUT', '/api/webinar-presenter-settings/me', {
      shortcuts: {}, preferences: {},
    });
    expect(response).toEqual({
      status: 400,
      body: { error: 'Unknown shortcut action', code: 'SHORTCUT_ACTION_UNKNOWN' },
    });
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', actorUserId: 7,
      statusCode: 400, reasonCode: 'SHORTCUT_ACTION_UNKNOWN',
    });
  });

  it.each([
    ['read', 'GET', undefined, () => settings.getSettings],
    ['write', 'PUT', { shortcuts: {}, preferences: {} }, () => settings.upsertSettings],
  ])('masks an unexpected settings %s error and emits only database classification', async (_label, method, body, target) => {
    target().mockRejectedValueOnce(Object.assign(
      new Error('ER_BAD_DB_ERROR password=secret source=<script>'),
      { code: 'ER_BAD_DB_ERROR' },
    ));
    const response = await request(method, '/api/webinar-presenter-settings/me', body);
    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expectOneOperationalRecord({
      event: 'webinar.database_failure', actorUserId: 7,
      statusCode: 500, reasonCode: 'DATABASE_FAILURE',
    });
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/ER_BAD_DB_ERROR|password|script/);
  });

  it('classifies errors safely when an injected settings double omits its error constructor', async () => {
    delete settings.WebinarSettingsError;
    settings.getSettings.mockRejectedValueOnce(new Error('password=secret source=<script>'));

    const response = await request('GET', '/api/webinar-presenter-settings/me');

    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expectOneOperationalRecord({
      event: 'webinar.database_failure', actorUserId: 7,
      statusCode: 500, reasonCode: 'DATABASE_FAILURE',
    });
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/password|script/);
  });
});
