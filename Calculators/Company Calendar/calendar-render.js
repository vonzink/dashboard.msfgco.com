(function() {
  'use strict';

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

  function monthLabel(state) {
    return `${window.CalendarState.MONTHS[state.viewDate.getMonth()]} ${state.viewDate.getFullYear()}`;
  }

  function renderHeader(state) {
    return `
      <header class="schedule-header">
        <div class="brand-mark">
          <div>
            <h1 class="brand-title">MSFG Company Schedule</h1>
            <p class="brand-subtitle">Availability board for ${escapeHtml(monthLabel(state))}</p>
          </div>
        </div>
        <div class="nav-group" aria-label="Month navigation">
          <button class="nav-btn" type="button" data-cal-action="prev" aria-label="Previous month">&lt;</button>
          <div class="month-label" aria-live="polite">${escapeHtml(monthLabel(state))}</div>
          <button class="nav-btn" type="button" data-cal-action="next" aria-label="Next month">&gt;</button>
          <button class="nav-btn" type="button" data-cal-action="today">Today</button>
        </div>
        <div class="schedule-controls">
          <button class="primary-btn" type="button" data-cal-action="add">Add Schedule</button>
        </div>
      </header>
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
    const add = root.querySelector('[data-cal-action="add"]');

    if (prev) {
      prev.addEventListener('click', () => {
        actions.setViewDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1));
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        actions.setViewDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1));
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
    render,
  };
})();
