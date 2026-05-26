import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const enginePath = require.resolve('../../services/calendarSync/syncEngine');
const routePath = require.resolve('../../routes/scheduleSync');
const originalDbCacheEntry = require.cache[dbPath];
const originalEngineCacheEntry = require.cache[enginePath];

const db = {
  query: vi.fn(),
};

const syncEngine = {
  runSyncForConnection: vi.fn().mockResolvedValue({ imported: 2, exported: 1 }),
};

describe('schedule sync routes', () => {
  let app;

  beforeEach(() => {
    db.query.mockReset();
    syncEngine.runSyncForConnection.mockClear();

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
    delete require.cache[routePath];

    const syncRoutes = require('../../routes/scheduleSync');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { db: { id: 7, role: 'user' }, groups: ['user'] };
      next();
    });
    app.use('/api/schedule/sync', syncRoutes);
    app.use((err, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    });
  });

  afterEach(() => {
    delete require.cache[routePath];

    if (originalDbCacheEntry) {
      require.cache[dbPath] = originalDbCacheEntry;
    } else {
      delete require.cache[dbPath];
    }

    if (originalEngineCacheEntry) {
      require.cache[enginePath] = originalEngineCacheEntry;
    } else {
      delete require.cache[enginePath];
    }
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

  it('starts a connection record for Outlook', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeJsonRequest(app, '/api/schedule/sync/connections/outlook/start', {
      provider: 'outlook',
      privacy_default: 'availability_only',
      sync_enabled: true,
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      provider: 'outlook',
      status: 'not_connected',
      authorization_url: null,
    });
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
      expect.objectContaining({ listEvents: expect.any(Function) })
    );
  });
});

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
