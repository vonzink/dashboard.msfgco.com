# Company Calendar Availability Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic Company Calendar with a shared employee availability board and add optional Outlook-first, Google-secondary two-way sync with private-by-default imported busy blocks.

**Architecture:** Phase 1 builds the shared manual availability board on a schedule-specific MySQL model and Express route set. Phase 2 adds sync tables, provider adapters, OAuth connection routes, sync jobs, and user-facing sync controls without changing the Phase 1 board contract.

**Tech Stack:** Static dashboard HTML/CSS/JavaScript, Express, MySQL, Zod, Vitest, AWS S3/CloudFront deploy script, EC2/PM2 backend deploy.

---

## Scope And Sequencing

This is a two-subsystem overhaul. Build it in two releasable phases:

1. **Manual shared availability board:** schedule tables, route permissions, roster UI, day/person detail, manual create/edit/delete.
2. **Optional calendar sync:** Outlook and Google connections, private imported busy blocks, dashboard-to-provider export, provider-to-dashboard import, sync status UI.

Do not start Phase 2 until Phase 1 is deployed and verified. The Phase 1 data model includes the source/visibility fields Phase 2 needs, so sync will attach cleanly.

## File Structure

### Backend

- Modify `backend/DATABASE_SCHEMA.sql`: add canonical schedule and sync table definitions.
- Create `backend/db/migrations/078_schedule_entries.sql`: create `schedule_entries`.
- Create `backend/db/migrations/079_calendar_sync.sql`: create sync connection, mapping, and run tables.
- Modify `backend/validation/schemas.js`: add `scheduleEntry`, `scheduleEntryUpdate`, `scheduleEntryQuery`, `calendarSyncConnectionStart`, and `calendarSyncRun`.
- Create `backend/services/schedule/permissions.js`: ownership and admin/manager edit rules.
- Create `backend/services/schedule/privacy.js`: shared response shaping for private imported busy blocks.
- Create `backend/routes/schedule.js`: schedule CRUD and availability endpoints.
- Modify `backend/server.js`: mount `/api/schedule` for authenticated users.
- Create `backend/services/calendarSync/tokenCrypto.js`: encrypt/decrypt provider tokens.
- Create `backend/services/calendarSync/providers/outlook.js`: Microsoft Graph adapter.
- Create `backend/services/calendarSync/providers/google.js`: Google Calendar adapter.
- Create `backend/services/calendarSync/syncEngine.js`: import/export orchestration and conflict rules.
- Create `backend/routes/scheduleSync.js`: provider connection and sync status endpoints.
- Create tests under `backend/tests/validation/`, `backend/tests/services/`, and `backend/tests/routes/`.

### Frontend

- Replace `Calculators/Company Calendar/calendar.html`: static shell, auth gate, and modular scripts.
- Replace `Calculators/Company Calendar/styles.css`: MSFG availability-board design tokens and layouts.
- Create `Calculators/Company Calendar/calendar-api.js`: API wrapper and auth token handling.
- Create `Calculators/Company Calendar/calendar-state.js`: normalized client state and date helpers.
- Create `Calculators/Company Calendar/calendar-render.js`: shared DOM rendering utilities.
- Create `Calculators/Company Calendar/calendar-roster.js`: month roster board, search, filters, drag selection.
- Create `Calculators/Company Calendar/calendar-detail.js`: day and person detail panel.
- Create `Calculators/Company Calendar/calendar-editor.js`: add/edit/delete schedule entry panel.
- Create `Calculators/Company Calendar/calendar-sync.js`: sync status and provider connection UI.
- Create `Calculators/Company Calendar/calendar-main.js`: bootstraps modules.

### Verification

- Use `cd backend && npm test -- ...` for backend validation, service, and route tests.
- Use a local static server from the repo root for browser checks: `python3 -m http.server 8765`.
- Use the existing dashboard deploy path only after implementation and tests pass: `./deploy.sh --backend`.

---

## Phase 1: Manual Shared Availability Board

### Task 1: Schedule Schema And Validation

**Files:**
- Create: `backend/db/migrations/078_schedule_entries.sql`
- Modify: `backend/DATABASE_SCHEMA.sql`
- Modify: `backend/validation/schemas.js`
- Modify: `backend/tests/validation/schemas-extended.test.js`

- [ ] **Step 1: Write failing validation tests**

Add `scheduleEntry` and `scheduleEntryUpdate` to the import list in `backend/tests/validation/schemas-extended.test.js`, then add this block after the existing calendar-event tests:

```js
describe('scheduleEntry schema', () => {
  const valid = {
    user_id: 7,
    status: 'out',
    start_date: '2026-06-01',
    end_date: '2026-06-03',
    start_time: null,
    end_time: null,
    timezone: 'America/Denver',
    note: 'Conference',
    visibility: 'shared_details',
    source: 'manual',
  };

  it('accepts a valid manual availability entry', () => {
    const result = scheduleEntry.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('out');
    expect(result.data.visibility).toBe('shared_details');
  });

  it('defaults imported event visibility to availability only', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      source: 'outlook',
      visibility: undefined,
      status: 'busy',
    });
    expect(result.success).toBe(true);
    expect(result.data.visibility).toBe('availability_only');
  });

  it('rejects PTO as a status', () => {
    expect(scheduleEntry.safeParse({ ...valid, status: 'pto' }).success).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      start_date: '2026-06-03',
      end_date: '2026-06-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an end time before the start time on the same date', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: '15:00',
      end_time: '09:00',
    });
    expect(result.success).toBe(false);
  });
});

describe('scheduleEntryUpdate schema', () => {
  it('accepts partial updates', () => {
    expect(scheduleEntryUpdate.safeParse({ status: 'remote' }).success).toBe(true);
  });

  it('rejects unknown update fields', () => {
    expect(scheduleEntryUpdate.safeParse({ paid_hours: 8 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused validation test and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/validation/schemas-extended.test.js
```

Expected: FAIL because `scheduleEntry` and `scheduleEntryUpdate` are not exported.

- [ ] **Step 3: Add schedule schemas**

In `backend/validation/schemas.js`, add this block after the existing calendar event schemas:

```js
const timeString = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM or HH:MM:SS format');

const scheduleStatuses = ['out', 'remote', 'traveling', 'meeting_event', 'other', 'busy'];
const scheduleSources = ['manual', 'outlook', 'google'];
const scheduleVisibility = ['availability_only', 'shared_details'];

const scheduleEntryBase = z.object({
  user_id: z.coerce.number().int().positive(),
  status: z.enum(scheduleStatuses),
  start_date: dateString,
  end_date: dateString,
  start_time: timeString.optional().nullable(),
  end_time: timeString.optional().nullable(),
  timezone: optionalString(80).default('America/Denver'),
  note: optionalString(1000),
  visibility: z.enum(scheduleVisibility).optional().default('availability_only'),
  source: z.enum(scheduleSources).optional().default('manual'),
  source_provider: z.enum(['outlook', 'google']).optional().nullable(),
  source_event_id: optionalString(255),
});

const scheduleEntry = scheduleEntryBase.strict().superRefine((data, ctx) => {
  if (data.end_date < data.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_date'],
      message: 'end_date must be on or after start_date',
    });
  }

  if (
    data.start_date === data.end_date &&
    data.start_time &&
    data.end_time &&
    data.end_time < data.start_time
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'end_time must be after start_time',
    });
  }
});

const scheduleEntryUpdate = scheduleEntryBase.partial().strict().superRefine((data, ctx) => {
  if (data.end_date && data.start_date && data.end_date < data.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_date'],
      message: 'end_date must be on or after start_date',
    });
  }

  if (
    data.start_date &&
    data.end_date &&
    data.start_date === data.end_date &&
    data.start_time &&
    data.end_time &&
    data.end_time < data.start_time
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_time'],
      message: 'end_time must be after start_time',
    });
  }
});

const scheduleEntryQuery = z.object({
  start_date: dateString.optional(),
  end_date: dateString.optional(),
  user_id: z.coerce.number().int().positive().optional(),
  status: z.enum(scheduleStatuses).optional(),
  source: z.enum(scheduleSources).optional(),
}).strict();
```

Add these exports in `module.exports`:

```js
  scheduleEntry,
  scheduleEntryUpdate,
  scheduleEntryQuery,
```

- [ ] **Step 4: Create the schedule migration**

Create `backend/db/migrations/078_schedule_entries.sql` with:

```sql
CREATE TABLE IF NOT EXISTS schedule_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    status ENUM('out','remote','traveling','meeting_event','other','busy') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    timezone VARCHAR(80) DEFAULT 'America/Denver',
    note TEXT NULL,
    visibility ENUM('availability_only','shared_details') DEFAULT 'availability_only',
    source ENUM('manual','outlook','google') DEFAULT 'manual',
    source_provider ENUM('outlook','google') NULL,
    source_event_id VARCHAR(255) NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_schedule_user_dates (user_id, start_date, end_date),
    INDEX idx_schedule_dates (start_date, end_date),
    INDEX idx_schedule_status (status),
    UNIQUE KEY uq_schedule_source_event (source_provider, source_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 5: Add the same table to `DATABASE_SCHEMA.sql`**

Append the same `CREATE TABLE IF NOT EXISTS schedule_entries` statement after the existing `calendar_events` table. Keep this table definition identical to the migration so fresh databases and migrated databases match.

- [ ] **Step 6: Run validation tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/validation/schemas-extended.test.js
```

Expected: PASS for the new schedule schema tests.

- [ ] **Step 7: Commit**

```bash
git add backend/db/migrations/078_schedule_entries.sql backend/DATABASE_SCHEMA.sql backend/validation/schemas.js backend/tests/validation/schemas-extended.test.js
git commit -m "feat: add schedule entry schema"
```

### Task 2: Schedule Permissions And Privacy Helpers

**Files:**
- Create: `backend/services/schedule/permissions.js`
- Create: `backend/services/schedule/privacy.js`
- Create: `backend/tests/services/schedulePermissions.test.js`
- Create: `backend/tests/services/schedulePrivacy.test.js`

- [ ] **Step 1: Write permissions tests**

Create `backend/tests/services/schedulePermissions.test.js`:

```js
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
```

- [ ] **Step 2: Write privacy tests**

Create `backend/tests/services/schedulePrivacy.test.js`:

```js
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
```

- [ ] **Step 3: Run the service tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/services/schedulePermissions.test.js tests/services/schedulePrivacy.test.js
```

Expected: FAIL because the service files do not exist.

- [ ] **Step 4: Implement permission helper**

Create `backend/services/schedule/permissions.js`:

```js
const { getUserId, hasRole } = require('../../middleware/userContext');

function canManageScheduleEntry(req, entryUserId) {
  if (hasRole(req, 'admin', 'manager')) return true;
  const currentUserId = getUserId(req);
  return Boolean(currentUserId && Number(currentUserId) === Number(entryUserId));
}

module.exports = {
  canManageScheduleEntry,
};
```

- [ ] **Step 5: Implement privacy presenter**

Create `backend/services/schedule/privacy.js`:

```js
const { getUserId, hasRole } = require('../../middleware/userContext');

const STATUS_LABELS = {
  out: 'Out',
  remote: 'Remote',
  traveling: 'Traveling',
  meeting_event: 'Meeting/Event',
  other: 'Unavailable',
  busy: 'Busy',
};

function canSeeDetails(entry, req) {
  if (entry.visibility === 'shared_details') return true;
  if (Number(entry.user_id) === Number(getUserId(req))) return true;
  return hasRole(req, 'admin', 'manager') && entry.source === 'manual';
}

function presentScheduleEntry(entry, req) {
  const visible = canSeeDetails(entry, req);
  return {
    id: entry.id,
    user_id: entry.user_id,
    employee_name: entry.employee_name || null,
    employee_initials: entry.employee_initials || null,
    employee_role: entry.employee_role || null,
    status: entry.status,
    display_label: visible ? (STATUS_LABELS[entry.status] || 'Unavailable') : 'Busy',
    start_date: entry.start_date,
    end_date: entry.end_date,
    start_time: entry.start_time,
    end_time: entry.end_time,
    timezone: entry.timezone || 'America/Denver',
    note: visible ? (entry.note || null) : null,
    visibility: entry.visibility,
    source: entry.source,
    private: !visible,
    created_by: entry.created_by || null,
    updated_by: entry.updated_by || null,
  };
}

module.exports = {
  canSeeDetails,
  presentScheduleEntry,
};
```

- [ ] **Step 6: Run service tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/services/schedulePermissions.test.js tests/services/schedulePrivacy.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/schedule/permissions.js backend/services/schedule/privacy.js backend/tests/services/schedulePermissions.test.js backend/tests/services/schedulePrivacy.test.js
git commit -m "feat: add schedule permission helpers"
```

### Task 3: Schedule CRUD And Availability Routes

**Files:**
- Create: `backend/routes/schedule.js`
- Create: `backend/tests/routes/schedule.test.js`
- Modify: `backend/server.js`

- [ ] **Step 1: Write route tests**

Create `backend/tests/routes/schedule.test.js` with a mocked database and standalone Express app:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

vi.mock('../../db/connection', () => ({
  default: undefined,
  query: vi.fn(),
}));

const db = await import('../../db/connection');
const scheduleRoutes = (await import('../../routes/schedule')).default || (await import('../../routes/schedule'));

function makeApp(user = { id: 7, role: 'user' }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { db: user, groups: user.groups || [] };
    next();
  });
  app.use('/api/schedule', scheduleRoutes);
  return app;
}

async function request(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
      }).then(async (res) => {
        const body = await res.text();
        server.close();
        resolve({ status: res.status, body: body ? JSON.parse(body) : null });
      });
    });
  });
}

describe('schedule routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists presented schedule entries', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 1,
        user_id: 7,
        employee_name: 'Zachary Zink',
        employee_initials: 'ZZ',
        status: 'out',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        start_time: null,
        end_time: null,
        timezone: 'America/Denver',
        note: 'Conference',
        visibility: 'shared_details',
        source: 'manual',
      },
    ]]);

    const res = await request(makeApp(), '/api/schedule/entries?start_date=2026-06-01&end_date=2026-06-30');
    expect(res.status).toBe(200);
    expect(res.body[0].note).toBe('Conference');
  });

  it('creates an own manual entry', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 44 }]);
    const res = await request(makeApp(), '/api/schedule/entries', {
      method: 'POST',
      body: {
        user_id: 7,
        status: 'remote',
        start_date: '2026-06-02',
        end_date: '2026-06-02',
        timezone: 'America/Denver',
        source: 'manual',
        visibility: 'shared_details',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(44);
  });

  it('blocks creating an entry for another user', async () => {
    const res = await request(makeApp({ id: 7, role: 'user' }), '/api/schedule/entries', {
      method: 'POST',
      body: {
        user_id: 9,
        status: 'out',
        start_date: '2026-06-02',
        end_date: '2026-06-02',
      },
    });
    expect(res.status).toBe(403);
  });

  it('lets managers create an entry for another user', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 45 }]);
    const res = await request(makeApp({ id: 7, role: 'manager' }), '/api/schedule/entries', {
      method: 'POST',
      body: {
        user_id: 9,
        status: 'traveling',
        start_date: '2026-06-02',
        end_date: '2026-06-03',
      },
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run route test and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/routes/schedule.test.js
```

Expected: FAIL because `backend/routes/schedule.js` does not exist.

- [ ] **Step 3: Implement schedule route**

Create `backend/routes/schedule.js`:

```js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const { scheduleEntry, scheduleEntryUpdate, scheduleEntryQuery, validate, validateQuery } = require('../validation/schemas');
const { canManageScheduleEntry } = require('../services/schedule/permissions');
const { presentScheduleEntry } = require('../services/schedule/privacy');

router.use(requireDbUser);

const SELECT_FIELDS = `
  se.*,
  u.name AS employee_name,
  u.initials AS employee_initials,
  u.role AS employee_role
`;

function buildListQuery(query) {
  const where = [];
  const params = [];

  if (query.start_date) {
    where.push('se.end_date >= ?');
    params.push(query.start_date);
  }
  if (query.end_date) {
    where.push('se.start_date <= ?');
    params.push(query.end_date);
  }
  if (query.user_id) {
    where.push('se.user_id = ?');
    params.push(query.user_id);
  }
  if (query.status) {
    where.push('se.status = ?');
    params.push(query.status);
  }
  if (query.source) {
    where.push('se.source = ?');
    params.push(query.source);
  }

  return {
    sql: `
      SELECT ${SELECT_FIELDS}
      FROM schedule_entries se
      JOIN users u ON u.id = se.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY se.start_date ASC, se.start_time ASC, u.name ASC
    `,
    params,
  };
}

router.get('/entries', validateQuery(scheduleEntryQuery), async (req, res, next) => {
  try {
    const { sql, params } = buildListQuery(req.query);
    const [rows] = await db.query(sql, params);
    res.json(rows.map(row => presentScheduleEntry(row, req)));
  } catch (error) {
    next(error);
  }
});

router.get('/availability', validateQuery(scheduleEntryQuery), async (req, res, next) => {
  try {
    const { sql, params } = buildListQuery(req.query);
    const [rows] = await db.query(sql, params);
    res.json({
      entries: rows.map(row => presentScheduleEntry(row, req)),
      count: rows.length,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/entries', validate(scheduleEntry), async (req, res, next) => {
  try {
    const payload = req.body;
    if (!canManageScheduleEntry(req, payload.user_id)) {
      return res.status(403).json({ error: 'You can only manage your own schedule entries.' });
    }

    const [result] = await db.query(
      `INSERT INTO schedule_entries
       (user_id, status, start_date, end_date, start_time, end_time, timezone, note, visibility, source, source_provider, source_event_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.user_id,
        payload.status,
        payload.start_date,
        payload.end_date,
        payload.start_time || null,
        payload.end_time || null,
        payload.timezone || 'America/Denver',
        payload.note || null,
        payload.visibility || 'availability_only',
        payload.source || 'manual',
        payload.source_provider || null,
        payload.source_event_id || null,
        getUserId(req),
        getUserId(req),
      ]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    next(error);
  }
});

router.put('/entries/:id', validate(scheduleEntryUpdate), async (req, res, next) => {
  try {
    const [[entry]] = await db.query('SELECT * FROM schedule_entries WHERE id=?', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Schedule entry not found' });
    if (!canManageScheduleEntry(req, entry.user_id)) {
      return res.status(403).json({ error: 'You can only manage your own schedule entries.' });
    }

    const nextEntry = { ...entry, ...req.body };
    await db.query(
      `UPDATE schedule_entries
       SET user_id=?, status=?, start_date=?, end_date=?, start_time=?, end_time=?, timezone=?, note=?, visibility=?, updated_by=?
       WHERE id=?`,
      [
        nextEntry.user_id,
        nextEntry.status,
        nextEntry.start_date,
        nextEntry.end_date,
        nextEntry.start_time || null,
        nextEntry.end_time || null,
        nextEntry.timezone || 'America/Denver',
        nextEntry.note || null,
        nextEntry.visibility || 'availability_only',
        getUserId(req),
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/entries/:id', async (req, res, next) => {
  try {
    const [[entry]] = await db.query('SELECT * FROM schedule_entries WHERE id=?', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Schedule entry not found' });
    if (!canManageScheduleEntry(req, entry.user_id)) {
      return res.status(403).json({ error: 'You can only manage your own schedule entries.' });
    }

    await db.query('DELETE FROM schedule_entries WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount schedule routes**

In `backend/server.js`, add the import beside `calendarEventsRoutes`:

```js
const scheduleRoutes = require('./routes/schedule');
```

Add the route beside `/api/calendar-events` so External users retain calendar access:

```js
app.use('/api/schedule', authenticate, scheduleRoutes);
```

- [ ] **Step 5: Run route tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/routes/schedule.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full backend tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/schedule.js backend/server.js backend/tests/routes/schedule.test.js
git commit -m "feat: add schedule availability API"
```

### Task 4: Calendar Frontend Shell And API Client

**Files:**
- Modify: `Calculators/Company Calendar/calendar.html`
- Create: `Calculators/Company Calendar/calendar-api.js`
- Create: `Calculators/Company Calendar/calendar-state.js`
- Create: `Calculators/Company Calendar/calendar-main.js`

- [ ] **Step 1: Replace the page shell**

Replace `Calculators/Company Calendar/calendar.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <script src="/js/auth-gate.js?v=20260227-1"></script>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MSFG Company Schedule</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@500;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
</head>
<body class="calendar-page">
  <div id="calToast" class="cal-toast" role="status" aria-live="polite"></div>
  <main id="calendarApp" class="schedule-app">
    <section class="schedule-loading" aria-label="Loading schedule">Loading schedule...</section>
  </main>

  <script src="calendar-api.js"></script>
  <script src="calendar-state.js"></script>
  <script src="calendar-render.js"></script>
  <script src="calendar-roster.js"></script>
  <script src="calendar-detail.js"></script>
  <script src="calendar-editor.js"></script>
  <script src="calendar-sync.js"></script>
  <script src="calendar-main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add the API client**

Create `Calculators/Company Calendar/calendar-api.js`:

```js
(function() {
  'use strict';

  const API_BASE = window.location.protocol === 'https:'
    ? 'https://api.msfgco.com/api'
    : 'http://52.203.186.217:8080/api';

  function getAuthToken() {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
    return (
      localStorage.getItem('auth_token') ||
      (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null) ||
      sessionStorage.getItem('auth_token')
    );
  }

  async function request(path, opts = {}) {
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (res.status === 401) throw new Error('Session expired. Please log in again.');
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'You do not have permission to perform this action.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Request failed');
    }
    return res.status === 204 ? null : res.json();
  }

  function toQuery(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') qs.set(key, value);
    });
    return qs.toString() ? `?${qs.toString()}` : '';
  }

  window.CalendarApi = {
    getMe: () => request('/me'),
    getEntries: (params) => request(`/schedule/entries${toQuery(params)}`),
    createEntry: (payload) => request('/schedule/entries', { method: 'POST', body: JSON.stringify(payload) }),
    updateEntry: (id, payload) => request(`/schedule/entries/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deleteEntry: (id) => request(`/schedule/entries/${id}`, { method: 'DELETE' }),
    getSyncStatus: () => request('/schedule/sync/status'),
  };
})();
```

- [ ] **Step 3: Add client state helpers**

Create `Calculators/Company Calendar/calendar-state.js`:

```js
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
    return { start: isoDate(start), end: isoDate(end) };
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
      loading: true,
      error: null,
    };
  }

  window.CalendarState = {
    STATUS_META,
    MONTHS,
    DOW,
    createState,
    daysInMonth,
    isoDate,
    parseDate,
    monthRange,
  };
})();
```

- [ ] **Step 4: Add a bootstrap file**

Create `Calculators/Company Calendar/calendar-main.js`:

```js
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
```

- [ ] **Step 5: Run a local static smoke check**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com
python3 -m http.server 8765
```

Open:

```text
http://127.0.0.1:8765/Calculators/Company%20Calendar/calendar.html
```

Expected: auth gate appears locally if no token is present, and there are no missing script 404s other than files not created in later tasks. If the page reports missing `calendar-render.js`, continue to Task 5 before judging visual output.

- [ ] **Step 6: Commit**

```bash
git add 'Calculators/Company Calendar/calendar.html' 'Calculators/Company Calendar/calendar-api.js' 'Calculators/Company Calendar/calendar-state.js' 'Calculators/Company Calendar/calendar-main.js'
git commit -m "feat: scaffold schedule calendar frontend"
```

### Task 5: Month Roster Rendering, Search, And Filters

**Files:**
- Modify: `Calculators/Company Calendar/styles.css`
- Create: `Calculators/Company Calendar/calendar-render.js`
- Create: `Calculators/Company Calendar/calendar-roster.js`

- [ ] **Step 1: Add MSFG schedule board styles**

Replace `Calculators/Company Calendar/styles.css` with a focused stylesheet. Start with:

```css
:root {
  --bg: #f3f1ea;
  --surface: #ffffff;
  --surface-2: #f5f3ec;
  --line: #d9d6cb;
  --line-soft: #e8e5db;
  --ink: #104547;
  --ink-2: #2f5e4c;
  --ink-dim: #6a7672;
  --accent: #8cc63e;
  --status-out: #4b7b4d;
  --status-remote: #6a9b48;
  --status-traveling: #2f5e4c;
  --status-meeting-event: #b85a2e;
  --status-other: #404041;
  --status-busy: #6a7672;
  --row-h: 38px;
  --name-col: 230px;
  --day-w: minmax(30px, 1fr);
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body.calendar-page {
  background: var(--bg);
  color: var(--ink);
  font-family: 'Source Sans 3', Arial, sans-serif;
}
button, input, select, textarea { font: inherit; }
.schedule-app {
  max-width: 1500px;
  margin: 0 auto;
  padding: 24px 28px 70px;
}
.schedule-header,
.schedule-summary,
.schedule-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}
.schedule-header { margin-bottom: 18px; }
.brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--ink);
  color: white;
  display: grid;
  place-items: center;
  font-family: Raleway, sans-serif;
  font-weight: 800;
}
.brand-title {
  font-family: Raleway, sans-serif;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: .075em;
  text-transform: uppercase;
}
.nav-group,
.view-tabs,
.status-filters {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px;
  display: inline-flex;
  gap: 4px;
}
.nav-btn,
.filter-chip,
.primary-btn {
  border: 0;
  border-radius: 999px;
  padding: 8px 13px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.primary-btn {
  background: var(--accent);
  color: var(--ink);
  font-weight: 700;
}
.summary-card {
  flex: 1;
  min-height: 116px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 18px 20px;
}
.summary-card .label,
.roster-toolbar .label {
  font-size: 10px;
  letter-spacing: .28em;
  text-transform: uppercase;
  color: var(--ink-dim);
}
.summary-number {
  font-family: Raleway, sans-serif;
  font-size: 44px;
  font-weight: 800;
}
.roster-card {
  margin-top: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow: hidden;
}
.roster-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.schedule-search {
  width: 240px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--surface-2);
  padding: 9px 12px;
}
.roster-scroll {
  overflow: auto;
  max-height: min(72vh, 900px);
}
.roster-grid {
  display: grid;
  grid-template-columns: var(--name-col) repeat(var(--days), var(--day-w));
  min-width: calc(var(--name-col) + var(--days) * 30px);
}
.roster-cell,
.day-head,
.person-cell {
  min-height: var(--row-h);
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}
.person-cell,
.corner-cell {
  position: sticky;
  left: 0;
  background: var(--surface);
  z-index: 2;
}
.day-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
  text-align: center;
  padding: 7px 3px;
  font-size: 11px;
  color: var(--ink-dim);
}
.day-head.is-today {
  background: var(--ink);
  color: white;
}
.day-cell.is-weekend,
.day-head.is-weekend {
  background: var(--surface-2);
}
.person-cell {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 10px;
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--ink-2);
  color: white;
  font-size: 11px;
  font-weight: 700;
}
.entry-bar {
  height: 24px;
  margin: 6px 2px;
  border-radius: 6px;
  color: white;
  padding: 4px 7px;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.entry-bar[data-status="out"] { background: var(--status-out); }
.entry-bar[data-status="remote"] { background: var(--status-remote); }
.entry-bar[data-status="traveling"] { background: var(--status-traveling); }
.entry-bar[data-status="meeting_event"] { background: var(--status-meeting-event); }
.entry-bar[data-status="other"] { background: var(--status-other); }
.entry-bar[data-status="busy"] { background: var(--status-busy); }
.cal-toast {
  position: fixed;
  top: 18px;
  right: 18px;
  transform: translateY(-12px);
  opacity: 0;
  pointer-events: none;
  background: var(--ink);
  color: white;
  border-radius: 10px;
  padding: 12px 14px;
  z-index: 10000;
  transition: opacity .16s ease, transform .16s ease;
}
.cal-toast-show {
  opacity: 1;
  transform: translateY(0);
}
@media (max-width: 900px) {
  .schedule-app { padding: 16px; }
  .schedule-summary { flex-direction: column; }
  .summary-card { width: 100%; }
}
```

- [ ] **Step 2: Add shared rendering utilities**

Create `Calculators/Company Calendar/calendar-render.js`:

```js
(function() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function derivePeople(entries) {
    const byId = new Map();
    entries.forEach(entry => {
      if (!byId.has(entry.user_id)) {
        byId.set(entry.user_id, {
          id: entry.user_id,
          name: entry.employee_name || `User ${entry.user_id}`,
          initials: entry.employee_initials || '??',
          role: entry.employee_role || '',
        });
      }
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function entriesForDay(entries, date) {
    const key = CalendarState.isoDate(date);
    return entries.filter(entry => entry.start_date <= key && entry.end_date >= key);
  }

  function renderHeader(state, actions) {
    const monthName = CalendarState.MONTHS[state.viewDate.getMonth()];
    const year = state.viewDate.getFullYear();
    return `
      <header class="schedule-header">
        <div class="brand-mark">MS</div>
        <div>
          <div class="brand-title">Company Schedule</div>
          <div class="label">Availability board</div>
        </div>
        <div style="flex:1"></div>
        <div class="nav-group">
          <button class="nav-btn" data-action="prev-month" aria-label="Previous month">&lt;</button>
          <button class="nav-btn" data-action="today">Today</button>
          <button class="nav-btn" data-action="next-month" aria-label="Next month">&gt;</button>
        </div>
        <div class="brand-title">${escapeHtml(monthName)} <span style="color:var(--ink-dim)">${year}</span></div>
        <button class="primary-btn" data-action="new-entry">Add Schedule</button>
      </header>
    `;
  }

  function renderSummary(state) {
    const todayEntries = entriesForDay(state.entries, state.today);
    const unavailable = todayEntries.filter(entry => ['out', 'traveling', 'meeting_event', 'other', 'busy'].includes(entry.status));
    const remote = todayEntries.filter(entry => entry.status === 'remote');
    const availableCount = Math.max(0, state.people.length - unavailable.length);
    return `
      <section class="schedule-summary" aria-label="Today summary">
        <article class="summary-card">
          <div class="label">Available today</div>
          <div class="summary-number">${availableCount}</div>
          <div>employees with no visible unavailable block</div>
        </article>
        <article class="summary-card">
          <div class="label">Unavailable today</div>
          <div class="summary-number">${unavailable.length}</div>
          <div>${remote.length} remote</div>
        </article>
        <article class="summary-card">
          <div class="label">Upcoming schedule notes</div>
          ${state.entries.slice(0, 4).map(entry => `
            <div>${escapeHtml(entry.start_date)} - ${escapeHtml(entry.display_label || entry.status)}</div>
          `).join('') || '<div>No upcoming entries.</div>'}
        </article>
      </section>
    `;
  }

  function bindShellActions(root, state, actions) {
    root.querySelector('[data-action="prev-month"]')?.addEventListener('click', () => {
      actions.setViewDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1));
    });
    root.querySelector('[data-action="next-month"]')?.addEventListener('click', () => {
      actions.setViewDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1));
    });
    root.querySelector('[data-action="today"]')?.addEventListener('click', () => {
      actions.setViewDate(new Date(state.today.getFullYear(), state.today.getMonth(), 1));
      actions.setSelectedDate(state.today);
    });
  }

  function render(root, state, actions) {
    if (state.loading) {
      root.innerHTML = '<section class="schedule-loading">Loading schedule...</section>';
      return;
    }
    if (state.error) {
      root.innerHTML = `<section class="schedule-loading">${escapeHtml(state.error)}</section>`;
      return;
    }

    root.innerHTML = `
      ${renderHeader(state, actions)}
      ${renderSummary(state)}
      ${CalendarRoster.render(state)}
      ${window.CalendarDetail ? CalendarDetail.render(state) : ''}
      ${window.CalendarEditor ? CalendarEditor.render(state) : ''}
      ${window.CalendarSync ? CalendarSync.render(state) : ''}
    `;

    bindShellActions(root, state, actions);
    CalendarRoster.bind(root, state, actions);
    if (window.CalendarDetail) CalendarDetail.bind(root, state, actions);
    if (window.CalendarEditor) CalendarEditor.bind(root, state, actions);
    if (window.CalendarSync) CalendarSync.bind(root, state, actions);
  }

  window.CalendarRender = {
    escapeHtml,
    derivePeople,
    entriesForDay,
    render,
  };
})();
```

- [ ] **Step 3: Add roster rendering**

Create `Calculators/Company Calendar/calendar-roster.js`:

```js
(function() {
  'use strict';

  function entryLabel(entry) {
    if (entry.private) return entry.display_label || 'Busy';
    return entry.note || entry.display_label || CalendarState.STATUS_META[entry.status]?.label || 'Unavailable';
  }

  function filteredPeople(state) {
    const term = state.search.trim().toLowerCase();
    return state.people.filter(person => {
      if (!term) return true;
      return [person.name, person.role].some(value => String(value || '').toLowerCase().includes(term));
    });
  }

  function entriesForPersonDay(state, personId, day) {
    const date = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), day);
    const key = CalendarState.isoDate(date);
    return state.entries.filter(entry =>
      Number(entry.user_id) === Number(personId) &&
      entry.start_date <= key &&
      entry.end_date >= key &&
      !state.hiddenStatuses.has(entry.status)
    );
  }

  function renderDayHeader(state, day) {
    const date = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), day);
    const isToday = CalendarState.isoDate(date) === CalendarState.isoDate(state.today);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    return `
      <div class="day-head ${isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''}">
        <div>${CalendarState.DOW[date.getDay()]}</div>
        <strong>${day}</strong>
      </div>
    `;
  }

  function renderPersonRow(state, person) {
    const days = CalendarState.daysInMonth(state.viewDate.getFullYear(), state.viewDate.getMonth());
    let html = `
      <div class="person-cell" data-user-id="${person.id}">
        <div class="avatar">${CalendarRender.escapeHtml(person.initials)}</div>
        <div>
          <div>${CalendarRender.escapeHtml(person.name)}</div>
          <small>${CalendarRender.escapeHtml(person.role || '')}</small>
        </div>
      </div>
    `;

    for (let day = 1; day <= days; day += 1) {
      const date = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), day);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const entries = entriesForPersonDay(state, person.id, day);
      html += `
        <div class="roster-cell day-cell ${isWeekend ? 'is-weekend' : ''}" data-user-id="${person.id}" data-day="${day}">
          ${entries.map(entry => `
            <div class="entry-bar" data-entry-id="${entry.id}" data-status="${entry.status}">
              ${CalendarRender.escapeHtml(entryLabel(entry))}
            </div>
          `).join('')}
        </div>
      `;
    }
    return html;
  }

  function render(state) {
    const days = CalendarState.daysInMonth(state.viewDate.getFullYear(), state.viewDate.getMonth());
    const people = filteredPeople(state);
    return `
      <section class="roster-card" aria-label="Monthly availability roster">
        <div class="roster-toolbar">
          <input class="schedule-search" data-role="schedule-search" placeholder="Search employees..." value="${CalendarRender.escapeHtml(state.search)}">
          <div class="status-filters">
            ${Object.entries(CalendarState.STATUS_META).map(([key, meta]) => `
              <button class="filter-chip" data-status-filter="${key}" style="${state.hiddenStatuses.has(key) ? 'opacity:.45' : ''}">
                ${CalendarRender.escapeHtml(meta.label)}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="roster-scroll">
          <div class="roster-grid" style="--days:${days}">
            <div class="day-head corner-cell">${people.length} employees</div>
            ${Array.from({ length: days }, (_, i) => renderDayHeader(state, i + 1)).join('')}
            ${people.map(person => renderPersonRow(state, person)).join('')}
          </div>
        </div>
      </section>
    `;
  }

  function bind(root, state, actions) {
    root.querySelector('[data-role="schedule-search"]')?.addEventListener('input', (event) => {
      actions.setSearch(event.target.value);
    });
    root.querySelectorAll('[data-status-filter]').forEach(button => {
      button.addEventListener('click', () => actions.toggleStatus(button.dataset.statusFilter));
    });
    root.querySelectorAll('.person-cell').forEach(cell => {
      cell.addEventListener('click', () => actions.setSelectedUser(Number(cell.dataset.userId)));
    });
    root.querySelectorAll('.day-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const day = Number(cell.dataset.day);
        actions.setSelectedDate(new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), day));
        actions.setSelectedUser(Number(cell.dataset.userId));
      });
    });
  }

  window.CalendarRoster = { render, bind };
})();
```

- [ ] **Step 4: Browser verify roster rendering**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com
python3 -m http.server 8765
```

Open:

```text
http://127.0.0.1:8765/Calculators/Company%20Calendar/calendar.html
```

Expected with auth: header, summary cards, search/filter toolbar, and roster grid render. Expected without auth: auth gate blocks content before app load.

- [ ] **Step 5: Commit**

```bash
git add 'Calculators/Company Calendar/styles.css' 'Calculators/Company Calendar/calendar-render.js' 'Calculators/Company Calendar/calendar-roster.js'
git commit -m "feat: render schedule roster board"
```

### Task 6: Manual Entry Editor

**Files:**
- Create: `Calculators/Company Calendar/calendar-editor.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/styles.css`

- [ ] **Step 1: Add editor actions to `calendar-main.js`**

Extend the state in `CalendarState.createState()` with:

```js
editor: null,
```

Add these actions to `calendar-main.js`:

```js
openEditor(entry) {
  state.editor = entry || {
    user_id: state.selectedUserId || state.me?.id,
    status: 'out',
    start_date: CalendarState.isoDate(state.selectedDate),
    end_date: CalendarState.isoDate(state.selectedDate),
    start_time: null,
    end_time: null,
    timezone: 'America/Denver',
    visibility: 'shared_details',
    source: 'manual',
    note: '',
  };
  CalendarRender.render(app, state, actions);
},
closeEditor() {
  state.editor = null;
  CalendarRender.render(app, state, actions);
},
async saveEditor(payload) {
  if (payload.id) {
    await CalendarApi.updateEntry(payload.id, payload);
    showToast('Schedule entry updated.', 'success');
  } else {
    await CalendarApi.createEntry(payload);
    showToast('Schedule entry created.', 'success');
  }
  state.editor = null;
  await actions.reload();
},
async deleteEntry(id) {
  await CalendarApi.deleteEntry(id);
  showToast('Schedule entry deleted.', 'success');
  state.editor = null;
  await actions.reload();
},
```

Update the existing `new-entry` binding in `calendar-render.js`:

```js
root.querySelector('[data-action="new-entry"]')?.addEventListener('click', () => actions.openEditor());
root.querySelectorAll('.entry-bar').forEach(bar => {
  bar.addEventListener('click', (event) => {
    event.stopPropagation();
    const entry = state.entries.find(item => String(item.id) === String(bar.dataset.entryId));
    if (entry) actions.openEditor(entry);
  });
});
```

- [ ] **Step 2: Create the editor module**

Create `Calculators/Company Calendar/calendar-editor.js`:

```js
(function() {
  'use strict';

  function render(state) {
    if (!state.editor) return '';
    const entry = state.editor;
    return `
      <div class="editor-backdrop" data-editor-backdrop>
        <form class="schedule-editor" data-role="schedule-editor">
          <div class="editor-head">
            <h2>${entry.id ? 'Edit Schedule' : 'Add Schedule'}</h2>
            <button type="button" class="icon-btn" data-editor-close aria-label="Close">x</button>
          </div>

          <label>Employee ID
            <input name="user_id" type="number" min="1" value="${CalendarRender.escapeHtml(entry.user_id || '')}" required>
          </label>

          <label>Status
            <select name="status" required>
              ${Object.entries(CalendarState.STATUS_META).filter(([key]) => key !== 'busy').map(([key, meta]) => `
                <option value="${key}" ${entry.status === key ? 'selected' : ''}>${CalendarRender.escapeHtml(meta.label)}</option>
              `).join('')}
            </select>
          </label>

          <div class="editor-grid">
            <label>Start Date
              <input name="start_date" type="date" value="${CalendarRender.escapeHtml(entry.start_date || '')}" required>
            </label>
            <label>End Date
              <input name="end_date" type="date" value="${CalendarRender.escapeHtml(entry.end_date || entry.start_date || '')}" required>
            </label>
            <label>Start Time
              <input name="start_time" type="time" value="${CalendarRender.escapeHtml((entry.start_time || '').slice(0, 5))}">
            </label>
            <label>End Time
              <input name="end_time" type="time" value="${CalendarRender.escapeHtml((entry.end_time || '').slice(0, 5))}">
            </label>
          </div>

          <label>Visibility
            <select name="visibility">
              <option value="shared_details" ${entry.visibility === 'shared_details' ? 'selected' : ''}>Share note/details</option>
              <option value="availability_only" ${entry.visibility === 'availability_only' ? 'selected' : ''}>Availability only</option>
            </select>
          </label>

          <label>Note
            <textarea name="note" rows="3" placeholder="Optional schedule note">${CalendarRender.escapeHtml(entry.note || '')}</textarea>
          </label>

          <div class="editor-actions">
            ${entry.id ? '<button type="button" class="danger-btn" data-editor-delete>Delete</button>' : ''}
            <button type="button" data-editor-close>Cancel</button>
            <button type="submit" class="primary-btn">Save</button>
          </div>
        </form>
      </div>
    `;
  }

  function formPayload(form, existing) {
    const data = new FormData(form);
    return {
      ...existing,
      user_id: Number(data.get('user_id')),
      status: data.get('status'),
      start_date: data.get('start_date'),
      end_date: data.get('end_date'),
      start_time: data.get('start_time') || null,
      end_time: data.get('end_time') || null,
      timezone: 'America/Denver',
      note: data.get('note') || '',
      visibility: data.get('visibility'),
      source: existing.source || 'manual',
    };
  }

  function bind(root, state, actions) {
    root.querySelectorAll('[data-editor-close]').forEach(button => {
      button.addEventListener('click', () => actions.closeEditor());
    });

    root.querySelector('[data-editor-delete]')?.addEventListener('click', () => {
      if (state.editor?.id && window.confirm('Delete this schedule entry?')) {
        actions.deleteEntry(state.editor.id).catch(err => actions.showToast(err.message, 'error'));
      }
    });

    root.querySelector('[data-role="schedule-editor"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      actions.saveEditor(formPayload(event.currentTarget, state.editor))
        .catch(err => actions.showToast(err.message, 'error'));
    });
  }

  window.CalendarEditor = { render, bind };
})();
```

- [ ] **Step 3: Add editor styles**

Append to `styles.css`:

```css
.editor-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(16, 69, 71, .18);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 82px 28px 28px;
  z-index: 9000;
}
.schedule-editor {
  width: min(420px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 24px 60px -24px rgba(0,0,0,.36);
  padding: 18px;
}
.editor-head,
.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.schedule-editor label {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
}
.schedule-editor input,
.schedule-editor select,
.schedule-editor textarea {
  width: 100%;
  margin-top: 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 10px;
  background: var(--surface-2);
}
.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.danger-btn {
  border: 1px solid #b85a2e;
  color: #b85a2e;
  background: white;
  border-radius: 999px;
  padding: 8px 13px;
}
```

- [ ] **Step 4: Browser verify manual create/edit/delete**

Use a logged-in dashboard session or a local token-bearing browser session. Open the calendar route and verify:

- Add Schedule opens the editor.
- Saving an own entry calls `POST /api/schedule/entries`.
- Clicking an entry opens edit mode.
- Delete calls `DELETE /api/schedule/entries/:id`.
- A normal user receives a 403 if they try to edit another employee by manually changing Employee ID.

- [ ] **Step 5: Commit**

```bash
git add 'Calculators/Company Calendar/calendar-editor.js' 'Calculators/Company Calendar/calendar-main.js' 'Calculators/Company Calendar/calendar-render.js' 'Calculators/Company Calendar/styles.css'
git commit -m "feat: add schedule entry editor"
```

### Task 7: Day And Person Detail Panel

**Files:**
- Create: `Calculators/Company Calendar/calendar-detail.js`
- Modify: `Calculators/Company Calendar/styles.css`

- [ ] **Step 1: Create detail renderer**

Create `Calculators/Company Calendar/calendar-detail.js`:

```js
(function() {
  'use strict';

  function selectedPerson(state) {
    if (!state.selectedUserId) return null;
    return state.people.find(person => Number(person.id) === Number(state.selectedUserId)) || null;
  }

  function selectedDateEntries(state) {
    const key = CalendarState.isoDate(state.selectedDate);
    return state.entries.filter(entry =>
      entry.start_date <= key &&
      entry.end_date >= key &&
      (!state.selectedUserId || Number(entry.user_id) === Number(state.selectedUserId))
    );
  }

  function timeLabel(entry) {
    if (!entry.start_time && !entry.end_time) return 'All day';
    return `${String(entry.start_time || '').slice(0, 5) || 'Start'} - ${String(entry.end_time || '').slice(0, 5) || 'End'}`;
  }

  function render(state) {
    const person = selectedPerson(state);
    const entries = selectedDateEntries(state);
    const title = person
      ? `${person.name} schedule`
      : `${CalendarState.MONTHS[state.selectedDate.getMonth()]} ${state.selectedDate.getDate()} schedule`;

    return `
      <aside class="detail-panel" aria-label="Schedule detail">
        <div class="detail-head">
          <div>
            <div class="label">Selected</div>
            <h2>${CalendarRender.escapeHtml(title)}</h2>
          </div>
        </div>
        <div class="detail-list">
          ${entries.map(entry => `
            <button class="detail-entry" data-entry-id="${entry.id}">
              <span class="detail-status" data-status="${entry.status}"></span>
              <span>
                <strong>${CalendarRender.escapeHtml(entry.display_label || CalendarState.STATUS_META[entry.status]?.label || 'Unavailable')}</strong>
                <small>${CalendarRender.escapeHtml(timeLabel(entry))}</small>
                ${entry.note ? `<small>${CalendarRender.escapeHtml(entry.note)}</small>` : ''}
              </span>
            </button>
          `).join('') || '<p class="empty-detail">No visible schedule entries for this selection.</p>'}
        </div>
      </aside>
    `;
  }

  function bind(root, state, actions) {
    root.querySelectorAll('.detail-entry').forEach(button => {
      button.addEventListener('click', () => {
        const entry = state.entries.find(item => String(item.id) === String(button.dataset.entryId));
        if (entry) actions.openEditor(entry);
      });
    });
  }

  window.CalendarDetail = { render, bind };
})();
```

- [ ] **Step 2: Add detail styles**

Append to `styles.css`:

```css
.detail-panel {
  margin-top: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 18px;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line-soft);
  padding-bottom: 12px;
  margin-bottom: 12px;
}
.detail-head h2 {
  margin: 4px 0 0;
  font-family: Raleway, sans-serif;
  font-size: 18px;
  color: var(--ink);
}
.detail-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.detail-entry {
  border: 1px solid var(--line-soft);
  background: var(--surface-2);
  border-radius: 10px;
  padding: 10px;
  text-align: left;
  display: flex;
  gap: 10px;
  color: var(--ink);
}
.detail-entry small {
  display: block;
  color: var(--ink-dim);
  margin-top: 2px;
}
.detail-status {
  width: 10px;
  border-radius: 999px;
  background: var(--status-busy);
}
.detail-status[data-status="out"] { background: var(--status-out); }
.detail-status[data-status="remote"] { background: var(--status-remote); }
.detail-status[data-status="traveling"] { background: var(--status-traveling); }
.detail-status[data-status="meeting_event"] { background: var(--status-meeting-event); }
.detail-status[data-status="other"] { background: var(--status-other); }
.empty-detail {
  color: var(--ink-dim);
  margin: 0;
}
```

- [ ] **Step 3: Browser verify detail behavior**

Open the calendar with entries loaded and verify:

- Clicking a person name focuses the detail panel on that person.
- Clicking a day cell changes the selected day.
- Private busy entries show no private note.
- Entries with start/end times show time labels in detail.

- [ ] **Step 4: Commit**

```bash
git add 'Calculators/Company Calendar/calendar-detail.js' 'Calculators/Company Calendar/styles.css'
git commit -m "feat: add schedule detail panel"
```

---

## Phase 2: Outlook And Google Sync

### Task 8: Sync Tables And Validation

**Files:**
- Create: `backend/db/migrations/079_calendar_sync.sql`
- Modify: `backend/DATABASE_SCHEMA.sql`
- Modify: `backend/validation/schemas.js`
- Modify: `backend/tests/validation/schemas-extended.test.js`

- [ ] **Step 1: Add sync validation tests**

Add this block to `backend/tests/validation/schemas-extended.test.js` after schedule entry tests:

```js
describe('calendar sync schemas', () => {
  it('accepts a valid sync connection start request', () => {
    const result = calendarSyncConnectionStart.safeParse({
      provider: 'outlook',
      privacy_default: 'availability_only',
      sync_enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported providers', () => {
    const result = calendarSyncConnectionStart.safeParse({
      provider: 'icloud',
      privacy_default: 'availability_only',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an on-demand sync run request', () => {
    const result = calendarSyncRun.safeParse({ provider: 'google' });
    expect(result.success).toBe(true);
  });
});
```

Update the import list to include:

```js
  calendarSyncConnectionStart, calendarSyncRun,
```

- [ ] **Step 2: Run validation tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/validation/schemas-extended.test.js
```

Expected: FAIL because sync schemas are not exported.

- [ ] **Step 3: Add sync schemas**

In `backend/validation/schemas.js`, add:

```js
const calendarSyncConnectionStart = z.object({
  provider: z.enum(['outlook', 'google']),
  privacy_default: z.enum(['availability_only', 'shared_details']).optional().default('availability_only'),
  sync_enabled: z.boolean().optional().default(true),
}).strict();

const calendarSyncRun = z.object({
  provider: z.enum(['outlook', 'google']).optional(),
}).strict();
```

Export both names in `module.exports`.

- [ ] **Step 4: Create sync migration**

Create `backend/db/migrations/079_calendar_sync.sql`:

```sql
CREATE TABLE IF NOT EXISTS calendar_sync_connections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    provider ENUM('outlook','google') NOT NULL,
    provider_account_email VARCHAR(255) NULL,
    encrypted_access_token TEXT NULL,
    encrypted_refresh_token TEXT NULL,
    scopes TEXT NULL,
    sync_enabled TINYINT DEFAULT 1,
    privacy_default ENUM('availability_only','shared_details') DEFAULT 'availability_only',
    last_sync_at TIMESTAMP NULL,
    sync_status ENUM('not_connected','connected','syncing','error') DEFAULT 'not_connected',
    sync_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_calendar_sync_user_provider (user_id, provider),
    INDEX idx_calendar_sync_status (sync_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_sync_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    schedule_entry_id INT NOT NULL,
    provider ENUM('outlook','google') NOT NULL,
    provider_calendar_id VARCHAR(255) NULL,
    provider_event_id VARCHAR(255) NOT NULL,
    provider_etag VARCHAR(255) NULL,
    provider_change_token VARCHAR(500) NULL,
    last_synced_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_entry_id) REFERENCES schedule_entries(id) ON DELETE CASCADE,
    UNIQUE KEY uq_calendar_sync_mapping (provider, provider_event_id),
    INDEX idx_calendar_sync_entry (schedule_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_sync_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    connection_id INT NOT NULL,
    provider ENUM('outlook','google') NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    status ENUM('running','success','error') DEFAULT 'running',
    entries_imported INT DEFAULT 0,
    entries_exported INT DEFAULT 0,
    error_message TEXT NULL,
    FOREIGN KEY (connection_id) REFERENCES calendar_sync_connections(id) ON DELETE CASCADE,
    INDEX idx_calendar_sync_runs_connection (connection_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 5: Add the same tables to `DATABASE_SCHEMA.sql`**

Append the same three `CREATE TABLE IF NOT EXISTS` statements after `schedule_entries`.

- [ ] **Step 6: Run validation tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/validation/schemas-extended.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/db/migrations/079_calendar_sync.sql backend/DATABASE_SCHEMA.sql backend/validation/schemas.js backend/tests/validation/schemas-extended.test.js
git commit -m "feat: add calendar sync schema"
```

### Task 9: Token Encryption And Provider Adapter Contracts

**Files:**
- Create: `backend/services/calendarSync/tokenCrypto.js`
- Create: `backend/services/calendarSync/providers/outlook.js`
- Create: `backend/services/calendarSync/providers/google.js`
- Create: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Write service tests**

Create `backend/tests/services/calendarSync.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { encryptToken, decryptToken } from '../../services/calendarSync/tokenCrypto';
import { normalizeOutlookEvent } from '../../services/calendarSync/providers/outlook';
import { normalizeGoogleEvent } from '../../services/calendarSync/providers/google';

describe('calendar sync token crypto', () => {
  beforeEach(() => {
    process.env.CALENDAR_SYNC_ENCRYPTION_KEY = Buffer.alloc(32, 'a').toString('base64');
  });

  it('round trips encrypted tokens', () => {
    const encrypted = encryptToken('secret-token');
    expect(encrypted).not.toBe('secret-token');
    expect(decryptToken(encrypted)).toBe('secret-token');
  });
});

describe('provider event normalization', () => {
  it('normalizes Outlook busy events without private details', () => {
    const event = normalizeOutlookEvent({
      id: 'outlook-1',
      subject: 'Private appointment',
      start: { dateTime: '2026-06-01T09:00:00', timeZone: 'Mountain Standard Time' },
      end: { dateTime: '2026-06-01T10:00:00', timeZone: 'Mountain Standard Time' },
      showAs: 'busy',
    }, { user_id: 7, privacy_default: 'availability_only' });

    expect(event.status).toBe('busy');
    expect(event.note).toBeNull();
    expect(event.source).toBe('outlook');
    expect(event.source_event_id).toBe('outlook-1');
  });

  it('normalizes Google busy events without private details', () => {
    const event = normalizeGoogleEvent({
      id: 'google-1',
      summary: 'Private appointment',
      start: { dateTime: '2026-06-01T09:00:00-06:00' },
      end: { dateTime: '2026-06-01T10:00:00-06:00' },
    }, { user_id: 7, privacy_default: 'availability_only' });

    expect(event.status).toBe('busy');
    expect(event.note).toBeNull();
    expect(event.source).toBe('google');
    expect(event.source_event_id).toBe('google-1');
  });
});
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/services/calendarSync.test.js
```

Expected: FAIL because sync service files do not exist.

- [ ] **Step 3: Add token encryption**

Create `backend/services/calendarSync/tokenCrypto.js`:

```js
const crypto = require('crypto');

function getKey() {
  const raw = process.env.CALENDAR_SYNC_ENCRYPTION_KEY;
  if (!raw) throw new Error('CALENDAR_SYNC_ENCRYPTION_KEY is required');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CALENDAR_SYNC_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

function encryptToken(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptToken(value) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = {
  encryptToken,
  decryptToken,
};
```

- [ ] **Step 4: Add Outlook normalizer**

Create `backend/services/calendarSync/providers/outlook.js`:

```js
function dateParts(value) {
  const date = new Date(value);
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 19),
  };
}

function normalizeOutlookEvent(event, connection) {
  const start = dateParts(event.start.dateTime);
  const end = dateParts(event.end.dateTime);
  const shared = connection.privacy_default === 'shared_details';
  return {
    user_id: connection.user_id,
    status: 'busy',
    start_date: start.date,
    end_date: end.date,
    start_time: start.time,
    end_time: end.time,
    timezone: 'America/Denver',
    note: shared ? (event.subject || null) : null,
    visibility: connection.privacy_default || 'availability_only',
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: event.id,
  };
}

module.exports = {
  normalizeOutlookEvent,
};
```

- [ ] **Step 5: Add Google normalizer**

Create `backend/services/calendarSync/providers/google.js`:

```js
function dateParts(value) {
  const date = new Date(value);
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 19),
  };
}

function normalizeGoogleEvent(event, connection) {
  const startValue = event.start.dateTime || `${event.start.date}T00:00:00Z`;
  const endValue = event.end.dateTime || `${event.end.date}T00:00:00Z`;
  const start = dateParts(startValue);
  const end = dateParts(endValue);
  const shared = connection.privacy_default === 'shared_details';
  return {
    user_id: connection.user_id,
    status: 'busy',
    start_date: start.date,
    end_date: end.date,
    start_time: event.start.dateTime ? start.time : null,
    end_time: event.end.dateTime ? end.time : null,
    timezone: 'America/Denver',
    note: shared ? (event.summary || null) : null,
    visibility: connection.privacy_default || 'availability_only',
    source: 'google',
    source_provider: 'google',
    source_event_id: event.id,
  };
}

module.exports = {
  normalizeGoogleEvent,
};
```

- [ ] **Step 6: Run service tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/services/calendarSync.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/calendarSync backend/tests/services/calendarSync.test.js
git commit -m "feat: add calendar sync adapter foundation"
```

### Task 10: Sync Engine And Routes

**Files:**
- Create: `backend/services/calendarSync/syncEngine.js`
- Create: `backend/routes/scheduleSync.js`
- Modify: `backend/server.js`
- Create: `backend/tests/routes/scheduleSync.test.js`

- [ ] **Step 1: Write sync route tests**

Create `backend/tests/routes/scheduleSync.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

vi.mock('../../db/connection', () => ({
  default: undefined,
  query: vi.fn(),
}));

vi.mock('../../services/calendarSync/syncEngine', () => ({
  runSyncForConnection: vi.fn().mockResolvedValue({ imported: 2, exported: 1 }),
}));

const db = await import('../../db/connection');
const syncRoutes = (await import('../../routes/scheduleSync')).default || (await import('../../routes/scheduleSync'));

function makeApp(user = { id: 7, role: 'user' }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { db: user, groups: [] };
    next();
  });
  app.use('/api/schedule/sync', syncRoutes);
  return app;
}

async function request(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
      }).then(async (res) => {
        const body = await res.text();
        server.close();
        resolve({ status: res.status, body: body ? JSON.parse(body) : null });
      });
    });
  });
}

describe('schedule sync routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns current user sync status', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, provider: 'outlook', sync_enabled: 1, sync_status: 'connected', last_sync_at: null, sync_error: null },
    ]]);

    const res = await request(makeApp(), '/api/schedule/sync/status');
    expect(res.status).toBe(200);
    expect(res.body.connections[0].provider).toBe('outlook');
  });

  it('starts a connection record for Outlook', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(makeApp(), '/api/schedule/sync/connections/outlook/start', {
      method: 'POST',
      body: { provider: 'outlook', privacy_default: 'availability_only', sync_enabled: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('outlook');
  });
});
```

- [ ] **Step 2: Run sync route tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/routes/scheduleSync.test.js
```

Expected: FAIL because `routes/scheduleSync.js` does not exist.

- [ ] **Step 3: Add sync engine**

Create `backend/services/calendarSync/syncEngine.js`:

```js
const db = require('../../db/connection');

async function upsertImportedEntry(entry) {
  await db.query(
    `INSERT INTO schedule_entries
     (user_id, status, start_date, end_date, start_time, end_time, timezone, note, visibility, source, source_provider, source_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status=VALUES(status),
       start_date=VALUES(start_date),
       end_date=VALUES(end_date),
       start_time=VALUES(start_time),
       end_time=VALUES(end_time),
       timezone=VALUES(timezone),
       note=VALUES(note),
       visibility=VALUES(visibility),
       updated_at=CURRENT_TIMESTAMP`,
    [
      entry.user_id,
      entry.status,
      entry.start_date,
      entry.end_date,
      entry.start_time,
      entry.end_time,
      entry.timezone,
      entry.note,
      entry.visibility,
      entry.source,
      entry.source_provider,
      entry.source_event_id,
    ]
  );
}

async function runSyncForConnection(connection, adapter) {
  const importedEvents = await adapter.listEvents(connection);
  let imported = 0;

  for (const entry of importedEvents) {
    await upsertImportedEntry(entry);
    imported += 1;
  }

  return { imported, exported: 0 };
}

module.exports = {
  runSyncForConnection,
  upsertImportedEntry,
};
```

- [ ] **Step 4: Add sync routes**

Create `backend/routes/scheduleSync.js`:

```js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const { calendarSyncConnectionStart, calendarSyncRun, validate, validateQuery } = require('../validation/schemas');
const { runSyncForConnection } = require('../services/calendarSync/syncEngine');

router.use(requireDbUser);

router.get('/status', async (req, res, next) => {
  try {
    const [connections] = await db.query(
      `SELECT id, provider, provider_account_email, sync_enabled, privacy_default, last_sync_at, sync_status, sync_error
       FROM calendar_sync_connections
       WHERE user_id=?
       ORDER BY provider ASC`,
      [getUserId(req)]
    );
    res.json({ connections });
  } catch (error) {
    next(error);
  }
});

router.post('/connections/:provider/start', validate(calendarSyncConnectionStart), async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (provider !== req.body.provider) {
      return res.status(400).json({ error: 'Provider mismatch' });
    }

    await db.query(
      `INSERT INTO calendar_sync_connections (user_id, provider, sync_enabled, privacy_default, sync_status)
       VALUES (?, ?, ?, ?, 'not_connected')
       ON DUPLICATE KEY UPDATE sync_enabled=VALUES(sync_enabled), privacy_default=VALUES(privacy_default), updated_at=CURRENT_TIMESTAMP`,
      [getUserId(req), provider, req.body.sync_enabled ? 1 : 0, req.body.privacy_default]
    );

    res.json({
      provider,
      status: 'not_connected',
      authorization_url: null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/run', validate(calendarSyncRun), async (req, res, next) => {
  try {
    const params = [getUserId(req)];
    let where = 'user_id=? AND sync_enabled=1';
    if (req.body.provider) {
      where += ' AND provider=?';
      params.push(req.body.provider);
    }

    const [connections] = await db.query(`SELECT * FROM calendar_sync_connections WHERE ${where}`, params);
    const results = [];
    for (const connection of connections) {
      const result = await runSyncForConnection(connection, { listEvents: async () => [] });
      results.push({ provider: connection.provider, ...result });
    }
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

- [ ] **Step 5: Mount sync routes**

In `backend/server.js`, add:

```js
const scheduleSyncRoutes = require('./routes/scheduleSync');
```

Mount after `/api/schedule`:

```js
app.use('/api/schedule/sync', authenticate, scheduleSyncRoutes);
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test -- tests/routes/scheduleSync.test.js tests/services/calendarSync.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/calendarSync/syncEngine.js backend/routes/scheduleSync.js backend/server.js backend/tests/routes/scheduleSync.test.js
git commit -m "feat: add calendar sync routes"
```

### Task 11: Sync Status UI

**Files:**
- Create: `Calculators/Company Calendar/calendar-sync.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/styles.css`

- [ ] **Step 1: Add sync state loading**

In `CalendarState.createState()`, add:

```js
syncConnections: [],
```

In `calendar-main.js`, add this function:

```js
async function loadSyncStatus() {
  try {
    const status = await CalendarApi.getSyncStatus();
    state.syncConnections = status.connections || [];
  } catch (err) {
    state.syncConnections = [];
  }
}
```

Call it after `await loadEntries();` in `boot()`:

```js
await loadSyncStatus();
```

- [ ] **Step 2: Create sync UI module**

Create `Calculators/Company Calendar/calendar-sync.js`:

```js
(function() {
  'use strict';

  function providerStatus(state, provider) {
    return state.syncConnections.find(connection => connection.provider === provider) || null;
  }

  function renderProvider(state, provider, label) {
    const connection = providerStatus(state, provider);
    const status = connection?.sync_status || 'not_connected';
    const enabled = connection?.sync_enabled ? 'Enabled' : 'Not enabled';
    return `
      <div class="sync-provider">
        <div>
          <strong>${CalendarRender.escapeHtml(label)}</strong>
          <small>${CalendarRender.escapeHtml(status)} - ${CalendarRender.escapeHtml(enabled)}</small>
        </div>
        <button class="nav-btn" data-sync-provider="${provider}">
          ${connection ? 'Manage' : 'Connect'}
        </button>
      </div>
    `;
  }

  function render(state) {
    return `
      <section class="sync-panel" aria-label="Calendar sync">
        <div class="label">Optional sync</div>
        ${renderProvider(state, 'outlook', 'Outlook')}
        ${renderProvider(state, 'google', 'Google')}
      </section>
    `;
  }

  function bind(root, state, actions) {
    root.querySelectorAll('[data-sync-provider]').forEach(button => {
      button.addEventListener('click', () => {
        actions.showToast(`${button.dataset.syncProvider} connection setup will open here.`, 'info');
      });
    });
  }

  window.CalendarSync = { render, bind };
})();
```

- [ ] **Step 3: Add sync styles**

Append to `styles.css`:

```css
.sync-panel {
  margin-top: 18px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 18px;
  display: grid;
  gap: 10px;
}
.sync-provider {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--surface-2);
  padding: 10px 12px;
}
.sync-provider small {
  display: block;
  color: var(--ink-dim);
}
```

- [ ] **Step 4: Browser verify sync panel**

Open the calendar route and verify:

- Optional sync panel renders below detail panel.
- Outlook and Google statuses display.
- Connect/Manage buttons show a toast.
- A failed `/api/schedule/sync/status` response does not block the board.

- [ ] **Step 5: Commit**

```bash
git add 'Calculators/Company Calendar/calendar-sync.js' 'Calculators/Company Calendar/calendar-main.js' 'Calculators/Company Calendar/styles.css'
git commit -m "feat: add calendar sync status UI"
```

### Task 12: Final Verification And Deployment

**Files:**
- Modify only files from earlier tasks if verification exposes defects.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm test
```

Expected: PASS.

- [ ] **Step 2: Run backend lint if available**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/backend
npm run lint
```

Expected: PASS, or report exact lint failures and fix them before deploy.

- [ ] **Step 3: Verify local frontend route**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com
python3 -m http.server 8765
```

Open:

```text
http://127.0.0.1:8765/Calculators/Company%20Calendar/calendar.html
```

Expected:

- Page loads behind auth gate locally.
- No 404s for calendar JS/CSS files.
- Search and status filters work with test data.
- Manual add/edit/delete works against the backend when authenticated.
- Private imported busy blocks show no private note.

- [ ] **Step 4: Commit any verification fixes**

If Step 1, Step 2, or Step 3 required fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize schedule calendar verification"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 5: Deploy frontend and backend**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com
./deploy.sh --backend
```

Expected:

- Frontend sync to S3 completes.
- CloudFront invalidation is created.
- Backend pulls latest main and restarts `msfg-backend`.

- [ ] **Step 6: Verify live route**

Open:

```text
https://dashboard.msfgco.com/Calculators/Company%20Calendar/calendar.html?v=20260525-schedule
```

Expected:

- The new schedule board loads for an authenticated employee.
- Add/edit/delete works for own entries.
- A normal user cannot edit another employee's entry.
- Admin/manager can edit another employee's entry.
- Optional sync panel renders without blocking the board.

- [ ] **Step 7: Final commit status check**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com
git status --short
```

Expected: no tracked implementation files remain unstaged. Existing unrelated `.planning/` and `.superpowers/` may still appear as untracked and should not be included unless the user asks.

