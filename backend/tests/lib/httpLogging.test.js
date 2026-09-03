import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';

const require = createRequire(import.meta.url);
const { createSafeHttpLogger } = require('../../lib/httpLogging');

let server;

afterEach(async () => {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
  server = null;
});

describe('credential-safe HTTP request logging', () => {
  it('never serializes authorization, cookie, or set-cookie canaries', async () => {
    const chunks = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const testLogger = pino({ base: null, timestamp: false }, stream);
    const app = express();
    app.use(createSafeHttpLogger(testLogger));
    app.get('/logging-canary', (_req, res) => {
      res.setHeader('set-cookie', 'session=LOG_CANARY_RESPONSE_COOKIE_91f0; HttpOnly');
      res.json({ ok: true });
    });
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/logging-canary`, {
      headers: {
        authorization: 'Bearer LOG_CANARY_BEARER_91f0',
        cookie: 'session=LOG_CANARY_REQUEST_COOKIE_91f0',
        'x-canary-private-header': 'LOG_CANARY_PRIVATE_HEADER_91f0',
      },
    });
    await response.text();
    await new Promise(resolve => setImmediate(resolve));

    const serialized = chunks.join('');
    expect(serialized).toContain('/logging-canary');
    expect(serialized).not.toContain('LOG_CANARY_BEARER_91f0');
    expect(serialized).not.toContain('LOG_CANARY_REQUEST_COOKIE_91f0');
    expect(serialized).not.toContain('LOG_CANARY_RESPONSE_COOKIE_91f0');
    expect(serialized).not.toContain('LOG_CANARY_PRIVATE_HEADER_91f0');
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized.toLowerCase()).not.toContain('set-cookie');
  });
});
