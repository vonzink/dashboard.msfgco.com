(function() {
  'use strict';

  const BASE_PROVIDERS = [
    { id: 'outlook', label: 'Outlook' },
  ];

  function providers() {
    if (window.MSFG_CALENDAR_ENABLE_GOOGLE_SYNC === true) {
      return [...BASE_PROVIDERS, { id: 'google', label: 'Google' }];
    }
    return BASE_PROVIDERS;
  }

  function escapeHtml(value) {
    return window.CalendarRender.escapeHtml(value);
  }

  function providerStatus(state, provider) {
    return (state.syncConnections || []).find((connection) => connection.provider === provider) || null;
  }

  function statusLabel(connection) {
    if (!connection || connection.sync_status === 'not_connected') return 'Not connected';
    if (!connection.sync_enabled) return 'Paused';
    if (connection.sync_status === 'connected') return 'Connected';
    if (connection.sync_status === 'syncing') return 'Syncing';
    if (connection.sync_status === 'error') return 'Error';
    return 'Not connected';
  }

  function providerMeta(connection) {
    const parts = [];
    if (connection?.provider_account_email) parts.push(`Account: ${connection.provider_account_email}`);
    if (connection?.last_sync_at) parts.push(`Last sync: ${String(connection.last_sync_at).slice(0, 10)}`);
    return parts.join(' · ') || 'Connect to import and manage your company calendar availability.';
  }

  function statusClass(connection) {
    if (!connection || connection.sync_status === 'not_connected') return 'not-connected';
    if (!connection.sync_enabled) return 'paused';
    if (connection.sync_status === 'syncing') return 'syncing';
    if (connection.sync_status === 'error') return 'error';
    return 'connected';
  }

  function isConnected(connection) {
    return Boolean(connection && connection.sync_enabled && connection.sync_status !== 'not_connected');
  }

  function isAdminUser(state) {
    const role = String(state.me?.role || state.me?.user_role || '').toLowerCase();
    const groups = Array.isArray(state.me?.groups) ? state.me.groups.map((group) => String(group).toLowerCase()) : [];
    return role === 'admin' || role === 'manager' || groups.includes('admin') || groups.includes('manager');
  }

  function renderProvider(state, provider) {
    const connection = providerStatus(state, provider.id);
    const connected = isConnected(connection);
    const syncing = connection?.sync_status === 'syncing';
    const error = connection?.sync_status === 'error' ? connection.sync_error : '';

    return `
      <div class="sync-provider ${error ? 'is-error' : ''}">
        <div class="sync-provider-icon" aria-hidden="true">${escapeHtml(provider.label.charAt(0))}</div>
        <div class="sync-provider-copy">
          <span class="sync-provider-title">
            <strong>${escapeHtml(provider.label)}</strong>
            <span class="sync-status-pill is-${escapeHtml(statusClass(connection))}">${escapeHtml(statusLabel(connection))}</span>
          </span>
          <small>${escapeHtml(providerMeta(connection))}</small>
          <span class="sync-provider-note">Synced items import as Hidden from Team by default. Private calendar events never expose details.</span>
          ${error ? `<span class="sync-error">${escapeHtml(error)}</span>` : ''}
        </div>
        <div class="sync-provider-actions">
          <button class="nav-btn" type="button" data-sync-connect="${escapeHtml(provider.id)}">
            ${connected ? 'Reconnect' : 'Connect'}
          </button>
          <button class="nav-btn" type="button" data-sync-run="${escapeHtml(provider.id)}" ${connected && !syncing ? '' : 'disabled'}>
            Sync now
          </button>
          <button class="danger-btn" type="button" data-sync-disconnect="${escapeHtml(provider.id)}" ${connection ? '' : 'disabled'}>
            Disconnect
          </button>
        </div>
      </div>
    `;
  }

  function renderTrigger(state) {
    const connectedCount = (state.syncConnections || []).filter(isConnected).length;
    const label = connectedCount
      ? `Calendar connection settings, ${connectedCount} connected`
      : 'Calendar connection settings';

    return `
      <button
        class="icon-btn sync-settings-trigger"
        type="button"
        data-sync-settings-toggle
        aria-label="${escapeHtml(label)}"
        aria-expanded="${state.syncSettingsOpen ? 'true' : 'false'}"
        title="Calendar connection settings"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a10 10 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"></path>
        </svg>
      </button>
    `;
  }

  function renderAdminOverviewRow(connection) {
    const provider = connection.provider === 'google' ? 'Google' : 'Outlook';
    const lastSync = connection.last_sync_at ? String(connection.last_sync_at).slice(0, 10) : 'Never';
    const status = connection.sync_status || 'not_connected';
    return `
      <div class="admin-sync-row">
        <div class="admin-sync-person">
          <strong>${escapeHtml(connection.name || connection.email || 'Employee')}</strong>
          <small>${escapeHtml(connection.email || connection.provider_account_email || '')}</small>
        </div>
        <div class="admin-sync-meta">
          <span>${escapeHtml(provider)}</span>
          <span>${escapeHtml(status)}</span>
          <span>Last synced ${escapeHtml(lastSync)}</span>
        </div>
        <div class="admin-sync-counts">
          <span><b>${Number(connection.shared_event_count) || 0}</b> shared</span>
          <span><b>${Number(connection.hidden_event_count) || 0}</b> hidden synced</span>
          <span><b>${Number(connection.protected_event_count) || 0}</b> private</span>
          <span><b>${Number(connection.total_synced_event_count) || 0}</b> total</span>
        </div>
        ${connection.sync_error ? `<span class="sync-error">${escapeHtml(connection.sync_error)}</span>` : ''}
      </div>
    `;
  }

  function renderAdminOverview(state) {
    if (!isAdminUser(state)) return '';
    const rows = state.adminSyncOverview || [];
    return `
      <section class="admin-sync-overview" aria-label="Admin sync overview">
        <div class="admin-sync-head">
          <div>
            <p class="detail-eyebrow">Admin</p>
            <h3>Admin Sync Overview</h3>
          </div>
          ${state.adminSyncLoading ? '<span class="sync-status-pill is-syncing">Loading</span>' : ''}
        </div>
        ${state.adminSyncError ? `<p class="sync-error">${escapeHtml(state.adminSyncError)}</p>` : ''}
        <div class="admin-sync-list">
          ${rows.length ? rows.map(renderAdminOverviewRow).join('') : '<p class="empty-detail">No synced company calendars in this range.</p>'}
        </div>
      </section>
    `;
  }

  function render(state) {
    if (!state.syncSettingsOpen) return '';

    return `
      <div class="sync-settings-backdrop" data-sync-settings-backdrop>
        <section class="sync-panel" role="dialog" aria-modal="true" aria-labelledby="syncSettingsTitle">
          <div class="sync-head">
            <div>
              <p class="detail-eyebrow">Optional Sync</p>
              <h2 id="syncSettingsTitle">Calendar Connections</h2>
            </div>
            <button class="icon-btn" type="button" data-sync-settings-close aria-label="Close calendar connection settings">&times;</button>
          </div>
          <div class="sync-list">
            ${providers().map((provider) => renderProvider(state, provider)).join('')}
          </div>
          ${renderAdminOverview(state)}
        </section>
      </div>
    `;
  }

  function bind(root, _state, actions) {
    root.querySelectorAll('[data-sync-settings-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.openSyncSettings) actions.openSyncSettings();
      });
    });

    root.querySelectorAll('[data-sync-settings-close]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.closeSyncSettings) actions.closeSyncSettings();
      });
    });

    root.querySelectorAll('[data-sync-settings-backdrop]').forEach((backdrop) => {
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop && actions.closeSyncSettings) actions.closeSyncSettings();
      });
    });

    root.querySelectorAll('[data-sync-connect]').forEach((button) => {
      button.addEventListener('click', () => {
        actions.connectSyncProvider(button.dataset.syncConnect);
      });
    });

    root.querySelectorAll('[data-sync-run]').forEach((button) => {
      button.addEventListener('click', () => {
        actions.runSyncProvider(button.dataset.syncRun);
      });
    });

    root.querySelectorAll('[data-sync-disconnect]').forEach((button) => {
      button.addEventListener('click', () => {
        actions.disconnectSyncProvider(button.dataset.syncDisconnect);
      });
    });
  }

  window.CalendarSync = {
    renderTrigger,
    render,
    bind,
  };
})();
