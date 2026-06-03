(function() {
  'use strict';

  const STATUS_OPTIONS = Object.keys(window.CalendarState.STATUS_META);
  const VISIBILITY_OPTIONS = [
    { value: 'availability_only', label: 'Hidden from Team' },
    { value: 'shared_details', label: 'Shared Details' },
  ];

  function escapeHtml(value) {
    return window.CalendarRender.escapeHtml(value);
  }

  function firstValue() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return '';
  }

  function entryUserId(entry) {
    return firstValue(entry.user_id, entry.userId, entry.employee_id, entry.employeeId, entry.owner_id, entry.ownerId);
  }

  function entryStartDate(entry) {
    return String(firstValue(entry.start_date, entry.startDate, entry.date)).slice(0, 10);
  }

  function entryEndDate(entry) {
    return String(firstValue(entry.end_date, entry.endDate, entry.date, entry.start_date, entry.startDate)).slice(0, 10);
  }

  function entryStartTime(entry) {
    return firstValue(entry.start_time, entry.startTime);
  }

  function entryEndTime(entry) {
    return firstValue(entry.end_time, entry.endTime);
  }

  function fieldValue(form, name) {
    return form.elements[name] ? String(form.elements[name].value || '').trim() : '';
  }

  function optionalTimeValue(form, name) {
    return fieldValue(form, name) || null;
  }

  function isPrivateEntry(entry) {
    return Boolean(entry && (entry.private || entry.is_private));
  }

  function isManualEditableEntry(entry) {
    return Boolean(entry && entry.source === 'manual' && !isPrivateEntry(entry));
  }

  function personOptionLabel(person) {
    const nmls = person.nmls_number ? ` - NMLS ${person.nmls_number}` : '';
    return `${person.name || person.email || `Employee ${person.id}`}${nmls}`;
  }

  function renderEmployeeOptions(state, selectedUserId) {
    const directory = state.peopleDirectory || [];
    const hasSelected = directory.some((person) => String(person.id) === String(selectedUserId));
    const fallback = selectedUserId && !hasSelected
      ? [{ id: selectedUserId, name: `Employee ${selectedUserId}` }]
      : [];

    return directory.concat(fallback).map((person) => `
      <option value="${escapeHtml(person.id)}" ${String(selectedUserId) === String(person.id) ? 'selected' : ''}>
        ${escapeHtml(personOptionLabel(person))}
      </option>
    `).join('');
  }

  function selectedAttendeeEmails(attendees) {
    return new Set((attendees || []).map((attendee) => String(attendee.email || '').toLowerCase()));
  }

  function selectedViewerIds(viewers) {
    return new Set((viewers || []).map((viewer) => String(viewer.user_id || viewer.userId || viewer.id || '')));
  }

  function renderAttendeeOptions(state, selectedAttendees) {
    const selected = selectedAttendeeEmails(selectedAttendees);
    return (state.peopleDirectory || []).map((person) => {
      const email = person.email || person.display_email || '';
      const label = email ? `${person.name || email} <${email}>` : (person.name || `Employee ${person.id}`);
      return `
        <option value="${escapeHtml(email)}" ${selected.has(String(email).toLowerCase()) ? 'selected' : ''}>
          ${escapeHtml(label)}
        </option>
      `;
    }).join('');
  }

  function renderViewerOptions(state, selectedViewers) {
    const selected = selectedViewerIds(selectedViewers);
    const allSelected = selected.size === 0;
    const peopleOptions = (state.peopleDirectory || []).map((person) => {
      const email = person.email || person.display_email || '';
      const label = email ? `${person.name || email} <${email}>` : (person.name || `Employee ${person.id}`);
      return `
        <option value="${escapeHtml(person.id)}" ${selected.has(String(person.id)) ? 'selected' : ''}>
          ${escapeHtml(label)}
        </option>
      `;
    }).join('');

    return `
      <option value="__all" ${allSelected ? 'selected' : ''}>All Team</option>
      ${peopleOptions}
    `;
  }

  function statusColor(status) {
    const meta = window.CalendarState.STATUS_META[status] || window.CalendarState.STATUS_META.other;
    return meta.color || '#404041';
  }

  function selectedAttendees(form, state) {
    const selected = Array.from(form.elements.attendees?.selectedOptions || []).map((option) => option.value);
    return selected.map((email) => {
      const person = (state.peopleDirectory || []).find((item) => (
        String(item.email || item.display_email || '').toLowerCase() === String(email).toLowerCase()
      ));
      return {
        user_id: person?.id || null,
        email,
        name: person?.name || email,
      };
    });
  }

  function selectedViewers(form, state) {
    const selected = Array.from(form.elements.viewers?.selectedOptions || [])
      .map((option) => option.value)
      .filter((value) => value && value !== '__all');
    return selected.map((userId) => {
      const person = (state.peopleDirectory || []).find((item) => String(item.id) === String(userId));
      return {
        user_id: Number(userId),
        email: person?.email || person?.display_email || null,
        name: person?.name || null,
      };
    });
  }

  function focusableElements(container) {
    return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.disabled && element.offsetParent !== null);
  }

  function focusFirstField(container) {
    const focusables = focusableElements(container);
    const target = focusables.find((element) => element.name === 'user_id') || focusables[0];
    if (!target || !target.focus) return;
    try {
      target.focus({ preventScroll: true });
    } catch (err) {
      target.focus();
    }
  }

  function renderStatusOptions(selected) {
    return STATUS_OPTIONS.map((status) => {
      const meta = window.CalendarState.STATUS_META[status] || { label: status };
      return `
        <option value="${escapeHtml(status)}" ${String(selected) === status ? 'selected' : ''}>
          ${escapeHtml(meta.label)}
        </option>
      `;
    }).join('');
  }

  function renderVisibilityOptions(selected) {
    return VISIBILITY_OPTIONS.map((option) => `
      <option value="${escapeHtml(option.value)}" ${String(selected || 'availability_only') === option.value ? 'selected' : ''}>
        ${escapeHtml(option.label)}
      </option>
    `).join('');
  }

  function render(state) {
    const entry = state.editor;
    if (!entry) return '';

    const isExisting = Boolean(entry.id);
    const canDelete = isExisting && isManualEditableEntry(entry);
    const isSaving = Boolean(state.editorSaving);
    const title = isExisting ? 'Edit Schedule' : 'Add Schedule';
    const status = firstValue(entry.status, 'out');
    const visibility = firstValue(entry.visibility, 'availability_only');
    const sourceNote = entry.source === 'manual' || !entry.source ? 'Manual availability entry' : 'Synced Outlook entry';

    return `
      <div class="editor-backdrop" role="presentation" data-editor-close>
        <section class="schedule-editor" role="dialog" aria-modal="true" aria-labelledby="scheduleEditorTitle">
          <form class="schedule-editor-form">
            <div class="editor-head">
              <div>
                <h2 id="scheduleEditorTitle">${escapeHtml(title)}</h2>
                <p>${escapeHtml(sourceNote)}</p>
              </div>
              <button class="icon-btn" type="button" aria-label="Close editor" data-editor-close ${isSaving ? 'disabled' : ''}>&times;</button>
            </div>
            <div class="editor-grid">
              <label>
                <span>Employee</span>
                <select name="user_id" required ${isSaving ? 'disabled' : ''}>
                  ${renderEmployeeOptions(state, entryUserId(entry))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select name="status" required ${isSaving ? 'disabled' : ''}>
                  ${renderStatusOptions(status)}
                </select>
              </label>
              <label>
                <span>Start Date</span>
                <input name="start_date" type="date" value="${escapeHtml(entryStartDate(entry))}" required ${isSaving ? 'disabled' : ''}>
              </label>
              <label>
                <span>End Date</span>
                <input name="end_date" type="date" value="${escapeHtml(entryEndDate(entry))}" required ${isSaving ? 'disabled' : ''}>
              </label>
              <label>
                <span>Start Time</span>
                <input name="start_time" type="time" value="${escapeHtml(entryStartTime(entry))}" ${isSaving ? 'disabled' : ''}>
              </label>
              <label>
                <span>End Time</span>
                <input name="end_time" type="time" value="${escapeHtml(entryEndTime(entry))}" ${isSaving ? 'disabled' : ''}>
              </label>
              <label>
                <span>Visibility</span>
                <select name="visibility" required ${isSaving ? 'disabled' : ''}>
                  ${renderVisibilityOptions(visibility)}
                </select>
                <small class="field-help">Hidden means teammates see nothing. Shared lets the selected viewers see details.</small>
              </label>
              <label>
                <span>Event Color</span>
                <input name="event_color" type="color" value="${escapeHtml(firstValue(entry.event_color, statusColor(status)))}" ${isSaving ? 'disabled' : ''}>
                <small class="field-help">Use a status color or choose a custom color for this event.</small>
              </label>
              <label class="editor-attendees">
                <span>Invite Employees</span>
                <select name="attendees" multiple ${isSaving ? 'disabled' : ''}>
                  ${renderAttendeeOptions(state, entry.attendees || [])}
                </select>
                <small class="field-help">People invited to attend this event, separate from who can view it.</small>
              </label>
              <label class="editor-viewers">
                <span>Visible To</span>
                <select name="viewers" multiple ${isSaving ? 'disabled' : ''}>
                  ${renderViewerOptions(state, entry.viewers || [])}
                </select>
                <small class="field-help">Leave All Team selected to share with everyone, or choose specific viewers.</small>
              </label>
              <label class="editor-note">
                <span>Note</span>
                <textarea name="note" rows="4" ${isSaving ? 'disabled' : ''}>${escapeHtml(firstValue(entry.note, ''))}</textarea>
              </label>
            </div>
            <div class="editor-actions">
              ${canDelete ? `<button class="danger-btn" type="button" data-editor-delete="${escapeHtml(entry.id)}" ${isSaving ? 'disabled' : ''}>Delete</button>` : ''}
              <span class="editor-action-spacer"></span>
              <button class="nav-btn" type="button" data-editor-close ${isSaving ? 'disabled' : ''}>Cancel</button>
              <button class="primary-btn" type="submit" data-save-mode="normal" ${isSaving ? 'disabled' : ''}>${isSaving ? 'Saving...' : 'Save'}</button>
              <button class="primary-btn send-btn" type="submit" data-save-mode="send" ${isSaving ? 'disabled' : ''}>Save and send updates</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function formPayload(form, existing) {
    const current = existing || {};
    return {
      id: current.id,
      user_id: fieldValue(form, 'user_id'),
      status: fieldValue(form, 'status'),
      start_date: fieldValue(form, 'start_date'),
      end_date: fieldValue(form, 'end_date'),
      start_time: optionalTimeValue(form, 'start_time'),
      end_time: optionalTimeValue(form, 'end_time'),
      timezone: 'America/Denver',
      note: fieldValue(form, 'note'),
      visibility: fieldValue(form, 'visibility'),
      event_color: fieldValue(form, 'event_color') || null,
      attendees: selectedAttendees(form, window.MSFGCalendar?.state || {}),
      viewers: selectedViewers(form, window.MSFGCalendar?.state || {}),
      send_updates: Boolean(form.dataset.sendUpdates === 'true'),
      source: current.source || 'manual',
    };
  }

  function bind(root, state, actions) {
    const backdrop = root.querySelector('.editor-backdrop');
    const form = root.querySelector('.schedule-editor-form');
    if (!backdrop || !form) return;

    focusFirstField(form);

    root.querySelectorAll('[data-editor-close]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (event.currentTarget === backdrop && event.target !== backdrop) return;
        actions.closeEditor();
      });
    });

    root.querySelectorAll('[data-editor-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.editorDelete;
        if (!id || state.editorSaving) return;
        if (window.confirm && !window.confirm('Delete this schedule entry?')) return;
        try {
          await actions.deleteEntry(id);
        } catch (err) {
          actions.showToast(err.message || 'Unable to delete schedule entry.', 'error');
        }
      });
    });

    form.addEventListener('click', (event) => {
      const saveButton = event.target.closest ? event.target.closest('[data-save-mode]') : null;
      if (!saveButton) return;
      form.dataset.sendUpdates = saveButton.dataset.saveMode === 'send' ? 'true' : 'false';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.editorSaving) return;
      try {
        await actions.saveEditor(formPayload(form, state.editor));
      } catch (err) {
        actions.showToast(err.message || 'Unable to save schedule entry.', 'error');
      }
    });

    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        actions.closeEditor();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = focusableElements(backdrop);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  window.CalendarEditor = {
    render,
    bind,
  };
})();
