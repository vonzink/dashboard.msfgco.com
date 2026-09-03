import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Covers the auth edge cases the cron job will actually hit: a fresh token is
// used as-is, an expiring one is refreshed and written back, a 401 triggers a
// single refresh + retry, and a missing token file gives a clear "run plaud
// login" error instead of a stack trace.

const require = createRequire(import.meta.url);
const { PlaudClient, PlaudAuthError, PlaudApiError, normalizeRecording, extractList } = require('../../services/plaud/client');
const tokenStore = require('../../services/plaud/tokenStore');

const API = 'https://api.test/developer/api';
const REFRESH = 'https://api.test/refresh';

let dir;
let tokenFile;
let fetchMock;

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  };
}

function makeClient() {
  return new PlaudClient({ tokenFile, apiBase: API, refreshUrl: REFRESH, fetchImpl: fetchMock });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plaud-test-'));
  tokenFile = path.join(dir, 'tokens.json');
  fetchMock = vi.fn();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('PlaudClient auth', () => {
  it('throws a PlaudAuthError with login instructions when no token file exists', async () => {
    await expect(makeClient().getCurrentUser()).rejects.toBeInstanceOf(PlaudAuthError);
    await expect(makeClient().getCurrentUser()).rejects.toThrow(/plaud login/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a fresh access token without refreshing', async () => {
    await tokenStore.save(tokenFile, {
      access_token: 'fresh',
      refresh_token: 'r1',
      token_type: 'Bearer',
      expires_at: Date.now() + 60 * 60 * 1000,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u1', email: 'me@x' }));

    const user = await makeClient().getCurrentUser();

    expect(user.email).toBe('me@x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/open/third-party/users/current`);
    expect(init.headers.Authorization).toBe('Bearer fresh');
  });

  it('refreshes an expiring token first and writes the new set back to disk', async () => {
    await tokenStore.save(tokenFile, {
      access_token: 'old',
      refresh_token: 'r1',
      token_type: 'Bearer',
      expires_at: Date.now() + 10 * 1000, // inside the 60s skew
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'u1' }));

    await makeClient().getCurrentUser();

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0];
    expect(refreshUrl).toBe(REFRESH);
    expect(refreshInit.method).toBe('POST');
    expect(String(refreshInit.body)).toBe('refresh_token=r1');
    expect(refreshInit.headers.Authorization).toBeUndefined();

    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');

    const saved = await tokenStore.load(tokenFile);
    expect(saved.access_token).toBe('new');
    expect(saved.refresh_token).toBe('r2');
    expect(saved.expires_at).toBeGreaterThan(Date.now() + 3500 * 1000);
  });

  it('keeps the old refresh token when the refresh response omits one', async () => {
    await tokenStore.save(tokenFile, { access_token: 'old', refresh_token: 'r1', expires_at: 1 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'u1' }));

    await makeClient().getCurrentUser();

    expect((await tokenStore.load(tokenFile)).refresh_token).toBe('r1');
  });

  it('retries exactly once after a 401 by refreshing', async () => {
    await tokenStore.save(tokenFile, { access_token: 'stale', refresh_token: 'r1', expires_at: Date.now() + 3600 * 1000 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'u1' }));

    const user = await makeClient().getCurrentUser();

    expect(user.id).toBe('u1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
  });

  it('surfaces a second 401 as an API error rather than looping', async () => {
    await tokenStore.save(tokenFile, { access_token: 'stale', refresh_token: 'r1', expires_at: Date.now() + 3600 * 1000 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }));

    await expect(makeClient().getCurrentUser()).rejects.toBeInstanceOf(PlaudApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('turns a failed refresh into a PlaudAuthError asking for re-login', async () => {
    await tokenStore.save(tokenFile, { access_token: 'old', refresh_token: 'dead', expires_at: 1 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, { status: 400 }));

    await expect(makeClient().getCurrentUser()).rejects.toThrow(/plaud login/);
  });
});

describe('PlaudClient endpoints', () => {
  beforeEach(async () => {
    await tokenStore.save(tokenFile, { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600 * 1000 });
  });

  it('lists files with a page size no smaller than Plaud allows and normalises rows', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      type: 'list',
      data: [
        { id: 'abc', name: 'Call with Bob', created_at: '2026-09-03T03:05:04', start_at: '2026-09-03T02:52:38', duration: 6000, serial_number: '888' },
        { junk: true },
      ],
      page: 1,
      page_size: 10,
    }));

    const rows = await makeClient().listFiles({ page: 1, pageSize: 5 });

    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/open/third-party/files/?page=1&page_size=10`);
    expect(rows).toEqual([{
      id: 'abc',
      name: 'Call with Bob',
      createdAt: '2026-09-03T03:05:04',
      startAt: '2026-09-03T02:52:38',
      durationMs: 6000,
      deviceSerial: '888',
    }]);
  });

  it('fetches one file by id, URL-encoding the id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'a/b', presigned_url: 'https://signed' }));

    const file = await makeClient().getFile('a/b');

    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/open/third-party/files/a%2Fb`);
    expect(file.presigned_url).toBe('https://signed');
  });

  it('opens a presigned audio URL without an Authorization header', async () => {
    const { Readable } = await import('stream');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: Readable.from([Buffer.from('mp3')]),
      headers: { get: (h) => (h === 'content-length' ? '3' : null) },
    });

    const { stream, contentLength } = await makeClient().openAudioStream('https://signed');

    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
    expect(contentLength).toBe(3);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('mp3');
  });
});

describe('helpers', () => {
  it('extractList accepts the known wrappers and a bare array', () => {
    expect(extractList([1])).toEqual([1]);
    expect(extractList({ data: [2] })).toEqual([2]);
    expect(extractList({ items: [3] })).toEqual([3]);
    expect(extractList({ nope: [4] })).toEqual([]);
    expect(extractList(null)).toEqual([]);
  });

  it('normalizeRecording drops rows without an id and coerces duration', () => {
    expect(normalizeRecording({ name: 'x' })).toBeNull();
    expect(normalizeRecording({ id: 1, duration: '250' }).durationMs).toBe(250);
    expect(normalizeRecording({ id: 1, duration: 'abc' }).durationMs).toBeNull();
  });

  it('tokenStore.normalize accepts camelCase and ISO expiry', () => {
    const t = tokenStore.normalize({ accessToken: 'a', refreshToken: 'r', expiresAt: '2030-01-01T00:00:00Z' });
    expect(t.access_token).toBe('a');
    expect(t.refresh_token).toBe('r');
    expect(t.expires_at).toBe(Date.parse('2030-01-01T00:00:00Z'));
    expect(tokenStore.normalize({})).toBeNull();
  });
});
