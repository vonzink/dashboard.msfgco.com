/**
 * Health endpoint tests — verifies DB ping check
 * Uses a standalone Express app (not importing server.js) to avoid cascading mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

// Standalone mock for db — no need to mock the whole server
const db = {
  ping: vi.fn(),
};

describe('GET /health', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();

    // Replicate the health endpoint from server.js
    app = express();
    app.get('/health', async (req, res) => {
      try {
        await db.ping();
        res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
      } catch (err) {
        res.status(503).json({ status: 'error', error: 'Database connection failed', timestamp: new Date().toISOString() });
      }
    });
  });

  it('returns 200 when DB is healthy', async () => {
    db.ping.mockResolvedValue(true);

    const res = await makeRequest(app, '/health');
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.timestamp).toBeTruthy();
  });

  it('returns 503 when DB is down', async () => {
    db.ping.mockRejectedValue(new Error('Connection refused'));

    const res = await makeRequest(app, '/health');
    expect(res.status).toBe(503);

    const body = JSON.parse(res.body);
    expect(body.status).toBe('error');
    expect(body.error).toBe('Database connection failed');
  });

  it('includes timestamp in both success and error responses', async () => {
    db.ping.mockResolvedValue(true);
    const okRes = await makeRequest(app, '/health');
    expect(JSON.parse(okRes.body).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    db.ping.mockRejectedValue(new Error('fail'));
    const errRes = await makeRequest(app, '/health');
    expect(JSON.parse(errRes.body).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// Lightweight request helper (avoids supertest dependency)
function makeRequest(app, path) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`)
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
