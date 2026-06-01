import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const enginePath = require.resolve('../../services/calendarSync/syncEngine');
const outlookProviderPath = require.resolve('../../services/calendarSync/providers/outlook');
const oauthStatePath = require.resolve('../../services/calendarSync/oauthState');
const routePath = require.resolve('../../routes/scheduleSync');
const publicRoutePath = require.resolve('../../routes/scheduleSyncPublic');
const originalDbCacheEntry = require.cache[dbPath];
const originalEngineCacheEntry = require.cache[enginePath];
const originalOutlookProviderCacheEntry = require.cache[outlookProviderPath];
const originalOAuthStateCacheEntry = require.cache[oauthStatePath];
const originalPublicRouteCacheEntry = require.cache[publicRoutePath];

const db = {
  query: vi.fn(),
};

const syncEngine = {
  runSyncForConnection: vi.fn().mockResolvedValue({ imported: 2, exported: 1 }),
};

const outlookProvider = {
  buildAuthorizationUrl: vi.fn((state) => `https://login.microsoftonline.com/auth?state=${state}`),
  exchangeCodeForTokens: vi.fn(),
  getAccountEmail: vi.fn(),
  refreshTokens: vi.fn(),
  listEvents: vi.fn().mockResolvedValue([]),
};

const oauthState = {
  createStateValue: vi.fn(() => 'state-123'),
  storeOAuthState: vi.fn().mockResolvedValue(),
  consumeOAuthState: vi.fn(),
};

describe('schedule sync routes', () => {
  let app;

  beforeEach(() => {
    vi.stubEnv('CALENDAR_SYNC_ENCRYPTION_KEY', Buffer.alloc(32, 'a').toString('base64'));
    db.query.mockReset();
    syncEngine.runSyncForConnection.mockClear();
    outlookProvider.buildAuthorizationUrl.mockClear();
    outlookProvider.exchangeCodeForTokens.mockReset();
    outlookProvider.getAccountEmail.mockReset();
    outlookProvider.refreshTokens.mockClear();
    outlookProvider.listEvents.mockClear();
    oauthState.createStateValue.mockClear();
    oauthState.storeOAuthState.mockClear();
    oauthState.consumeOAuthState.mockReset();

    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: db,
    };
    require.cache[enginePath] = {
      id: enginePath,
      filename: enginePath,
      loaded: true,
      exports: syncEngine,
    };
    require.cache[outlookProviderPath] = {
      id: outlookProviderPath,
      filename: outlookProviderPath,
      loaded: true,
      exports: outlookProvider,
    };
    require.cache[oauthStatePath] = {
      id: oauthStatePath,
      filename: oauthStatePath,
      loaded: true,
      exports: oauthState,
    };
    delete require.cache[routePath];
    delete require.cache[publicRoutePath];

    const syncRoutes = require('../../routes/scheduleSync');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const role = req.headers['x-test-user'] || 'user';
      req.user = { db: { id: 7, role }, groups: [role] };
      next();
    });
    app.use('/api/schedule/sync', syncRoutes);
    app.use((err, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete require.cache[routePath];
    delete require.cache[publicRoutePath];

    restoreCacheEntry(dbPath, originalDbCacheEntry);
    restoreCacheEntry(enginePath, originalEngineCacheEntry);
    restoreCacheEntry(outlookProviderPath, originalOutlookProviderCacheEntry);
    restoreCacheEntry(oauthStatePath, originalOAuthStateCacheEntry);
    restoreCacheEntry(publicRoutePath, originalPublicRouteCacheEntry);
  });

  it('returns current user sync status', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 1,
        provider: 'outlook',
        provider_account_email: 'user@msfg.us',
        sync_enabled: 1,
        privacy_default: 'availability_only',
        sync_status: 'connected',
        last_sync_at: null,
        sync_error: null,
      },
    ]]);

    const res = await makeRequest(app, '/api/schedule/sync/status');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).connections[0]).toEqual(expect.objectContaining({
      provider: 'outlook',
      sync_status: 'connected',
    }));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM calendar_sync_connections'), [7]);
  });

  it('returns an Outlook authorization URL on connection start', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeJsonRequest(app, '/api/schedule/sync/connections/outlook/start', {
      provider: 'outlook',
      privacy_default: 'availability_only',
      sync_enabled: true,
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      provider: 'outlook',
      status: 'authorization_required',
      authorization_url: 'https://login.microsoftonline.com/auth?state=state-123',
    }));
    expect(oauthState.storeOAuthState).toHaveBeenCalledWith(7, 'outlook', 'state-123');
  });

  it('rejects provider mismatches on connection start', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/sync/connections/outlook/start', {
      provider: 'google',
      privacy_default: 'availability_only',
    });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Provider mismatch' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('runs sync for enabled connections owned by the current user', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 4, user_id: 7, provider: 'outlook', sync_enabled: 1 },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/sync/run', { provider: 'outlook' });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      results: [
        { provider: 'outlook', imported: 2, exported: 1 },
      ],
    });
    expect(syncEngine.runSyncForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, user_id: 7, provider: 'outlook' }),
      outlookProvider
    );
  });

  it('disconnects a provider connection', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeRequest(app, '/api/schedule/sync/connections/outlook/disconnect', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('encrypted_access_token = NULL'), [7, 'outlook']);
  });

  it('returns admin sync health for managers and admins only', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 1,
        user_id: 7,
        name: 'Test User',
        email: 'user@msfg.us',
        provider: 'outlook',
        sync_enabled: 1,
        sync_status: 'connected',
        last_sync_at: null,
        sync_error: null,
      },
    ]]);

    const res = await makeRequest(app, '/api/schedule/sync/admin/status', {
      headers: { 'x-test-user': 'manager' },
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).connections[0]).toEqual(expect.objectContaining({
      user_id: 7,
      provider: 'outlook',
      sync_status: 'connected',
    }));
  });

  it('handles Outlook OAuth callback without app authentication', async () => {
    oauthState.consumeOAuthState.mockResolvedValueOnce({ id: 4, user_id: 7, provider: 'outlook' });
    outlookProvider.exchangeCodeForTokens.mockResolvedValueOnce({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      scope: 'offline_access User.Read Calendars.ReadWrite',
    });
    outlookProvider.getAccountEmail.mockResolvedValueOnce('user@msfg.us');
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    syncEngine.runSyncForConnection.mockResolvedValueOnce({ imported: 1, exported: 0 });

    const publicRoutes = require('../../routes/scheduleSyncPublic');
    const publicApp = express();
    publicApp.use('/api/schedule/sync', publicRoutes);
    publicApp.use((err, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    });

    const res = await makeRequest(publicApp, '/api/schedule/sync/outlook/callback?code=abc&state=state-123', {
      redirect: 'manual',
    });

    expect([302, 303]).toContain(res.status);
    expect(oauthState.consumeOAuthState).toHaveBeenCalledWith('outlook', 'state-123');
    expect(outlookProvider.exchangeCodeForTokens).toHaveBeenCalledWith('abc');
    expect(syncEngine.runSyncForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4, user_id: 7, provider_account_email: 'user@msfg.us' }),
      outlookProvider
    );
  });
});

function restoreCacheEntry(path, entry) {
  if (entry) {
    require.cache[path] = entry;
  } else {
    delete require.cache[path];
  }
}

function makeJsonRequest(app, path, body, headers = {}, method = 'POST') {
  return makeRequest(app, path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeRequest(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`, options)
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          resolve({ status: 500, body: err.message });
        });
    });
  });
}
