import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadServerApi(fetchImpl = vi.fn()) {
  const context = {
    window: {},
    document: { addEventListener: vi.fn(), cookie: '', visibilityState: 'hidden' },
    localStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    sessionStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    CONFIG: { api: { baseUrl: '/api', timeout: 1000 }, cognito: {} },
    URLSearchParams: globalThis.URLSearchParams,
    AbortController: globalThis.AbortController,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(process.cwd(), '../js/api-server.js'), 'utf8'), context);
  return context.window.ServerAPI;
}

function loadStudioApi(serverApi) {
  const context = {
    window: { ServerAPI: serverApi },
    URLSearchParams: globalThis.URLSearchParams,
    Object,
    encodeURIComponent,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(process.cwd(), '../js/webinar-studio/api.js'), 'utf8'), context);
  return context.window.WebinarStudioAPI;
}

describe('ServerAPI Webinar Studio transports', () => {
  it('preserves only bounded conflict metadata on a normal 409 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 409,
      ok: false,
      statusText: 'Conflict',
      json: vi.fn().mockResolvedValue({
        error: 'Webinar has changed',
        code: 'VERSION_CONFLICT',
        currentVersion: 8,
        updatedAt: '2026-09-05T12:00:00.000Z',
        updatedBy: { id: 9, name: 'Another Editor' },
        source: '<script>private source</script>',
        token: 'private-token',
      }),
    });
    const api = loadServerApi(fetchImpl);

    const error = await api.request('/webinars/12/master', { method: 'PUT' }).catch(value => value);

    expect(error.message).toBe('Webinar has changed');
    expect(error).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      currentVersion: 8,
      updatedAt: '2026-09-05T12:00:00.000Z',
      updatedBy: { id: 9, name: 'Another Editor' },
    });
    expect(Object.keys(error).sort()).toEqual(['code', 'currentVersion', 'status', 'updatedAt', 'updatedBy']);
    expect(JSON.stringify(error)).not.toMatch(/private source|private-token|script|token|source/);
  });

  it('drops malformed, oversized, secret, and arbitrary error metadata while preserving the message and status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 409,
      ok: false,
      statusText: 'Conflict',
      json: vi.fn().mockResolvedValue({
        error: 'Still changed',
        code: 'VERSION_CONFLICT<script>',
        currentVersion: '8',
        updatedAt: 'x'.repeat(1000),
        updatedBy: { id: 9, name: 'x'.repeat(1000), email: 'private@example.test' },
        headers: { authorization: 'Bearer secret' },
        body: '<script>source</script>',
      }),
    });
    const api = loadServerApi(fetchImpl);

    const error = await api.request('/webinars/12/master', { method: 'PUT' }).catch(value => value);

    expect(error.message).toBe('Still changed');
    expect(error.status).toBe(409);
    expect(Object.keys(error)).toEqual(['status']);
    expect(JSON.stringify(error)).not.toMatch(/Bearer|secret|private@example|script|authorization|headers|body|source/);
  });

  it('treats a successful 204 response as an empty result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, ok: true });
    const api = loadServerApi(fetchImpl);

    await expect(api.request('/webinars/12/notes/5', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('treats a successful 204 retry after token refresh as an empty result', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 204, ok: true });
    const api = loadServerApi(fetchImpl);
    api.refreshAccessToken = vi.fn().mockResolvedValue('refreshed-token');

    await expect(api.request('/webinars/12/notes/5', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('sends PATCH through the established authenticated request pipeline', async () => {
    const api = loadServerApi();
    api.request = vi.fn().mockResolvedValue({ ok: true });
    const body = { displayName: 'Front porch' };

    await api.patch('/webinar-assets/asset-id', body);

    expect(api.request).toHaveBeenCalledWith('/webinar-assets/asset-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  it('preserves one-argument DELETE behavior exactly', async () => {
    const api = loadServerApi();
    api.request = vi.fn().mockResolvedValue({ ok: true });

    await api.delete('/webinars/12');

    expect(api.request).toHaveBeenCalledWith('/webinars/12', { method: 'DELETE' });
  });

  it('adds JSON only for an explicitly body-bearing DELETE', async () => {
    const api = loadServerApi();
    api.request = vi.fn().mockResolvedValue({ ok: true });
    const body = { expectedVersion: 7 };

    await api.delete('/webinars/12/slides/slide-id', body);

    expect(api.request).toHaveBeenCalledWith('/webinars/12/slides/slide-id', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });
});

describe('WebinarStudioAPI fixed route adapter', () => {
  it('encodes every identifier and maps webinar, history, access, notes, settings, and users methods', async () => {
    const serverApi = {
      get: vi.fn().mockResolvedValue({}),
      post: vi.fn().mockResolvedValue({}),
      put: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const api = loadStudioApi(serverApi);
    const webinarId = '12/../../public';
    const slideId = 'slide/id?#';
    const revisionId = 'revision/id';
    const noteId = 'note/id';
    const body = { expectedVersion: 7 };
    const encodedWebinar = '12%2F..%2F..%2Fpublic';
    const encodedSlide = 'slide%2Fid%3F%23';

    await api.listWebinars();
    expect(serverApi.get).toHaveBeenLastCalledWith('/webinars');
    await api.getWebinar(webinarId);
    expect(serverApi.get).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}`);
    await api.createWebinar(body);
    expect(serverApi.post).toHaveBeenLastCalledWith('/webinars', body);
    await api.archiveWebinar(webinarId);
    expect(serverApi.delete).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}`);
    await api.saveMaster(webinarId, body);
    expect(serverApi.put).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/master`, body);
    await api.addSlide(webinarId, body);
    expect(serverApi.post).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/slides`, body);
    await api.saveSlide(webinarId, slideId, body);
    expect(serverApi.put).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/slides/${encodedSlide}`, body);
    await api.reorderSlides(webinarId, body);
    expect(serverApi.put).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/slides/order`, body);
    await api.archiveSlide(webinarId, slideId, body);
    expect(serverApi.delete).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/slides/${encodedSlide}`, body);
    await api.getHistory(webinarId);
    expect(serverApi.get).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/history`);
    await api.restoreRevision(webinarId, revisionId, body);
    expect(serverApi.post).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/history/revision%2Fid/restore`, body);
    await api.changeOwner(webinarId, body);
    expect(serverApi.put).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/owner`, body);
    await api.changeAudienceAccess(webinarId, body);
    expect(serverApi.put).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/audience-access`, body);
    await api.listNotes(webinarId);
    expect(serverApi.get).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/notes`);
    await api.addNote(webinarId, slideId, body);
    expect(serverApi.post).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/slides/${encodedSlide}/notes`, body);
    await api.updateNote(webinarId, noteId, body);
    expect(serverApi.put).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/notes/note%2Fid`, body);
    await api.deleteNote(webinarId, noteId);
    expect(serverApi.delete).toHaveBeenLastCalledWith(`/webinars/${encodedWebinar}/notes/note%2Fid`);
    await api.getSettings();
    expect(serverApi.get).toHaveBeenLastCalledWith('/webinar-presenter-settings/me');
    await api.saveSettings(body);
    expect(serverApi.put).toHaveBeenLastCalledWith('/webinar-presenter-settings/me', body);
    await api.listUsers();
    expect(serverApi.get).toHaveBeenLastCalledWith('/users/directory');
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('maps only fixed asset routes and allowlisted catalog query fields', async () => {
    const serverApi = {
      get: vi.fn().mockResolvedValue({}),
      post: vi.fn().mockResolvedValue({}),
      put: vi.fn().mockResolvedValue({}),
      patch: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const api = loadStudioApi(serverApi);
    const assetId = 'asset/id';
    const versionId = 'version/id?#';
    const body = { filename: 'front.webp' };

    await api.listAssets({
      search: 'front porch',
      mediaType: 'image/svg',
      status: 'available',
      arbitraryPath: '../../public',
    });
    expect(serverApi.get).toHaveBeenLastCalledWith('/webinar-assets?search=front+porch&mediaType=image%2Fsvg&status=available');
    await api.createUploadIntent(body);
    expect(serverApi.post).toHaveBeenLastCalledWith('/webinar-assets/upload-intents', body);
    await api.confirmUpload(versionId);
    expect(serverApi.post).toHaveBeenLastCalledWith('/webinar-assets/upload-intents/version%2Fid%3F%23/confirm', {});
    await api.createAssetVersionIntent(assetId, body);
    expect(serverApi.post).toHaveBeenLastCalledWith('/webinar-assets/asset%2Fid/versions', body);
    await api.updateAsset(assetId, body);
    expect(serverApi.patch).toHaveBeenLastCalledWith('/webinar-assets/asset%2Fid', body);
    await api.updateAssetVersion(assetId, versionId, body);
    expect(serverApi.patch).toHaveBeenLastCalledWith('/webinar-assets/asset%2Fid/versions/version%2Fid%3F%23', body);
    await api.getAssetUsage(versionId);
    expect(serverApi.get).toHaveBeenLastCalledWith('/webinar-assets/version%2Fid%3F%23/usage');
  });
});
