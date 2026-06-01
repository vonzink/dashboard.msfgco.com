(function() {
  'use strict';

  const app = document.getElementById('calendarApp');
  const state = CalendarState.createState();
  let entriesRequestSeq = 0;

  function showToast(message, type) {
    const toast = document.getElementById('calToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `cal-toast cal-toast-${type || 'info'} cal-toast-show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('cal-toast-show'), 4000);
  }

  async function loadEntries() {
    const requestSeq = ++entriesRequestSeq;
    const range = CalendarState.monthRange(state.viewDate);
    try {
      const entries = await CalendarApi.getEntries(range);
      if (requestSeq !== entriesRequestSeq) return false;
      state.entries = entries;
      state.people = CalendarRender.derivePeople(state.entries);
      state.loading = false;
      state.error = null;
      return true;
    } catch (err) {
      if (requestSeq !== entriesRequestSeq) return false;
      throw err;
    }
  }

  async function loadSyncStatus() {
    try {
      const status = await CalendarApi.getSyncStatus();
      state.syncConnections = status.connections || [];
    } catch (err) {
      state.syncConnections = [];
    }
  }

  function handleSyncReturnParams() {
    const params = new URLSearchParams(window.location.search || '');
    const syncStatus = params.get('sync');
    if (!syncStatus) return;

    const provider = params.get('provider') || 'calendar';
    if (syncStatus === 'connected') {
      showToast(`${provider} connected.`, 'success');
    } else if (syncStatus === 'error') {
      showToast(`Unable to connect ${provider}.`, 'error');
    }

    params.delete('sync');
    params.delete('provider');
    params.delete('reason');
    const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  async function boot() {
    try {
      state.me = await CalendarApi.getMe();
      const loaded = await loadEntries();
      if (!loaded) return;
      await loadSyncStatus();
      state.error = null;
      CalendarRender.render(app, state, actions);
      handleSyncReturnParams();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      CalendarRender.render(app, state, actions);
      showToast(err.message, 'error');
    }
  }

  function currentUserId() {
    const me = state.me || {};
    return me.id || me.user_id || me.userId || me.employee_id || me.employeeId || '';
  }

  function selectedIsoDate() {
    return CalendarState.isoDate(state.selectedDate || state.today || new Date());
  }

  function newManualEntry() {
    const date = selectedIsoDate();
    return {
      user_id: state.selectedUserId || currentUserId(),
      status: 'out',
      start_date: date,
      end_date: date,
      start_time: '',
      end_time: '',
      timezone: 'America/Denver',
      visibility: 'shared_details',
      source: 'manual',
      note: '',
    };
  }

  function isPrivateEntry(entry) {
    return Boolean(entry && (entry.private || entry.is_private));
  }

  function isManualEditableEntry(entry) {
    return !entry || (entry.source === 'manual' && !isPrivateEntry(entry));
  }

  function restoreEditorFocus() {
    const target = state.editorReturnFocus;
    state.editorReturnFocus = null;
    if (!target || !document.contains || !document.contains(target) || !target.focus) return;
    try {
      target.focus({ preventScroll: true });
    } catch (err) {
      target.focus();
    }
  }

  function schedulePayloadBody(payload) {
    return {
      user_id: payload.user_id,
      status: payload.status,
      start_date: payload.start_date,
      end_date: payload.end_date,
      start_time: payload.start_time || null,
      end_time: payload.end_time || null,
      timezone: payload.timezone || 'America/Denver',
      note: payload.note || '',
      visibility: payload.visibility,
      source: 'manual',
    };
  }

  const actions = {
    showToast,
    async reload() {
      try {
        const loaded = await loadEntries();
        if (loaded) CalendarRender.render(app, state, actions);
      } catch (err) {
        state.loading = false;
        state.error = err.message;
        CalendarRender.render(app, state, actions);
        showToast(err.message, 'error');
      }
    },
    async connectSyncProvider(provider) {
      try {
        const result = await CalendarApi.startSyncConnection(provider, {
          privacy_default: 'availability_only',
          sync_enabled: true,
        });
        if (result.authorization_url) {
          window.location.href = result.authorization_url;
          return;
        }
        await loadSyncStatus();
        CalendarRender.render(app, state, actions);
      } catch (err) {
        showToast(err.message || 'Unable to start calendar connection.', 'error');
      }
    },
    async runSyncProvider(provider) {
      try {
        showToast('Syncing calendar...', 'info');
        await CalendarApi.runSync(provider);
        await loadSyncStatus();
        await loadEntries();
        CalendarRender.render(app, state, actions);
        showToast('Calendar sync complete.', 'success');
      } catch (err) {
        showToast(err.message || 'Unable to sync calendar.', 'error');
      }
    },
    async disconnectSyncProvider(provider) {
      if (window.confirm && !window.confirm('Disconnect this calendar account?')) return;
      try {
        await CalendarApi.disconnectSyncConnection(provider);
        await loadSyncStatus();
        CalendarRender.render(app, state, actions);
        showToast('Calendar disconnected.', 'success');
      } catch (err) {
        showToast(err.message || 'Unable to disconnect calendar.', 'error');
      }
    },
    openSyncSettings() {
      state.syncSettingsOpen = true;
      CalendarRender.render(app, state, actions);
    },
    closeSyncSettings() {
      state.syncSettingsOpen = false;
      CalendarRender.render(app, state, actions);
    },
    setSearch(value) {
      const active = document.activeElement;
      const shouldRestoreSearch = active && active.classList && active.classList.contains('schedule-search');
      const selectionStart = shouldRestoreSearch ? active.selectionStart : null;
      const selectionEnd = shouldRestoreSearch ? active.selectionEnd : null;
      state.search = value;
      CalendarRender.render(app, state, actions);
      if (!shouldRestoreSearch) return;
      const search = app.querySelector('.schedule-search');
      if (!search) return;
      try {
        search.focus({ preventScroll: true });
      } catch (err) {
        search.focus();
      }
      if (selectionStart == null || selectionEnd == null || !search.setSelectionRange) return;
      search.setSelectionRange(selectionStart, selectionEnd);
    },
    setViewDate(date) {
      state.viewDate = date;
      actions.reload();
    },
    setSelectedDate(date) {
      state.selectedDate = date;
      CalendarRender.render(app, state, actions);
    },
    setSelectedUser(userId) {
      state.selectedUserId = userId;
      CalendarRender.render(app, state, actions);
    },
    toggleStatus(status) {
      if (state.hiddenStatuses.has(status)) state.hiddenStatuses.delete(status);
      else state.hiddenStatuses.add(status);
      CalendarRender.render(app, state, actions);
    },
    openEditor(entry) {
      if (state.editorSaving) return;
      if (entry && !isManualEditableEntry(entry)) {
        showToast('Synced/private entries can only be viewed as availability.', 'info');
        return;
      }
      state.editorReturnFocus = document.activeElement;
      state.editor = entry || newManualEntry();
      CalendarRender.render(app, state, actions);
    },
    closeEditor() {
      if (state.editorSaving) return;
      state.editor = null;
      state.editorSaving = false;
      CalendarRender.render(app, state, actions);
      restoreEditorFocus();
    },
    async saveEditor(payload = {}) {
      if (state.editorSaving) return;
      const current = state.editor;
      if (!current) return;
      if (!isManualEditableEntry(current)) {
        showToast('Synced/private entries can only be viewed as availability.', 'info');
        return;
      }
      const editorId = current.id;
      if (payload.id && String(payload.id) !== String(editorId || '')) {
        showToast('Schedule entry changed. Please reopen and try again.', 'error');
        return;
      }
      state.editorSaving = true;
      CalendarRender.render(app, state, actions);
      try {
        const body = schedulePayloadBody(payload);
        if (editorId) {
          await CalendarApi.updateEntry(editorId, body);
          showToast('Schedule entry updated.', 'success');
        } else {
          await CalendarApi.createEntry(body);
          showToast('Schedule entry created.', 'success');
        }
        state.editor = null;
        state.editorSaving = false;
        await actions.reload();
        restoreEditorFocus();
      } catch (err) {
        state.editorSaving = false;
        CalendarRender.render(app, state, actions);
        throw err;
      }
    },
    async deleteEntry(id) {
      if (state.editorSaving) return;
      const current = state.editor;
      if (!current || !current.id) return;
      if (!isManualEditableEntry(current)) {
        showToast('Synced/private entries can only be viewed as availability.', 'info');
        return;
      }
      if (id && String(id) !== String(current.id)) {
        showToast('Schedule entry changed. Please reopen and try again.', 'error');
        return;
      }
      state.editorSaving = true;
      CalendarRender.render(app, state, actions);
      try {
        await CalendarApi.deleteEntry(current.id);
        showToast('Schedule entry deleted.', 'success');
        state.editor = null;
        state.editorSaving = false;
        await actions.reload();
        restoreEditorFocus();
      } catch (err) {
        state.editorSaving = false;
        CalendarRender.render(app, state, actions);
        throw err;
      }
    },
  };

  window.MSFGCalendar = { state, actions };
  boot();
})();
