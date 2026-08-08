/**
 * /api/my-files client for the sync engine.
 *
 * Deliberately standalone (like the My Files popup's own client) rather than
 * routed through js/api.js, because the engine also runs inside the popup,
 * which does not load the SPA's API layer.
 */
(function (root) {
  'use strict';

  const API_BASE = root.location.protocol === 'https:'
    ? 'https://api.msfgco.com/api'
    : 'http://52.203.186.217:8080/api';

  function getAuthToken() {
    const stored = root.localStorage.getItem('auth_token');
    if (stored) return stored;
    const cookie = document.cookie.split('; ').find((c) => c.startsWith('auth_token='));
    if (cookie) return decodeURIComponent(cookie.split('=').slice(1).join('='));
    return root.sessionStorage.getItem('auth_token');
  }

  async function api(path, options = {}) {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/my-files${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /** Full remote tree keyed by path → {size, etag}. */
  async function snapshot() {
    const result = await api('/snapshot');
    const files = {};
    for (const file of result.files) {
      files[file.path] = { size: file.size, etag: file.etag };
    }
    return files;
  }

  /**
   * Upload via the existing 3-step presigned flow.
   *
   * The returned etag is null unless the bucket's CORS config lists ETag in
   * ExposeHeaders — a cross-origin response hides every other header. Callers
   * must fall back to hashing the file rather than storing null, or the next
   * sync cycle reads the missing etag as a remote change and re-downloads the
   * file it just uploaded.
   *
   * @returns {Promise<{etag: string|null, size: number}>}
   */
  async function upload(path, file) {
    const { url } = await api('/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        path,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      }),
    });

    const putResponse = await fetch(url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!putResponse.ok) {
      const error = new Error(`Upload failed (${putResponse.status})`);
      error.status = putResponse.status;
      throw error;
    }

    const confirmed = await api('/upload-complete', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    const etag = (putResponse.headers.get('ETag') || '').replace(/"/g, '') || null;
    return { etag, size: (confirmed && confirmed.size) || file.size };
  }

  /** Download a file's bytes. */
  async function download(path) {
    const { url } = await api(`/download-url?path=${encodeURIComponent(path)}`);
    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(`Download failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  /** Soft delete — the file lands in the dashboard trash, recoverable for 30 days. */
  function remove(path) {
    return api(`/?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }

  root.FileSyncRemote = {
    snapshot, upload, download, remove, api,
  };
}(typeof self !== 'undefined' ? self : this));
