import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const routePath = require.resolve('../../routes/users');
const originalDbCacheEntry = require.cache[dbPath];

const db = { query: vi.fn() };

describe('users directory route', () => {
  let app;

  beforeEach(() => {
    db.query.mockReset();
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: db,
    };
    delete require.cache[routePath];

    const usersRoutes = require('../../routes/users');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { db: { id: 10, role: 'employee' }, groups: ['employee'] };
      next();
    });
    app.use('/api/users', usersRoutes);
  });

  afterEach(() => {
    delete require.cache[routePath];
    if (originalDbCacheEntry) {
      require.cache[dbPath] = originalDbCacheEntry;
    } else {
      delete require.cache[dbPath];
    }
  });

  it('returns NMLS numbers in the active user directory', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 10,
        name: 'Zachary Zink',
        email: 'zachary.zink@msfg.us',
        initials: 'ZZ',
        role: 'admin',
        nmls_number: '451924',
      },
    ]]);

    const res = await makeRequest(app, '/api/users/directory');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)[0]).toEqual(expect.objectContaining({
      name: 'Zachary Zink',
      nmls_number: '451924',
    }));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('p.nmls_number'));
  });
});

function makeRequest(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${path}`, options)
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        });
    });
  });
}
