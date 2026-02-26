import { describe, it, expect } from 'vitest';
import { isTerminalStatus, isDeleteStatus, isFundedStatus } from '../../services/loanLifecycle';

describe('isTerminalStatus', () => {
  it('returns true for "funded"', () => {
    expect(isTerminalStatus('funded')).toBe(true);
    expect(isTerminalStatus('Funded')).toBe(true);
    expect(isTerminalStatus(' FUNDED ')).toBe(true);
  });

  it('returns true for delete statuses', () => {
    expect(isTerminalStatus('withdrawn')).toBe(true);
    expect(isTerminalStatus('incomplete')).toBe(true);
    expect(isTerminalStatus('denied')).toBe(true);
    expect(isTerminalStatus('not accepted')).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalStatus('active')).toBe(false);
    expect(isTerminalStatus('in progress')).toBe(false);
    expect(isTerminalStatus('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTerminalStatus(null)).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});

describe('isFundedStatus', () => {
  it('returns true only for "funded"', () => {
    expect(isFundedStatus('funded')).toBe(true);
    expect(isFundedStatus('Funded')).toBe(true);
  });

  it('returns false for delete statuses', () => {
    expect(isFundedStatus('withdrawn')).toBe(false);
    expect(isFundedStatus('denied')).toBe(false);
  });
});

describe('isDeleteStatus', () => {
  it('returns true for delete-worthy statuses', () => {
    expect(isDeleteStatus('withdrawn')).toBe(true);
    expect(isDeleteStatus('incomplete')).toBe(true);
    expect(isDeleteStatus('denied')).toBe(true);
    expect(isDeleteStatus('not accepted')).toBe(true);
  });

  it('returns false for funded', () => {
    expect(isDeleteStatus('funded')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDeleteStatus(null)).toBe(false);
  });
});
