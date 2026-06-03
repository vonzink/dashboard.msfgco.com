import { describe, it, expect } from 'vitest';
import { canViewScheduleEntry, presentScheduleEntry } from '../../services/schedule/privacy';

function reqFor(user) {
  return { headers: {}, user: { db: user, groups: [] } };
}

describe('presentScheduleEntry', () => {
  const entry = {
    id: 1,
    user_id: 10,
    employee_name: 'Morgan Smith',
    employee_initials: 'MS',
    status: 'meeting_event',
    start_date: '2026-06-01',
    end_date: '2026-06-01',
    start_time: '09:00:00',
    end_time: '10:00:00',
    timezone: 'America/Denver',
    note: 'Private appointment',
    visibility: 'availability_only',
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: 'outlook-1',
    details_shareable: 1,
    provider_sensitivity: 'normal',
  };

  it('hides private imported details from other employees', () => {
    const result = presentScheduleEntry(entry, reqFor({ id: 11, role: 'user' }));
    expect(result.note).toBeNull();
    expect(result.private).toBe(true);
    expect(result.display_label).toBe('Busy');
    expect(result.status).toBe('busy');
    expect(result.details_shareable).toBe(true);
    expect(result.provider_sensitivity).toBe('normal');
  });

  it('blocks hidden entries from other employees entirely', () => {
    expect(canViewScheduleEntry(entry, reqFor({ id: 11, role: 'user' }))).toBe(false);
    expect(canViewScheduleEntry(entry, reqFor({ id: 10, role: 'user' }))).toBe(true);
  });

  it('limits shared entries to selected viewers when an audience is set', () => {
    const sharedEntry = {
      ...entry,
      visibility: 'shared_details',
      viewers: [{ user_id: 12, name: 'Selected Viewer' }],
    };

    expect(canViewScheduleEntry(sharedEntry, reqFor({ id: 11, role: 'user' }))).toBe(false);
    expect(canViewScheduleEntry(sharedEntry, reqFor({ id: 12, role: 'user' }))).toBe(true);
    expect(canViewScheduleEntry({ ...sharedEntry, viewers: [] }, reqFor({ id: 11, role: 'user' }))).toBe(true);
  });

  it('redacts sync diagnostics and attendees when details are hidden', () => {
    const result = presentScheduleEntry(
      {
        ...entry,
        sync_write_status: 'error',
        sync_write_error: 'Provider write failed with private subject',
        sync_write_attempted_at: '2026-06-01T16:30:00.000Z',
        attendees: [{ email: 'client@example.com', name: 'Client Person' }],
      },
      reqFor({ id: 11, role: 'user' })
    );

    expect(result.sync_write_status).toBe('error');
    expect(result.sync_write_error).toBeNull();
    expect(result.sync_write_attempted_at).toBeNull();
    expect(result.attendees).toEqual([]);
  });

  it('shows details to the owner', () => {
    const result = presentScheduleEntry(entry, reqFor({ id: 10, role: 'user' }));
    expect(result.note).toBe('Private appointment');
    expect(result.private).toBe(false);
    expect(result.status).toBe('meeting_event');
  });

  it('shows sync diagnostics and attendees to viewers with details access', () => {
    const result = presentScheduleEntry(
      {
        ...entry,
        sync_write_status: 'error',
        sync_write_error: 'Provider write failed',
        sync_write_attempted_at: '2026-06-01T16:30:00.000Z',
        attendees: [{ email: 'client@example.com', name: 'Client Person' }],
      },
      reqFor({ id: 10, role: 'user' })
    );

    expect(result.sync_write_error).toBe('Provider write failed');
    expect(result.sync_write_attempted_at).toBe('2026-06-01T16:30:00.000Z');
    expect(result.attendees).toEqual([{ email: 'client@example.com', name: 'Client Person' }]);
  });

  it('shows shared details to everyone', () => {
    const result = presentScheduleEntry(
      { ...entry, visibility: 'shared_details', note: 'Client visit' },
      reqFor({ id: 11, role: 'user' })
    );
    expect(result.note).toBe('Client visit');
    expect(result.private).toBe(false);
    expect(result.status).toBe('meeting_event');
  });

  it('keeps hidden manual entries private from admins and managers', () => {
    const manualEntry = { ...entry, source: 'manual', note: 'Leadership meeting' };

    const adminResult = presentScheduleEntry(manualEntry, reqFor({ id: 11, role: 'admin' }));
    const managerResult = presentScheduleEntry(manualEntry, reqFor({ id: 12, role: 'manager' }));

    expect(adminResult.note).toBeNull();
    expect(adminResult.private).toBe(true);
    expect(adminResult.status).toBe('busy');
    expect(managerResult.note).toBeNull();
    expect(managerResult.private).toBe(true);
    expect(managerResult.status).toBe('busy');
  });

  it('keeps imported availability-only details private from admins and managers', () => {
    const adminResult = presentScheduleEntry(entry, reqFor({ id: 11, role: 'admin' }));
    const managerResult = presentScheduleEntry(entry, reqFor({ id: 12, role: 'manager' }));

    expect(adminResult.note).toBeNull();
    expect(adminResult.private).toBe(true);
    expect(adminResult.status).toBe('busy');
    expect(managerResult.note).toBeNull();
    expect(managerResult.private).toBe(true);
    expect(managerResult.status).toBe('busy');
  });
});
