import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const clientPath = require.resolve('../../services/monday/client');
const routePath = require.resolve('../../routes/monday');
const originalDb = require.cache[dbPath];
const originalClient = require.cache[clientPath];

const db = { query: vi.fn(), getConnection: vi.fn() };
const client = { mondayQuery: vi.fn() };

describe('GET /monday/status-labels', () => {
  let app;
  beforeEach(() => {
    db.query.mockReset();
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: client };
    delete require.cache[routePath];
    const mondayRoutes = require('../../routes/monday');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { db: { id: 10, role: 'admin' }, groups: ['admin'] }; next(); });
    app.use('/api/monday', mondayRoutes);
  });
  afterEach(() => {
    delete require.cache[routePath];
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
    if (originalClient) require.cache[clientPath] = originalClient; else delete require.cache[clientPath];
  });

  it('returns labels grouped by board then field', async () => {
    db.query.mockResolvedValueOnce([[
      { board_id: '1', pipeline_field: 'wvoes', labels_json: '["Please Order","Done"]' },
    ]]);
    const res = await makeRequest(app, '/api/monday/status-labels?section=pipeline');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ '1': { wvoes: ['Please Order', 'Done'] } });
  });
});

function makeRequest(app, path) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${path}`)
        .then(async (res) => { const body = await res.text(); server.close(); resolve({ status: res.status, body }); });
    });
  });
}
