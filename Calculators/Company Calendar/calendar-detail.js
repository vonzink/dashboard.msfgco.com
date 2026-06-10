(function() {
  'use strict';

  function escapeHtml(value) {
    return window.CalendarRender.escapeHtml(value);
  }

  function entryUserId(entry) {
    return String(entry.user_id || entry.userId || entry.employee_id || entry.employeeId || entry.owner_id || entry.ownerId || '');
  }

  function entryStartIso(entry) {
    return String(entry.start_date || entry.startDate || entry.date || '').slice(0, 10);
  }

  function entryEndIso(entry) {
    return String(entry.end_date || entry.endDate || entry.date || entry.start_date || entry.startDate || '').slice(0, 10);
  }

  function entryTime(value) {
    return String(value || '').slice(0, 5);
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

  function isOutlookOwnedEntry(entry) {
    return Boolean(entry && (entry.source_provider === 'outlook' || entry.source === 'outlook'));
  }

  function isProviderOwnedEntry(entry) {
    return Boolean(entry && (entry.provider_owned || entry.source_provider || entry.source === 'outlook' || entry.source === 'google'));
  }

  function providerName(entry) {
    return (entry.source_provider || entry.source) === 'google' ? 'Google' : 'Outlook';
  }

  function currentUserId(state) {
    const me = state.me || {};
    return String(me.id || me.user_id || me.userId || me.employee_id || me.employeeId || '');
  }

  function isOwnerEntry(entry, state) {
    return Boolean(entry && currentUserId(state) && entryUserId(entry) === currentUserId(state));
  }

  function canToggleProviderDetails(entry, state) {
    return Boolean(isProviderOwnedEntry(entry) && isOwnerEntry(entry, state) && entry.details_shareable && entry.id);
  }

  function isProviderPrivate(entry, state) {
    return Boolean(
      isProviderOwnedEntry(entry) &&
      isOwnerEntry(entry, state) &&
      !entry.details_shareable &&
      entry.provider_sensitivity &&
      entry.provider_sensitivity !== 'normal'
    );
  }

  function selectedIso(state) {
    return window.CalendarState.isoDate(state.selectedDate || state.viewDate || state.today || new Date());
  }

  function selectedPerson(state) {
    const selectedUserId = String(state.selectedUserId || '');
    if (!selectedUserId) return null;
    return (state.people || []).find((person) => String(person.id) === selectedUserId) || {
      id: selectedUserId,
      name: `Employee ${selectedUserId}`,
      role: '',
    };
  }

  function entryOverlapsDate(entry, iso) {
    const start = entryStartIso(entry);
    const end = entryEndIso(entry) || start;
    return Boolean(start && iso >= start && iso <= end);
  }

  function selectedDateEntries(state) {
    const iso = selectedIso(state);
    const selectedUserId = String(state.selectedUserId || '');
    return (state.entries || [])
      .filter((entry) => {
        if (!entryOverlapsDate(entry, iso)) return false;
        if (selectedUserId && entryUserId(entry) !== selectedUserId) return false;
        return !state.hiddenStatuses.has(entry.status);
      })
      .sort((a, b) => {
        const aTime = entryTime(a.start_time || a.startTime) || '99:99';
        const bTime = entryTime(b.start_time || b.startTime) || '99:99';
        return aTime.localeCompare(bTime) || entryUserId(a).localeCompare(entryUserId(b));
      });
  }

  function dateLabel(state) {
    const date = state.selectedDate || state.viewDate || state.today || new Date();
    return `${window.CalendarState.MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  function timeLabel(entry) {
    const start = entryTime(entry.start_time || entry.startTime);
    const end = entryTime(entry.end_time || entry.endTime);
    if (!start && !end) return 'All day';
    if (start && end) return `${start} - ${end}`;
    return start ? `${start} start` : `${end} end`;
  }

  function statusLabel(entry) {
    return (window.CalendarState.STATUS_META[entry.status] && window.CalendarState.STATUS_META[entry.status].label) ||
      entry.status ||
      'Schedule';
  }

  function entryTitle(entry) {
    if (isPrivateEntry(entry)) return 'Busy';
    if (entry.note && isProviderOwnedEntry(entry)) return entry.note;
    if (entry.visibility === 'availability_only') return statusLabel(entry);
    return entry.display_label ||
      entry.note ||
      statusLabel(entry);
  }

  function canShowNote(entry) {
    return Boolean(entry.note && !isPrivateEntry(entry) && entry.visibility !== 'availability_only');
  }

  function providerReadOnlyMessage(entry) {
    if (!isOutlookOwnedEntry(entry)) return '';
    return '<span class="detail-note">Managed in Outlook. Edit this event in Outlook.</span>';
  }

  function providerPrivacyControl(entry, state) {
    if (isProviderPrivate(entry, state)) {
      return `<span class="detail-privacy-badge">Private in ${escapeHtml(providerName(entry))}</span>`;
    }

    if (!canToggleProviderDetails(entry, state)) return '';

    const sharing = entry.visibility === 'shared_details';
    const targetVisibility = sharing ? 'availability_only' : 'shared_details';
    const label = sharing ? 'Hide details' : 'Share details';
    const stateLabel = sharing ? 'Shared with team' : 'Hidden from team';

    return `
      <span class="detail-share-row">
        <span class="detail-privacy-badge">${escapeHtml(stateLabel)}</span>
        <button class="detail-share-toggle" type="button" data-entry-id="${escapeHtml(entry.id)}" data-entry-visibility="${escapeHtml(targetVisibility)}">
          ${escapeHtml(label)}
        </button>
      </span>
    `;
  }

  function personLabel(entry, state) {
    const selected = selectedPerson(state);
    if (selected) return selected.name;
    return entry.user_name || entry.userName || entry.employee_name || entry.employeeName || `Employee ${entryUserId(entry) || ''}`.trim();
  }

  function renderEntry(entry, state) {
    const editable = isEditableEntry(entry);
    const tag = editable ? 'button' : 'div';
    const attrs = editable
      ? `type="button" data-entry-id="${escapeHtml(entry.id)}" aria-label="Edit ${escapeHtml(entryTitle(entry))}"`
      : 'aria-disabled="true"';

    return `
      <${tag} class="detail-entry ${editable ? 'is-editable' : 'is-readonly'}" ${attrs}>
        <span class="detail-status" data-status="${escapeHtml(entry.status || 'other')}" aria-hidden="true"></span>
        <span class="detail-entry-body">
          <span class="detail-entry-top">
            <strong>${escapeHtml(entryTitle(entry))}</strong>
            <small>${escapeHtml(timeLabel(entry))}</small>
          </span>
          <span class="detail-person">${escapeHtml(personLabel(entry, state))}</span>
          ${canShowNote(entry) ? `<span class="detail-note">${escapeHtml(entry.note)}</span>` : ''}
          ${!editable ? providerReadOnlyMessage(entry) : ''}
          ${providerPrivacyControl(entry, state)}
        </span>
      </${tag}>
    `;
  }

  function render(state) {
    const person = selectedPerson(state);
    const entries = selectedDateEntries(state);
    const heading = person ? `${person.name} Schedule` : 'Company Schedule';
    const subheading = person && person.role ? `${person.role} on ${dateLabel(state)}` : dateLabel(state);

    return `
      <aside class="detail-panel" aria-label="Selected schedule details">
        <div class="detail-head">
          <div>
            <p class="detail-eyebrow">Selected</p>
            <h2>${escapeHtml(heading)}</h2>
            <p>${escapeHtml(subheading)}</p>
          </div>
          ${person ? '<button class="nav-btn" type="button" data-detail-clear-person>All People</button>' : ''}
        </div>
        <div class="detail-list">
          ${entries.length ? entries.map((entry) => renderEntry(entry, state)).join('') : `
            <p class="empty-detail">No visible schedule entries for this selection.</p>
          `}
        </div>
      </aside>
    `;
  }

  function bind(root, state, actions) {
    const clear = root.querySelector('[data-detail-clear-person]');
    if (clear) {
      clear.addEventListener('click', () => actions.setSelectedUser(null));
    }

    root.querySelectorAll('.detail-entry[data-entry-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = (state.entries || []).find((item) => String(item.id) === String(button.dataset.entryId));
        if (entry && actions.openEditor) actions.openEditor(entry);
      });
    });

    root.querySelectorAll('[data-entry-visibility]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (actions.updateEntryVisibility) {
          actions.updateEntryVisibility(button.dataset.entryId, button.dataset.entryVisibility);
        }
      });
    });
  }

  window.CalendarDetail = {
    render,
    bind,
  };
})();
