import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers';
import pino from 'pino';

const require = createRequire(import.meta.url);
const { createApp, loadPublicWebinarOrigins } = require('../../server');
const { PublicBundleError } = require('../../services/webinars/publicBundle');

const slug = 'first-home-without-mystery';
const slideId = '11111111-1111-4111-8111-111111111111';
const publicOrigin = 'https://msfgmortgage.com';
const dashboardOrigin = 'https://dashboard.msfgco.com';
const etag = `"${'a'.repeat(64)}"`;
const bundle = {
  schemaVersion: 1,
  webinar: { id: 17, slug, title: 'Your first home, without the mystery.', liveVersion: 4 },
  master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: '' },
  slides: [{ id: slideId, position: 0, anchor: 'opening', title: 'Opening', html: '<p>Hello</p>', css: '', javascript: '' }],
  assets: {},
  resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] },
};
const json = JSON.stringify(bundle);
const rawNonPublicRuntimeLookalikes = Object.freeze([
  ['backslash separators', `/api/public/webinars\\${slug}\\runtime-events`],
  ['literal dot segment', `/api/else/../public/webinars/${slug}/runtime-events`],
  ['repeated slash', `/api//public/webinars/${slug}/runtime-events`],
  ['encoded dot segment', `/api/else/%2e%2e/public/webinars/${slug}/runtime-events`],
  ['encoded backslashes', `/api/public/webinars%5C${slug}%5Cruntime-events`],
  ['absolute-form target', `http://msfgmortgage.com/api/public/webinars/${slug}/runtime-events`],
  ['fragment-bearing target', `/api/public/webinars/${slug}/runtime-events#fragment`],
]);

let server;
let getLiveBundleBySlug;
let operationalLogger;
let authenticate;
let errorLogger;

function identityMiddleware(req, res) {
  res.status(401).json({ error: 'Authentication required' });
}

async function listen(overrides = {}) {
  getLiveBundleBySlug = overrides.getLiveBundleBySlug
    || vi.fn().mockResolvedValue({ bundle, json, etag });
  operationalLogger = overrides.operationalLogger || { info: vi.fn() };
  authenticate = overrides.authenticate || vi.fn(identityMiddleware);
  errorLogger = overrides.errorLogger || { error: vi.fn() };
  const app = createApp({
    webinarAuthenticate: authenticate,
    webinarServices: { publicBundle: { getLiveBundleBySlug } },
    webinarOperationalLogger: operationalLogger,
    publicWebinarOrigins: overrides.publicWebinarOrigins || [publicOrigin, 'http://localhost:4200'],
    publicWebinarRuntimeLimit: overrides.publicWebinarRuntimeLimit || 1000,
    generalWriteLimit: overrides.generalWriteLimit || 200,
    accessLogger: overrides.accessLogger,
    errorLogger,
  });
  return new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
}

async function request(path, {
  method = 'GET',
  origin,
  headers = {},
  body,
} = {}) {
  const requestHeaders = { ...headers };
  if (origin !== undefined) requestHeaders.Origin = origin;
  if (body !== undefined && !Object.keys(requestHeaders).some(name => name.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: requestHeaders,
    body,
  });
  return { response, text: await response.text() };
}

function requestWithDeclaredLength(path, contentLength) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path,
      method: 'POST',
      headers: {
        Origin: publicOrigin,
        'Content-Type': 'application/json',
        'Content-Length': contentLength,
      },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject);
    req.end('x'.repeat(contentLength));
  });
}

function rawRequest(target, {
  method = 'POST',
  origin,
  headers = {},
  body = runtimePayload(),
} = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (origin !== undefined) requestHeaders.Origin = origin;
    if (body !== undefined) {
      if (!Object.keys(requestHeaders).some(name => name.toLowerCase() === 'content-type')) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      requestHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: target,
      method,
      headers: requestHeaders,
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: responseBody,
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function runtimePayload(overrides = {}) {
  return JSON.stringify({ liveVersion: 4, slideId, code: 'SLIDE_RUNTIME_ERROR', ...overrides });
}

beforeEach(async () => {
  server = await listen();
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
});

describe('public live webinar reads', () => {
  it('serves an unauthenticated bundle with exact public caching and CORS headers', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/live`, { origin: publicOrigin });

    expect(response.status).toBe(200);
    expect(text).toBe(json);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate, stale-if-error=300');
    expect(response.headers.get('etag')).toBe(etag);
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('vary')).toMatch(/(?:^|,\s*)Origin(?:,|$)/i);
    expect(authenticate).not.toHaveBeenCalled();
    expect(getLiveBundleBySlug).toHaveBeenCalledWith(slug);
  });

  it('gives HEAD the GET headers and no body', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/live`, {
      method: 'HEAD', origin: publicOrigin,
    });

    expect(response.status).toBe(200);
    expect(text).toBe('');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(json)));
    expect(response.headers.get('etag')).toBe(etag);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate, stale-if-error=300');
  });

  it.each([
    ['an exact validator', etag],
    ['a weak validator', `W/${etag}`],
    ['one validator in a list', `"${'b'.repeat(64)}", W/${etag}`],
    ['the wildcard validator', '*'],
  ])('returns 304 for %s', async (_label, validator) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/live`, {
      origin: publicOrigin,
      headers: { 'If-None-Match': validator },
    });

    expect(response.status).toBe(304);
    expect(text).toBe('');
    expect(response.headers.get('etag')).toBe(etag);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate, stale-if-error=300');
  });

  it('returns 200 when no validator matches', async () => {
    const { response } = await request(`/api/public/webinars/${slug}/live`, {
      headers: { 'If-None-Match': `W/"${'b'.repeat(64)}"` },
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ['an unterminated opaque tag before the real-looking hash', `"unterminated, ${etag}`],
    ['a trailing list separator', `${etag},`],
    ['a lowercase weak prefix', `w/${etag}`],
    ['a wildcard mixed into a list', `*, ${etag}`],
  ])('ignores malformed If-None-Match syntax: %s', async (_label, validator) => {
    const { response } = await request(`/api/public/webinars/${slug}/live`, {
      headers: { 'If-None-Match': validator },
    });
    expect(response.status).toBe(200);
  });

  it('allows direct requests with no Origin but never reflects a missing origin', async () => {
    const { response } = await request(`/api/public/webinars/${slug}/live`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects an unlisted origin without reflecting it', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/live`, {
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary')).toMatch(/(?:^|,\s*)Origin(?:,|$)/i);
    expect(text).not.toContain('evil.example');
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
  });

  it('keeps public preflight path-specific and composes Vary values', async () => {
    const { response } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'OPTIONS',
      origin: publicOrigin,
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,HEAD,POST,OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type');
    const vary = response.headers.get('vary');
    expect(vary).toMatch(/(?:^|,\s*)Origin(?:,|$)/i);
    expect(vary).toMatch(/Access-Control-Request-Headers/i);
  });

  it('rejects a mixed-case public preflight after applying only public CORS policy', async () => {
    const { response, text } = await request(`/API/PUBLIC/WEBINARS/${slug}/RUNTIME-EVENTS`, {
      method: 'OPTIONS',
      origin: publicOrigin,
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
    expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    const vary = response.headers.get('vary');
    expect(vary).toMatch(/(?:^|,\s*)Origin(?:,|$)/i);
    expect(vary).toMatch(/Access-Control-Request-Headers/i);
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 404, reasonCode: 'WEBINAR_NOT_FOUND',
    }, 'webinar operational event');
    expect(errorLogger.error).not.toHaveBeenCalled();
  });

  it('does not broaden private Dashboard CORS or bypass private authentication', async () => {
    const rejected = await request('/api/webinars', { origin: publicOrigin });
    expect(rejected.response.status).toBe(403);
    expect(rejected.response.headers.get('access-control-allow-origin')).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();

    const privateRequest = await request('/api/webinars', { origin: dashboardOrigin });
    expect(privateRequest.response.status).toBe(401);
    expect(privateRequest.response.headers.get('access-control-allow-origin')).toBe(dashboardOrigin);
    expect(privateRequest.response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it.each(rawNonPublicRuntimeLookalikes)(
    'keeps the %s lookalike on private CORS with no webinar event',
    async (_label, target) => {
      const result = await rawRequest(target, { origin: publicOrigin });

      expect(result.status).toBe(403);
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
      expect(result.headers['access-control-allow-credentials']).toBeUndefined();
      expect(result.body).not.toMatch(/RAW_LOOKALIKE|runtime|slide|source|stack/i);
      expect(getLiveBundleBySlug).not.toHaveBeenCalled();
      expect(operationalLogger.info).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for a missing, archived, or audience-disabled slug', async () => {
    getLiveBundleBySlug.mockResolvedValueOnce(null);
    const { response, text } = await request(`/api/public/webinars/${slug}/live`, { origin: publicOrigin });
    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: 'Webinar not found' });
    expect(operationalLogger.info).not.toHaveBeenCalled();
  });

  it('rejects canonical, trailing, query, and malformed mixed-case public aliases at one safe boundary', async () => {
    await new Promise(resolve => server.close(resolve));
    const chunks = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const accessLogger = pino({ base: null, timestamp: false }, stream);
    server = await listen({ accessLogger });

    const samples = [
      ['GET', `/API/PUBLIC/WEBINARS/${slug}/live`, undefined, {}],
      ['GET', `/api/Public/webinars/${slug}/LIVE/`, undefined, {}],
      ['GET', `/Api/Public/Webinars/${slug}/LiVe?source=MIXED_QUERY_CANARY`, undefined, {}],
      ['POST', `/API/PUBLIC/WEBINARS/${slug}/runtime-events`, runtimePayload(), {}],
      ['POST', `/api/Public/webinars/${slug}/RUNTIME-EVENTS/`, runtimePayload(), {}],
      ['POST', `/Api/Public/Webinars/${slug}/Runtime-Events?source=MIXED_QUERY_CANARY`, runtimePayload(), {}],
      ['GET', '/API/PUBLIC/WEBINARS/MIXED_URI_CANARY_%ZZ/live', undefined, {}],
      ['GET', '/api/Public/webinars/MIXED_URI_CANARY_%/LIVE/', undefined, {}],
      ['GET', '/Api/Public/Webinars/MIXED_URI_CANARY_%C3%28/LiVe?source=MIXED_QUERY_CANARY', undefined, {}],
      ['POST', '/API/PUBLIC/WEBINARS/MIXED_URI_CANARY_%ZZ/runtime-events', runtimePayload(), {}],
      ['POST', '/api/Public/webinars/MIXED_URI_CANARY_%/RUNTIME-EVENTS/', runtimePayload(), {}],
      [
        'POST',
        `/api/public/webinars/${slug}/Runtime-Events?source=MIXED_QUERY_CANARY`,
        '{"MIXED_BODY_CANARY":',
        { 'Content-Type': 'text/MIXED_TRANSPORT_CANARY' },
      ],
    ];

    for (const [method, path, body, headers] of samples) {
      operationalLogger.info.mockClear();
      const { response, text } = await request(path, {
        method, origin: publicOrigin, headers, body,
      });

      expect(response.status, `${method} ${path}`).toBe(404);
      expect(JSON.parse(text)).toEqual({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
      expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
      expect(response.headers.get('vary')).toMatch(/(?:^|,\s*)Origin(?:,|$)/i);
      expect(text).not.toMatch(/MIXED_|%ZZ|%C3|URIError|decode|stack/i);
      expect(getLiveBundleBySlug).not.toHaveBeenCalled();
      expect(operationalLogger.info).toHaveBeenCalledTimes(1);
      expect(operationalLogger.info).toHaveBeenCalledWith({
        event: 'webinar.validation_rejected', statusCode: 404, reasonCode: 'WEBINAR_NOT_FOUND',
      }, 'webinar operational event');
      expect(JSON.stringify(operationalLogger.info.mock.calls))
        .not.toMatch(/MIXED_|%ZZ|%C3|URIError|decode|stack/i);
    }
    await new Promise(resolve => setImmediate(resolve));

    expect(errorLogger.error).not.toHaveBeenCalled();
    const serializedAccess = chunks.join('');
    expect(serializedAccess).not.toMatch(/MIXED_|%ZZ|%C3|URIError|decode|stack/i);
    const records = serializedAccess.trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(samples.length);
    expect(records.every(record => record.req.url === '/api/public/webinars/[redacted]')).toBe(true);
    expect(records.every(record => record.req.headers['content-type'] === undefined)).toBe(true);
  });

  it.each([
    ['GET live canonical malformed hex', 'GET', '/api/public/webinars/PUBLIC_URI_CANARY_%ZZ/live'],
    ['GET live trailing incomplete escape', 'GET', '/api/public/webinars/PUBLIC_URI_CANARY_%/live/'],
    ['GET live query invalid UTF-8', 'GET', '/api/public/webinars/PUBLIC_URI_CANARY_%C3%28/live?source=QUERY_URI_CANARY'],
    ['POST runtime canonical malformed hex', 'POST', '/api/public/webinars/PUBLIC_URI_CANARY_%ZZ/runtime-events'],
    ['POST runtime trailing incomplete escape', 'POST', '/api/public/webinars/PUBLIC_URI_CANARY_%/runtime-events/'],
    ['POST runtime query invalid UTF-8', 'POST', '/api/public/webinars/PUBLIC_URI_CANARY_%C3%28/runtime-events?source=QUERY_URI_CANARY'],
  ])('normalizes %s without leaking the URI failure', async (_label, method, path) => {
    await new Promise(resolve => server.close(resolve));
    const chunks = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const accessLogger = pino({ base: null, timestamp: false }, stream);
    server = await listen({ accessLogger });

    const { response, text } = await request(path, {
      method,
      origin: publicOrigin,
      body: method === 'POST' ? runtimePayload() : undefined,
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
    expect(text).not.toMatch(/PUBLIC_URI_CANARY|QUERY_URI_CANARY|%ZZ|%C3/i);
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 404, reasonCode: 'WEBINAR_NOT_FOUND',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/PUBLIC_URI_CANARY|QUERY_URI_CANARY|URIError|decode|stack/i);
    expect(errorLogger.error).not.toHaveBeenCalled();

    const serializedAccess = chunks.join('');
    expect(serializedAccess).not.toMatch(/PUBLIC_URI_CANARY|QUERY_URI_CANARY|%ZZ|%C3/i);
    const records = serializedAccess.trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].req.url).toBe('/api/public/webinars/[redacted]');
  });

  it('keeps malformed non-public parameter routes on the existing error path', async () => {
    const { response, text } = await request('/api/schedule/sync/NON_PUBLIC_URI_CANARY_%ZZ/callback', {
      origin: dashboardOrigin,
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).not.toEqual({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
    expect(operationalLogger.info).not.toHaveBeenCalled();
    expect(errorLogger.error).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed JSON', '{"liveVersion":'],
    ['a JSON primitive', 'true'],
  ])('returns one fixed parser 400 for %s without logging payload details', async (_label, body) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body,
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Invalid runtime event JSON', code: 'MALFORMED_JSON' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 400, reasonCode: 'MALFORMED_JSON',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/liveVersion|private|source|stack/i);
  });

  it('treats a JSON array as a schema violation rather than a parser failure', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: '[]',
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Invalid runtime event', code: 'VALIDATION_FAILED' });
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 400, reasonCode: 'VALIDATION_FAILED',
    }, 'webinar operational event');
  });

  it('does not parse a non-JSON content type through the later global parser', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST',
      origin: publicOrigin,
      headers: { 'Content-Type': 'text/plain' },
      body: runtimePayload(),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Unsupported runtime event transport', code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 400, reasonCode: 'UNSUPPORTED_MEDIA_TYPE',
    }, 'webinar operational event');
  });

  it.each([
    ['Content-Encoding', { 'Content-Encoding': 'private-encoding' }],
    ['charset', { 'Content-Type': 'application/json; charset=secret-charset' }],
  ])('normalizes unsupported %s without logging or reflecting its value', async (_label, transportHeaders) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, headers: transportHeaders, body: runtimePayload(),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Unsupported runtime event transport', code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(text).not.toMatch(/private-encoding|secret-charset/i);
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 400, reasonCode: 'UNSUPPORTED_MEDIA_TYPE',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/private-encoding|secret-charset/i);
  });

  it('allows a direct same-origin-style telemetry request without reflecting CORS', async () => {
    const { response } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', body: runtimePayload(),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('maps controlled and unknown bundle failures to one safe operational event and generic 503', async () => {
    for (const error of [
      new PublicBundleError(new Error('stored <script> and s3://private/key client-name.png')),
      new Error('database password and internal query'),
    ]) {
      operationalLogger.info.mockClear();
      getLiveBundleBySlug.mockRejectedValueOnce(error);
      const { response, text } = await request(`/api/public/webinars/${slug}/live`, { origin: publicOrigin });
      expect(response.status).toBe(503);
      expect(JSON.parse(text)).toEqual({ error: 'Public webinar is temporarily unavailable' });
      expect(text).not.toMatch(/stored|script|s3|private|client-name|database|password|query/i);
      expect(operationalLogger.info).toHaveBeenCalledTimes(1);
      expect(operationalLogger.info).toHaveBeenCalledWith({
        event: 'webinar.public_delivery_failure',
        statusCode: 503,
        reasonCode: 'PUBLIC_DELIVERY_FAILURE',
      }, 'webinar operational event');
      expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toContain(slideId);
    }
  });
});

describe('public webinar origin configuration', () => {
  it('defaults production to the one mortgage-site origin', () => {
    expect(loadPublicWebinarOrigins({ NODE_ENV: 'production' })).toEqual([publicOrigin]);
  });

  it('allows only explicitly configured loopback origins outside production', () => {
    expect(loadPublicWebinarOrigins(
      { NODE_ENV: 'development', PUBLIC_WEBINAR_ORIGINS: 'http://localhost:4200,http://127.0.0.1:4182' },
    )).toEqual([publicOrigin, 'http://localhost:4200', 'http://127.0.0.1:4182']);
  });

  it.each([
    ['a wildcard', { NODE_ENV: 'development', PUBLIC_WEBINAR_ORIGINS: '*' }],
    ['a non-loopback development site', { NODE_ENV: 'development', PUBLIC_WEBINAR_ORIGINS: 'https://preview.example' }],
    ['a localhost production origin', { NODE_ENV: 'production', PUBLIC_WEBINAR_ORIGINS: 'http://localhost:4200' }],
    ['an origin with a path', { NODE_ENV: 'development', PUBLIC_WEBINAR_ORIGINS: 'http://localhost:4200/path' }],
  ])('fails closed for %s', (_label, env) => {
    expect(() => loadPublicWebinarOrigins(env)).toThrow('Invalid public webinar origin configuration');
  });
});

describe('public runtime telemetry', () => {
  it.each(['SLIDE_RUNTIME_ERROR', 'SLIDE_STARTUP_TIMEOUT'])('records the closed %s reason for an audience-enabled webinar', async (code) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload({ code }),
    });

    expect(response.status).toBe(204);
    expect(text).toBe('');
    expect(getLiveBundleBySlug).toHaveBeenCalledWith(slug);
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.public_runtime_error',
      webinarId: 17,
      slideId,
      liveVersion: 4,
      statusCode: 204,
      reasonCode: code,
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/first-home|source|stack|message/i);
  });

  it.each([
    [`/api/public/webinars/${slug}/runtime-events/`, undefined],
    [`/api/public/webinars/${slug}/runtime-events/?source=PRIVATE_QUERY_CANARY`, undefined],
  ])('applies identical valid semantics to %s', async (path) => {
    const { response } = await request(path, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    });
    expect(response.status).toBe(204);
    expect(getLiveBundleBySlug).toHaveBeenCalledWith(slug);
  });

  it.each([
    ['wrong media', { headers: { 'Content-Type': 'text/PRIVATE_MEDIA_CANARY' }, body: runtimePayload(), status: 400, code: 'UNSUPPORTED_MEDIA_TYPE' }],
    ['unsupported charset', { headers: { 'Content-Type': 'application/json; charset=PRIVATE_CHARSET_CANARY' }, body: runtimePayload(), status: 400, code: 'UNSUPPORTED_MEDIA_TYPE' }],
    ['unsupported encoding', { headers: { 'Content-Encoding': 'PRIVATE_ENCODING_CANARY' }, body: runtimePayload(), status: 400, code: 'UNSUPPORTED_MEDIA_TYPE' }],
    ['oversize body', { headers: {}, body: `${runtimePayload()}${' '.repeat(2048)}`, status: 413, code: 'CONTENT_LIMIT_EXCEEDED' }],
    ['malformed JSON', { headers: {}, body: '{"PRIVATE_JSON_CANARY":', status: 400, code: 'MALFORMED_JSON' }],
  ])('normalizes trailing-slash %s through the exact transport boundary', async (_label, sample) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events/`, {
      method: 'POST', origin: publicOrigin, headers: sample.headers, body: sample.body,
    });
    expect(response.status).toBe(sample.status);
    expect(JSON.parse(text).code).toBe(sample.code);
    expect(text).not.toMatch(/PRIVATE_/);
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/PRIVATE_/);
  });

  it('does not recognize doubled/internal slashes or nearby route names as runtime events', async () => {
    for (const path of [
      `/api/public/webinars/${slug}/runtime-events//`,
      `/api/public/webinars/${slug}//runtime-events`,
      `/api/public/webinars/${slug}/runtime-events-nearby`,
    ]) {
      const result = await request(path, {
        method: 'POST', origin: publicOrigin, body: runtimePayload(),
      });
      expect(result.response.status).toBe(404);
    }
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).not.toHaveBeenCalled();
  });

  it.each(rawNonPublicRuntimeLookalikes)(
    'routes the %s lookalike through only the general write quota',
    async (_label, target) => {
      await new Promise(resolve => server.close(resolve));
      server = await listen({ publicWebinarRuntimeLimit: 1, generalWriteLimit: 1 });

      const firstLookalike = await rawRequest(target);
      expect(firstLookalike.status).toBe(404);
      expect(JSON.parse(firstLookalike.body)).toEqual({ error: 'Not found' });
      expect(getLiveBundleBySlug).not.toHaveBeenCalled();
      expect(operationalLogger.info).not.toHaveBeenCalled();

      expect((await rawRequest(target)).status).toBe(429);
      expect(getLiveBundleBySlug).not.toHaveBeenCalled();
      expect(operationalLogger.info).not.toHaveBeenCalled();

      const canonical = await rawRequest(`/api/public/webinars/${slug}/runtime-events`);
      expect(canonical.status).toBe(204);
      expect((await rawRequest(`/api/public/webinars/${slug}/runtime-events`)).status).toBe(429);
    },
  );

  it('logs raw non-public lookalikes with ordinary header policy and no query data', async () => {
    await new Promise(resolve => server.close(resolve));
    const chunks = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const accessLogger = pino({ base: null, timestamp: false }, stream);
    server = await listen({ accessLogger });

    const queryCanary = 'RAW_LOOKALIKE_QUERY_SECRET';
    const samples = rawNonPublicRuntimeLookalikes.map(([label, target], index) => ({
      label,
      target: index === 1 ? `${target}?trace=${queryCanary}` : target,
      expectedPath: index < 5 ? target : undefined,
    }));
    for (const sample of samples) {
      const result = await rawRequest(sample.target, {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
      expect(result.status, sample.label).toBe(404);
    }
    await new Promise(resolve => setImmediate(resolve));

    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).not.toHaveBeenCalled();
    const serialized = chunks.join('');
    expect(serialized).not.toContain(queryCanary);
    const records = serialized.trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(samples.length);
    for (const [index, record] of records.entries()) {
      expect(record.req.url, samples[index].label).toBe(samples[index].expectedPath);
      expect(record.req.headers['content-type'], samples[index].label)
        .toBe('application/json; charset=utf-8');
    }
  });

  it('removes runtime transport canaries from the actual access log, response, and event', async () => {
    await new Promise(resolve => server.close(resolve));
    const chunks = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const accessLogger = pino({ base: null, timestamp: false }, stream);
    server = await listen({ accessLogger });

    const samples = [
      { path: '', headers: { 'Content-Type': 'text/ACCESS_MEDIA_SECRET' } },
      { path: '/', headers: { 'Content-Type': 'application/json; charset=ACCESS_CHARSET_SECRET' } },
      { path: '/', headers: { 'Content-Encoding': 'ACCESS_ENCODING_SECRET' } },
    ];
    let responses = '';
    for (const sample of samples) {
      const result = await request(`/api/public/webinars/${slug}/runtime-events${sample.path}`, {
        method: 'POST', origin: publicOrigin, headers: sample.headers, body: runtimePayload(),
      });
      expect(result.response.status).toBe(400);
      responses += result.text;
    }
    await new Promise(resolve => setImmediate(resolve));

    const serializedAccess = chunks.join('');
    const serializedEvents = JSON.stringify(operationalLogger.info.mock.calls);
    for (const secret of ['ACCESS_MEDIA_SECRET', 'ACCESS_CHARSET_SECRET', 'ACCESS_ENCODING_SECRET']) {
      expect(serializedAccess).not.toContain(secret);
      expect(responses).not.toContain(secret);
      expect(serializedEvents).not.toContain(secret);
    }
    const records = serializedAccess.trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records.every(record => record.req.headers['content-type'] === undefined)).toBe(true);
  });

  it.each([
    ['zero version', { liveVersion: 0 }],
    ['unsafe version', { liveVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid slide UUID', { slideId: 'not-a-uuid' }],
    ['unknown code', { code: 'ARBITRARY_ERROR' }],
    ['extra field', { source: '<script>private()</script>' }],
    ['stack field', { stack: 's3://private/key' }],
    ['message field', { message: 'private filename.png' }],
  ])('rejects %s with no event', async (_label, override) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(override),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Invalid runtime event', code: 'VALIDATION_FAILED' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 400, reasonCode: 'VALIDATION_FAILED',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/script|private|filename|stack/i);
  });

  it('accepts exactly 2 KiB and rejects 2 KiB plus one before global JSON parsing', async () => {
    const raw = runtimePayload();
    const exact = `${raw}${' '.repeat(2048 - Buffer.byteLength(raw))}`;
    const accepted = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: exact,
    });
    expect(accepted.response.status).toBe(204);

    const oversized = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: `${exact} `,
    });
    expect(oversized.response.status).toBe(413);
    expect(JSON.parse(oversized.text)).toEqual({
      error: 'Runtime event exceeds 2 KiB limit', code: 'CONTENT_LIMIT_EXCEEDED',
    });
    expect(getLiveBundleBySlug).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info).toHaveBeenLastCalledWith({
      event: 'webinar.validation_rejected', statusCode: 413, reasonCode: 'CONTENT_LIMIT_EXCEEDED',
    }, 'webinar operational event');
  });

  it('rejects an oversized declared body before waiting for or parsing it', async () => {
    const response = await requestWithDeclaredLength(`/api/public/webinars/${slug}/runtime-events`, 2049);
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Runtime event exceeds 2 KiB limit', code: 'CONTENT_LIMIT_EXCEEDED',
    });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).toHaveBeenCalledWith({
      event: 'webinar.validation_rejected', statusCode: 413, reasonCode: 'CONTENT_LIMIT_EXCEEDED',
    }, 'webinar operational event');
  });

  it('returns 404 and writes no runtime event when the slug is not audience-enabled', async () => {
    getLiveBundleBySlug.mockResolvedValueOnce(null);
    const { response } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    });
    expect(response.status).toBe(404);
    expect(operationalLogger.info).not.toHaveBeenCalled();
  });

  it('attempts each operational event once without letting a failed log sink change the response', async () => {
    await new Promise(resolve => server.close(resolve));
    const failedLogger = { info: vi.fn(() => { throw new Error('private sink failure'); }) };
    server = await listen({ operationalLogger: failedLogger });

    getLiveBundleBySlug.mockRejectedValueOnce(new Error('private database failure'));
    const deliveryFailure = await request(`/api/public/webinars/${slug}/live`, { origin: publicOrigin });
    expect(deliveryFailure.response.status).toBe(503);

    const runtimeAccepted = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    });
    expect(runtimeAccepted.response.status).toBe(204);
    expect(failedLogger.info).toHaveBeenCalledTimes(2);
  });

  it('applies exactly 60 writes per resolved client IP while skipping GET, HEAD, and OPTIONS', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 60 });
    const post = ip => request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST',
      origin: publicOrigin,
      headers: { 'X-Forwarded-For': ip },
      body: runtimePayload(),
    });

    expect((await request(`/api/public/webinars/${slug}/live`, {
      origin: publicOrigin, headers: { 'X-Forwarded-For': '198.51.100.10' },
    })).response.status).toBe(200);
    expect((await request(`/api/public/webinars/${slug}/live`, {
      method: 'HEAD', origin: publicOrigin, headers: { 'X-Forwarded-For': '198.51.100.10' },
    })).response.status).toBe(200);
    expect((await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'OPTIONS', origin: publicOrigin, headers: { 'X-Forwarded-For': '198.51.100.10' },
    })).response.status).toBe(204);
    for (let index = 0; index < 60; index += 1) {
      expect((await post('198.51.100.10')).response.status).toBe(204);
    }
    expect((await post('198.51.100.10')).response.status).toBe(429);
    expect((await post('198.51.100.11')).response.status).toBe(204);
  });

  it('allows a raised dedicated limit to cross the general 200-write boundary', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 205 });
    for (let index = 0; index < 201; index += 1) {
      const result = await request(`/api/public/webinars/${slug}/runtime-events`, {
        method: 'POST', origin: publicOrigin, body: runtimePayload(),
      });
      expect(result.response.status).toBe(204);
    }
  });

  it('isolates the public telemetry quota from the Dashboard write quota in both directions', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 1, generalWriteLimit: 1 });

    const dashboardWrite = await request('/api/announcements', {
      method: 'POST', origin: dashboardOrigin, body: '{}',
    });
    expect(dashboardWrite.response.status).toBe(401);
    const firstPublic = await request(`/api/public/webinars/${slug}/runtime-events/`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    });
    expect(firstPublic.response.status).toBe(204);
    const publicExcess = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    });
    expect(publicExcess.response.status).toBe(429);
    const dashboardExcess = await request('/api/announcements', {
      method: 'POST', origin: dashboardOrigin, body: '{}',
    });
    expect(dashboardExcess.response.status).toBe(429);

    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 3, generalWriteLimit: 1 });
    for (let index = 0; index < 2; index += 1) {
      const publicWrite = await request(`/api/public/webinars/${slug}/runtime-events`, {
        method: 'POST', origin: publicOrigin, body: runtimePayload(),
      });
      expect(publicWrite.response.status).toBe(204);
    }
    const firstDashboardWrite = await request('/api/announcements', {
      method: 'POST', origin: dashboardOrigin, body: '{}',
    });
    expect(firstDashboardWrite.response.status).toBe(401);
    const secondDashboardExcess = await request('/api/announcements', {
      method: 'POST', origin: dashboardOrigin, body: '{}',
    });
    expect(secondDashboardExcess.response.status).toBe(429);
  });

  it('does not exempt a nearby non-runtime public POST from the general write limiter', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 10, generalWriteLimit: 1 });
    const path = `/api/public/webinars/${slug}/runtime-events-nearby`;
    expect((await request(path, { method: 'POST', origin: publicOrigin, body: '{}' })).response.status).toBe(404);
    expect((await request(path, { method: 'POST', origin: publicOrigin, body: '{}' })).response.status).toBe(429);
  });

  it('does not let rejected mixed-case runtime aliases consume the general write quota', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 10, generalWriteLimit: 1 });
    const mixedPath = `/api/public/webinars/${slug}/RUNTIME-EVENTS`;

    for (let index = 0; index < 2; index += 1) {
      expect((await request(mixedPath, {
        method: 'POST', origin: publicOrigin, body: runtimePayload(),
      })).response.status).toBe(404);
    }
    expect((await request('/api/announcements', {
      method: 'POST', origin: dashboardOrigin, body: '{}',
    })).response.status).toBe(401);
    expect((await request('/api/announcements', {
      method: 'POST', origin: dashboardOrigin, body: '{}',
    })).response.status).toBe(429);
  });

  it('counts rejected mixed-case runtime aliases only against the dedicated telemetry quota', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 1, generalWriteLimit: 10 });
    const mixedPath = `/API/PUBLIC/WEBINARS/${slug}/runtime-events`;

    expect((await request(mixedPath, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    })).response.status).toBe(404);
    expect((await request(mixedPath, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    })).response.status).toBe(429);
    expect((await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    })).response.status).toBe(429);
  });

  it('shares one dedicated quota between canonical and trailing-slash runtime paths', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 1 });
    expect((await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    })).response.status).toBe(204);
    expect((await request(`/api/public/webinars/${slug}/runtime-events/`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
    })).response.status).toBe(429);
  });
});
