// Checklist format helpers — pure functions.
//
// Status string parsing/labelling, date formatting, overdue detection,
// and the next-status cycle for the toggle-status button.
// Extracted from js/checklists.js (audit §2.3) — behavior identical.
//
// No DOM, no module state, no Utils dependency. Safe to call before
// the main Checklists object exists.
//
// Exposes: window.ChecklistFormat

(function () {
  const STATUS_LABELS = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    submitted:   'Submitted',
    done:        'Done',
    incomplete:  'Incomplete',
    issue:       'Issue',
    na:          'N/A',
  };

  // Order used by the round-trip status button on a checklist row.
  const STATUS_CYCLE = ['not_started', 'in_progress', 'submitted', 'done'];

  const ChecklistFormat = {

    /** Normalize a free-form status string to the canonical enum value. */
    parseStatus(str) {
      if (!str) return 'not_started';
      const lower = String(str).toLowerCase().trim();
      if (lower === 'done') return 'done';
      if (lower === 'in progress' || lower === 'in_progress') return 'in_progress';
      if (lower === 'submitted') return 'submitted';
      if (lower === 'incomplete') return 'incomplete';
      if (lower === 'issue') return 'issue';
      if (lower === 'n/a' || lower === 'na') return 'na';
      if (lower === 'not started' || lower === 'not_started') return 'not_started';
      return 'not_started';
    },

    /** Human-readable label for a status enum value. */
    statusLabel(status) {
      return STATUS_LABELS[status] || 'Not Started';
    },

    /** Next status in the click-cycle (skips submitted->done wraparound to start). */
    nextStatus(current) {
      const idx = STATUS_CYCLE.indexOf(current);
      if (idx < 0) return 'not_started';
      return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    },

    /** Today's date as YYYY-MM-DD in local time. */
    todayISO() {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    },

    /** Format a date string or Date as MM/DD/YY h:mm AM/PM (local). */
    fmtDateTime(value) {
      if (!value) return '';
      const d = (value instanceof Date) ? value : new Date(value);
      if (isNaN(d.getTime())) return String(value);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(2);
      let h = d.getHours();
      const min = String(d.getMinutes()).padStart(2, '0');
      const am = h < 12 ? 'AM' : 'PM';
      h = h % 12 || 12;
      return `${mm}/${dd}/${yy} ${h}:${min} ${am}`;
    },

    /** Format a YYYY-MM-DD date string as MM/DD/YY. Passes through other formats. */
    fmtDate(dateStr) {
      if (!dateStr) return '';
      const parts = String(dateStr).slice(0, 10).split('-');
      if (parts.length === 3) {
        const [y, m, d] = parts;
        return `${m}/${d}/${y.slice(2)}`;
      }
      return dateStr;
    },

    /** True when the given YYYY-MM-DD due date is before today. */
    isOverdue(dueDateStr) {
      if (!dueDateStr) return false;
      return String(dueDateStr).slice(0, 10) < ChecklistFormat.todayISO();
    },

    /**
     * Category/Gate filter predicate. An item passes when it matches every
     * active dimension (AND). A null/absent filter dimension matches anything.
     */
    matchesTagFilter(item, filter) {
      if (!filter) return true;
      if (filter.category && (item.category || null) !== filter.category) return false;
      if (filter.gate && (item.gate || null) !== filter.gate) return false;
      return true;
    },
  };

  // Browser global (consumed by checklists.js via mixin)
  if (typeof window !== 'undefined') window.ChecklistFormat = ChecklistFormat;
  // CommonJS export for vitest unit tests (Node has no `window`)
  if (typeof module !== 'undefined' && module.exports) module.exports = ChecklistFormat;
})();
