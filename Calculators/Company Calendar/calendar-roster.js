(function() {
  'use strict';

  function escapeHtml(value) {
    return window.CalendarRender.escapeHtml(value);
  }

  function entryStartIso(entry) {
    return String(entry.start_date || entry.startDate || entry.date || '').slice(0, 10);
  }

  function entryEndIso(entry) {
    return String(entry.end_date || entry.endDate || entry.date || entry.start_date || entry.startDate || '').slice(0, 10);
  }

  function entryUserId(entry) {
    return String(entry.user_id || entry.userId || entry.employee_id || entry.employeeId || entry.owner_id || entry.ownerId || entry.user_name || entry.userName || '');
  }

  function entryLabel(entry) {
    if (entry.is_private || entry.private) {
      return entry.display_label || 'Busy';
    }
    return entry.note || entry.display_label || (window.CalendarState.STATUS_META[entry.status] && window.CalendarState.STATUS_META[entry.status].label) || entry.status || 'Schedule';
  }

  function filteredPeople(state) {
    const query = String(state.search || '').trim().toLowerCase();
    const people = state.people || [];
    if (!query) return people;
    return people.filter((person) => {
      return String(person.name || '').toLowerCase().includes(query) ||
        String(person.role || '').toLowerCase().includes(query);
    });
  }

  function entriesForPersonDay(state, personId, day) {
    const iso = window.CalendarState.isoDate(day);
    return (state.entries || []).filter((entry) => {
      const start = entryStartIso(entry);
      const end = entryEndIso(entry) || start;
      return entryUserId(entry) === String(personId) &&
        start && iso >= start && iso <= end &&
        !state.hiddenStatuses.has(entry.status);
    });
  }

  function daysForView(state) {
    const year = state.viewDate.getFullYear();
    const month = state.viewDate.getMonth();
    const days = window.CalendarState.daysInMonth(year, month);
    return Array.from({ length: days }, (_, index) => new Date(year, month, index + 1));
  }

  function isToday(state, day) {
    return window.CalendarState.isoDate(day) === window.CalendarState.isoDate(state.today || new Date());
  }

  function isWeekend(day) {
    return day.getDay() === 0 || day.getDay() === 6;
  }

  function renderDayHeader(state, day) {
    const classes = ['roster-cell', 'day-head'];
    if (isToday(state, day)) classes.push('is-today');
    if (isWeekend(day)) classes.push('is-weekend');
    return `
      <div class="${classes.join(' ')}" role="columnheader">
        <span class="day-dow">${window.CalendarState.DOW[day.getDay()]}</span>
        <span class="day-num">${day.getDate()}</span>
      </div>
    `;
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';
  }

  function renderPersonRow(state, person) {
    const personClasses = ['roster-cell', 'person-cell'];
    if (String(state.selectedUserId || '') === String(person.id)) personClasses.push('is-selected');
    const days = daysForView(state);
    const dayCells = days.map((day) => {
      const classes = ['roster-cell', 'day-cell'];
      if (isToday(state, day)) classes.push('is-today');
      if (isWeekend(day)) classes.push('is-weekend');
      const entries = entriesForPersonDay(state, person.id, day);
      const bars = entries.map((entry) => `
        <button class="entry-bar" type="button" data-entry-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status || 'other')}" title="${escapeHtml(entryLabel(entry))}">
          ${escapeHtml(entryLabel(entry))}
        </button>
      `).join('');
      return `<div class="${classes.join(' ')}" role="button" tabindex="0" data-date="${window.CalendarState.isoDate(day)}" data-user-id="${escapeHtml(person.id)}">${bars}</div>`;
    }).join('');

    return `
      <div class="${personClasses.join(' ')}" data-user-id="${escapeHtml(person.id)}" role="button" tabindex="0">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</span>
        <span class="person-text">
          <span class="person-name">${escapeHtml(person.name)}</span>
          <span class="person-role">${escapeHtml(person.role || 'Team')}</span>
        </span>
      </div>
      ${dayCells}
    `;
  }

  function renderStatusFilters(state) {
    return Object.keys(window.CalendarState.STATUS_META).map((status) => {
      const meta = window.CalendarState.STATUS_META[status];
      const hidden = state.hiddenStatuses.has(status);
      return `
        <button class="filter-chip ${hidden ? 'is-muted' : 'is-active'}" type="button" data-status-filter="${escapeHtml(status)}" aria-pressed="${hidden ? 'false' : 'true'}">
          ${escapeHtml(meta.label)}
        </button>
      `;
    }).join('');
  }

  function render(state) {
    const days = daysForView(state);
    const people = filteredPeople(state);
    const rows = people.map((person) => renderPersonRow(state, person)).join('');
    return `
      <section class="roster-card" aria-label="Availability roster">
        <div class="roster-toolbar">
          <input class="schedule-search" type="search" placeholder="Search people or roles" value="${escapeHtml(state.search || '')}" aria-label="Search people or roles">
          <div class="status-filters" aria-label="Status filters">
            ${renderStatusFilters(state)}
          </div>
        </div>
        <div class="roster-scroll">
          ${people.length ? `
            <div class="roster-grid" style="--days:${days.length}" role="grid">
              <div class="roster-cell corner-cell" role="columnheader">Team</div>
              ${days.map((day) => renderDayHeader(state, day)).join('')}
              ${rows}
            </div>
          ` : '<div class="empty-roster">No people match the current search and filters.</div>'}
        </div>
      </section>
    `;
  }

  function bind(root, state, actions) {
    function isActivationKey(event) {
      return event.key === 'Enter' || event.key === ' ';
    }

    function activateOnKey(event, handler) {
      if (!isActivationKey(event)) return;
      event.preventDefault();
      handler(event);
    }

    function selectPerson(userId) {
      actions.setSelectedUser(userId);
    }

    function selectPersonDay(userId, date) {
      actions.setSelectedDate(window.CalendarState.parseDate(date));
      actions.setSelectedUser(userId);
    }

    function findEntry(entryId) {
      return (state.entries || []).find((entry) => String(entry.id) === String(entryId));
    }

    function activateEntry(entryId, userId, date) {
      const entry = findEntry(entryId);
      const entryUser = entry ? entryUserId(entry) : userId;
      const entryDate = date || (entry ? entryStartIso(entry) : '');
      if (entryDate) actions.setSelectedDate(window.CalendarState.parseDate(entryDate));
      if (entryUser) actions.setSelectedUser(entryUser);
      if (actions.openEditor) actions.openEditor(entry || entryId);
    }

    const search = root.querySelector('.schedule-search');
    if (search) {
      search.addEventListener('input', (event) => actions.setSearch(event.target.value));
    }
    root.querySelectorAll('[data-status-filter]').forEach((button) => {
      button.addEventListener('click', () => actions.toggleStatus(button.dataset.statusFilter));
    });
    root.querySelectorAll('.person-cell[data-user-id]').forEach((cell) => {
      const activate = () => selectPerson(cell.dataset.userId);
      cell.addEventListener('click', activate);
      cell.addEventListener('keydown', (event) => activateOnKey(event, activate));
    });
    root.querySelectorAll('.day-cell[data-date][data-user-id]').forEach((cell) => {
      const activate = () => selectPersonDay(cell.dataset.userId, cell.dataset.date);
      cell.addEventListener('click', (event) => {
        if (event.target.closest('.entry-bar')) return;
        activate();
      });
      cell.addEventListener('keydown', (event) => {
        if (event.target.closest('.entry-bar')) return;
        activateOnKey(event, activate);
      });
    });
    root.querySelectorAll('.entry-bar[data-entry-id]').forEach((button) => {
      const cell = button.closest('.day-cell[data-date][data-user-id]');
      const activate = () => activateEntry(button.dataset.entryId, cell && cell.dataset.userId, cell && cell.dataset.date);
      button.addEventListener('click', activate);
    });
  }

  window.CalendarRoster = {
    render,
    bind,
  };
})();
