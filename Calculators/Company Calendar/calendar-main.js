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

  async function boot() {
    try {
      state.me = await CalendarApi.getMe();
      const loaded = await loadEntries();
      if (!loaded) return;
      state.error = null;
      CalendarRender.render(app, state, actions);
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
      state.editor = entry || newManualEntry();
      CalendarRender.render(app, state, actions);
    },
    closeEditor() {
      state.editor = null;
      CalendarRender.render(app, state, actions);
    },
    async saveEditor(payload) {
      if (payload.id) {
        await CalendarApi.updateEntry(payload.id, payload);
        showToast('Schedule entry updated.', 'success');
      } else {
        await CalendarApi.createEntry(payload);
        showToast('Schedule entry created.', 'success');
      }
      state.editor = null;
      await actions.reload();
    },
    async deleteEntry(id) {
      await CalendarApi.deleteEntry(id);
      showToast('Schedule entry deleted.', 'success');
      state.editor = null;
      await actions.reload();
    },
  };

  window.MSFGCalendar = { state, actions };
  boot();
})();
