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
    const range = CalendarState.visibleRange(state);
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
      state.teamSyncConnections = status.team_connections || status.teamConnections || [];
    } catch (err) {
      state.syncConnections = [];
      state.teamSyncConnections = [];
    }
  }

  async function loadPeopleDirectory() {
    try {
      state.peopleDirectory = await CalendarApi.getUserDirectory();
      state.directoryError = null;
    } catch (err) {
      state.peopleDirectory = state.me ? [state.me] : [];
      state.directoryError = err.message || 'Unable to load employee directory.';
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
      await loadPeopleDirectory();
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

  function isAdminUser() {
    const role = String(state.me?.role || state.me?.user_role || '').toLowerCase();
    const groups = Array.isArray(state.me?.groups) ? state.me.groups.map((group) => String(group).toLowerCase()) : [];
    return role === 'admin' || role === 'manager' || groups.includes('admin') || groups.includes('manager');
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
      visibility: 'availability_only',
      event_color: '',
      attendees: [],
      viewers: [],
      source: 'manual',
      note: '',
    };
  }

  function isPrivateEntry(entry) {
    return Boolean(entry && (entry.private || entry.is_private));
  }

  function isProviderOwnedEntry(entry) {
    return Boolean(entry && (entry.provider_owned || entry.source_provider || entry.source === 'outlook' || entry.source === 'google'));
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
    if (!entry || isPrivateEntry(entry)) return false;
    if (entry.source === 'manual') return true;
    if (isProtectedOutlookEntry(entry)) return false;
    return Boolean(isProviderOwnedEntry(entry) && (entry.source_provider === 'outlook' || entry.source === 'outlook'));
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
      event_color: payload.event_color || null,
      attendees: payload.attendees || [],
      viewers: payload.viewers || [],
      send_updates: Boolean(payload.send_updates),
      source: payload.source || 'manual',
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
      if (isAdminUser()) actions.loadAdminSyncOverview();
    },
    closeSyncSettings() {
      state.syncSettingsOpen = false;
      CalendarRender.render(app, state, actions);
    },
    async loadAdminSyncOverview() {
      if (!isAdminUser() || state.adminSyncLoading) return;
      state.adminSyncLoading = true;
      state.adminSyncError = null;
      CalendarRender.render(app, state, actions);
      try {
        const result = await CalendarApi.getAdminSyncStatus(CalendarState.visibleRange(state));
        state.adminSyncOverview = result.connections || [];
        state.adminSyncLoading = false;
        state.adminSyncError = null;
      } catch (err) {
        state.adminSyncOverview = [];
        state.adminSyncLoading = false;
        state.adminSyncError = err.message || 'Unable to load admin sync overview.';
      }
      CalendarRender.render(app, state, actions);
    },
    openDayDrawer(date, focusEntryId) {
      const iso = typeof date === 'string' ? date.slice(0, 10) : CalendarState.isoDate(date || state.selectedDate || new Date());
      state.drawerDate = iso;
      state.drawerFocusEntryId = focusEntryId || null;
      state.sidePanelMode = 'day';
      state.selectedDate = CalendarState.parseDate(iso);
      CalendarRender.render(app, state, actions);
    },
    closeSidePanel() {
      state.drawerDate = null;
      state.drawerFocusEntryId = null;
      state.sidePanelMode = null;
      state.selectedBulkEntryIds = new Set();
      CalendarRender.render(app, state, actions);
    },
    focusEntryInDrawer(entryId) {
      state.drawerFocusEntryId = entryId || null;
      const entry = (state.entries || []).find((item) => String(item.id) === String(entryId));
      if (entry && isEditableEntry(entry)) {
        actions.openEditor(entry);
        return;
      }
      CalendarRender.render(app, state, actions);
    },
    toggleBulkEntry(entryId, checked) {
      const selected = state.selectedBulkEntryIds || new Set();
      const key = Number.isNaN(Number(entryId)) ? String(entryId) : Number(entryId);
      const hasEntry = selected.has(key) || selected.has(String(entryId));
      if (checked == null ? !hasEntry : checked) selected.add(key);
      else {
        selected.delete(key);
        selected.delete(String(entryId));
      }
      state.selectedBulkEntryIds = selected;
      CalendarRender.render(app, state, actions);
    },
    clearBulkSelection() {
      state.selectedBulkEntryIds = new Set();
      CalendarRender.render(app, state, actions);
    },
    async bulkUpdateVisibility(visibility, viewers) {
      const selectedIds = Array.from(state.selectedBulkEntryIds || []);
      if (!selectedIds.length) return;
      try {
        const result = await CalendarApi.updateEntryVisibilityBulk(selectedIds, visibility, viewers || []);
        const updatedEntries = result.updated_entries || result.updatedEntries || [];
        const updatedById = new Map(updatedEntries.map((entry) => [String(entry.id), entry]));
        state.entries = (state.entries || []).map((entry) => updatedById.get(String(entry.id)) || entry);
        updatedEntries.forEach((entry) => {
          if (!(state.entries || []).some((item) => String(item.id) === String(entry.id))) {
            state.entries.push(entry);
          }
        });
        const successfulIds = new Set(updatedEntries.map((entry) => String(entry.id)));
        state.selectedBulkEntryIds = new Set(selectedIds.filter((id) => !successfulIds.has(String(id))));
        state.people = CalendarRender.derivePeople(state.entries);
        CalendarRender.render(app, state, actions);
        const failures = result.failures || [];
        const message = failures.length
          ? `${updatedEntries.length} updated, ${failures.length} blocked.`
          : `${updatedEntries.length} events updated.`;
        showToast(message, failures.length ? 'info' : 'success');
      } catch (err) {
        showToast(err.message || 'Unable to update selected events.', 'error');
      }
    },
    setSearch(value) {
      const active = document.activeElement;
      const shouldRestoreSearch = active && active.classList && active.classList.contains('schedule-search');
      const selectionStart = shouldRestoreSearch ? active.selectionStart : null;
      const selectionEnd = shouldRestoreSearch ? active.selectionEnd : null;
      state.search = value;
      if (String(value || '').trim()) {
        state.sidePanelMode = 'search';
      } else if (state.sidePanelMode === 'search') {
        state.sidePanelMode = state.drawerDate ? 'day' : null;
      }
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
    setViewMode(mode) {
      if (!CalendarState.VIEW_MODES.includes(mode) || state.viewMode === mode) return;
      state.viewMode = mode;
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
    toggleCalendarFilter(key) {
      if (!key) return;
      const selected = state.selectedCalendarKeys || new Set();
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      state.selectedCalendarKeys = selected;
      CalendarRender.render(app, state, actions);
    },
    clearCalendarFilters() {
      state.selectedCalendarKeys = new Set();
      CalendarRender.render(app, state, actions);
    },
    openEditor(entry) {
      if (state.editorSaving) return;
      if (entry && !isEditableEntry(entry)) {
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
      if (!isEditableEntry(current)) {
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
    async updateEntryVisibility(id, visibility) {
      try {
        const result = await CalendarApi.updateEntryVisibility(id, visibility);
        if (result && result.entry) {
          state.entries = state.entries.map((entry) => (
            String(entry.id) === String(result.entry.id) ? result.entry : entry
          ));
          if (state.editor && String(state.editor.id) === String(result.entry.id)) {
            state.editor = result.entry;
          }
          state.people = CalendarRender.derivePeople(state.entries);
          CalendarRender.render(app, state, actions);
        } else {
          await actions.reload();
        }
        showToast(visibility === 'shared_details' ? 'Event details shared.' : 'Event details hidden.', 'success');
      } catch (err) {
        showToast(err.message || 'Unable to update event sharing.', 'error');
      }
    },
    async deleteEntry(id) {
      if (state.editorSaving) return;
      const current = state.editor;
      if (!current || !current.id) return;
      if (!isEditableEntry(current)) {
        showToast('Synced/private entries can only be viewed as availability.', 'info');
        return;
      }
      if (current.source !== 'manual') {
        showToast('Synced Outlook entries can be edited, but deletion stays in Outlook.', 'info');
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
