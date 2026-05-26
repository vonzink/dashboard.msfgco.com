(function() {
  'use strict';

  const app = document.getElementById('calendarApp');
  const state = CalendarState.createState();

  function showToast(message, type) {
    const toast = document.getElementById('calToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `cal-toast cal-toast-${type || 'info'} cal-toast-show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('cal-toast-show'), 4000);
  }

  async function loadEntries() {
    const range = CalendarState.monthRange(state.viewDate);
    state.entries = await CalendarApi.getEntries(range);
    state.people = CalendarRender.derivePeople(state.entries);
  }

  async function boot() {
    try {
      state.me = await CalendarApi.getMe();
      await loadEntries();
      state.loading = false;
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
      await loadEntries();
      CalendarRender.render(app, state, actions);
    },
    setSearch(value) {
      state.search = value;
      CalendarRender.render(app, state, actions);
    },
    setViewDate(date) {
      state.viewDate = date;
      actions.reload().catch(err => showToast(err.message, 'error'));
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
