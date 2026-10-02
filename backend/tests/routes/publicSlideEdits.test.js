import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
const { SlideEditError } = require('../../services/webinars/slideEdits');

const base = '/api/public/webinar-slide-edits';
const publicOrigin = 'https://msfgmortgage.com';
const dashboardOrigin = 'https://dashboard.msfgco.com';
const password = 'test-edit-password';
const saved = { slideId: 'opening', html: '<h1>Hi</h1>', css: 'h1 { color: red; }', js: '', updatedAt: '2026-10-01T12:00:00.000Z' };

let server;
let service;

async function listen(overrides = {}) {
  service = overrides.service || {
    listBySlug: vi.fn().mockResolvedValue([saved]),
    save: vi.fn().mockResolvedValue(saved),
    remove: vi.fn().mockResolvedValue(true),
  };
  const app = createApp({
    slideEditServices: {
      service,
      getPassword: 'getPassword' in overrides ? overrides.getPassword : () => password,
    },
    slideEditWriteLimit: overrides.slideEditWriteLimit || 1000,
    generalWriteLimit: overrides.generalWriteLimit || 200,
    publicWebinarOrigins: [publicOrigin, 'http://localhost:4200'],
    errorLogger: { error: vi.fn() },
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
}

async function request(path, { method = 'GET', origin = publicOrigin, headers = {}, body } = {}) {
  const requestHeaders = { ...headers };
  if (origin) requestHeaders.Origin = origin;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: requestHeaders,
    body,
  });
  const text = await response.text();
  return { response, text, json: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
}

function put(path, body, pass = password) {
  return request(path, {
    method: 'PUT',
    headers: pass === null ? {} : { 'X-Webinar-Edit-Password': pass },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  server = null;
});

describe('public slide edits', () => {
  it('lets anyone read the saved edits for a deck, uncached and cross-origin readable', async () => {
    await listen();
    const { response, json } = await request(`${base}/reverse-mortgages`);
    expect(response.status).toBe(200);
    expect(json).toEqual({ slug: 'reverse-mortgages', edits: [saved] });
    expect(service.listBySlug).toHaveBeenCalledWith('reverse-mortgages');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('serves the www hostname of the webinar site too, without opening the Studio routes to it', async () => {
    await listen();
    const www = 'https://www.msfgmortgage.com';
    const edits = await request(`${base}/reverse-mortgages`, { origin: www });
    expect(edits.response.status).toBe(200);
    expect(edits.response.headers.get('access-control-allow-origin')).toBe(www);
    const studio = await request('/api/public/webinars/reverse-mortgages/live', { origin: www });
    expect(studio.response.status).toBe(403);
  });

  it('answers the browser preflight for a password-carrying save', async () => {
    await listen();
    const { response } = await request(`${base}/reverse-mortgages/opening`, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type,x-webinar-edit-password',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
    expect(response.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(response.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(response.headers.get('access-control-allow-headers').toLowerCase()).toContain('x-webinar-edit-password');
  });

  it('refuses origins that are not the webinar site, including the Dashboard', async () => {
    await listen();
    for (const origin of [dashboardOrigin, 'https://evil.example']) {
      const denied = await request(`${base}/reverse-mortgages`, { origin });
      expect(denied.response.status).toBe(403);
      expect(denied.response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(service.listBySlug).not.toHaveBeenCalled();
  });

  it('saves with the right password and returns the stored edit', async () => {
    await listen();
    const { response, json } = await put(`${base}/reverse-mortgages/opening`, { html: '<h1>Hi</h1>', css: 'h1 { color: red; }' });
    expect(response.status).toBe(200);
    expect(json).toEqual(saved);
    expect(service.save).toHaveBeenCalledWith('reverse-mortgages', 'opening', { html: '<h1>Hi</h1>', css: 'h1 { color: red; }' });
  });

  it('rejects a missing or wrong password without touching storage', async () => {
    await listen();
    for (const pass of [null, '', 'nope', `${password}x`, password.toUpperCase()]) {
      const { response, json } = await put(`${base}/reverse-mortgages/opening`, { html: '<p>x</p>', css: '' }, pass);
      expect(response.status).toBe(401);
      expect(json.code).toBe('WRONG_PASSWORD');
    }
    const reset = await request(`${base}/reverse-mortgages/opening`, { method: 'DELETE' });
    expect(reset.response.status).toBe(401);
    expect(service.save).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('refuses every save when the server has no password configured', async () => {
    for (const getPassword of [() => undefined, () => '']) {
      await listen({ getPassword });
      const { response, json } = await put(`${base}/reverse-mortgages/opening`, { html: '<p>x</p>', css: '' }, '');
      expect(response.status).toBe(503);
      expect(json.code).toBe('EDITING_NOT_CONFIGURED');
      expect(service.save).not.toHaveBeenCalled();
      await new Promise(resolve => server.close(resolve));
      server = null;
    }
  });

  it('saves and resets the deck-wide Master CSS under its reserved name', async () => {
    await listen();
    const body = { html: '', css: '.source-title { color: red; }', js: '' };
    expect((await put(`${base}/reverse-mortgages/_master`, body)).response.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith('reverse-mortgages', '_master', body);
    const reset = await request(`${base}/reverse-mortgages/_master`, {
      method: 'DELETE',
      headers: { 'X-Webinar-Edit-Password': password },
    });
    expect(reset.response.status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith('reverse-mortgages', '_master');
    expect((await put(`${base}/reverse-mortgages/_other`, body)).response.status).toBe(404);
  });

  it('saves the deck\'s slide list (added and removed slides) under its reserved name', async () => {
    await listen();
    const body = { html: JSON.stringify({ order: ['opening', 'added-k3x9'], added: { 'added-k3x9': { from: 'opening', title: 'New' } }, removed: [] }), css: '', js: '' };
    expect((await put(`${base}/reverse-mortgages/_slides`, body)).response.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith('reverse-mortgages', '_slides', body);
    expect((await put(`${base}/reverse-mortgages/_slides`, body, 'nope')).response.status).toBe(401);
  });

  it('lists the webinars created in Webinar Studio, and creates one under its reserved name', async () => {
    const created = [{ slug: 'first-time-buyers', title: 'First-time buyers', createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }];
    await listen({
      service: {
        listWebinars: vi.fn().mockResolvedValue(created),
        listBySlug: vi.fn(),
        save: vi.fn().mockResolvedValue(saved),
        remove: vi.fn(),
      },
    });
    for (const path of [base, `${base}/`]) {
      const { response, json } = await request(path);
      expect(response.status).toBe(200);
      expect(json).toEqual({ webinars: created });
      expect(response.headers.get('access-control-allow-origin')).toBe(publicOrigin);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const body = { html: JSON.stringify({ title: 'First-time buyers' }), css: '', js: '' };
    expect((await put(`${base}/first-time-buyers/_webinar`, body)).response.status).toBe(200);
    expect(service.save).toHaveBeenCalledWith('first-time-buyers', '_webinar', body);
    expect((await put(`${base}/first-time-buyers/_webinar`, body, 'nope')).response.status).toBe(401);
  });

  it('resets a slide with the right password', async () => {
    await listen();
    const { response } = await request(`${base}/reverse-mortgages/opening`, {
      method: 'DELETE',
      headers: { 'X-Webinar-Edit-Password': password },
    });
    expect(response.status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith('reverse-mortgages', 'opening');
  });

  it('returns not found for names that are not deck or slide ids', async () => {
    await listen();
    expect((await request(`${base}/Not_A_Slug`)).response.status).toBe(404);
    expect((await put(`${base}/reverse-mortgages/Bad%20Id`, { html: '<p>x</p>', css: '' })).response.status).toBe(404);
    expect((await request('/API/public/webinar-slide-edits/reverse-mortgages', { origin: null })).response.status).toBe(404);
    expect(service.listBySlug).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('reports validation, oversize and malformed bodies clearly', async () => {
    await listen({
      service: {
        listBySlug: vi.fn(),
        save: vi.fn().mockRejectedValue(new SlideEditError('VALIDATION_FAILED', 'There is nothing to save')),
        remove: vi.fn(),
      },
    });
    const invalid = await put(`${base}/reverse-mortgages/opening`, { html: '', css: '' });
    expect(invalid.response.status).toBe(400);
    expect(invalid.json).toEqual({ error: 'There is nothing to save', code: 'VALIDATION_FAILED' });

    const malformed = await put(`${base}/reverse-mortgages/opening`, '{"html":');
    expect(malformed.response.status).toBe(400);
    expect(malformed.json.code).toBe('MALFORMED_JSON');

    const oversized = await put(`${base}/reverse-mortgages/opening`, { html: 'x'.repeat(600 * 1024), css: '' });
    expect(oversized.response.status).toBe(413);
    expect(oversized.json.code).toBe('CONTENT_LIMIT_EXCEEDED');
  });

  it('hides storage failures behind a temporary-unavailable answer', async () => {
    await listen({
      service: {
        listBySlug: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1')),
        save: vi.fn(),
        remove: vi.fn(),
      },
    });
    const { response, text } = await request(`${base}/reverse-mortgages`);
    expect(response.status).toBe(503);
    expect(text).not.toContain('ECONNREFUSED');
  });

  it('limits save attempts on their own budget, leaving reads and Dashboard writes alone', async () => {
    await listen({ slideEditWriteLimit: 2, generalWriteLimit: 1 });
    const attempt = () => put(`${base}/reverse-mortgages/opening`, { html: '<p>x</p>', css: '' }, 'guess');
    expect((await attempt()).response.status).toBe(401);
    expect((await attempt()).response.status).toBe(401);
    expect((await attempt()).response.status).toBe(429);
    expect((await request(`${base}/reverse-mortgages`)).response.status).toBe(200);
  });
});
