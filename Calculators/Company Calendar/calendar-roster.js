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

  function entryUserName(entry) {
    return entry.employee_name || entry.employeeName || entry.user_name || entry.userName || entry.name || `Employee ${entryUserId(entry) || ''}`.trim();
  }

  function entryTime(value) {
    return String(value || '').slice(0, 5);
  }

  function entryLabel(entry) {
    if (entry.is_private || entry.private) return entry.display_label || 'Busy';
    return entry.note || entry.display_label || (window.CalendarState.STATUS_META[entry.status] && window.CalendarState.STATUS_META[entry.status].label) || entry.status || 'Schedule';
  }

  function entryTimeLabel(entry) {
    const start = entryTime(entry.start_time || entry.startTime);
    const end = entryTime(entry.end_time || entry.endTime);
    if (!start && !end) return 'All day';
    if (start && end) return `${start}-${end}`;
    return start || end;
  }

  function isPrivateEntry(entry) {
    return Boolean(entry && (entry.private || entry.is_private));
  }

  function isManualEditableEntry(entry) {
    return Boolean(entry && entry.source === 'manual' && !isPrivateEntry(entry));
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

  function filteredPersonIds(state) {
    const ids = filteredPeople(state).map((person) => String(person.id));
    return new Set(ids);
  }

  function entryOverlapsDate(entry, iso) {
    const start = entryStartIso(entry);
    const end = entryEndIso(entry) || start;
    return Boolean(start && iso >= start && iso <= end);
  }

  function entryOverlapsRange(entry, range) {
    const start = entryStartIso(entry);
    const end = entryEndIso(entry) || start;
    return Boolean(start && range && start <= range.end_date && end >= range.start_date);
  }

  function visibleEntries(state) {
    const ids = filteredPersonIds(state);
    const range = window.CalendarState.visibleRange(state);
    return (state.entries || [])
      .filter((entry) => !state.hiddenStatuses.has(entry.status))
      .filter((entry) => ids.has(entryUserId(entry)))
      .filter((entry) => entryOverlapsRange(entry, range))
      .sort((a, b) => {
        return entryStartIso(a).localeCompare(entryStartIso(b)) ||
          (entryTime(a.start_time || a.startTime) || '99:99').localeCompare(entryTime(b.start_time || b.startTime) || '99:99') ||
          entryUserName(a).localeCompare(entryUserName(b));
      });
  }

  function entriesForDay(state, day) {
    const iso = window.CalendarState.isoDate(day);
    return visibleEntries(state).filter((entry) => entryOverlapsDate(entry, iso));
  }

  function entriesForPerson(state, personId) {
    return visibleEntries(state).filter((entry) => entryUserId(entry) === String(personId));
  }

  function isToday(state, day) {
    return window.CalendarState.isoDate(day) === window.CalendarState.isoDate(state.today || new Date());
  }

  function isSelectedDate(state, day) {
    return window.CalendarState.isoDate(day) === window.CalendarState.isoDate(state.selectedDate || state.today || new Date());
  }

  function isWeekend(day) {
    return day.getDay() === 0 || day.getDay() === 6;
  }

  function dayLabel(day) {
    return `${window.CalendarState.MONTHS[day.getMonth()]} ${day.getDate()}`;
  }

  function monthLabel(year, month) {
    return `${window.CalendarState.MONTHS[month]} ${year}`;
  }

  function daysForMonth(year, month) {
    const days = window.CalendarState.daysInMonth(year, month);
    return Array.from({ length: days }, (_, index) => new Date(year, month, index + 1));
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';
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

  function renderToolbar(state) {
    return `
      <div class="roster-toolbar">
        <input class="schedule-search" type="search" placeholder="Search people or roles" value="${escapeHtml(state.search || '')}" aria-label="Search people or roles">
        <div class="status-filters" aria-label="Status filters">
          ${renderStatusFilters(state)}
        </div>
      </div>
    `;
  }

  function renderEntryPill(entry, compact) {
    const time = entryTimeLabel(entry);
    return `
      <button class="entry-bar ${compact ? 'is-compact' : ''}" type="button" data-entry-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status || 'other')}" title="${escapeHtml(entryLabel(entry))}">
        ${compact ? '' : `<span class="entry-time">${escapeHtml(time)}</span>`}
        <span class="entry-name">${escapeHtml(entryLabel(entry))}</span>
        ${compact ? '' : `<span class="entry-person">${escapeHtml(entryUserName(entry))}</span>`}
      </button>
    `;
  }

  function renderDayTile(state, day, options = {}) {
    const classes = ['calendar-day'];
    if (isToday(state, day)) classes.push('is-today');
    if (isSelectedDate(state, day)) classes.push('is-selected');
    if (isWeekend(day)) classes.push('is-weekend');
    const entries = entriesForDay(state, day);
    const limit = options.compact ? 3 : 5;
    const shown = entries.slice(0, limit);
    const hiddenCount = Math.max(entries.length - shown.length, 0);

    return `
      <div class="${classes.join(' ')}" data-date="${window.CalendarState.isoDate(day)}" role="button" tabindex="0" aria-label="${escapeHtml(dayLabel(day))}">
        <div class="calendar-day-head">
          <span>${escapeHtml(window.CalendarState.DOW[day.getDay()])}</span>
          <strong>${day.getDate()}</strong>
        </div>
        <div class="calendar-day-entries">
          ${shown.map((entry) => renderEntryPill(entry, options.compact)).join('')}
          ${hiddenCount ? `<button class="day-more" type="button" data-date="${window.CalendarState.isoDate(day)}">+${hiddenCount} more</button>` : ''}
        </div>
      </div>
    `;
  }

  function renderWeekdays() {
    return window.CalendarState.DOW.map((day) => `<div class="weekday-label">${escapeHtml(day)}</div>`).join('');
  }

  function renderMonthBoard(state, year, month, options = {}) {
    const days = daysForMonth(year, month);
    const blanks = Array.from({ length: days[0].getDay() }, (_, index) => `<div class="calendar-day is-blank" aria-hidden="true" data-blank="${index}"></div>`).join('');
    const classes = ['calendar-month-board'];
    if (options.compact) classes.push('is-compact');

    return `
      <article class="${classes.join(' ')}">
        <div class="month-board-head">
          <h2>${escapeHtml(monthLabel(year, month))}</h2>
          <span>${entriesForMonth(state, year, month).length} entries</span>
        </div>
        <div class="calendar-weekdays">${renderWeekdays()}</div>
        <div class="calendar-month-grid">
          ${blanks}
          ${days.map((day) => renderDayTile(state, day, options)).join('')}
        </div>
      </article>
    `;
  }

  function entriesForMonth(state, year, month) {
    const start = window.CalendarState.isoDate(new Date(year, month, 1));
    const end = window.CalendarState.isoDate(new Date(year, month + 1, 0));
    return visibleEntries(state).filter((entry) => entryOverlapsRange(entry, { start_date: start, end_date: end }));
  }

  function renderMonthView(state) {
    return `
      <div class="month-overview">
        ${renderMonthBoard(state, state.viewDate.getFullYear(), state.viewDate.getMonth())}
      </div>
    `;
  }

  function renderTwoMonthsView(state) {
    const first = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), 1);
    const second = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    return `
      <div class="two-month-overview">
        ${renderMonthBoard(state, first.getFullYear(), first.getMonth(), { compact: true })}
        ${renderMonthBoard(state, second.getFullYear(), second.getMonth(), { compact: true })}
      </div>
    `;
  }

  function renderMiniMonth(state, year, month) {
    const days = daysForMonth(year, month);
    const blanks = Array.from({ length: days[0].getDay() }, (_, index) => `<span class="mini-day is-blank" aria-hidden="true" data-blank="${index}"></span>`).join('');
    return `
      <article class="year-month">
        <div class="year-month-head">
          <h2>${escapeHtml(window.CalendarState.MONTHS[month])}</h2>
          <span>${entriesForMonth(state, year, month).length}</span>
        </div>
        <div class="year-month-grid">
          ${window.CalendarState.DOW.map((day) => `<span class="mini-weekday">${escapeHtml(day.charAt(0))}</span>`).join('')}
          ${blanks}
          ${days.map((day) => {
            const entries = entriesForDay(state, day);
            const classes = ['mini-day'];
            if (entries.length) classes.push('has-entries');
            if (isToday(state, day)) classes.push('is-today');
            if (isSelectedDate(state, day)) classes.push('is-selected');
            return `<button class="${classes.join(' ')}" type="button" data-date="${window.CalendarState.isoDate(day)}" title="${escapeHtml(dayLabel(day))}: ${entries.length} entries">${day.getDate()}</button>`;
          }).join('')}
        </div>
      </article>
    `;
  }

  function renderYearView(state) {
    const year = state.viewDate.getFullYear();
    return `
      <div class="year-overview">
        ${Array.from({ length: 12 }, (_, month) => renderMiniMonth(state, year, month)).join('')}
      </div>
    `;
  }

  function renderPersonCard(state, person) {
    const entries = entriesForPerson(state, person.id);
    const shown = entries.slice(0, 8);
    return `
      <article class="person-card ${String(state.selectedUserId || '') === String(person.id) ? 'is-selected' : ''}" data-user-id="${escapeHtml(person.id)}" role="button" tabindex="0">
        <div class="person-card-head">
          <span class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</span>
          <span class="person-text">
            <span class="person-name">${escapeHtml(person.name)}</span>
            <span class="person-role">${escapeHtml(person.role || 'Team')}</span>
          </span>
          <strong>${entries.length}</strong>
        </div>
        <div class="person-entry-list">
          ${shown.length ? shown.map((entry) => `
            <button class="person-entry" type="button" data-entry-id="${escapeHtml(entry.id)}" data-date="${escapeHtml(entryStartIso(entry))}">
              <span class="detail-status" data-status="${escapeHtml(entry.status || 'other')}" aria-hidden="true"></span>
              <span>
                <strong>${escapeHtml(entryLabel(entry))}</strong>
                <small>${escapeHtml(entryStartIso(entry))} · ${escapeHtml(entryTimeLabel(entry))}</small>
              </span>
            </button>
          `).join('') : '<p class="empty-detail">No visible entries in this range.</p>'}
        </div>
      </article>
    `;
  }

  function renderPeopleView(state) {
    const people = filteredPeople(state);
    return `
      <div class="people-overview">
        ${people.length ? people.map((person) => renderPersonCard(state, person)).join('') : '<div class="empty-roster">No people match the current search and filters.</div>'}
      </div>
    `;
  }

  function renderBoard(state) {
    if (state.viewMode === 'two_months') return renderTwoMonthsView(state);
    if (state.viewMode === 'year') return renderYearView(state);
    if (state.viewMode === 'people') return renderPeopleView(state);
    return renderMonthView(state);
  }

  function render(state) {
    return `
      <section class="roster-card is-${escapeHtml(state.viewMode || 'month')}" aria-label="Availability roster">
        ${renderToolbar(state)}
        ${renderBoard(state)}
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

    function selectDate(date) {
      actions.setSelectedDate(window.CalendarState.parseDate(date));
    }

    function findEntry(entryId) {
      return (state.entries || []).find((entry) => String(entry.id) === String(entryId));
    }

    function activateEntry(entryId, date) {
      const entry = findEntry(entryId);
      const entryDate = date || (entry ? entryStartIso(entry) : '');
      if (entryDate) selectDate(entryDate);
      if (entry) selectPerson(entryUserId(entry));
      if (entry && isManualEditableEntry(entry) && actions.openEditor) actions.openEditor(entry);
    }

    const search = root.querySelector('.schedule-search');
    if (search) {
      search.addEventListener('input', (event) => actions.setSearch(event.target.value));
    }
    root.querySelectorAll('[data-status-filter]').forEach((button) => {
      button.addEventListener('click', () => actions.toggleStatus(button.dataset.statusFilter));
    });
    root.querySelectorAll('.person-card[data-user-id]').forEach((card) => {
      const activate = () => selectPerson(card.dataset.userId);
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (event) => activateOnKey(event, activate));
    });
    root.querySelectorAll('.calendar-day[data-date], .mini-day[data-date], .day-more[data-date]').forEach((target) => {
      const activate = () => selectDate(target.dataset.date);
      target.addEventListener('click', activate);
      target.addEventListener('keydown', (event) => activateOnKey(event, activate));
    });
    root.querySelectorAll('.entry-bar[data-entry-id], .person-entry[data-entry-id]').forEach((button) => {
      const activate = (event) => {
        event.stopPropagation();
        activateEntry(button.dataset.entryId, button.dataset.date);
      };
      button.addEventListener('click', activate);
    });
  }

  window.CalendarRoster = {
    render,
    bind,
  };
})();
