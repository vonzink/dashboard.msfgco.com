(function() {
  'use strict';

  function escapeHtml(value) {
    return window.CalendarRender.escapeHtml(value);
  }

  function entryStartIso(entry) {
    return window.CalendarFilters.entryStartIso(entry);
  }

  function entryTime(value) {
    return String(value || '').slice(0, 5);
  }

  function entryTimeLabel(entry) {
    const start = entryTime(entry.start_time || entry.startTime);
    const end = entryTime(entry.end_time || entry.endTime);
    if (!start && !end) return 'All day';
    if (start && end) return `${start}-${end}`;
    return start || end;
  }

  function entryTitle(entry) {
    return window.CalendarFilters.entryLabel(entry);
  }

  function personName(entry) {
    return window.CalendarFilters.entryUserName(entry);
  }

  function statusLabel(entry) {
    const meta = window.CalendarState.STATUS_META[entry.status] || {};
    return meta.label || entry.status || 'Schedule';
  }

  function privacyBadge(entry, state) {
    const privacy = window.CalendarFilters.entryPrivacyState(entry, state.me);
    return `<span class="panel-privacy is-${escapeHtml(privacy.key)}">${escapeHtml(privacy.label)}</span>`;
  }

  function providerBadge(entry) {
    const provider = window.CalendarFilters.providerId(entry);
    if (!provider) return '';
    const label = provider === 'google' ? 'Google' : 'Outlook';
    return `<span class="panel-provider">${escapeHtml(label)}</span>`;
  }

  function formatDate(value) {
    const date = window.CalendarState.parseDate(String(value).slice(0, 10));
    if (!date || Number.isNaN(date.getTime())) return String(value || '');
    return `${window.CalendarState.MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  function selectedBulkEntryIds(state) {
    return state.selectedBulkEntryIds || new Set();
  }

  function isEntryOwner(entry, state) {
    return String(window.CalendarFilters.entryUserId(entry)) === String(state.me?.id || state.me?.user_id || state.me?.userId || '');
  }

  function renderBulkControl(entry, state) {
    const eligible = window.CalendarFilters.isBulkShareEligible(entry, state.me);
    const provider = window.CalendarFilters.providerId(entry);
    const checked = selectedBulkEntryIds(state).has(entry.id) || selectedBulkEntryIds(state).has(String(entry.id));
    if (eligible) {
      return `
        <label class="bulk-select" title="Select for bulk sharing">
          <input type="checkbox" data-bulk-entry="${escapeHtml(entry.id)}" ${checked ? 'checked' : ''}>
          <span>Bulk</span>
        </label>
      `;
    }
    if (provider === 'outlook' && isEntryOwner(entry, state)) {
      return `
        <label class="bulk-select is-disabled" title="This event cannot be bulk shared">
          <input type="checkbox" data-bulk-entry-disabled="${escapeHtml(entry.id)}" disabled>
          <span>Locked</span>
        </label>
      `;
    }
    return '';
  }

  function renderBulkBar(state) {
    const count = selectedBulkEntryIds(state).size;
    if (!count) return '';
    return `
      <div class="bulk-action-bar" aria-label="Bulk sharing">
        <strong>Bulk sharing</strong>
        <span>${count} selected</span>
        <button class="nav-btn" type="button" data-bulk-visibility="shared_details">Share with team</button>
        <button class="nav-btn" type="button" data-bulk-visibility="availability_only">Hide from team</button>
        <button class="nav-btn" type="button" data-bulk-clear>Clear</button>
      </div>
    `;
  }

  function renderEntryRow(entry, state, options = {}) {
    const focused = String(state.drawerFocusEntryId || '') === String(entry.id || '');
    const resultAttr = options.searchResult ? `data-search-result="${escapeHtml(entry.id)}"` : '';
    return `
      <div class="panel-entry-row">
        ${renderBulkControl(entry, state)}
        <button class="panel-entry ${focused ? 'is-focused' : ''}" type="button" data-panel-entry="${escapeHtml(entry.id)}" data-date="${escapeHtml(entryStartIso(entry))}" ${resultAttr}>
          <span class="detail-status" data-status="${escapeHtml(entry.status || 'other')}" aria-hidden="true"></span>
          <span class="panel-entry-copy">
            <strong>${escapeHtml(entryTitle(entry))}</strong>
            <small>${escapeHtml(personName(entry))} - ${escapeHtml(entryTimeLabel(entry))} - ${escapeHtml(statusLabel(entry))}</small>
            <span class="panel-entry-badges">
              ${providerBadge(entry)}
              ${privacyBadge(entry, state)}
            </span>
          </span>
        </button>
      </div>
    `;
  }

  function renderDayDrawer(state) {
    if (!state.drawerDate) return '';
    const date = String(state.drawerDate).slice(0, 10);
    const entries = window.CalendarFilters.entriesForDate(state, date);

    return `
      <section class="schedule-day-drawer schedule-side-panel" aria-label="Day schedule drawer">
        <div class="panel-head">
          <div>
            <p class="detail-eyebrow">Day</p>
            <h2>${escapeHtml(formatDate(date))}</h2>
            <p>${entries.length} visible ${entries.length === 1 ? 'entry' : 'entries'}</p>
          </div>
          <button class="icon-btn" type="button" data-panel-close aria-label="Close day drawer">&times;</button>
        </div>
        <div class="panel-actions">
          <button class="primary-btn" type="button" data-day-add="${escapeHtml(date)}">Add Schedule</button>
        </div>
        ${renderBulkBar(state)}
        <div class="panel-entry-list">
          ${entries.length ? entries.map((entry) => renderEntryRow(entry, state)).join('') : '<p class="empty-detail">No visible entries for this day.</p>'}
        </div>
      </section>
    `;
  }

  function renderSearchPanel(state) {
    const query = String(state.search || '').trim();
    if (!query) return '';
    const results = window.CalendarFilters.searchResults(state);
    const countLabel = `${results.length} ${results.length === 1 ? 'result' : 'results'}`;

    return `
      <section class="schedule-search-panel schedule-side-panel" aria-label="Calendar search results">
        <div class="panel-head">
          <div>
            <p class="detail-eyebrow">Search</p>
            <h2>${escapeHtml(countLabel)}</h2>
            <p>${escapeHtml(query)}</p>
          </div>
        </div>
        <div class="panel-entry-list">
          ${renderBulkBar(state)}
          ${results.length ? results.map((entry) => renderEntryRow(entry, state, { searchResult: true })).join('') : '<p class="empty-detail">No entries match this search.</p>'}
        </div>
      </section>
    `;
  }

  function render(state) {
    const html = [
      renderSearchPanel(state),
      renderDayDrawer(state),
    ].filter(Boolean).join('');

    if (!html) return '';
    return `<aside class="schedule-side-panels">${html}</aside>`;
  }

  function bind(root, _state, actions) {
    root.querySelectorAll('[data-panel-close]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.closeSidePanel) actions.closeSidePanel();
      });
    });

    root.querySelectorAll('.schedule-side-panel [data-day-add]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.openDayDrawer) actions.openDayDrawer(button.dataset.dayAdd);
        if (actions.openEditor) actions.openEditor();
      });
    });

    root.querySelectorAll('[data-search-result]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.openDayDrawer) actions.openDayDrawer(button.dataset.date, button.dataset.searchResult);
      });
    });

    root.querySelectorAll('[data-panel-entry]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.searchResult) return;
        if (actions.focusEntryInDrawer) actions.focusEntryInDrawer(button.dataset.panelEntry);
      });
    });

    root.querySelectorAll('[data-bulk-entry]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (actions.toggleBulkEntry) actions.toggleBulkEntry(checkbox.dataset.bulkEntry, checkbox.checked);
      });
    });

    root.querySelectorAll('[data-bulk-visibility]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.bulkUpdateVisibility) actions.bulkUpdateVisibility(button.dataset.bulkVisibility);
      });
    });

    root.querySelectorAll('[data-bulk-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.clearBulkSelection) actions.clearBulkSelection();
      });
    });
  }

  window.CalendarPanels = {
    render,
    bind,
  };
})();
