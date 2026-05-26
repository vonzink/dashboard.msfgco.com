(function() {
  'use strict';

  const STATUS_META = {
    out: { label: 'Out', color: '#4b7b4d' },
    remote: { label: 'Remote', color: '#6a9b48' },
    traveling: { label: 'Traveling', color: '#2f5e4c' },
    meeting_event: { label: 'Meeting/Event', color: '#b85a2e' },
    other: { label: 'Other', color: '#404041' },
    busy: { label: 'Busy', color: '#6a7672' },
  };

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDate(value) {
    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function monthRange(viewDate) {
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    return { start_date: isoDate(start), end_date: isoDate(end) };
  }

  function createState() {
    const today = new Date();
    return {
      today,
      viewDate: new Date(today.getFullYear(), today.getMonth(), 1),
      selectedDate: today,
      me: null,
      entries: [],
      people: [],
      search: '',
      hiddenStatuses: new Set(),
      selectedUserId: null,
      editor: null,
      loading: true,
      error: null,
    };
  }

  window.CalendarState = {
    STATUS_META,
    MONTHS,
    DOW,
    pad,
    createState,
    daysInMonth,
    isoDate,
    parseDate,
    monthRange,
  };
})();
