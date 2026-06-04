(function() {
  'use strict';

  const MSFG_LOGO_URL = 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/MSFG+Home+Loans/MSFG-Color-Transparent.png';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function entryUserId(entry) {
    return entry.user_id || entry.userId || entry.employee_id || entry.employeeId || entry.owner_id || entry.ownerId || '';
  }

  function entryUserName(entry) {
    return entry.user_name || entry.userName || entry.employee_name || entry.employeeName || entry.name || entry.display_name || 'Unassigned';
  }

  function entryUserRole(entry) {
    return entry.user_role || entry.userRole || entry.employee_role || entry.employeeRole || entry.role || '';
  }

  function derivePeople(entries) {
    const byId = new Map();
    (entries || []).forEach((entry) => {
      const id = String(entryUserId(entry) || entryUserName(entry));
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        name: entryUserName(entry),
        role: entryUserRole(entry),
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function entryStartIso(entry) {
    return String(entry.start_date || entry.startDate || entry.date || '').slice(0, 10);
  }

  function entryEndIso(entry) {
    return String(entry.end_date || entry.endDate || entry.date || entry.start_date || entry.startDate || '').slice(0, 10);
  }

  function entryOverlapsDate(entry, iso) {
    const start = entryStartIso(entry);
    const end = entryEndIso(entry) || start;
    return Boolean(start && iso >= start && iso <= end);
  }

  function entriesForDay(entries, date) {
    const iso = window.CalendarState.isoDate(date);
    return (entries || []).filter((entry) => entryOverlapsDate(entry, iso));
  }

  function providerId(entry) {
    const provider = String(entry.source_provider || entry.source || '').toLowerCase();
    return ['outlook', 'google'].includes(provider) ? provider : '';
  }

  function providerLabel(provider) {
    if (provider === 'google') return 'Google';
    if (provider === 'outlook') return 'Outlook';
    return 'Calendar';
  }

  function calendarKey(entry) {
    const provider = providerId(entry);
    const userId = String(entryUserId(entry) || '');
    return provider && userId ? `${provider}:${userId}` : '';
  }

  function personForEntry(state, entry) {
    const id = String(entryUserId(entry) || '');
    return (state.peopleDirectory || state.people || []).find((person) => String(person.id) === id) || null;
  }

  function calendarOptions(state) {
    const byKey = new Map();
    (state.entries || []).forEach((entry) => {
      const key = calendarKey(entry);
      if (!key || byKey.has(key)) return;
      const provider = providerId(entry);
      const person = personForEntry(state, entry);
      const personName = person?.name || entryUserName(entry);
      byKey.set(key, {
        key,
        label: `${personName} ${providerLabel(provider)}`,
        provider,
        personName,
      });
    });
    return Array.from(byKey.values()).sort((a, b) => (
      a.personName.localeCompare(b.personName) || a.provider.localeCompare(b.provider)
    ));
  }

  function monthLabel(state) {
    if (state.viewMode === 'year') return `${state.viewDate.getFullYear()}`;
    if (state.viewMode === 'two_months') {
      const next = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
      return `${window.CalendarState.MONTHS[state.viewDate.getMonth()]} - ${window.CalendarState.MONTHS[next.getMonth()]} ${next.getFullYear()}`;
    }
    return `${window.CalendarState.MONTHS[state.viewDate.getMonth()]} ${state.viewDate.getFullYear()}`;
  }

  function viewModeLabel(mode) {
    if (mode === 'day') return 'Day';
    if (mode === 'week') return 'Week';
    if (mode === 'two_months') return '2 Months';
    if (mode === 'year') return 'Year';
    if (mode === 'people') return 'People';
    if (mode === 'all') return 'All';
    return 'Month';
  }

  function renderViewTabs(state) {
    const current = state.viewMode || 'month';
    return `
      <div class="view-tabs" aria-label="Calendar view">
        ${window.CalendarState.VIEW_MODES.map((mode) => `
          <button class="view-tab ${current === mode ? 'is-active' : ''}" type="button" data-view-mode="${escapeHtml(mode)}" aria-pressed="${current === mode ? 'true' : 'false'}">
            ${escapeHtml(viewModeLabel(mode))}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderStatusFilters(state) {
    const hiddenStatuses = state.hiddenStatuses || new Set();
    return Object.keys(window.CalendarState.STATUS_META).map((status) => {
      const meta = window.CalendarState.STATUS_META[status];
      const hidden = hiddenStatuses.has(status);
      return `
        <button class="filter-chip ${hidden ? 'is-muted' : 'is-active'}" type="button" data-status-filter="${escapeHtml(status)}" aria-pressed="${hidden ? 'false' : 'true'}">
          <span class="status-dot" style="--status-color:${escapeHtml(meta.color)}" aria-hidden="true"></span>
          ${escapeHtml(meta.label)}
        </button>
      `;
    }).join('');
  }

  function renderCalendarFilters(state) {
    const options = calendarOptions(state);
    if (!options.length) return '';
    const selected = state.selectedCalendarKeys || new Set();
    const allActive = selected.size === 0;
    return `
      <div class="calendar-filters" aria-label="Calendar filters">
        <button class="filter-chip calendar-filter-chip ${allActive ? 'is-active' : ''}" type="button" data-calendar-filter-all aria-pressed="${allActive ? 'true' : 'false'}">
          All Calendars
        </button>
        ${options.map((option) => {
          const active = selected.has(option.key);
          return `
            <button class="filter-chip calendar-filter-chip ${active ? 'is-active' : 'is-muted'}" type="button" data-calendar-filter="${escapeHtml(option.key)}" aria-pressed="${active ? 'true' : 'false'}">
              ${escapeHtml(option.label)}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderHeader(state) {
    return `
      <header class="schedule-topbar">
        <div class="brand-mark">
          <h1 class="brand-title">MSFG Company Schedule</h1>
          <p class="brand-subtitle">Availability board for ${escapeHtml(monthLabel(state))}</p>
        </div>
        <img class="schedule-logo" src="${MSFG_LOGO_URL}" alt="MSFG Home Loans" loading="eager">
      </header>
      <div class="schedule-toolbar" aria-label="Calendar controls">
        <div class="nav-group" aria-label="Month navigation">
          <button class="nav-btn icon-only" type="button" data-cal-action="prev" aria-label="Previous">&lt;</button>
          <button class="nav-btn" type="button" data-cal-action="today">Today</button>
          <div class="month-label" aria-live="polite">${escapeHtml(monthLabel(state))}</div>
          <button class="nav-btn icon-only" type="button" data-cal-action="next" aria-label="Next">&gt;</button>
        </div>
        ${renderViewTabs(state)}
        <div class="status-filters" aria-label="Status filters">
          ${renderStatusFilters(state)}
        </div>
        ${renderCalendarFilters(state)}
        <div class="schedule-controls">
          ${window.CalendarSync ? window.CalendarSync.renderTrigger(state) : ''}
          <button class="primary-btn" type="button" data-cal-action="add" data-action="new-entry">Add Schedule</button>
        </div>
      </div>
    `;
  }

  function renderSummary(state) {
    const todayEntries = entriesForDay(state.entries, state.today || new Date());
    const unavailableUsers = new Set(todayEntries.filter((entry) => entry.status !== 'remote').map((entry) => String(entryUserId(entry))));
    const remoteUsers = new Set(todayEntries.filter((entry) => entry.status === 'remote').map((entry) => String(entryUserId(entry))));
    const unavailableToday = unavailableUsers.size;
    const remoteToday = remoteUsers.size;
    const peopleCount = (state.people || []).length;
    const availableToday = Math.max(peopleCount - unavailableToday, 0);
    const todayIso = window.CalendarState.isoDate(state.today || new Date());
    const upcomingNotes = (state.entries || []).filter((entry) => entryStartIso(entry) >= todayIso).length;

    return `
      <section class="schedule-summary" aria-label="Schedule summary">
        <article class="summary-card">
          <p class="summary-label">Available Today</p>
          <p class="summary-number">${availableToday}</p>
          <p class="summary-note">of ${peopleCount} rostered</p>
        </article>
        <article class="summary-card">
          <p class="summary-label">Unavailable Today</p>
          <p class="summary-number">${unavailableToday}</p>
          <p class="summary-note">out, busy, traveling, or events</p>
        </article>
        <article class="summary-card">
          <p class="summary-label">Remote Today</p>
          <p class="summary-number">${remoteToday}</p>
          <p class="summary-note">working away from office</p>
        </article>
        <article class="summary-card">
          <p class="summary-label">Upcoming Notes</p>
          <p class="summary-number">${upcomingNotes}</p>
          <p class="summary-note">entries from today forward</p>
        </article>
      </section>
    `;
  }

  function bindShellActions(root, state, actions) {
    const prev = root.querySelector('[data-cal-action="prev"]');
    const next = root.querySelector('[data-cal-action="next"]');
    const today = root.querySelector('[data-cal-action="today"]');
    const add = root.querySelector('[data-cal-action="add"], [data-action="new-entry"]');
    const step = state.viewMode === 'year' ? 12 : (state.viewMode === 'two_months' ? 2 : 1);

    function shiftDate(days) {
      const base = state.selectedDate || state.viewDate || new Date();
      const nextDate = window.CalendarState.addDays(base, days);
      actions.setSelectedDate(nextDate);
      actions.setViewDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    }

    if (prev) {
      prev.addEventListener('click', () => {
        if (state.viewMode === 'day') {
          shiftDate(-1);
          return;
        }
        if (state.viewMode === 'week') {
          shiftDate(-7);
          return;
        }
        actions.setViewDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - step, 1));
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        if (state.viewMode === 'day') {
          shiftDate(1);
          return;
        }
        if (state.viewMode === 'week') {
          shiftDate(7);
          return;
        }
        actions.setViewDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + step, 1));
      });
    }
    if (today) {
      today.addEventListener('click', () => {
        const now = new Date();
        actions.setSelectedDate(now);
        actions.setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
      });
    }
    if (add) {
      add.addEventListener('click', () => {
        if (actions.openEditor) actions.openEditor();
      });
    }
    root.querySelectorAll('[data-view-mode]').forEach((button) => {
      button.addEventListener('click', () => actions.setViewMode(button.dataset.viewMode));
    });
    root.querySelectorAll('[data-status-filter]').forEach((button) => {
      button.addEventListener('click', () => actions.toggleStatus(button.dataset.statusFilter));
    });
    root.querySelectorAll('[data-calendar-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.toggleCalendarFilter) actions.toggleCalendarFilter(button.dataset.calendarFilter);
      });
    });
    root.querySelectorAll('[data-calendar-filter-all]').forEach((button) => {
      button.addEventListener('click', () => {
        if (actions.clearCalendarFilters) actions.clearCalendarFilters();
      });
    });
  }

  function render(root, state, actions) {
    if (!root) return;
    if (state.loading) {
      root.innerHTML = '<section class="schedule-loading" aria-label="Loading schedule">Loading schedule...</section>';
      return;
    }
    if (state.error) {
      root.innerHTML = `<section class="schedule-error" role="alert">${escapeHtml(state.error)}</section>`;
      return;
    }

    root.innerHTML = `
      ${renderHeader(state, actions)}
      ${renderSummary(state)}
      ${window.CalendarRoster ? window.CalendarRoster.render(state) : ''}
      ${window.CalendarDetail ? window.CalendarDetail.render(state) : ''}
      ${window.CalendarEditor ? window.CalendarEditor.render(state) : ''}
      ${window.CalendarSync ? window.CalendarSync.render(state) : ''}
    `;

    bindShellActions(root, state, actions);
    if (window.CalendarRoster) window.CalendarRoster.bind(root, state, actions);
    if (window.CalendarDetail && window.CalendarDetail.bind) window.CalendarDetail.bind(root, state, actions);
    if (window.CalendarEditor && window.CalendarEditor.bind) window.CalendarEditor.bind(root, state, actions);
    if (window.CalendarSync && window.CalendarSync.bind) window.CalendarSync.bind(root, state, actions);
  }

  window.CalendarRender = {
    escapeHtml,
    derivePeople,
    entriesForDay,
    renderHeader,
    renderViewTabs,
    render,
  };
})();
