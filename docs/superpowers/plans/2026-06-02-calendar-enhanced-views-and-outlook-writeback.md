# Calendar Enhanced Views and Outlook Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next company calendar iteration: hidden-by-default entries, name/NMLS employee selection, editable colors, day/week/all views with multi-day bars, Outlook-backed event editing, and attendee invite writeback.

**Architecture:** Add the backend data model first so all UI behavior can round-trip through the API. Outlook remains delegated per employee; all writeback uses the target employee's connected company Outlook account and never uses tenant-wide Graph application permissions. Frontend work then exposes the new safe fields and view modes while preserving the existing settings-cog sync flow.

**Tech Stack:** Express, MySQL migrations, Zod validation, Vitest, vanilla browser modules in `Calculators/Company Calendar`, Microsoft Graph delegated `Calendars.ReadWrite`.

---

## File Structure

Backend changes:

- Create: `backend/db/migrations/083_schedule_entry_color_attendees_writeback.sql`
- Modify: `backend/DATABASE_SCHEMA.sql`
- Modify: `backend/validation/schemas.js`
- Modify: `backend/routes/users.js`
- Modify: `backend/routes/schedule.js`
- Modify: `backend/services/schedule/privacy.js`
- Create: `backend/services/calendarSync/connections.js`
- Modify: `backend/services/calendarSync/syncEngine.js`
- Modify: `backend/services/calendarSync/providers/outlook.js`

Frontend changes:

- Modify: `Calculators/Company Calendar/calendar-api.js`
- Modify: `Calculators/Company Calendar/calendar-state.js`
- Modify: `Calculators/Company Calendar/calendar-render.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/calendar-editor.js`
- Modify: `Calculators/Company Calendar/calendar-detail.js`
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Modify: `Calculators/Company Calendar/styles.css`

Tests:

- Modify: `backend/tests/validation/schemas-extended.test.js`
- Create: `backend/tests/routes/usersDirectory.test.js`
- Modify: `backend/tests/routes/schedule.test.js`
- Modify: `backend/tests/services/calendarSync.test.js`
- Modify: `backend/tests/frontend/calendarSyncUi.test.js`

Reference behavior confirmed from Microsoft Graph docs:

- Creating an Outlook event with attendees sends invitations to attendees: `https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0`
- Updating attendee properties sends meeting updates to changed attendees: `https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0`

---

### Task 1: Schema, Validation, and API Presentation Fields

**Files:**
- Create: `backend/db/migrations/083_schedule_entry_color_attendees_writeback.sql`
- Modify: `backend/DATABASE_SCHEMA.sql`
- Modify: `backend/validation/schemas.js`
- Modify: `backend/services/schedule/privacy.js`
- Test: `backend/tests/validation/schemas-extended.test.js`

- [ ] **Step 1: Write failing validation tests**

Append these tests in `backend/tests/validation/schemas-extended.test.js` inside the existing schedule schema coverage:

```js
it('accepts event color, attendees, and send_updates on schedule entries', () => {
  const result = scheduleEntry.safeParse({
    user_id: 10,
    status: 'meeting_event',
    start_date: '2026-06-10',
    end_date: '2026-06-10',
    event_color: '#0F766E',
    attendees: [
      { user_id: 11, email: 'assistant@msfg.us', name: 'Assistant User' },
    ],
    send_updates: true,
  });

  expect(result.success).toBe(true);
  expect(result.data.event_color).toBe('#0F766E');
  expect(result.data.attendees).toEqual([
    { user_id: 11, email: 'assistant@msfg.us', name: 'Assistant User' },
  ]);
  expect(result.data.send_updates).toBe(true);
});

it('rejects invalid event colors and attendee emails', () => {
  expect(scheduleEntry.safeParse({
    user_id: 10,
    status: 'busy',
    start_date: '2026-06-10',
    end_date: '2026-06-10',
    event_color: 'red',
  }).success).toBe(false);

  expect(scheduleEntry.safeParse({
    user_id: 10,
    status: 'busy',
    start_date: '2026-06-10',
    end_date: '2026-06-10',
    attendees: [{ email: 'not-an-email', name: 'Bad Email' }],
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run validation tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/validation/schemas-extended.test.js
```

Expected: FAIL because `event_color`, `attendees`, and `send_updates` are not accepted by `scheduleEntry`.

- [ ] **Step 3: Add migration 083**

Create `backend/db/migrations/083_schedule_entry_color_attendees_writeback.sql`:

```sql
SET @dbname = DATABASE();

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'event_color'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN event_color VARCHAR(20) NULL AFTER provider_sensitivity',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'sync_write_status'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN sync_write_status ENUM(''idle'',''pending'',''synced'',''error'') DEFAULT ''idle'' AFTER event_color',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'sync_write_error'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN sync_write_error TEXT NULL AFTER sync_write_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'sync_write_attempted_at'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN sync_write_attempted_at TIMESTAMP NULL AFTER sync_write_error',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS schedule_entry_attendees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  schedule_entry_id INT NOT NULL,
  user_id INT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  response_status VARCHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (schedule_entry_id) REFERENCES schedule_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_schedule_entry_attendee_email (schedule_entry_id, email),
  INDEX idx_schedule_entry_attendees_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 4: Update base schema**

In `backend/DATABASE_SCHEMA.sql`, update `schedule_entries` to include these columns after `provider_sensitivity`:

```sql
    event_color VARCHAR(20) NULL,
    sync_write_status ENUM('idle','pending','synced','error') DEFAULT 'idle',
    sync_write_error TEXT NULL,
    sync_write_attempted_at TIMESTAMP NULL,
```

Add this table after `schedule_entries`:

```sql
CREATE TABLE IF NOT EXISTS schedule_entry_attendees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_entry_id INT NOT NULL,
    user_id INT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    response_status VARCHAR(40) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_entry_id) REFERENCES schedule_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uq_schedule_entry_attendee_email (schedule_entry_id, email),
    INDEX idx_schedule_entry_attendees_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 5: Update Zod schedule schemas**

In `backend/validation/schemas.js`, add these constants near `timeString`:

```js
const eventColor = z.string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected #RGB or #RRGGBB color')
  .optional()
  .nullable();

const scheduleAttendee = z.object({
  user_id: z.coerce.number().int().positive().optional().nullable(),
  email: z.string().trim().email().max(255),
  name: optionalString(255),
}).strict();
```

Add these fields to `scheduleEntryFields`:

```js
  event_color: eventColor,
  attendees: z.array(scheduleAttendee).max(100).optional().default([]),
  send_updates: z.boolean().optional().default(false),
```

- [ ] **Step 6: Present the new fields safely**

In `backend/services/schedule/privacy.js`, add these properties to the returned object from `presentScheduleEntry`:

```js
    employee_nmls_number: entry.employee_nmls_number || null,
    event_color: entry.event_color || null,
    sync_write_status: entry.sync_write_status || 'idle',
    sync_write_error: entry.sync_write_status === 'error' ? (entry.sync_write_error || null) : null,
    sync_write_attempted_at: entry.sync_write_attempted_at || null,
    attendees: Array.isArray(entry.attendees) ? entry.attendees : [],
```

- [ ] **Step 7: Run validation tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/validation/schemas-extended.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/db/migrations/083_schedule_entry_color_attendees_writeback.sql backend/DATABASE_SCHEMA.sql backend/validation/schemas.js backend/services/schedule/privacy.js backend/tests/validation/schemas-extended.test.js
git commit -m "feat: add schedule color attendees schema"
```

---

### Task 2: User Directory, NMLS, and Schedule Attendee Loading

**Files:**
- Modify: `backend/routes/users.js`
- Modify: `backend/routes/schedule.js`
- Test: `backend/tests/routes/usersDirectory.test.js`
- Test: `backend/tests/routes/schedule.test.js`

- [ ] **Step 1: Add user directory test**

Create `backend/tests/routes/usersDirectory.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const routePath = require.resolve('../../routes/users');
const originalDbCacheEntry = require.cache[dbPath];

const db = { query: vi.fn() };

describe('users directory route', () => {
  let app;

  beforeEach(() => {
    db.query.mockReset();
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: db,
    };
    delete require.cache[routePath];

    const usersRoutes = require('../../routes/users');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { db: { id: 10, role: 'employee' }, groups: ['employee'] };
      next();
    });
    app.use('/api/users', usersRoutes);
  });

  afterEach(() => {
    delete require.cache[routePath];
    if (originalDbCacheEntry) require.cache[dbPath] = originalDbCacheEntry;
    else delete require.cache[dbPath];
  });

  it('returns NMLS numbers in the active user directory', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 10,
        name: 'Zachary Zink',
        email: 'zachary.zink@msfg.us',
        initials: 'ZZ',
        role: 'admin',
        nmls_number: '451924',
      },
    ]]);

    const res = await makeRequest(app, '/api/users/directory');

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)[0]).toEqual(expect.objectContaining({
      name: 'Zachary Zink',
      nmls_number: '451924',
    }));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('p.nmls_number'));
  });
});

function makeRequest(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${path}`, options)
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        });
    });
  });
}
```

- [ ] **Step 2: Add schedule attendee presentation test**

In `backend/tests/routes/schedule.test.js`, add:

```js
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
```

- [ ] **Step 3: Run route tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/routes/usersDirectory.test.js tests/routes/schedule.test.js
```

Expected: FAIL because directory NMLS and attendee loading are not implemented.

- [ ] **Step 4: Add NMLS to directory response**

In `backend/routes/users.js`, change the `/directory` SELECT to include `p.nmls_number`:

```sql
SELECT u.id, u.name, u.email, u.initials, u.role,
       p.phone, p.display_email, p.team, p.avatar_s3_key, p.nmls_number
```

- [ ] **Step 5: Include NMLS in schedule entry SELECT fields**

In `backend/routes/schedule.js`, update `SELECT_FIELDS`:

```js
const SELECT_FIELDS = `
  se.*,
  u.name AS employee_name,
  u.initials AS employee_initials,
  u.role AS employee_role,
  p.nmls_number AS employee_nmls_number
`;
```

Update both schedule entry queries to join profiles:

```sql
JOIN users u ON u.id = se.user_id
LEFT JOIN user_profiles p ON p.user_id = u.id
```

- [ ] **Step 6: Add attendee loader to schedule route**

Add this helper in `backend/routes/schedule.js`:

```js
async function attachAttendees(rows) {
  const entries = rows || [];
  const ids = entries.map((row) => row.id).filter(Boolean);
  if (!ids.length) return entries;

  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.query(
    `SELECT schedule_entry_id, user_id, email, name, response_status
     FROM schedule_entry_attendees
     WHERE schedule_entry_id IN (${placeholders})
     ORDER BY name ASC, email ASC`,
    ids
  );
  const attendeeRows = getRows(result) || [];
  const byEntry = new Map();
  attendeeRows.forEach((row) => {
    const key = String(row.schedule_entry_id);
    if (!byEntry.has(key)) byEntry.set(key, []);
    byEntry.get(key).push({
      user_id: row.user_id || null,
      email: row.email,
      name: row.name || null,
      response_status: row.response_status || null,
    });
  });

  return entries.map((entry) => ({
    ...entry,
    attendees: byEntry.get(String(entry.id)) || [],
  }));
}
```

Use it in `/entries` and `/availability` before `presentScheduleEntry`:

```js
const rows = await attachAttendees(getRows(result) || []);
res.json(rows.map((row) => presentScheduleEntry(row, req)));
```

- [ ] **Step 7: Run route tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/routes/usersDirectory.test.js tests/routes/schedule.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/routes/users.js backend/routes/schedule.js backend/tests/routes/usersDirectory.test.js backend/tests/routes/schedule.test.js
git commit -m "feat: expose schedule people metadata"
```

---

### Task 3: Outlook Status, Category, Color, and Attendee Payloads

**Files:**
- Modify: `backend/services/calendarSync/providers/outlook.js`
- Test: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Add failing Outlook provider tests**

Append these tests in the `Outlook provider adapter` describe block in `backend/tests/services/calendarSync.test.js`:

```js
it('exports MSFG status categories and attendee payloads to Outlook', () => {
  const { outlookEventPayload } = require('../../services/calendarSync/providers/outlook');
  const payload = outlookEventPayload({
    status: 'meeting_event',
    start_date: '2026-06-10',
    end_date: '2026-06-10',
    start_time: '09:00:00',
    end_time: '10:00:00',
    timezone: 'America/Denver',
    note: 'Borrower call',
    visibility: 'shared_details',
    attendees: [
      { email: 'assistant@msfg.us', name: 'Assistant User' },
    ],
  });

  expect(payload.showAs).toBe('busy');
  expect(payload.sensitivity).toBe('normal');
  expect(payload.categories).toEqual(['MSFG Schedule', 'MSFG Meeting/Event']);
  expect(payload.attendees).toEqual([
    {
      emailAddress: {
        address: 'assistant@msfg.us',
        name: 'Assistant User',
      },
      type: 'required',
    },
  ]);
});

it('imports Outlook category labels back into MSFG statuses', () => {
  const { normalizeOutlookEvent } = require('../../services/calendarSync/providers/outlook');
  const event = normalizeOutlookEvent({
    id: 'event-99',
    subject: 'Borrower call',
    sensitivity: 'normal',
    showAs: 'busy',
    categories: ['MSFG Schedule', 'MSFG Meeting/Event'],
    start: { dateTime: '2026-06-10T09:00:00', timeZone: 'Mountain Standard Time' },
    end: { dateTime: '2026-06-10T10:00:00', timeZone: 'Mountain Standard Time' },
    attendees: [
      {
        emailAddress: { address: 'assistant@msfg.us', name: 'Assistant User' },
        status: { response: 'accepted' },
      },
    ],
  }, { user_id: 10, provider: 'outlook' });

  expect(event.status).toBe('meeting_event');
  expect(event.attendees).toEqual([
    {
      email: 'assistant@msfg.us',
      name: 'Assistant User',
      response_status: 'accepted',
    },
  ]);
});
```

- [ ] **Step 2: Run provider tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/services/calendarSync.test.js
```

Expected: FAIL because categories and attendees are not mapped.

- [ ] **Step 3: Add Outlook category mapping helpers**

In `backend/services/calendarSync/providers/outlook.js`, add near constants:

```js
const OUTLOOK_CATEGORY_BY_STATUS = {
  meeting_event: 'MSFG Meeting/Event',
  busy: 'MSFG Busy',
  out: 'MSFG Out',
  remote: 'MSFG Remote',
  traveling: 'MSFG Traveling',
  other: 'MSFG Other',
};

const STATUS_BY_OUTLOOK_CATEGORY = Object.entries(OUTLOOK_CATEGORY_BY_STATUS)
  .reduce((acc, [status, category]) => {
    acc[category.toLowerCase()] = status;
    return acc;
  }, {});
```

Replace `outlookStatus(showAs)` with:

```js
function outlookStatus(showAs, categories = []) {
  const statusCategory = (categories || [])
    .map((category) => STATUS_BY_OUTLOOK_CATEGORY[String(category || '').toLowerCase()])
    .find(Boolean);
  if (statusCategory) return statusCategory;
  if (showAs === 'oof') return 'out';
  if (showAs === 'workingElsewhere') return 'remote';
  if (showAs === 'tentative') return 'meeting_event';
  return 'busy';
}
```

In `normalizeOutlookEvent`, call:

```js
status: outlookStatus(event.showAs || 'busy', event.categories || []),
```

- [ ] **Step 4: Add attendee normalization**

Add these helpers in `outlook.js`:

```js
function normalizeOutlookAttendees(attendees = []) {
  return attendees
    .map((attendee) => ({
      email: attendee.emailAddress?.address || null,
      name: attendee.emailAddress?.name || attendee.emailAddress?.address || null,
      response_status: attendee.status?.response || null,
    }))
    .filter((attendee) => attendee.email);
}

function outlookAttendeesPayload(attendees = []) {
  return attendees
    .filter((attendee) => attendee && attendee.email)
    .map((attendee) => ({
      emailAddress: {
        address: attendee.email,
        name: attendee.name || attendee.email,
      },
      type: 'required',
    }));
}
```

In `normalizeOutlookEvent`, add:

```js
attendees: normalizeOutlookAttendees(event.attendees || []),
```

In `outlookEventPayload`, add:

```js
const attendees = outlookAttendeesPayload(entry.attendees || []);
const payload = {
  subject: entry.note || 'MSFG Schedule',
  isAllDay,
  showAs: showAsForEntry(entry),
  sensitivity: entry.visibility === 'availability_only' ? 'private' : 'normal',
  categories: ['MSFG Schedule', OUTLOOK_CATEGORY_BY_STATUS[entry.status] || OUTLOOK_CATEGORY_BY_STATUS.other],
  start: { dateTime: startDateTime, timeZone: entry.timezone || 'America/Denver' },
  end: { dateTime: endDateTime, timeZone: entry.timezone || 'America/Denver' },
};
if (attendees.length) payload.attendees = attendees;
return payload;
```

- [ ] **Step 5: Select categories and attendees from Graph**

In `listEvents`, update the `$select` value:

```js
'$select': 'id,subject,start,end,showAs,isCancelled,isAllDay,sensitivity,lastModifiedDateTime,webLink,categories,attendees',
```

- [ ] **Step 6: Run provider tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/services/calendarSync.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/services/calendarSync/providers/outlook.js backend/tests/services/calendarSync.test.js
git commit -m "feat: map outlook schedule categories"
```

---

### Task 4: Sync Engine Attendee Persistence and Shared Connection Helper

**Files:**
- Create: `backend/services/calendarSync/connections.js`
- Modify: `backend/services/calendarSync/syncEngine.js`
- Test: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Add failing sync engine attendee persistence test**

In `backend/tests/services/calendarSync.test.js`, add to `calendar sync engine`:

```js
it('persists imported provider attendees with imported schedule entries', async () => {
  db.query.mockImplementation(async (sql) => {
    if (sql.includes('INSERT INTO calendar_sync_runs')) return [{ insertId: 12 }];
    if (sql.includes('SELECT provider_event_id')) return [[]];
    if (sql.includes('SELECT id FROM schedule_entries')) return [[{ id: 88 }]];
    return [{ affectedRows: 1, insertId: 88 }];
  });

  const adapter = {
    listEvents: vi.fn().mockResolvedValue([
      {
        user_id: 7,
        status: 'meeting_event',
        start_date: '2026-06-10',
        end_date: '2026-06-10',
        start_time: '09:00:00',
        end_time: '10:00:00',
        timezone: 'America/Denver',
        note: 'Borrower call',
        visibility: 'availability_only',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'outlook-88',
        details_shareable: true,
        provider_sensitivity: 'normal',
        attendees: [
          { email: 'assistant@msfg.us', name: 'Assistant User', response_status: 'accepted' },
        ],
      },
    ]),
  };

  const { runSyncForConnection } = require('../../services/calendarSync/syncEngine');
  await runSyncForConnection(
    { id: 4, user_id: 7, provider: 'outlook', sync_enabled: 1 },
    adapter,
    {
      startDate: '2026-04-27',
      endDate: '2026-11-23',
      startDateTime: '2026-04-27T06:00:00.000Z',
      endDateTime: '2026-11-24T06:59:59.999Z',
    }
  );

  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining('DELETE FROM schedule_entry_attendees WHERE schedule_entry_id = ?'),
    [88]
  );
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO schedule_entry_attendees'),
    [88, null, 'assistant@msfg.us', 'Assistant User', 'accepted']
  );
});
```

- [ ] **Step 2: Run sync tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/services/calendarSync.test.js
```

Expected: FAIL because imported attendees are not persisted.

- [ ] **Step 3: Create shared connection helper**

Create `backend/services/calendarSync/connections.js`:

```js
const db = require('../../db/connection');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

async function persistRefreshedTokens(connection, refreshed) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET encrypted_access_token = ?,
         encrypted_refresh_token = ?,
         access_token_expires_at = ?,
         scopes = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      refreshed.encrypted_access_token,
      refreshed.encrypted_refresh_token,
      refreshed.access_token_expires_at,
      refreshed.scopes || null,
      connection.id,
    ]
  );
}

function prepareConnection(connection) {
  return {
    ...connection,
    persistRefreshedTokens: async (refreshed) => {
      Object.assign(connection, refreshed);
      await persistRefreshedTokens(connection, refreshed);
    },
  };
}

async function loadWritableConnection(userId, provider) {
  const result = await db.query(
    `SELECT *
     FROM calendar_sync_connections
     WHERE user_id = ?
       AND provider = ?
       AND sync_enabled = 1
       AND encrypted_access_token IS NOT NULL
     LIMIT 1`,
    [userId, provider]
  );
  const connection = (getRows(result) || [])[0] || null;
  return connection ? prepareConnection(connection) : null;
}

module.exports = {
  loadWritableConnection,
  prepareConnection,
  persistRefreshedTokens,
};
```

In `syncEngine.js`, import `prepareConnection` and remove the local duplicate `persistRefreshedTokens` and `prepareConnection` definitions:

```js
const { prepareConnection } = require('./connections');
```

- [ ] **Step 4: Persist attendees during imported upsert**

In `syncEngine.js`, add:

```js
async function fetchImportedEntryId(entry) {
  const result = await db.query(
    `SELECT id FROM schedule_entries
     WHERE user_id = ? AND source_provider = ? AND source_event_id = ?
     LIMIT 1`,
    [entry.user_id, entry.source_provider, entry.source_event_id]
  );
  return (getRows(result) || [])[0]?.id || null;
}

async function replaceEntryAttendees(entryId, attendees = []) {
  await db.query('DELETE FROM schedule_entry_attendees WHERE schedule_entry_id = ?', [entryId]);
  for (const attendee of attendees || []) {
    if (!attendee.email) continue;
    await db.query(
      `INSERT INTO schedule_entry_attendees
       (schedule_entry_id, user_id, email, name, response_status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entryId,
        attendee.user_id || null,
        attendee.email,
        attendee.name || null,
        attendee.response_status || null,
      ]
    );
  }
}
```

At the end of `upsertImportedEntry`, add:

```js
const entryId = await fetchImportedEntryId(entry);
if (entryId) await replaceEntryAttendees(entryId, entry.attendees || []);
```

Export `replaceEntryAttendees` for route reuse:

```js
  replaceEntryAttendees,
```

- [ ] **Step 5: Run sync tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/services/calendarSync.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/services/calendarSync/connections.js backend/services/calendarSync/syncEngine.js backend/tests/services/calendarSync.test.js
git commit -m "feat: persist calendar sync attendees"
```

---

### Task 5: Provider-Aware Schedule Edits and Immediate Outlook Writeback

**Files:**
- Modify: `backend/routes/schedule.js`
- Modify: `backend/services/calendarSync/providers/outlook.js`
- Test: `backend/tests/routes/schedule.test.js`

- [ ] **Step 1: Add failing tests for editable Outlook entries**

Replace the existing `blocks updates to provider-owned schedule entries` test in `backend/tests/routes/schedule.test.js` with:

```js
it('lets the owner reclassify an Outlook-backed busy event as a meeting event', async () => {
  db.query
    .mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 10,
        employee_name: 'Employee User',
        employee_initials: 'EU',
        employee_role: 'employee',
        status: 'busy',
        start_date: '2026-06-10',
        end_date: '2026-06-10',
        start_time: '09:00:00',
        end_time: '10:00:00',
        timezone: 'America/Denver',
        note: 'Borrower call',
        visibility: 'availability_only',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'outlook-9',
        details_shareable: 1,
        provider_sensitivity: 'normal',
      },
    ]])
    .mockResolvedValueOnce([[
      {
        id: 3,
        user_id: 10,
        provider: 'outlook',
        sync_enabled: 1,
        encrypted_access_token: 'encrypted',
      },
    ]])
    .mockResolvedValueOnce([{ affectedRows: 1 }])
    .mockResolvedValueOnce([{ affectedRows: 1 }])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 10,
        employee_name: 'Employee User',
        employee_initials: 'EU',
        employee_role: 'employee',
        status: 'meeting_event',
        start_date: '2026-06-10',
        end_date: '2026-06-10',
        visibility: 'availability_only',
        source: 'outlook',
        source_provider: 'outlook',
        source_event_id: 'outlook-9',
        details_shareable: 1,
        provider_sensitivity: 'normal',
        sync_write_status: 'synced',
      },
    ]])
    .mockResolvedValueOnce([[]]);

  const res = await makeJsonRequest(app, '/api/schedule/entries/9', {
    status: 'meeting_event',
    event_color: '#0F766E',
    attendees: [],
    send_updates: false,
  }, {}, 'PUT');

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).entry).toEqual(expect.objectContaining({
    status: 'meeting_event',
    event_color: '#0F766E',
    provider_owned: true,
  }));
});

it('blocks Outlook detail edits on provider-private events', async () => {
  db.query.mockResolvedValueOnce([[
    {
      id: 9,
      user_id: 10,
      status: 'busy',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      source: 'outlook',
      source_provider: 'outlook',
      source_event_id: 'outlook-private',
      details_shareable: 0,
      provider_sensitivity: 'private',
    },
  ]]);

  const res = await makeJsonRequest(app, '/api/schedule/entries/9', {
    note: 'Private detail',
    attendees: [{ email: 'assistant@msfg.us', name: 'Assistant User' }],
    send_updates: true,
  }, {}, 'PUT');

  expect(res.status).toBe(409);
  expect(JSON.parse(res.body)).toEqual({
    error: 'This Outlook event is private and cannot update details or attendees from MSFG Calendar.',
  });
});
```

- [ ] **Step 2: Mock the Outlook provider in route tests**

At the top of `schedule.test.js`, add:

```js
const outlookProviderPath = require.resolve('../../services/calendarSync/providers/outlook');
const originalOutlookProviderCacheEntry = require.cache[outlookProviderPath];
const outlookProvider = {
  updateEvent: vi.fn().mockResolvedValue({ provider_event_id: 'outlook-9', provider_etag: 'etag-9' }),
  createEvent: vi.fn().mockResolvedValue({ provider_event_id: 'outlook-created', provider_etag: 'etag-created' }),
};
```

In `beforeEach`, add the cache entry:

```js
outlookProvider.updateEvent.mockClear();
outlookProvider.createEvent.mockClear();
require.cache[outlookProviderPath] = {
  id: outlookProviderPath,
  filename: outlookProviderPath,
  loaded: true,
  exports: outlookProvider,
};
```

In `afterEach`, restore it:

```js
if (originalOutlookProviderCacheEntry) require.cache[outlookProviderPath] = originalOutlookProviderCacheEntry;
else delete require.cache[outlookProviderPath];
```

- [ ] **Step 3: Run route tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/routes/schedule.test.js
```

Expected: FAIL because provider-owned updates are still blocked.

- [ ] **Step 4: Add provider edit helpers**

In `backend/routes/schedule.js`, import helpers:

```js
const outlookProvider = require('../services/calendarSync/providers/outlook');
const { loadWritableConnection } = require('../services/calendarSync/connections');
const { replaceEntryAttendees } = require('../services/calendarSync/syncEngine');
```

Add:

```js
function isProtectedProviderEntry(entry) {
  return Boolean(
    isProviderOwned(entry) &&
    (!entry.details_shareable || (entry.provider_sensitivity && entry.provider_sensitivity !== 'normal'))
  );
}

function hasProtectedDetailChanges(body) {
  return Object.prototype.hasOwnProperty.call(body, 'note') ||
    (Array.isArray(body.attendees) && body.attendees.length > 0) ||
    body.visibility === 'shared_details';
}

async function markEntryWriteback(id, status, errorMessage = null) {
  await db.query(
    `UPDATE schedule_entries
     SET sync_write_status = ?,
         sync_write_error = ?,
         sync_write_attempted_at = UTC_TIMESTAMP(),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, errorMessage, id]
  );
}
```

- [ ] **Step 5: Extend editable fields and value writers**

Update `EDITABLE_FIELDS`:

```js
  'event_color',
  'attendees',
  'send_updates',
```

Update `toInsertValues` and the INSERT statement to include `event_color`.

Update `toUpdateValues` and the UPDATE statement to include `event_color`, while preserving provider fields for provider-owned entries:

```js
function toUpdateValues(entry, userId) {
  return [
    entry.user_id,
    entry.status,
    entry.start_date,
    entry.end_date,
    entry.start_time || null,
    entry.end_time || null,
    entry.timezone || 'America/Denver',
    entry.note || null,
    entry.visibility || 'availability_only',
    entry.source || 'manual',
    entry.source_provider || null,
    entry.source_event_id || null,
    entry.event_color || null,
    userId,
    entry.id,
  ];
}
```

- [ ] **Step 6: Replace provider-owned update block**

In `PUT /entries/:id`, replace the `requireEditableEntry(existing, res)` line with:

```js
if (isProviderOwned(existing) && existing.source_provider !== 'outlook') {
  return res.status(409).json({ error: `This schedule entry is managed in ${providerName(existing)}.` });
}
if (isProviderOwned(existing) && isProtectedProviderEntry(existing) && hasProtectedDetailChanges(req.body)) {
  return res.status(409).json({
    error: 'This Outlook event is private and cannot update details or attendees from MSFG Calendar.',
  });
}
```

After the internal `UPDATE`, add provider writeback for Outlook entries:

```js
if (isProviderOwned(existing) && existing.source_provider === 'outlook') {
  const connection = await loadWritableConnection(validated.user_id, 'outlook');
  if (!connection) {
    await markEntryWriteback(existing.id, 'error', 'Outlook is not connected for this employee.');
  } else {
    try {
      await outlookProvider.updateEvent(connection, existing.source_event_id, {
        ...validated,
        id: existing.id,
        attendees: req.body.attendees || existing.attendees || [],
      });
      await markEntryWriteback(existing.id, 'synced');
    } catch (error) {
      await markEntryWriteback(existing.id, 'error', error.message || 'Outlook writeback failed');
    }
  }
}
if (Array.isArray(req.body.attendees)) {
  await replaceEntryAttendees(existing.id, req.body.attendees);
}
const updated = await fetchEntry(req.params.id);
const rows = await attachAttendees(updated ? [updated] : []);
return res.json({ success: true, entry: presentScheduleEntry(rows[0] || updated || validated, req) });
```

- [ ] **Step 7: Preserve provider-owned delete block**

Keep `DELETE /entries/:id` blocking provider-owned entries. Editing Outlook-backed events is allowed; deleting imported Outlook events from MSFG Calendar stays blocked in this phase to avoid accidental meeting cancellations.

- [ ] **Step 8: Run route tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/routes/schedule.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/routes/schedule.js backend/tests/routes/schedule.test.js
git commit -m "feat: edit outlook-backed schedule entries"
```

---

### Task 6: Frontend API, State, Employee Picker, Hidden Default, Colors, and Attendees

**Files:**
- Modify: `Calculators/Company Calendar/calendar-api.js`
- Modify: `Calculators/Company Calendar/calendar-state.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/calendar-editor.js`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Add failing frontend VM tests**

In `backend/tests/frontend/calendarSyncUi.test.js`, add loaders for `calendar-editor.js` and `calendar-main.js` if missing, then add:

```js
describe('calendar editor enhanced fields', () => {
  it('renders employee names, NMLS numbers, color controls, and attendee picker fields', () => {
    const context = { window: {} };
    for (const file of ['calendar-state.js', 'calendar-render.js', 'calendar-editor.js']) {
      const source = readFileSync(
        resolve(process.cwd(), `../Calculators/Company Calendar/${file}`),
        'utf8'
      );
      vm.runInNewContext(source, context);
    }

    const state = context.window.CalendarState.createState();
    state.peopleDirectory = [
      { id: 10, name: 'Zachary Zink', email: 'zachary.zink@msfg.us', nmls_number: '451924' },
      { id: 11, name: 'Assistant User', email: 'assistant@msfg.us', nmls_number: null },
    ];
    state.editor = {
      user_id: 10,
      status: 'meeting_event',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      visibility: 'availability_only',
      source: 'manual',
      event_color: '#0F766E',
      attendees: [{ email: 'assistant@msfg.us', name: 'Assistant User' }],
    };

    const html = context.window.CalendarEditor.render(state);
    expect(html).toContain('Zachary Zink - NMLS 451924');
    expect(html).not.toContain('Employee ID');
    expect(html).toContain('name="event_color"');
    expect(html).toContain('Assistant User');
    expect(html).toContain('Hidden from Team');
  });
});
```

Update the existing API helper test to expect `getUserDirectory`:

```js
expect(typeof CalendarApi.getUserDirectory).toBe('function');
```

- [ ] **Step 2: Run frontend VM tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: FAIL because the editor still shows raw `Employee ID` and no color/attendee controls.

- [ ] **Step 3: Add directory API and state**

In `calendar-api.js`, add:

```js
getUserDirectory: () => request('/users/directory'),
```

In `calendar-state.js`, change view modes and state:

```js
const VIEW_MODES = ['day', 'week', 'month', 'two_months', 'year', 'people', 'all'];
```

Add to `createState()`:

```js
peopleDirectory: [],
directoryError: null,
```

- [ ] **Step 4: Load directory during boot**

In `calendar-main.js`, add:

```js
async function loadPeopleDirectory() {
  try {
    state.peopleDirectory = await CalendarApi.getUserDirectory();
    state.directoryError = null;
  } catch (err) {
    state.peopleDirectory = state.me ? [state.me] : [];
    state.directoryError = err.message || 'Unable to load employee directory.';
  }
}
```

In `boot()`, call it after `getMe()`:

```js
state.me = await CalendarApi.getMe();
await loadPeopleDirectory();
```

Change `newManualEntry()`:

```js
visibility: 'availability_only',
event_color: '',
attendees: [],
```

- [ ] **Step 5: Allow editable Outlook entries in frontend**

In `calendar-main.js`, replace `isManualEditableEntry` with:

```js
function isProviderOwnedEntry(entry) {
  return Boolean(entry && (entry.provider_owned || entry.source_provider || entry.source === 'outlook' || entry.source === 'google'));
}

function isEditableEntry(entry) {
  if (!entry || isPrivateEntry(entry)) return false;
  if (entry.source === 'manual') return true;
  return Boolean(isProviderOwnedEntry(entry) && (entry.source_provider === 'outlook' || entry.source === 'outlook'));
}
```

Use `isEditableEntry` in `openEditor`, `saveEditor`, and `deleteEntry`. Keep delete blocking non-manual entries:

```js
if (current.source !== 'manual') {
  showToast('Synced Outlook entries can be edited, but deletion stays in Outlook.', 'info');
  return;
}
```

In `schedulePayloadBody`, include:

```js
event_color: payload.event_color || null,
attendees: payload.attendees || [],
send_updates: Boolean(payload.send_updates),
source: payload.source || 'manual',
```

- [ ] **Step 6: Render employee picker, color, and attendees**

In `calendar-editor.js`, replace the raw `Employee ID` label with:

```js
function personOptionLabel(person) {
  const nmls = person.nmls_number ? ` - NMLS ${person.nmls_number}` : '';
  return `${person.name || person.email || `Employee ${person.id}`}${nmls}`;
}

function renderEmployeeOptions(state, selectedUserId) {
  return (state.peopleDirectory || []).map((person) => `
    <option value="${escapeHtml(person.id)}" ${String(selectedUserId) === String(person.id) ? 'selected' : ''}>
      ${escapeHtml(personOptionLabel(person))}
    </option>
  `).join('');
}
```

Use it:

```html
<label>
  <span>Employee</span>
  <select name="user_id" required ${isSaving ? 'disabled' : ''}>
    ${renderEmployeeOptions(state, entryUserId(entry))}
  </select>
</label>
```

Change visibility labels:

```js
const VISIBILITY_OPTIONS = [
  { value: 'availability_only', label: 'Hidden from Team' },
  { value: 'shared_details', label: 'Shared Details' },
];
```

Add color field:

```html
<label>
  <span>Event Color</span>
  <input name="event_color" type="color" value="${escapeHtml(firstValue(entry.event_color, statusColor(status)))}" ${isSaving ? 'disabled' : ''}>
</label>
```

Add attendee multi-select:

```html
<label class="editor-attendees">
  <span>Invite Employees</span>
  <select name="attendees" multiple ${isSaving ? 'disabled' : ''}>
    ${renderAttendeeOptions(state, entry.attendees || [])}
  </select>
</label>
```

Add `renderAttendeeOptions`, `statusColor`, and attendee parsing:

```js
function selectedAttendeeEmails(attendees) {
  return new Set((attendees || []).map((attendee) => String(attendee.email || '').toLowerCase()));
}

function renderAttendeeOptions(state, selectedAttendees) {
  const selected = selectedAttendeeEmails(selectedAttendees);
  return (state.peopleDirectory || []).map((person) => {
    const email = person.email || person.display_email || '';
    return `
      <option value="${escapeHtml(email)}" ${selected.has(String(email).toLowerCase()) ? 'selected' : ''}>
        ${escapeHtml(`${person.name || email} <${email}>`)}
      </option>
    `;
  }).join('');
}

function statusColor(status) {
  const meta = window.CalendarState.STATUS_META[status] || window.CalendarState.STATUS_META.other;
  return meta.color || '#404041';
}

function selectedAttendees(form, state) {
  const selected = Array.from(form.elements.attendees?.selectedOptions || []).map((option) => option.value);
  return selected.map((email) => {
    const person = (state.peopleDirectory || []).find((item) => String(item.email || item.display_email || '').toLowerCase() === String(email).toLowerCase());
    return {
      user_id: person?.id || null,
      email,
      name: person?.name || email,
    };
  });
}
```

In `formPayload`, set:

```js
event_color: fieldValue(form, 'event_color') || null,
attendees: selectedAttendees(form, window.MSFGCalendar?.state || {}),
send_updates: Boolean(form.dataset.sendUpdates === 'true'),
```

- [ ] **Step 7: Add save-send button**

In editor actions, render:

```html
<button class="primary-btn" type="submit" data-save-mode="normal" ${isSaving ? 'disabled' : ''}>${isSaving ? 'Saving...' : 'Save'}</button>
<button class="primary-btn send-btn" type="submit" data-save-mode="send" ${isSaving ? 'disabled' : ''}>Save and send updates</button>
```

In bind submit handling:

```js
form.addEventListener('click', (event) => {
  const saveButton = event.target.closest('[data-save-mode]');
  if (!saveButton) return;
  form.dataset.sendUpdates = saveButton.dataset.saveMode === 'send' ? 'true' : 'false';
});
```

- [ ] **Step 8: Run frontend VM tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: PASS.

Commit:

```bash
git add Calculators/Company\ Calendar/calendar-api.js Calculators/Company\ Calendar/calendar-state.js Calculators/Company\ Calendar/calendar-main.js Calculators/Company\ Calendar/calendar-editor.js backend/tests/frontend/calendarSyncUi.test.js
git commit -m "feat: enhance calendar editor fields"
```

---

### Task 7: Day, Week, All Views and Multi-Day Event Bars

**Files:**
- Modify: `Calculators/Company Calendar/calendar-state.js`
- Modify: `Calculators/Company Calendar/calendar-render.js`
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Modify: `Calculators/Company Calendar/calendar-detail.js`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Add failing view tests**

In `backend/tests/frontend/calendarSyncUi.test.js`, update the view controls test:

```js
expect(html).toContain('data-view-mode="day"');
expect(html).toContain('data-view-mode="week"');
expect(html).toContain('data-view-mode="all"');
```

Add:

```js
describe('calendar multi-day view rendering', () => {
  it('renders week and all-view multi-day bars with span metadata', () => {
    const context = { window: {} };
    for (const file of ['calendar-state.js', 'calendar-render.js', 'calendar-roster.js']) {
      const source = readFileSync(
        resolve(process.cwd(), `../Calculators/Company Calendar/${file}`),
        'utf8'
      );
      vm.runInNewContext(source, context);
    }

    const state = context.window.CalendarState.createState();
    state.viewDate = new Date(2026, 5, 1);
    state.viewMode = 'week';
    state.entries = [{
      id: 30,
      user_id: 10,
      employee_name: 'Zachary Zink',
      status: 'out',
      start_date: '2026-06-02',
      end_date: '2026-06-05',
      visibility: 'availability_only',
      event_color: '#0F766E',
    }];
    state.people = context.window.CalendarRender.derivePeople(state.entries);

    const weekHtml = context.window.CalendarRoster.render(state);
    expect(weekHtml).toContain('week-overview');
    expect(weekHtml).toContain('grid-column');
    expect(weekHtml).toContain('is-hidden-details');

    state.viewMode = 'all';
    const allHtml = context.window.CalendarRoster.render(state);
    expect(allHtml).toContain('all-overview');
    expect(allHtml).toContain('person-timeline-row');
  });
});
```

- [ ] **Step 2: Run frontend VM tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: FAIL because day/week/all renderers do not exist.

- [ ] **Step 3: Add day and week date ranges**

In `calendar-state.js`, add:

```js
function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfWeek(date) {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(value, -value.getDay());
}
```

Update `visibleRange`:

```js
if (viewMode === 'day') {
  const day = state.selectedDate || viewDate;
  return { start_date: isoDate(day), end_date: isoDate(day) };
}

if (viewMode === 'week') {
  const start = startOfWeek(state.selectedDate || viewDate);
  const end = addDays(start, 6);
  return { start_date: isoDate(start), end_date: isoDate(end) };
}
```

Export `addDays` and `startOfWeek`.

- [ ] **Step 4: Update view labels**

In `calendar-render.js`, update `viewModeLabel`:

```js
if (mode === 'day') return 'Day';
if (mode === 'week') return 'Week';
if (mode === 'all') return 'All';
```

Update navigation step:

```js
const step = state.viewMode === 'year' ? 12 : (state.viewMode === 'two_months' ? 2 : 1);
```

For day/week navigation, call `setSelectedDate` and `setViewDate` together:

```js
function shiftDate(days) {
  const base = state.selectedDate || state.viewDate || new Date();
  const nextDate = window.CalendarState.addDays(base, days);
  actions.setSelectedDate(nextDate);
  actions.setViewDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
}
```

Use `shiftDate(-1)` for day previous, `shiftDate(1)` for day next, `shiftDate(-7)` for week previous, and `shiftDate(7)` for week next.

- [ ] **Step 5: Add shared event style helpers**

In `calendar-roster.js`, add:

```js
function entryColor(entry) {
  return entry.event_color || (window.CalendarState.STATUS_META[entry.status] && window.CalendarState.STATUS_META[entry.status].color) || '#404041';
}

function visibilityClass(entry) {
  return entry.visibility === 'shared_details' ? 'is-shared-details' : 'is-hidden-details';
}

function barStyle(entry) {
  return `--entry-color:${escapeHtml(entryColor(entry))};`;
}
```

Update `renderEntryPill` button class and style:

```html
<button class="entry-bar ${compact ? 'is-compact' : ''} ${visibilityClass(entry)}" type="button" data-entry-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status || 'other')}" style="${barStyle(entry)}" title="${escapeHtml(entryLabel(entry))}">
```

- [ ] **Step 6: Add day view renderer**

In `calendar-roster.js`, add:

```js
function renderDayView(state) {
  const day = state.selectedDate || state.today || new Date();
  const entries = entriesForDay(state, day);
  return `
    <div class="day-overview">
      <div class="day-overview-head">
        <h2>${escapeHtml(dayLabel(day))}</h2>
        <span>${entries.length} entries</span>
      </div>
      <div class="day-entry-list">
        ${entries.length ? entries.map((entry) => renderEntryPill(entry, false)).join('') : '<p class="empty-roster">No visible entries for this day.</p>'}
      </div>
    </div>
  `;
}
```

- [ ] **Step 7: Add week view renderer**

Add:

```js
function daysForWeek(state) {
  const start = window.CalendarState.startOfWeek(state.selectedDate || state.today || new Date());
  return Array.from({ length: 7 }, (_, index) => window.CalendarState.addDays(start, index));
}

function dayIndexInRange(iso, days) {
  const dateIso = String(iso || '').slice(0, 10);
  return days.findIndex((day) => window.CalendarState.isoDate(day) === dateIso);
}

function renderWeekSpanningBar(entry, days) {
  const startIndex = Math.max(dayIndexInRange(entryStartIso(entry), days), 0);
  const rawEndIndex = dayIndexInRange(entryEndIso(entry), days);
  const endIndex = rawEndIndex < 0 ? days.length - 1 : rawEndIndex;
  return `
    <button class="entry-bar timeline-bar ${visibilityClass(entry)}" type="button" data-entry-id="${escapeHtml(entry.id)}" data-status="${escapeHtml(entry.status || 'other')}" style="grid-column:${startIndex + 1} / ${endIndex + 2}; ${barStyle(entry)}">
      <span class="entry-name">${escapeHtml(entryLabel(entry))}</span>
      <span class="entry-person">${escapeHtml(entryUserName(entry))}</span>
    </button>
  `;
}

function renderWeekView(state) {
  const days = daysForWeek(state);
  const entries = visibleEntries(state);
  return `
    <div class="week-overview">
      <div class="timeline-days">
        ${days.map((day) => `<div class="timeline-day-head">${escapeHtml(window.CalendarState.DOW[day.getDay()])} ${day.getDate()}</div>`).join('')}
      </div>
      <div class="week-bars">
        ${entries.length ? entries.map((entry) => renderWeekSpanningBar(entry, days)).join('') : '<p class="empty-roster">No visible entries this week.</p>'}
      </div>
    </div>
  `;
}
```

- [ ] **Step 8: Add All view renderer**

Add:

```js
function renderAllView(state) {
  const range = window.CalendarState.visibleRange(state);
  const start = window.CalendarState.parseDate(range.start_date);
  const totalDays = Math.round((window.CalendarState.parseDate(range.end_date) - start) / 86400000) + 1;
  const days = Array.from({ length: totalDays }, (_, index) => window.CalendarState.addDays(start, index));
  const people = filteredPeople(state);

  return `
    <div class="all-overview">
      <div class="all-timeline-grid" style="--days:${days.length}">
        <div class="corner-cell">Employee</div>
        ${days.map((day) => `<div class="day-head ${isToday(state, day) ? 'is-today' : ''}"><span class="day-dow">${escapeHtml(window.CalendarState.DOW[day.getDay()])}</span><span class="day-num">${day.getDate()}</span></div>`).join('')}
        ${people.map((person) => renderPersonTimelineRow(state, person, days)).join('')}
      </div>
    </div>
  `;
}

function renderPersonTimelineRow(state, person, days) {
  const entries = entriesForPerson(state, person.id);
  return `
    <div class="person-cell person-timeline-row" data-user-id="${escapeHtml(person.id)}">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(person.name))}</span>
      <span class="person-text">
        <span class="person-name">${escapeHtml(person.name)}</span>
        <span class="person-role">${escapeHtml(person.role || person.nmls_number || 'Team')}</span>
      </span>
    </div>
    <div class="person-timeline-bars" style="grid-template-columns:repeat(${days.length}, var(--day-w));">
      ${entries.map((entry) => renderWeekSpanningBar(entry, days)).join('')}
    </div>
  `;
}
```

Update `renderBoard`:

```js
if (state.viewMode === 'day') return renderDayView(state);
if (state.viewMode === 'week') return renderWeekView(state);
if (state.viewMode === 'all') return renderAllView(state);
```

- [ ] **Step 9: Let synced Outlook entries open editor from roster/detail**

In `calendar-roster.js`, replace `isManualEditableEntry(entry)` checks with:

```js
const editable = entry && !isPrivateEntry(entry) && (entry.source === 'manual' || entry.source_provider === 'outlook' || entry.source === 'outlook');
```

In `calendar-detail.js`, use the same editable expression in `renderEntry`.

- [ ] **Step 10: Run frontend VM tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: PASS.

Commit:

```bash
git add Calculators/Company\ Calendar/calendar-state.js Calculators/Company\ Calendar/calendar-render.js Calculators/Company\ Calendar/calendar-roster.js Calculators/Company\ Calendar/calendar-detail.js backend/tests/frontend/calendarSyncUi.test.js
git commit -m "feat: add calendar day week all views"
```

---

### Task 8: Logo, Visual Polish, Brightness, and Responsive CSS

**Files:**
- Modify: `Calculators/Company Calendar/calendar-render.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Add failing logo and visibility class tests**

In `backend/tests/frontend/calendarSyncUi.test.js`, add:

```js
it('renders the official MSFG logo in the calendar header', () => {
  const CalendarRender = loadCalendarRender();
  const html = CalendarRender.renderViewTabs({ viewMode: 'month' }) + CalendarRender.renderHeader?.({
    viewMode: 'month',
    viewDate: new Date(2026, 5, 1),
  });

  expect(String(html)).toContain('MSFG-Color-Transparent.png');
  expect(String(html)).toContain('alt="MSFG Home Loans"');
});
```

If `renderHeader` is not exported, export it from `CalendarRender`.

- [ ] **Step 2: Run frontend VM tests and verify failure**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: FAIL because the header still uses the CSS brand mark.

- [ ] **Step 3: Replace brand pseudo-mark with logo image**

In `calendar-render.js`, add:

```js
const MSFG_LOGO_URL = 'https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/MSFG+Home+Loans/MSFG-Color-Transparent.png';
```

Inside `renderHeader`, add the logo near the controls:

```html
<img class="schedule-logo" src="${MSFG_LOGO_URL}" alt="MSFG Home Loans" loading="eager">
```

Export `renderHeader`:

```js
renderHeader,
```

- [ ] **Step 4: Add visibility and color CSS**

In `styles.css`, replace hard-coded entry background rules with custom property support:

```css
.entry-bar {
  background: var(--entry-color, var(--status-other));
}

.entry-bar.is-hidden-details {
  opacity: .62;
  filter: saturate(.72);
}

.entry-bar.is-shared-details {
  opacity: 1;
  filter: saturate(1.08);
}

.entry-bar[data-status="out"] { --entry-color: var(--status-out); }
.entry-bar[data-status="remote"] { --entry-color: var(--status-remote); }
.entry-bar[data-status="traveling"] { --entry-color: var(--status-traveling); }
.entry-bar[data-status="meeting_event"] { --entry-color: var(--status-meeting-event); }
.entry-bar[data-status="other"] { --entry-color: var(--status-other); }
.entry-bar[data-status="busy"] { --entry-color: var(--status-busy); }
```

Add logo CSS:

```css
.schedule-logo {
  justify-self: end;
  max-width: 156px;
  max-height: 48px;
  object-fit: contain;
}

.brand-mark::before {
  display: none;
}
```

Add dense timeline CSS:

```css
.week-overview,
.day-overview,
.all-overview {
  padding: 12px;
}

.timeline-days,
.week-bars {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.timeline-day-head {
  min-height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-soft);
  background: var(--surface-2);
  color: var(--ink-dim);
  font-size: 12px;
  font-weight: 800;
}

.week-bars {
  align-items: start;
  margin-top: 8px;
}

.timeline-bar {
  min-height: 42px;
}

.all-overview {
  overflow-x: auto;
}

.all-timeline-grid {
  display: grid;
  grid-template-columns: var(--name-col) repeat(var(--days), var(--day-w));
  min-width: calc(var(--name-col) + (var(--days) * var(--day-w)));
}

.person-timeline-bars {
  position: relative;
  display: grid;
  grid-column: 2 / -1;
  min-height: var(--row-h);
  padding: 6px;
  border-bottom: 1px solid var(--line-soft);
  background: #fff;
}
```

- [ ] **Step 5: Run frontend VM tests and commit**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: PASS.

Commit:

```bash
git add Calculators/Company\ Calendar/calendar-render.js Calculators/Company\ Calendar/styles.css backend/tests/frontend/calendarSyncUi.test.js
git commit -m "feat: polish calendar views and branding"
```

---

### Task 9: End-to-End Verification, Browser Check, and Deployment Notes

**Files:**
- Modify: none unless verification finds a defect

- [ ] **Step 1: Run backend test suite**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npm test
```

Expected: PASS.

- [ ] **Step 2: Run backend lint**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync/backend
npm run lint
```

Expected: PASS, or only pre-existing warnings documented in the final handoff.

- [ ] **Step 3: Serve the calendar locally**

Run:

```bash
cd /Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com/.worktrees/codex-complete-calendar-sync
python3 -m http.server 64819
```

Expected: server prints `Serving HTTP on :: port 64819` or `Serving HTTP on 0.0.0.0 port 64819`.

- [ ] **Step 4: Browser verify desktop**

Open:

```text
http://127.0.0.1:64819/Calculators/Company%20Calendar/calendar.html
```

Verify:

- Header shows official MSFG logo.
- View buttons include Day, Week, Month, 2 Months, Year, People, All.
- Hidden events are visibly dimmer than shared events.
- Month and 2 Months avoid the old full-page scrollbar problem.
- All view is horizontally scrollable inside the dense grid only.
- Opening a shareable Outlook event shows editable status, color, visibility, and attendee controls.
- Private Outlook events do not show share or attendee/title edit controls.

- [ ] **Step 5: Browser verify mobile**

Set viewport near `390x844` and verify:

- Header controls wrap without overlapping.
- Editor fields fit within the modal.
- Logo does not push action buttons off-screen.
- All view scrolls horizontally inside its panel.

- [ ] **Step 6: Commit verification fixes**

If verification required fixes, run:

```bash
git status --short
git add <changed-files>
git commit -m "fix: stabilize calendar enhanced sync views"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 7: Final git status**

Run:

```bash
git status --short --branch
```

Expected: clean worktree on `codex/calendar-enhanced-views-and-sync`.

---

## Self-Review

Spec coverage:

- Names/NMLS: Task 2 and Task 6.
- Hidden default and dimmed/bright shared state: Task 1, Task 6, Task 8.
- Multi-day continuous bars: Task 7.
- Day, Week, All views: Task 7.
- Event colors: Task 1, Task 6, Task 8.
- Add events and sync back to Outlook: Task 5 preserves manual creation and extends immediate writeback for editable Outlook-backed events; existing scheduled export remains active for manual mapped entries.
- Add other employees and sync to their calendars: Task 5 uses the target employee's delegated connection through `loadWritableConnection`.
- Edit synced Outlook items and reclassify busy to meeting: Task 3 and Task 5.
- Invite functionality: Task 1 stores attendees, Task 3 builds Graph attendee payloads, Task 6 adds `Save and send updates`.
- Official logo: Task 8.

Placeholder scan:

- No disallowed placeholder markers are used.
- Commands include expected pass/fail results.
- Each code-changing task includes concrete code snippets and exact file paths.

Type consistency:

- `event_color`, `attendees`, `send_updates`, `sync_write_status`, `sync_write_error`, and `sync_write_attempted_at` are consistently named across schema, route, presenter, API, and UI tasks.
- Outlook categories consistently use `MSFG Schedule` plus one status category.
- Provider writeback consistently uses `source_provider` and `source_event_id`.
