import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const routePath = require.resolve('../../routes/schedule');
const originalDbCacheEntry = require.cache[dbPath];

const db = {
  query: vi.fn(),
};

const userContext = {
  employee: { id: 10, role: 'employee', name: 'Employee User' },
  manager: { id: 20, role: 'manager', name: 'Manager User' },
};

describe('schedule routes', () => {
  let app;

  beforeEach(async () => {
    db.query.mockReset();

    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: db,
    };
    delete require.cache[routePath];

    const scheduleRoutes = require('../../routes/schedule');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const mode = req.headers['x-test-user'] || 'employee';
      req.user = {
        db: userContext[mode],
        groups: [userContext[mode].role],
      };
      next();
    });
    app.use('/api/schedule', scheduleRoutes);
    app.use((err, _req, res, _next) => {
      res.status(500).json({ error: err.message });
    });
  });

  afterEach(() => {
    delete require.cache[routePath];

    if (originalDbCacheEntry) {
      require.cache[dbPath] = originalDbCacheEntry;
    } else {
      delete require.cache[dbPath];
    }
  });

  it('returns presented schedule entries for a date range', async () => {
    db.query.mockResolvedValueOnce([
      [
        {
          id: 1,
          user_id: 10,
          employee_name: 'Employee User',
          employee_initials: 'EU',
          employee_role: 'employee',
          employee_nmls_number: '123456',
          status: 'remote',
          start_date: '2026-06-01',
          end_date: '2026-06-01',
          start_time: '09:00:00',
          end_time: '17:00:00',
          timezone: 'America/Denver',
          note: 'Working from home',
          visibility: 'shared_details',
          source: 'manual',
          created_by: 10,
          updated_by: 10,
        },
      ],
    ]);

    const res = await makeRequest(app, '/api/schedule/entries?start_date=2026-06-01&end_date=2026-06-30');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      expect.objectContaining({
        id: 1,
        user_id: 10,
        employee_name: 'Employee User',
        employee_nmls_number: '123456',
        status: 'remote',
        display_label: 'Remote',
        note: 'Working from home',
        private: false,
      }),
    ]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('se.end_date >= ?'),
      ['2026-06-01', '2026-06-30']
    );
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('p.nmls_number AS employee_nmls_number');
    expect(sql).toContain('LEFT JOIN user_profiles p ON p.user_id = u.id');
  });

  it('returns employee NMLS, event color, sync warning, and attendees with schedule entries', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 77,
          user_id: 10,
          employee_name: 'Employee User',
          employee_initials: 'EU',
          employee_role: 'employee',
          employee_nmls_number: '451924',
          status: 'meeting_event',
          start_date: '2026-06-10',
          end_date: '2026-06-10',
          start_time: '09:00:00',
          end_time: '10:00:00',
          timezone: 'America/Denver',
          note: 'Client meeting',
          visibility: 'shared_details',
          source: 'manual',
          event_color: '#0F766E',
          sync_write_status: 'error',
          sync_write_error: 'Outlook Graph request failed',
        },
      ]])
      .mockResolvedValueOnce([[
        {
          schedule_entry_id: 77,
          user_id: 11,
          email: 'assistant@msfg.us',
          name: 'Assistant User',
          response_status: null,
        },
      ]]);

    const res = await makeRequest(app, '/api/schedule/entries?start_date=2026-06-01&end_date=2026-06-30');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)[0]).toEqual(expect.objectContaining({
      employee_nmls_number: '451924',
      event_color: '#0F766E',
      sync_write_status: 'error',
      sync_write_error: 'Outlook Graph request failed',
      attendees: [
        {
          user_id: 11,
          email: 'assistant@msfg.us',
          name: 'Assistant User',
          response_status: null,
        },
      ],
    }));
  });

  it('returns presented availability entries with count for a date range', async () => {
    db.query.mockResolvedValueOnce([
      [
        {
          id: 2,
          user_id: 99,
          employee_name: 'Private User',
          employee_initials: 'PU',
          employee_role: 'employee',
          status: 'out',
          start_date: '2026-06-03',
          end_date: '2026-06-03',
          start_time: null,
          end_time: null,
          timezone: 'America/Denver',
          note: 'Private appointment',
          visibility: 'availability_only',
          source: 'manual',
          created_by: 99,
          updated_by: 99,
        },
      ],
    ]);

    const res = await makeRequest(app, '/api/schedule/availability?start_date=2026-06-01&end_date=2026-06-30');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      count: 1,
      entries: [
        expect.objectContaining({
          id: 2,
          user_id: 99,
          status: 'busy',
          display_label: 'Busy',
          note: null,
          private: true,
        }),
      ],
    });
  });

  it('returns provider source markers without exposing private provider details', async () => {
    db.query.mockResolvedValueOnce([
      [
        {
          id: 3,
          user_id: 99,
          employee_name: 'Private User',
          employee_initials: 'PU',
          employee_role: 'employee',
          status: 'out',
          start_date: '2026-06-03',
          end_date: '2026-06-03',
          start_time: null,
          end_time: null,
          timezone: 'America/Denver',
          note: 'Doctor',
          visibility: 'availability_only',
          source: 'outlook',
          source_provider: 'outlook',
          source_event_id: 'event-1',
          created_by: null,
          updated_by: null,
        },
      ],
    ]);

    const res = await makeRequest(app, '/api/schedule/availability?start_date=2026-06-01&end_date=2026-06-30');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).entries[0]).toEqual(expect.objectContaining({
      status: 'busy',
      note: null,
      private: true,
      source: 'outlook',
      source_provider: 'outlook',
      provider_owned: true,
    }));
    expect(JSON.parse(res.body).entries[0]).not.toHaveProperty('source_event_id');
  });

  it('requires start_date and end_date for schedule entries list', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await makeRequest(app, '/api/schedule/entries');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'start_date and end_date are required',
      field: undefined,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('requires start_date and end_date for availability list', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await makeRequest(app, '/api/schedule/availability');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'start_date and end_date are required',
      field: undefined,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects inverted schedule entries list date ranges', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await makeRequest(app, '/api/schedule/entries?start_date=2026-07-01&end_date=2026-06-01');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'end_date must be on or after start_date',
      field: 'end_date',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects schedule entries list date ranges longer than 370 days', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await makeRequest(app, '/api/schedule/entries?start_date=2026-01-01&end_date=2027-12-31');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'date range must not exceed 370 days',
      field: 'end_date',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects inverted availability date ranges', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await makeRequest(app, '/api/schedule/availability?start_date=2026-07-01&end_date=2026-06-01');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'end_date must be on or after start_date',
      field: 'end_date',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('lets a user create their own manual entry and returns the inserted id', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 123 }]);

    const res = await makeJsonRequest(app, '/api/schedule/entries', {
      user_id: 10,
      status: 'out',
      start_date: '2026-06-10',
      end_date: '2026-06-12',
      start_time: null,
      end_time: null,
      timezone: 'America/Denver',
      note: 'PTO',
      visibility: 'shared_details',
      source: 'manual',
    });

    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ id: 123 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schedule_entries'),
      expect.arrayContaining([10, 'out', '2026-06-10', '2026-06-12', 10, 10])
    );
  });

  it('persists event_color when creating a manual entry', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 125 }]);

    const res = await makeJsonRequest(app, '/api/schedule/entries', {
      user_id: 10,
      status: 'meeting_event',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      start_time: '09:00:00',
      end_time: '10:00:00',
      timezone: 'America/Denver',
      visibility: 'shared_details',
      source: 'manual',
      event_color: '#0F766E',
    });

    expect(res.status).toBe(201);
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('event_color');
    expect(values).toContain('#0F766E');
  });

  it('rejects attendee invites on create until writeback is supported', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/entries', {
      user_id: 10,
      status: 'meeting_event',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      source: 'manual',
      attendees: [{ email: 'client@example.com', name: 'Client Person' }],
    });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Attendee invites are not supported by this endpoint yet.',
      field: 'attendees',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects invite update notifications on create until writeback is supported', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/entries', {
      user_id: 10,
      status: 'meeting_event',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      source: 'manual',
      send_updates: true,
    });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Sending calendar invite updates is not supported by this endpoint yet.',
      field: 'send_updates',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('forces public schedule creates to remain manual entries', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 124 }]);

    const res = await makeJsonRequest(app, '/api/schedule/entries', {
      user_id: 10,
      status: 'busy',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      source: 'outlook',
      source_provider: 'outlook',
      source_event_id: 'forged-event',
    });

    expect(res.status).toBe(201);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schedule_entries'),
      expect.arrayContaining(['manual', null, null, 10, 10])
    );
  });

  it('ignores provider ownership fields on public schedule updates', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 5,
          user_id: 10,
          status: 'remote',
          start_date: '2026-06-10',
          end_date: '2026-06-10',
          start_time: null,
          end_time: null,
          timezone: 'America/Denver',
          note: 'Old note',
          visibility: 'shared_details',
          source: 'manual',
          source_provider: null,
          source_event_id: null,
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      source: 'outlook',
      source_provider: 'outlook',
      source_event_id: 'forged-event',
      note: 'Still manual',
    }, {}, 'PUT');

    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE schedule_entries'),
      expect.arrayContaining(['Still manual', 'manual', null, null])
    );
  });

  it('persists event_color when updating a manual entry', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 5,
          user_id: 10,
          status: 'remote',
          start_date: '2026-06-10',
          end_date: '2026-06-10',
          start_time: null,
          end_time: null,
          timezone: 'America/Denver',
          note: 'Old note',
          visibility: 'shared_details',
          source: 'manual',
          source_provider: null,
          source_event_id: null,
          event_color: '#475569',
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      event_color: '#0F766E',
    }, {}, 'PUT');

    expect(res.status).toBe(200);
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toContain('event_color = ?');
    expect(values).toContain('#0F766E');
  });

  it('rejects attendee invites on update until writeback is supported', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      attendees: [{ email: 'client@example.com', name: 'Client Person' }],
    }, {}, 'PUT');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Attendee invites are not supported by this endpoint yet.',
      field: 'attendees',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects invite update notifications on update until writeback is supported', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      send_updates: true,
    }, {}, 'PUT');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Sending calendar invite updates is not supported by this endpoint yet.',
      field: 'send_updates',
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('blocks a normal user creating an entry for another user', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/entries', {
      user_id: 99,
      status: 'out',
      start_date: '2026-06-10',
      end_date: '2026-06-12',
      source: 'manual',
    });

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access denied' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('lets a manager create an entry for another user', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 456 }]);

    const res = await makeJsonRequest(
      app,
      '/api/schedule/entries',
      {
        user_id: 99,
        status: 'traveling',
        start_date: '2026-06-15',
        end_date: '2026-06-15',
        source: 'manual',
      },
      { 'x-test-user': 'manager' }
    );

    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ id: 456 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schedule_entries'),
      expect.arrayContaining([99, 'traveling', '2026-06-15', '2026-06-15', 20, 20])
    );
  });

  it('blocks a normal user updating another user schedule entry', async () => {
    db.query.mockResolvedValueOnce([[{ id: 5, user_id: 99, status: 'out' }]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      status: 'remote',
    }, {}, 'PUT');

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access denied' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('blocks a normal user reassigning their own entry to another user', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 5,
        user_id: 10,
        status: 'out',
        start_date: '2026-06-10',
        end_date: '2026-06-12',
        start_time: null,
        end_time: null,
        timezone: 'America/Denver',
        note: 'PTO',
        visibility: 'shared_details',
        source: 'manual',
        source_provider: null,
        source_event_id: null,
      },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      user_id: 99,
    }, {}, 'PUT');

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Access denied' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejects empty partial updates without running an update', async () => {
    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {}, {}, 'PUT');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'At least one field is required',
      field: undefined,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects partial updates that would make merged start_date after end_date', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 5,
        user_id: 10,
        status: 'out',
        start_date: '2026-06-10',
        end_date: '2026-06-12',
        start_time: null,
        end_time: null,
        timezone: 'America/Denver',
        note: 'PTO',
        visibility: 'shared_details',
        source: 'manual',
        source_provider: null,
        source_event_id: null,
      },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      start_date: '2026-06-20',
    }, {}, 'PUT');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'end_date must be on or after start_date',
      field: 'end_date',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejects partial updates that would make merged same-day end_time before start_time', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 5,
        user_id: 10,
        status: 'meeting_event',
        start_date: '2026-06-10',
        end_date: '2026-06-10',
        start_time: '13:00:00',
        end_time: '17:00:00',
        timezone: 'America/Denver',
        note: 'Planning',
        visibility: 'shared_details',
        source: 'manual',
        source_provider: null,
        source_event_id: null,
      },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      end_time: '12:00:00',
    }, {}, 'PUT');

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: 'end_time must be after start_time',
      field: 'end_time',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('allows partial updates when persisted date columns are Date objects', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 5,
          user_id: 10,
          status: 'remote',
          start_date: new Date('2026-06-10T00:00:00.000Z'),
          end_date: new Date('2026-06-12T00:00:00.000Z'),
          start_time: null,
          end_time: null,
          timezone: 'America/Denver',
          note: 'Old note',
          visibility: 'shared_details',
          source: 'manual',
          source_provider: null,
          source_event_id: null,
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/5', {
      note: 'Updated note',
    }, {}, 'PUT');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE schedule_entries'),
      expect.arrayContaining(['2026-06-10', '2026-06-12', 'Updated note'])
    );
  });

  it('blocks updates to provider-owned schedule entries', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 10,
        status: 'busy',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'event-1',
      },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/9', { note: 'Change' }, {}, 'PUT');

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'This schedule entry is managed in Outlook.',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('blocks deletes of provider-owned schedule entries', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 10,
        status: 'busy',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'event-1',
      },
    ]]);

    const res = await makeRequest(app, '/api/schedule/entries/9', { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'This schedule entry is managed in Outlook.',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('lets the owner share details for a shareable provider-owned entry', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 9,
          user_id: 10,
          employee_name: 'Employee User',
          employee_initials: 'EU',
          employee_role: 'employee',
          status: 'busy',
          start_date: '2026-06-01',
          end_date: '2026-06-01',
          start_time: '09:00:00',
          end_time: '10:00:00',
          timezone: 'America/Denver',
          note: 'Client review',
          visibility: 'availability_only',
          source: 'outlook',
          source_provider: 'outlook',
          source_event_id: 'event-1',
          details_shareable: 1,
          provider_sensitivity: 'normal',
        },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[
        {
          id: 9,
          user_id: 10,
          employee_name: 'Employee User',
          employee_initials: 'EU',
          employee_role: 'employee',
          status: 'busy',
          start_date: '2026-06-01',
          end_date: '2026-06-01',
          start_time: '09:00:00',
          end_time: '10:00:00',
          timezone: 'America/Denver',
          note: 'Client review',
          visibility: 'shared_details',
          source: 'outlook',
          source_provider: 'outlook',
          source_event_id: 'event-1',
          details_shareable: 1,
          provider_sensitivity: 'normal',
        },
      ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/9/visibility', {
      visibility: 'shared_details',
    }, {}, 'PATCH');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      entry: expect.objectContaining({
        id: 9,
        note: 'Client review',
        visibility: 'shared_details',
        details_shareable: true,
        provider_owned: true,
        private: false,
      }),
    });
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SET visibility = ?'),
      ['shared_details', 10, '9']
    );
    expect(db.query.mock.calls[0][0]).toContain('LEFT JOIN user_profiles p ON p.user_id = u.id');
    expect(db.query.mock.calls[2][0]).toContain('LEFT JOIN user_profiles p ON p.user_id = u.id');
  });

  it('blocks non-owners from changing provider event sharing', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 99,
        status: 'busy',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'event-1',
        details_shareable: 1,
        provider_sensitivity: 'normal',
      },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/9/visibility', {
      visibility: 'shared_details',
    }, {}, 'PATCH');

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: "Only the connected calendar owner can change this event's sharing.",
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('blocks sharing provider-private event details', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 10,
        status: 'busy',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'event-1',
        details_shareable: 0,
        provider_sensitivity: 'private',
      },
    ]]);

    const res = await makeJsonRequest(app, '/api/schedule/entries/9/visibility', {
      visibility: 'shared_details',
    }, {}, 'PATCH');

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual({
      error: 'This Outlook event is private and cannot be shared.',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('lets a manager delete another user schedule entry', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 5, user_id: 99, status: 'out' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await makeRequest(app, '/api/schedule/entries/5', {
      method: 'DELETE',
      headers: { 'x-test-user': 'manager' },
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(db.query).toHaveBeenLastCalledWith(
      'DELETE FROM schedule_entries WHERE id = ?',
      ['5']
    );
  });
});

function makeJsonRequest(app, path, body, headers = {}, method = 'POST') {
  return makeRequest(app, path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeRequest(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`, options)
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          resolve({ status: 500, body: err.message });
        });
    });
  });
}
