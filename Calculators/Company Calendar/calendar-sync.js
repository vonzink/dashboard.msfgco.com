(function() {
  'use strict';

  const PROVIDERS = [
    { id: 'outlook', label: 'Outlook' },
    { id: 'google', label: 'Google' },
  ];

  function escapeHtml(value) {
    return window.CalendarRender.escapeHtml(value);
  }

  function providerStatus(state, provider) {
    return (state.syncConnections || []).find((connection) => connection.provider === provider) || null;
  }

  function statusText(connection) {
    if (!connection) return 'Not connected';
    return String(connection.sync_status || 'not_connected').replace(/_/g, ' ');
  }

  function enabledText(connection) {
    if (!connection) return 'Optional';
    return connection.sync_enabled ? 'Enabled' : 'Paused';
  }

  function lastSyncText(connection) {
    if (!connection || !connection.last_sync_at) return '';
    return `Last sync ${String(connection.last_sync_at).slice(0, 10)}`;
  }

  function renderProvider(state, provider) {
    const connection = providerStatus(state, provider.id);
    const meta = [statusText(connection), enabledText(connection), lastSyncText(connection)]
      .filter(Boolean)
      .join(' - ');

    return `
      <div class="sync-provider">
        <div>
          <strong>${escapeHtml(provider.label)}</strong>
          <small>${escapeHtml(meta)}</small>
        </div>
        <button class="nav-btn" type="button" data-sync-provider="${escapeHtml(provider.id)}">
          ${connection ? 'Manage' : 'Connect'}
        </button>
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
          ${PROVIDERS.map((provider) => renderProvider(state, provider)).join('')}
        </div>
      </section>
    `;
  }

  function bind(root, state, actions) {
    root.querySelectorAll('[data-sync-provider]').forEach((button) => {
      button.addEventListener('click', () => {
        const provider = button.dataset.syncProvider || 'calendar';
        actions.showToast(`${provider} connection setup will open here.`, 'info');
      });
    });
  }

  window.CalendarSync = {
    render,
    bind,
  };
})();
