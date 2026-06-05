(function() {
  'use strict';

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
    const meta = window.CalendarState.STATUS_META[entry.status] || {};
    return entry.note || entry.display_label || meta.label || entry.status || 'Schedule';
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

  function personForEntry(state, entry) {
    const id = entryUserId(entry);
    return (state.peopleDirectory || state.people || []).find((person) => String(person.id) === id) || null;
  }

  function filteredPeople(state) {
    const directory = (state.peopleDirectory || []).map((person) => ({
      id: person.id,
      name: person.name || person.email || `Employee ${person.id}`,
      role: person.role || person.team || '',
      nmls_number: person.nmls_number || '',
      email: person.email || person.display_email || '',
    }));
    const people = directory.length ? directory : (state.people || []);
    const selectedUserId = String(state.selectedUserId || '');
    if (!selectedUserId) return people;
    return people.filter((person) => String(person.id) === selectedUserId);
  }

  function filteredPersonIds(state) {
    const people = filteredPeople(state);
    if (!people.length && !state.selectedUserId) return null;
    return new Set(people.map((person) => String(person.id)));
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

  function entryMatchesCalendarFilter(state, entry) {
    const selected = state.selectedCalendarKeys || new Set();
    if (!selected.size) return true;
    const key = calendarKey(entry);
    return Boolean(key && selected.has(key));
  }

  function visibleEntries(state) {
    const ids = filteredPersonIds(state);
    const range = window.CalendarState.visibleRange(state);
    const hiddenStatuses = state.hiddenStatuses || new Set();
    return (state.entries || [])
      .filter((entry) => !hiddenStatuses.has(entry.status))
      .filter((entry) => !ids || ids.has(entryUserId(entry)))
      .filter((entry) => entryMatchesKeyword(state, entry))
      .filter((entry) => entryMatchesCalendarFilter(state, entry))
      .filter((entry) => entryOverlapsRange(entry, range))
      .slice()
      .sort((a, b) => (
        entryStartIso(a).localeCompare(entryStartIso(b)) ||
        (entryTime(a.start_time || a.startTime) || '99:99').localeCompare(entryTime(b.start_time || b.startTime) || '99:99') ||
        entryUserName(a).localeCompare(entryUserName(b))
      ));
  }

  function entriesForDate(state, isoDate) {
    const iso = typeof isoDate === 'string' ? isoDate.slice(0, 10) : window.CalendarState.isoDate(isoDate);
    return visibleEntries(state).filter((entry) => entryOverlapsDate(entry, iso));
  }

  function searchResults(state) {
    if (!String(state.search || '').trim()) return [];
    return visibleEntries(state);
  }

  function currentUserId(value) {
    if (value && typeof value === 'object') {
      return String(value.id || value.user_id || value.userId || value.employee_id || value.employeeId || '');
    }
    return String(value || '');
  }

  function isFalseValue(value) {
    return value === false || value === 0 || value === '0';
  }

  function isProviderProtected(entry) {
    return Boolean(
      entry &&
      (isFalseValue(entry.details_shareable) || (entry.provider_sensitivity && entry.provider_sensitivity !== 'normal'))
    );
  }

  function entryViewers(entry) {
    return Array.isArray(entry?.viewers) ? entry.viewers : [];
  }

  function entryPrivacyState(entry, currentUser) {
    const userId = currentUserId(currentUser);
    const owner = userId && entryUserId(entry) === userId;
    const viewers = entryViewers(entry);
    const viewerMatch = viewers.some((viewer) => String(viewer.user_id || viewer.userId || viewer.id) === userId);

    if (isProviderProtected(entry)) {
      return { key: 'provider_private', label: 'Private Provider Event', tone: 'locked' };
    }
    if (entry.visibility === 'shared_details' && viewers.length) {
      return {
        key: owner ? 'selected_people' : 'shared_with_you',
        label: owner ? 'Shared with Selected People' : (viewerMatch ? 'Shared with You' : 'Shared with Selected People'),
        tone: 'selected',
      };
    }
    if (entry.visibility === 'shared_details') {
      return { key: 'team', label: 'Shared with Team', tone: 'shared' };
    }
    return { key: 'hidden', label: 'Hidden from Team', tone: 'hidden' };
  }

  function isBulkShareEligible(entry, currentUser) {
    const userId = currentUserId(currentUser);
    const provider = providerId(entry);
    return Boolean(
      entry &&
      entry.id &&
      provider === 'outlook' &&
      entryUserId(entry) === userId &&
      !isProviderProtected(entry)
    );
  }

  window.CalendarFilters = {
    visibleEntries,
    entriesForDate,
    searchResults,
    entryMatchesKeyword,
    entryMatchesCalendarFilter,
    entryPrivacyState,
    isBulkShareEligible,
    entryStartIso,
    entryEndIso,
    entryUserId,
    entryUserName,
    entryLabel,
    entryOverlapsDate,
    entryOverlapsRange,
    calendarKey,
    providerId,
  };
})();
