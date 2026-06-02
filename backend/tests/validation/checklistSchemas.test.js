import { describe, it, expect } from 'vitest';
import { loanChecklistItemUpdate, loanChecklistSubitemUpdate } from '../../validation/schemas';

// Contract tests for the checklist item/subitem update payloads. Bug 1
// ("changes not autosaving") hinged on this contract drifting from what the
// frontend sends, so these lock it down.

describe('loanChecklistItemUpdate schema', () => {
  it('accepts a category tag', () => {
    expect(loanChecklistItemUpdate.safeParse({ category: 'income' }).success).toBe(true);
  });

  it('accepts a gate tag', () => {
    expect(loanChecklistItemUpdate.safeParse({ gate: 'ptd' }).success).toBe(true);
  });

  it('accepts null category/gate (clearing a tag)', () => {
    expect(loanChecklistItemUpdate.safeParse({ category: null }).success).toBe(true);
    expect(loanChecklistItemUpdate.safeParse({ gate: null }).success).toBe(true);
  });

  it('accepts every category value', () => {
    for (const c of ['assets', 'income', 'reo', 'credit', 'title']) {
      expect(loanChecklistItemUpdate.safeParse({ category: c }).success).toBe(true);
    }
  });

  it('accepts every gate value', () => {
    for (const g of ['ptd', 'ptc', 'ptf', 'ctc']) {
      expect(loanChecklistItemUpdate.safeParse({ gate: g }).success).toBe(true);
    }
  });

  it('rejects an unknown category / gate', () => {
    expect(loanChecklistItemUpdate.safeParse({ category: 'bogus' }).success).toBe(false);
    expect(loanChecklistItemUpdate.safeParse({ gate: 'xyz' }).success).toBe(false);
  });

  // ── Guard the exact contract Bug 1 depended on ──
  it('accepts assigned_to: null (unassign)', () => {
    expect(loanChecklistItemUpdate.safeParse({ assigned_to: null }).success).toBe(true);
  });

  it('accepts the expanded status values', () => {
    for (const s of ['not_started', 'in_progress', 'submitted', 'done', 'incomplete', 'issue', 'na']) {
      expect(loanChecklistItemUpdate.safeParse({ status: s }).success).toBe(true);
    }
  });

  it('accepts a YYYY-MM-DD date but rejects an ISO timestamp', () => {
    expect(loanChecklistItemUpdate.safeParse({ date: '2026-06-01' }).success).toBe(true);
    expect(loanChecklistItemUpdate.safeParse({ date: '2026-06-01T00:00:00Z' }).success).toBe(false);
  });

  it('rejects an empty update (no recognized fields → backend returns 400)', () => {
    expect(loanChecklistItemUpdate.safeParse({}).success).toBe(false);
    expect(loanChecklistItemUpdate.safeParse({ bogus: 1 }).success).toBe(false);
  });
});

describe('loanChecklistSubitemUpdate schema', () => {
  it('accepts name / status / date / sort_order', () => {
    expect(loanChecklistSubitemUpdate.safeParse({ status: 'done' }).success).toBe(true);
    expect(loanChecklistSubitemUpdate.safeParse({ name: 'Pay stub' }).success).toBe(true);
    expect(loanChecklistSubitemUpdate.safeParse({ date: '2026-06-01' }).success).toBe(true);
  });

  it('does not carry item-only fields (importance / category / gate)', () => {
    // Unknown keys are stripped → object becomes empty → refine rejects.
    expect(loanChecklistSubitemUpdate.safeParse({ importance: 'urgent' }).success).toBe(false);
    expect(loanChecklistSubitemUpdate.safeParse({ category: 'income' }).success).toBe(false);
  });

  it('rejects an empty update', () => {
    expect(loanChecklistSubitemUpdate.safeParse({}).success).toBe(false);
  });
});
