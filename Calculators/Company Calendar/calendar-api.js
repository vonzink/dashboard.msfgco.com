(function() {
  'use strict';

  const API_BASE = window.location.protocol === 'https:'
    ? 'https://api.msfgco.com/api'
    : 'http://52.203.186.217:8080/api';

  function getAuthToken() {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
    return (
      localStorage.getItem('auth_token') ||
      (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null) ||
      sessionStorage.getItem('auth_token')
    );
  }

  async function request(path, opts = {}) {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (res.status === 401) throw new Error('Session expired. Please log in again.');
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'You do not have permission to perform this action.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    return res.status === 204 ? null : res.json();
  }

  function toQuery(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') qs.set(key, value);
    });
    return qs.toString() ? `?${qs.toString()}` : '';
  }

  window.CalendarApi = {
    getMe: () => request('/me'),
    getUserDirectory: () => request('/users/directory'),
    getEntries: (params) => request(`/schedule/entries${toQuery(params)}`),
    createEntry: (payload) => request('/schedule/entries', { method: 'POST', body: JSON.stringify(payload) }),
    updateEntry: (id, payload) => request(`/schedule/entries/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    updateEntryVisibility: (id, visibility, viewers) => request(`/schedule/entries/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({
        visibility,
        ...(Array.isArray(viewers) ? { viewers } : {}),
      }),
    }),
    updateEntryVisibilityBulk: (entryIds, visibility, viewers) => request('/schedule/entries/visibility/bulk', {
      method: 'PATCH',
      body: JSON.stringify({
        entry_ids: entryIds,
        visibility,
        viewers: Array.isArray(viewers) ? viewers : [],
      }),
    }),
    deleteEntry: (id) => request(`/schedule/entries/${id}`, { method: 'DELETE' }),
    getSyncStatus: () => request('/schedule/sync/status'),
    startSyncConnection: (provider, payload) => request(`/schedule/sync/connections/${encodeURIComponent(provider)}/start`, {
      method: 'POST',
      body: JSON.stringify({ provider, ...(payload || {}) }),
    }),
    runSync: (provider) => request('/schedule/sync/run', {
      method: 'POST',
      body: JSON.stringify(provider ? { provider } : {}),
    }),
    disconnectSyncConnection: (provider) => request(`/schedule/sync/connections/${encodeURIComponent(provider)}/disconnect`, {
      method: 'POST',
    }),
    getAdminSyncStatus: (params) => request(`/schedule/sync/admin/status${toQuery(params)}`),
  };
})();
