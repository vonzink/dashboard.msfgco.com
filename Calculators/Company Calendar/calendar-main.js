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
      state.search = value;
      CalendarRender.render(app, state, actions);
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
  };

  window.MSFGCalendar = { state, actions };
  boot();
})();
