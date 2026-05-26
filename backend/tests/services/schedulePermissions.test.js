import { describe, it, expect } from 'vitest';
import { canManageScheduleEntry } from '../../services/schedule/permissions';

function reqFor(user) {
  return {
    headers: {},
    user: {
      db: user,
      groups: user.groups || [],
    },
  };
}

describe('canManageScheduleEntry', () => {
  it('allows users to manage their own entries', () => {
    expect(canManageScheduleEntry(reqFor({ id: 7, role: 'user' }), 7)).toBe(true);
  });

  it('allows managers to manage anyone', () => {
    expect(canManageScheduleEntry(reqFor({ id: 7, role: 'manager' }), 12)).toBe(true);
  });

  it('allows admins to manage anyone', () => {
    expect(canManageScheduleEntry(reqFor({ id: 7, role: 'admin' }), 12)).toBe(true);
  });

  it('blocks users from managing another employee entry', () => {
    expect(canManageScheduleEntry(reqFor({ id: 7, role: 'user' }), 12)).toBe(false);
  });
});
