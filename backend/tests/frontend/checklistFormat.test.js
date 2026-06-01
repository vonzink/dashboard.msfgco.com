// Locks in the behavior of js/checklists/format.js — the pure format
// helpers extracted from the old monolith checklists.js (audit §2.3).
//
// Why this lives in backend/tests/: vitest is already configured here and
// no separate test infra is needed. The frontend file is dual-exported
// (window global in browsers, module.exports in Node) specifically for
// this test path. If we later add Playwright for full UI smoke, those
// tests get their own directory.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// format.js uses CommonJS module.exports (so it can also attach to
// window in browsers). Bridge it into ESM via createRequire.
const require = createRequire(import.meta.url);
const ChecklistFormat = require('../../../js/checklists/format');

describe('ChecklistFormat.parseStatus', () => {
  it('returns canonical enum values for known inputs', () => {
    expect(ChecklistFormat.parseStatus('Done')).toBe('done');
    expect(ChecklistFormat.parseStatus('done')).toBe('done');
    expect(ChecklistFormat.parseStatus('In Progress')).toBe('in_progress');
    expect(ChecklistFormat.parseStatus('in_progress')).toBe('in_progress');
    expect(ChecklistFormat.parseStatus('Submitted')).toBe('submitted');
    expect(ChecklistFormat.parseStatus('Incomplete')).toBe('incomplete');
    expect(ChecklistFormat.parseStatus('Issue')).toBe('issue');
    expect(ChecklistFormat.parseStatus('N/A')).toBe('na');
    expect(ChecklistFormat.parseStatus('na')).toBe('na');
    expect(ChecklistFormat.parseStatus('Not Started')).toBe('not_started');
    expect(ChecklistFormat.parseStatus('not_started')).toBe('not_started');
  });
  it('handles surrounding whitespace and case', () => {
    expect(ChecklistFormat.parseStatus('  DONE  ')).toBe('done');
    expect(ChecklistFormat.parseStatus('  in PROGRESS ')).toBe('in_progress');
  });
  it('defaults to not_started for empty/unknown/null', () => {
    expect(ChecklistFormat.parseStatus('')).toBe('not_started');
    expect(ChecklistFormat.parseStatus(null)).toBe('not_started');
    expect(ChecklistFormat.parseStatus(undefined)).toBe('not_started');
    expect(ChecklistFormat.parseStatus('garbage value')).toBe('not_started');
  });
});

describe('ChecklistFormat.statusLabel', () => {
  it('returns human-readable label for each enum value', () => {
    expect(ChecklistFormat.statusLabel('not_started')).toBe('Not Started');
    expect(ChecklistFormat.statusLabel('in_progress')).toBe('In Progress');
    expect(ChecklistFormat.statusLabel('submitted')).toBe('Submitted');
    expect(ChecklistFormat.statusLabel('done')).toBe('Done');
    expect(ChecklistFormat.statusLabel('incomplete')).toBe('Incomplete');
    expect(ChecklistFormat.statusLabel('issue')).toBe('Issue');
    expect(ChecklistFormat.statusLabel('na')).toBe('N/A');
  });
  it('defaults to "Not Started" for unknown', () => {
    expect(ChecklistFormat.statusLabel('xyz')).toBe('Not Started');
    expect(ChecklistFormat.statusLabel(null)).toBe('Not Started');
  });
});

describe('ChecklistFormat.nextStatus', () => {
  it('cycles not_started -> in_progress -> submitted -> done -> not_started', () => {
    expect(ChecklistFormat.nextStatus('not_started')).toBe('in_progress');
    expect(ChecklistFormat.nextStatus('in_progress')).toBe('submitted');
    expect(ChecklistFormat.nextStatus('submitted')).toBe('done');
    expect(ChecklistFormat.nextStatus('done')).toBe('not_started');
  });
  it('resets to not_started for non-cycle statuses', () => {
    expect(ChecklistFormat.nextStatus('issue')).toBe('not_started');
    expect(ChecklistFormat.nextStatus('na')).toBe('not_started');
    expect(ChecklistFormat.nextStatus('incomplete')).toBe('not_started');
    expect(ChecklistFormat.nextStatus(undefined)).toBe('not_started');
  });
});

describe('ChecklistFormat.todayISO', () => {
  it('returns YYYY-MM-DD format', () => {
    const today = ChecklistFormat.todayISO();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('matches current local date', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(ChecklistFormat.todayISO()).toBe(expected);
  });
});

describe('ChecklistFormat.fmtDate', () => {
  it('formats YYYY-MM-DD as MM/DD/YY', () => {
    expect(ChecklistFormat.fmtDate('2026-05-22')).toBe('05/22/26');
    expect(ChecklistFormat.fmtDate('2024-01-09')).toBe('01/09/24');
  });
  it('extracts date portion from ISO timestamps', () => {
    expect(ChecklistFormat.fmtDate('2026-05-22T14:30:00.000Z')).toBe('05/22/26');
  });
  it('returns empty string for null/empty', () => {
    expect(ChecklistFormat.fmtDate('')).toBe('');
    expect(ChecklistFormat.fmtDate(null)).toBe('');
    expect(ChecklistFormat.fmtDate(undefined)).toBe('');
  });
  it('passes through values with the wrong shape', () => {
    // Single-component strings have no "-" to split, so the function passes
    // them through unchanged.
    expect(ChecklistFormat.fmtDate('garbage')).toBe('garbage');
    // 4-part strings hit the >3 branch and pass through.
    expect(ChecklistFormat.fmtDate('a-b-c-d')).toBe('a-b-c-d');
  });
});

describe('ChecklistFormat.fmtDateTime', () => {
  it('formats Date as MM/DD/YY h:mm AM/PM', () => {
    const d = new Date(2026, 4, 22, 14, 30); // May 22, 2026 14:30 local
    expect(ChecklistFormat.fmtDateTime(d)).toBe('05/22/26 2:30 PM');
  });
  it('formats AM correctly', () => {
    const d = new Date(2026, 0, 9, 7, 5); // Jan 9, 2026 07:05 local
    expect(ChecklistFormat.fmtDateTime(d)).toBe('01/09/26 7:05 AM');
  });
  it('handles 12 AM and 12 PM boundary', () => {
    const midnight = new Date(2026, 0, 1, 0, 0);
    expect(ChecklistFormat.fmtDateTime(midnight)).toBe('01/01/26 12:00 AM');
    const noon = new Date(2026, 0, 1, 12, 0);
    expect(ChecklistFormat.fmtDateTime(noon)).toBe('01/01/26 12:00 PM');
  });
  it('returns empty string for falsy', () => {
    expect(ChecklistFormat.fmtDateTime(null)).toBe('');
    expect(ChecklistFormat.fmtDateTime('')).toBe('');
  });
  it('passes through invalid date strings', () => {
    expect(ChecklistFormat.fmtDateTime('garbage')).toBe('garbage');
  });
});

describe('ChecklistFormat.isOverdue', () => {
  it('returns true for past dates', () => {
    expect(ChecklistFormat.isOverdue('2020-01-01')).toBe(true);
  });
  it('returns false for today', () => {
    expect(ChecklistFormat.isOverdue(ChecklistFormat.todayISO())).toBe(false);
  });
  it('returns false for future dates', () => {
    expect(ChecklistFormat.isOverdue('2999-12-31')).toBe(false);
  });
  it('returns false for null/empty', () => {
    expect(ChecklistFormat.isOverdue(null)).toBe(false);
    expect(ChecklistFormat.isOverdue('')).toBe(false);
    expect(ChecklistFormat.isOverdue(undefined)).toBe(false);
  });
  it('handles ISO timestamps by using date portion only', () => {
    expect(ChecklistFormat.isOverdue('2020-01-01T23:59:59.999Z')).toBe(true);
  });
});
