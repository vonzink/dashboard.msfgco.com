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

  function isFalseValue(value) {
    return value === false || value === 0 || value === '0';
  }

  function isProtectedOutlookEntry(entry) {
    return Boolean(
      entry &&
      (entry.source_provider === 'outlook' || entry.source === 'outlook') &&
      (isFalseValue(entry.details_shareable) || (entry.provider_sensitivity && entry.provider_sensitivity !== 'normal'))
    );
  }

  function isEditableEntry(entry) {
    return Boolean(
      entry &&
      !isPrivateEntry(entry) &&
      !isProtectedOutlookEntry(entry) &&
      (entry.source === 'manual' || entry.source_provider === 'outlook' || entry.source === 'outlook')
    );
  }

  function filteredPeople(state) {
    const directory = (state.peopleDirectory || []).map((person) => ({
      id: person.id,
      name: person.name || person.email || `Employee ${person.id}`,
      role: person.role || person.team || '',
      nmls_number: person.nmls_number || '',
      email: person.email || person.display_email || '',
    }));
    const selectedUserId = String(state.selectedUserId || '');
    const people = directory.length ? directory : (state.people || []);
    if (!selectedUserId) return people;
    return people.filter((person) => String(person.id) === selectedUserId);
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

  function providerId(entry) {
    const provider = String(entry.source_provider || entry.source || '').toLowerCase();
    return ['outlook', 'google'].includes(provider) ? provider : '';
  }

  function calendarKey(entry) {
    const provider = providerId(entry);
    const userId = entryUserId(entry);
    return provider && userId ? `${provider}:${userId}` : '';
  }

  function entryMatchesCalendarFilter(state, entry) {
    const selected = state.selectedCalendarKeys || new Set();
    if (!selected.size) return true;
    const key = calendarKey(entry);
    return Boolean(key && selected.has(key));
  }

  function personForEntry(state, entry) {
    const id = entryUserId(entry);
    return (state.peopleDirectory || state.people || []).find((person) => String(person.id) === id) || null;
  }

  function keywordText(state, entry) {
    const person = personForEntry(state, entry) || {};
    const status = window.CalendarState.STATUS_META[entry.status] || {};
    return [
      entryLabel(entry),
      entry.note,
      entry.display_label,
      status.label,
      entry.status,
      entryUserName(entry),
      person.name,
      person.role,
      person.team,
      person.nmls_number,
      person.email,
      person.display_email,
      entry.source,
      entry.source_provider,
      entryStartIso(entry),
      entryEndIso(entry),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function entryMatchesKeyword(state, entry) {
    const query = String(state.search || '').trim().toLowerCase();
    if (!query) return true;
    return query.split(/\s+/).every((term) => keywordText(state, entry).includes(term));
  }

  function visibleEntries(state) {
    if (window.CalendarFilters && window.CalendarFilters.visibleEntries) {
      return window.CalendarFilters.visibleEntries(state);
    }
    const ids = filteredPersonIds(state);
    const range = window.CalendarState.visibleRange(state);
    return (state.entries || [])
      .filter((entry) => !state.hiddenStatuses.has(entry.status))
      .filter((entry) => ids.has(entryUserId(entry)))
      .filter((entry) => entryMatchesKeyword(state, entry))
      .filter((entry) => entryMatchesCalendarFilter(state, entry))
      .filter((entry) => entryOverlapsRange(entry, range))
      .sort((a, b) => {
        return entryStartIso(a).localeCompare(entryStartIso(b)) ||
          (entryTime(a.start_time || a.startTime) || '99:99').localeCompare(entryTime(b.start_time || b.startTime) || '99:99') ||
          entryUserName(a).localeCompare(entryUserName(b));
      });
  }

  function entriesForDay(state, day) {
    const iso = window.CalendarState.isoDate(day);
    if (window.CalendarFilters && window.CalendarFilters.entriesForDate) {
      return window.CalendarFilters.entriesForDate(state, iso);
    }
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

  function renderToolbar(state) {
    return `
      <div class="roster-toolbar">
        <input class="schedule-search" type="search" placeholder="Keyword search" value="${escapeHtml(state.search || '')}" aria-label="Keyword search">
        <select class="user-filter" data-user-filter aria-label="Filter by employee">
          ${renderUserFilterOptions(state)}
        </select>
      </div>
    `;
  }

  function personFilterLabel(person) {
    const nmls = person.nmls_number ? ` - NMLS ${person.nmls_number}` : '';
    return `${person.name || person.email || `Employee ${person.id}`}${nmls}`;
  }

  function renderUserFilterOptions(state) {
    const selectedUserId = String(state.selectedUserId || '');
    const people = (state.peopleDirectory && state.peopleDirectory.length ? state.peopleDirectory : state.people || [])
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    return `
      <option value="" ${selectedUserId ? '' : 'selected'}>All Employees</option>
      ${people.map((person) => `
        <option value="${escapeHtml(person.id)}" ${selectedUserId === String(person.id) ? 'selected' : ''}>
          ${escapeHtml(personFilterLabel(person))}
        </option>
      `).join('')}
    `;
  }

  function entryColor(entry) {
    return entry.event_color ||
      (window.CalendarState.STATUS_META[entry.status] && window.CalendarState.STATUS_META[entry.status].color) ||
      '#404041';
  }

  function visibilityClass(entry) {
    return entry.visibility === 'shared_details' ? 'is-shared-details' : 'is-hidden-details';
  }

  function visibilityLabel(entry, state) {
    if (window.CalendarFilters && window.CalendarFilters.entryPrivacyState) {
      return window.CalendarFilters.entryPrivacyState(entry, state && state.me).label;
    }
    return entry.visibility === 'shared_details' ? 'Shared with Team' : 'Hidden from Team';
  }

  function barStyle(entry) {
    return `--entry-color:${escapeHtml(entryColor(entry))};`;
  }

  function renderDensityIndicators(entries) {
    if (!entries.length) return '';
    const dots = entries.slice(0, 3).map((entry) => (
      `<i class="density-dot" style="--pip-color:${escapeHtml(entryColor(entry))}" aria-hidden="true"></i>`
    )).join('');
    const hasShared = entries.some((entry) => entry.visibility === 'shared_details' && !isPrivateEntry(entry));
    const hasHidden = entries.some((entry) => entry.visibility !== 'shared_details' || isPrivateEntry(entry));
    const privacy = hasShared && hasHidden ? '<span class="density-privacy" aria-label="Mixed shared and hidden entries"></span>' : '';
    return `
      <span class="day-density" title="${entries.length} visible entries">
        <span class="density-dots">${dots}</span>
        <b>${entries.length}</b>
        ${privacy}
      </span>
    `;
  }

  function renderEntryPill(entry, compact, state) {
    const time = entryTimeLabel(entry);
    const privacyLabel = visibilityLabel(entry, state);
    return `
      <button class="entry-bar ${compact ? 'is-compact' : ''} ${visibilityClass(entry)}" type="button" data-entry-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status || 'other')}" style="${barStyle(entry)}" title="${escapeHtml(entryLabel(entry))}">
        ${compact ? '' : `<span class="entry-time">${escapeHtml(time)}</span>`}
        <span class="entry-name">${escapeHtml(entryLabel(entry))}</span>
        ${compact ? '' : `<span class="entry-person">${escapeHtml(entryUserName(entry))}</span>`}
        ${compact ? '' : `<span class="entry-visibility">${escapeHtml(privacyLabel)}</span>`}
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
      <div class="${classes.join(' ')}" data-date="${window.CalendarState.isoDate(day)}" data-day-open="${window.CalendarState.isoDate(day)}" data-day-drilldown="true" role="button" tabindex="0" aria-label="${escapeHtml(dayLabel(day))}">
        <div class="calendar-day-head">
          <span>${escapeHtml(window.CalendarState.DOW[day.getDay()])}</span>
          <strong>${day.getDate()}</strong>
        </div>
        <div class="calendar-day-entries">
          ${shown.map((entry) => renderEntryPill(entry, options.compact, state)).join('')}
          ${hiddenCount ? renderDensityIndicators(entries) : ''}
          ${hiddenCount ? `<button class="day-more" type="button" data-date="${window.CalendarState.isoDate(day)}" data-day-open="${window.CalendarState.isoDate(day)}" data-day-drilldown="true">+${hiddenCount} more</button>` : ''}
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
            const density = entries.length ? renderDensityIndicators(entries) : '';
            return `<button class="${classes.join(' ')}" type="button" data-date="${window.CalendarState.isoDate(day)}" data-day-open="${window.CalendarState.isoDate(day)}" data-day-drilldown="true" title="${escapeHtml(dayLabel(day))}: ${entries.length} entries"><span>${day.getDate()}</span>${density}</button>`;
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
            <span class="person-role">${escapeHtml(person.role || 'Team')}${person.nmls_number ? ` · NMLS ${escapeHtml(person.nmls_number)}` : ''}</span>
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

  function renderDayView(state) {
    const day = state.selectedDate || state.viewDate || state.today || new Date();
    const entries = entriesForDay(state, day);
    const counts = {
      out: entries.filter((entry) => entry.status === 'out').length,
      remote: entries.filter((entry) => entry.status === 'remote').length,
      traveling: entries.filter((entry) => entry.status === 'traveling').length,
      meetings: entries.filter((entry) => entry.status === 'meeting_event' || entry.status === 'busy' || entry.status === 'bday').length,
    };
    return `
      <div class="day-overview">
        <aside class="day-rail">
          <span class="day-rail-weekday">${escapeHtml(window.CalendarState.DOW[day.getDay()])}</span>
          <strong>${day.getDate()}</strong>
          <span>${escapeHtml(window.CalendarState.MONTHS[day.getMonth()])} ${day.getFullYear()}</span>
          <button class="primary-btn" type="button" data-day-add="${window.CalendarState.isoDate(day)}">Add Schedule</button>
          <div class="day-rail-counts">
            <span><b>${counts.out}</b> Out</span>
            <span><b>${counts.remote}</b> Remote</span>
            <span><b>${counts.traveling}</b> Traveling</span>
            <span><b>${counts.meetings}</b> Events/Busy</span>
          </div>
        </aside>
        <section class="day-entry-panel">
          <div class="day-overview-head">
            <h2>${escapeHtml(dayLabel(day))}</h2>
            <div class="day-overview-actions">
              <span>${entries.length} visible entries</span>
            </div>
          </div>
          <div class="day-entry-list">
            ${entries.length ? entries.map((entry) => renderEntryPill(entry, false, state)).join('') : '<p class="empty-roster">No visible entries for this day.</p>'}
          </div>
        </section>
      </div>
    `;
  }

  function daysForWeek(state) {
    const start = window.CalendarState.startOfWeek(state.selectedDate || state.viewDate || state.today || new Date());
    return Array.from({ length: 7 }, (_, index) => window.CalendarState.addDays(start, index));
  }

  function dayIndexInRange(iso, days) {
    const dateIso = String(iso || '').slice(0, 10);
    return days.findIndex((day) => window.CalendarState.isoDate(day) === dateIso);
  }

  function renderWeekSpanningBar(entry, days) {
    const startIndex = Math.max(dayIndexInRange(entryStartIso(entry), days), 0);
    const rawEndIndex = dayIndexInRange(entryEndIso(entry), days);
    const endIndex = rawEndIndex < 0 ? days.length - 1 : rawEndIndex;
    return `
      <button class="entry-bar timeline-bar ${visibilityClass(entry)}" type="button" data-entry-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status || 'other')}" style="grid-column:${startIndex + 1} / ${endIndex + 2}; ${barStyle(entry)}" title="${escapeHtml(entryLabel(entry))}">
        <span class="entry-name">${escapeHtml(entryLabel(entry))}</span>
        <span class="entry-person">${escapeHtml(entryUserName(entry))}</span>
      </button>
    `;
  }

  function renderWeekView(state) {
    const days = daysForWeek(state);
    const entries = visibleEntries(state);
    return `
      <div class="week-overview">
        <div class="timeline-days" style="grid-template-columns:repeat(${days.length}, minmax(0, 1fr));">
          ${days.map((day) => `<button class="timeline-day-head" type="button" data-date="${window.CalendarState.isoDate(day)}" data-day-drilldown="true">${escapeHtml(window.CalendarState.DOW[day.getDay()])} ${day.getDate()}</button>`).join('')}
        </div>
        <div class="week-bars" style="grid-template-columns:repeat(${days.length}, minmax(0, 1fr));">
          ${entries.length ? entries.map((entry) => renderWeekSpanningBar(entry, days)).join('') : '<p class="empty-roster">No visible entries this week.</p>'}
        </div>
      </div>
    `;
  }

  function renderPersonTimelineRow(state, person, days) {
    const entries = entriesForPerson(state, person.id);
    return `
      <div class="person-cell person-timeline-row" data-user-id="${escapeHtml(person.id)}">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</span>
        <span class="person-text">
          <span class="person-name">${escapeHtml(person.name)}</span>
          <span class="person-role">${escapeHtml(person.role || (person.nmls_number ? `NMLS ${person.nmls_number}` : 'Team'))}</span>
        </span>
      </div>
      <div class="person-timeline-bars" style="grid-column:2 / span ${days.length}; grid-template-columns:repeat(${days.length}, var(--day-w));">
        ${entries.map((entry) => renderWeekSpanningBar(entry, days)).join('')}
      </div>
    `;
  }

  function renderAllView(state) {
    const range = window.CalendarState.visibleRange(state);
    const start = window.CalendarState.parseDate(range.start_date);
    const totalDays = Math.round((window.CalendarState.parseDate(range.end_date) - start) / 86400000) + 1;
    const days = Array.from({ length: totalDays }, (_, index) => window.CalendarState.addDays(start, index));
    const people = filteredPeople(state);

    return `
      <div class="all-overview">
        <div class="all-timeline-grid" style="--days:${days.length}">
          <div class="corner-cell">Employee</div>
          ${days.map((day) => `<button class="day-head ${isToday(state, day) ? 'is-today' : ''}" type="button" data-date="${window.CalendarState.isoDate(day)}" data-day-drilldown="true"><span class="day-dow">${escapeHtml(window.CalendarState.DOW[day.getDay()])}</span><span class="day-num">${day.getDate()}</span></button>`).join('')}
          ${people.length ? people.map((person) => renderPersonTimelineRow(state, person, days)).join('') : '<div class="empty-roster">No people match the current search and filters.</div>'}
        </div>
      </div>
    `;
  }

  function renderBoard(state) {
    if (state.viewMode === 'day') return renderDayView(state);
    if (state.viewMode === 'week') return renderWeekView(state);
    if (state.viewMode === 'two_months') return renderTwoMonthsView(state);
    if (state.viewMode === 'year') return renderYearView(state);
    if (state.viewMode === 'people') return renderPeopleView(state);
    if (state.viewMode === 'all') return renderAllView(state);
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

    function drillDownToDay(date) {
      selectDate(date);
      if (
        actions.openDayDrawer &&
        ['month', 'two_months', 'year'].includes(state.viewMode)
      ) {
        actions.openDayDrawer(date);
        return;
      }
      if (actions.setViewMode) {
        actions.setViewMode('day');
      }
    }

    function findEntry(entryId) {
      return (state.entries || []).find((entry) => String(entry.id) === String(entryId));
    }

    function activateEntry(entryId, date) {
      const entry = findEntry(entryId);
      const entryDate = date || (entry ? entryStartIso(entry) : '');
      if (entryDate) selectDate(entryDate);
      if (entry) selectPerson(entryUserId(entry));
      if (entry && isEditableEntry(entry) && actions.openEditor) actions.openEditor(entry);
    }

    const search = root.querySelector('.schedule-search');
    if (search) {
      search.addEventListener('input', (event) => actions.setSearch(event.target.value));
    }
    root.querySelectorAll('[data-user-filter]').forEach((select) => {
      select.addEventListener('change', () => actions.setSelectedUser(select.value || null));
    });
    root.querySelectorAll('.person-card[data-user-id]').forEach((card) => {
      const activate = () => selectPerson(card.dataset.userId);
      card.addEventListener('click', activate);
      card.addEventListener('keydown', (event) => activateOnKey(event, activate));
    });
    root.querySelectorAll('.calendar-day[data-date], .mini-day[data-date], .day-more[data-date]').forEach((target) => {
      const activate = (event) => {
        if (event && target.classList && target.classList.contains('day-more')) event.stopPropagation();
        drillDownToDay(target.dataset.date);
      };
      target.addEventListener('click', activate);
      target.addEventListener('keydown', (event) => activateOnKey(event, activate));
    });
    root.querySelectorAll('.roster-card [data-day-add]').forEach((button) => {
      button.addEventListener('click', () => {
        selectDate(button.dataset.dayAdd);
        if (actions.openEditor) actions.openEditor();
      });
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
