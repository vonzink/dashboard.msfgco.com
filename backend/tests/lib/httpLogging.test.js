import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers';
import express from 'express';
import pino from 'pino';

const require = createRequire(import.meta.url);
const { createSafeHttpLogger, serializeRequest } = require('../../lib/httpLogging');

let server;

afterEach(async () => {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
  server = null;
});

describe('credential-safe HTTP request logging', () => {
  it('omits attacker-controlled transport headers only for exact public runtime POST paths', () => {
    const request = (url, method = 'POST') => serializeRequest({
      id: 1,
      method,
      originalUrl: url,
      headers: {
        accept: '*/*',
        'content-length': '95',
        'content-type': 'application/json; charset=LOG_RUNTIME_CHARSET_SECRET',
        'content-encoding': 'LOG_RUNTIME_ENCODING_SECRET',
        'user-agent': 'test',
      },
      socket: { remoteAddress: '127.0.0.1', remotePort: 1234 },
    });

    for (const url of [
      '/api/public/webinars/first-home/runtime-events',
      '/api/public/webinars/first-home/runtime-events/',
      '/api/public/webinars/first-home/runtime-events/?trace=LOG_QUERY_SECRET',
      '/API/PUBLIC/WEBINARS/first-home/RUNTIME-EVENTS',
      '/Api/Public/Webinars/first-home/Runtime-Events/?trace=LOG_MIXED_QUERY_SECRET',
    ]) {
      expect(request(url).headers).toEqual({
        accept: '*/*', 'content-length': '95', 'user-agent': 'test',
      });
    }

    expect(request('/api/announcements').headers['content-type'])
      .toContain('LOG_RUNTIME_CHARSET_SECRET');
    expect(request('/api/public/webinars/first-home/runtime-events-nearby').headers['content-type'])
      .toContain('LOG_RUNTIME_CHARSET_SECRET');
    expect(request('/api/public/webinars/first-home/runtime-events', 'GET').headers['content-type'])
      .toContain('LOG_RUNTIME_CHARSET_SECRET');
  });

  it('redacts every path segment below the public webinar prefix without changing other URLs', () => {
    const request = url => serializeRequest({
      id: 1,
      method: 'GET',
      originalUrl: url,
      headers: {},
      socket: { remoteAddress: '127.0.0.1', remotePort: 1234 },
    });

    expect(request('/api/public/webinars/PUBLIC_URI_CANARY_%ZZ/live').url)
      .toBe('/api/public/webinars/[redacted]');
    expect(request('/api/public/webinars/PUBLIC_URI_CANARY_%C3%28/live?query=QUERY_URI_CANARY').url)
      .toBe('/api/public/webinars/[redacted]');
    expect(request('/API/PUBLIC/WEBINARS/MIXED_CASE_CANARY/live').url)
      .toBe('/api/public/webinars/[redacted]');
    expect(request('/Api/Public/Webinars/MIXED_URI_CANARY_%ZZ/LiVe?query=MIXED_QUERY_CANARY').url)
      .toBe('/api/public/webinars/[redacted]');
    expect(request('/API/PUBLIC/WEBINARS').url).toBe('/api/public/webinars/[redacted]');
    expect(request('/api/public/webinars').url).toBe('/api/public/webinars');
    expect(request('/api/announcements/PUBLIC_URI_CANARY_%ZZ').url)
      .toBe('/api/announcements/PUBLIC_URI_CANARY_%ZZ');
  });

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

  it('serializes only the pathname for requests with any query parameters', async () => {
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
    app.get('/logging-query-canary', (_req, res) => res.json({ ok: true }));
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });

    const query = [
      'api_key=LOG_QUERY_API_KEY_6b45',
      'token=LOG_QUERY_TOKEN_6b45',
      'code=LOG_QUERY_OAUTH_CODE_6b45',
      'state=LOG_QUERY_OAUTH_STATE_6b45',
      'MiXeD_CrEdEnTiAl=LOG_QUERY_MIXED_CASE_6b45',
      'encoded=LOG_QUERY_ENCODED%2FVALUE%3F6b45',
      'duplicate=LOG_QUERY_DUPLICATE_ONE_6b45',
      'duplicate=LOG_QUERY_DUPLICATE_TWO_6b45',
      'page=LOG_QUERY_SAFE_LOOKING_6b45',
    ].join('&');
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/logging-query-canary?${query}`,
    );
    await response.text();
    await new Promise(resolve => setImmediate(resolve));

    const serialized = chunks.join('');
    const records = serialized.trim().split('\n').map(line => JSON.parse(line));
    const urlValues = records.flatMap(record => (
      Object.entries(record.req || {})
        .filter(([key]) => key.toLowerCase().includes('url'))
        .map(([, value]) => value)
    ));
    expect(urlValues).toEqual(['/logging-query-canary']);
    for (const canary of [
      'LOG_QUERY_API_KEY_6b45',
      'LOG_QUERY_TOKEN_6b45',
      'LOG_QUERY_OAUTH_CODE_6b45',
      'LOG_QUERY_OAUTH_STATE_6b45',
      'LOG_QUERY_MIXED_CASE_6b45',
      'LOG_QUERY_ENCODED%2FVALUE%3F6b45',
      'LOG_QUERY_ENCODED/VALUE?6b45',
      'LOG_QUERY_DUPLICATE_ONE_6b45',
      'LOG_QUERY_DUPLICATE_TWO_6b45',
      'LOG_QUERY_SAFE_LOOKING_6b45',
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });
});
