import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';

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

let server;
let getLiveBundleBySlug;
let operationalLogger;
let authenticate;

function identityMiddleware(req, res) {
  res.status(401).json({ error: 'Authentication required' });
}

async function listen(overrides = {}) {
  getLiveBundleBySlug = overrides.getLiveBundleBySlug
    || vi.fn().mockResolvedValue({ bundle, json, etag });
  operationalLogger = overrides.operationalLogger || { info: vi.fn() };
  authenticate = overrides.authenticate || vi.fn(identityMiddleware);
  const app = createApp({
    webinarAuthenticate: authenticate,
    webinarServices: { publicBundle: { getLiveBundleBySlug } },
    webinarOperationalLogger: operationalLogger,
    publicWebinarOrigins: overrides.publicWebinarOrigins || [publicOrigin, 'http://localhost:4200'],
    publicWebinarRuntimeLimit: overrides.publicWebinarRuntimeLimit || 1000,
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

  it('returns 404 for a missing, archived, or audience-disabled slug', async () => {
    getLiveBundleBySlug.mockResolvedValueOnce(null);
    const { response, text } = await request(`/api/public/webinars/${slug}/live`, { origin: publicOrigin });
    expect(response.status).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: 'Webinar not found' });
    expect(operationalLogger.info).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"liveVersion":'],
    ['an array', '[]'],
    ['a JSON primitive', 'true'],
  ])('returns one fixed 400 for %s without logging payload details', async (_label, body) => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body,
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Invalid runtime event' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).not.toHaveBeenCalled();
  });

  it('does not parse a non-JSON content type through the later global parser', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST',
      origin: publicOrigin,
      headers: { 'Content-Type': 'text/plain' },
      body: runtimePayload(),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ error: 'Invalid runtime event' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
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
  it('records one allow-listed event for an audience-enabled webinar and returns 204', async () => {
    const { response, text } = await request(`/api/public/webinars/${slug}/runtime-events`, {
      method: 'POST', origin: publicOrigin, body: runtimePayload(),
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
      reasonCode: 'PUBLIC_RUNTIME_ERROR',
    }, 'webinar operational event');
    expect(JSON.stringify(operationalLogger.info.mock.calls)).not.toMatch(/first-home|SLIDE_RUNTIME_ERROR|source|stack|message/i);
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
    expect(JSON.parse(text)).toEqual({ error: 'Invalid runtime event' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
    expect(operationalLogger.info).not.toHaveBeenCalled();
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
    expect(JSON.parse(oversized.text)).toEqual({ error: 'Runtime event exceeds 2 KiB limit' });
    expect(getLiveBundleBySlug).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized declared body before waiting for or parsing it', async () => {
    const response = await requestWithDeclaredLength(`/api/public/webinars/${slug}/runtime-events`, 2049);
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({ error: 'Runtime event exceeds 2 KiB limit' });
    expect(getLiveBundleBySlug).not.toHaveBeenCalled();
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

  it('limits writes per resolved client IP while skipping GET, HEAD, and OPTIONS', async () => {
    await new Promise(resolve => server.close(resolve));
    server = await listen({ publicWebinarRuntimeLimit: 2 });
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
    expect((await post('198.51.100.10')).response.status).toBe(204);
    expect((await post('198.51.100.10')).response.status).toBe(204);
    expect((await post('198.51.100.10')).response.status).toBe(429);
    expect((await post('198.51.100.11')).response.status).toBe(204);
  });
});
