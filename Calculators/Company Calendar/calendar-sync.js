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
    const parts = [statusLabel(connection)];
    if (connection?.provider_account_email) parts.push(connection.provider_account_email);
    if (connection?.last_sync_at) parts.push(`Last sync ${String(connection.last_sync_at).slice(0, 10)}`);
    return parts.join(' - ');
  }

  function isConnected(connection) {
    return Boolean(connection && connection.sync_enabled && connection.sync_status !== 'not_connected');
  }

  function renderProvider(state, provider) {
    const connection = providerStatus(state, provider.id);
    const connected = isConnected(connection);
    const syncing = connection?.sync_status === 'syncing';
    const error = connection?.sync_status === 'error' ? connection.sync_error : '';

    return `
      <div class="sync-provider ${error ? 'is-error' : ''}">
        <div class="sync-provider-copy">
          <strong>${escapeHtml(provider.label)}</strong>
          <small>${escapeHtml(providerMeta(connection))}</small>
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

  function render(state) {
    return `
      <section class="sync-panel" aria-label="Optional calendar sync">
        <div class="sync-head">
          <div>
            <p class="detail-eyebrow">Optional Sync</p>
            <h2>Calendar Connections</h2>
          </div>
        </div>
        <div class="sync-list">
          ${providers().map((provider) => renderProvider(state, provider)).join('')}
        </div>
      </section>
    `;
  }

  function bind(root, _state, actions) {
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
    render,
    bind,
  };
})();
