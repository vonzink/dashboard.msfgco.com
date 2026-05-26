(function() {
  'use strict';

  const STATUS_OPTIONS = Object.keys(window.CalendarState.STATUS_META).filter((status) => status !== 'busy');
  const VISIBILITY_OPTIONS = [
    { value: 'shared_details', label: 'Shared Details' },
    { value: 'availability_only', label: 'Availability Only' },
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

  function isPrivateEntry(entry) {
    return Boolean(entry && (entry.private || entry.is_private));
  }

  function isManualEditableEntry(entry) {
    return Boolean(entry && entry.source === 'manual' && !isPrivateEntry(entry));
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
      <option value="${escapeHtml(option.value)}" ${String(selected || 'shared_details') === option.value ? 'selected' : ''}>
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
    const visibility = firstValue(entry.visibility, 'shared_details');

    return `
      <div class="editor-backdrop" role="presentation" data-editor-close>
        <section class="schedule-editor" role="dialog" aria-modal="true" aria-labelledby="scheduleEditorTitle">
          <form class="schedule-editor-form">
            <div class="editor-head">
              <div>
                <h2 id="scheduleEditorTitle">${escapeHtml(title)}</h2>
                <p>Manual availability entry</p>
              </div>
              <button class="icon-btn" type="button" aria-label="Close editor" data-editor-close ${isSaving ? 'disabled' : ''}>&times;</button>
            </div>
            <div class="editor-grid">
              <label>
                <span>Employee ID</span>
                <input name="user_id" type="text" value="${escapeHtml(entryUserId(entry))}" required ${isSaving ? 'disabled' : ''}>
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
              <button class="primary-btn" type="submit" ${isSaving ? 'disabled' : ''}>${isSaving ? 'Saving...' : 'Save Schedule'}</button>
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
      start_time: fieldValue(form, 'start_time'),
      end_time: fieldValue(form, 'end_time'),
      timezone: 'America/Denver',
      note: fieldValue(form, 'note'),
      visibility: fieldValue(form, 'visibility'),
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
