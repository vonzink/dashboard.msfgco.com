import { describe, it, expect } from 'vitest';
import { presentScheduleEntry } from '../../services/schedule/privacy';

function reqFor(user) {
  return { headers: {}, user: { db: user, groups: [] } };
}

describe('presentScheduleEntry', () => {
  const entry = {
    id: 1,
    user_id: 10,
    employee_name: 'Morgan Smith',
    employee_initials: 'MS',
    status: 'busy',
    start_date: '2026-06-01',
    end_date: '2026-06-01',
    start_time: '09:00:00',
    end_time: '10:00:00',
    timezone: 'America/Denver',
    note: 'Private appointment',
    visibility: 'availability_only',
    source: 'outlook',
  };

  it('hides private imported details from other employees', () => {
    const result = presentScheduleEntry(entry, reqFor({ id: 11, role: 'user' }));
    expect(result.note).toBeNull();
    expect(result.private).toBe(true);
    expect(result.display_label).toBe('Busy');
  });

  it('shows details to the owner', () => {
    const result = presentScheduleEntry(entry, reqFor({ id: 10, role: 'user' }));
    expect(result.note).toBe('Private appointment');
    expect(result.private).toBe(false);
  });

  it('shows shared details to everyone', () => {
    const result = presentScheduleEntry(
      { ...entry, visibility: 'shared_details', note: 'Client visit' },
      reqFor({ id: 11, role: 'user' })
    );
    expect(result.note).toBe('Client visit');
    expect(result.private).toBe(false);
  });
});
