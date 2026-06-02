# Calendar View Switcher And Detail Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a purpose-built Month / 2 Months / Year / People view switcher and owner-controlled Outlook event detail sharing.

**Architecture:** Add backend metadata for whether imported provider details can be shared, expose a narrow owner-only visibility route, and keep provider-owned entries read-only otherwise. Refactor the static calendar frontend so date range loading and rendering are driven by a `viewMode`, with compact overview layouts replacing the always-wide roster as the default experience.

**Tech Stack:** Express, MySQL migrations, Zod, Vitest, static browser JavaScript, CSS, S3/CloudFront deployment.

---

## File Structure

- Modify `backend/db/migrations/082_schedule_entry_detail_privacy.sql`: add shareability metadata columns to `schedule_entries`.
- Modify `backend/validation/schemas.js`: add `scheduleEntryVisibilityUpdate` schema and metadata fields to schedule entry validation.
- Modify `backend/services/schedule/privacy.js`: include metadata flags in presented entries while preserving note privacy.
- Modify `backend/routes/schedule.js`: add `PATCH /api/schedule/entries/:id/visibility`.
- Modify `backend/services/calendarSync/providers/outlook.js`: store normal event subjects privately and mark private/sensitive events as not shareable.
- Modify `backend/services/calendarSync/providers/google.js`: align provider output with shareability metadata.
- Modify `backend/services/calendarSync/syncEngine.js`: persist detail metadata during imported upserts.
- Modify `backend/tests/services/calendarSync.test.js`: cover provider normalization and upsert metadata.
- Modify `backend/tests/services/schedulePrivacy.test.js`: cover owner/coworker/admin detail visibility.
- Modify `backend/tests/routes/schedule.test.js`: cover the visibility route.
- Modify `backend/tests/validation/schemas-extended.test.js`: cover the new schema.
- Modify `Calculators/Company Calendar/calendar-state.js`: add `viewMode`.
- Modify `Calculators/Company Calendar/calendar-main.js`: load date ranges by view mode and add actions for view and provider visibility.
- Modify `Calculators/Company Calendar/calendar-api.js`: add `updateEntryVisibility`.
- Modify `Calculators/Company Calendar/calendar-render.js`: render the view switcher and delegate to view-specific renderers.
- Modify `Calculators/Company Calendar/calendar-roster.js`: convert from only wide roster to view-aware rendering helpers.
- Modify `Calculators/Company Calendar/calendar-detail.js`: render owner-only share controls for provider-owned entries.
- Modify `Calculators/Company Calendar/styles.css`: add compact month, two-month, year, people, and sharing-control styles.
- Modify `backend/tests/frontend/calendarSyncUi.test.js`: add VM-level tests for view switcher and sharing controls.

## Task 1: Backend Detail Metadata Schema

**Files:**
- Create: `backend/db/migrations/082_schedule_entry_detail_privacy.sql`
- Modify: `backend/validation/schemas.js`
- Test: `backend/tests/validation/schemas-extended.test.js`

- [ ] **Step 1: Write validation tests for provider detail metadata**

Add this test under the existing `describe('scheduleEntry schema', ...)` block in `backend/tests/validation/schemas-extended.test.js`:

```js
it('accepts provider detail metadata for imported schedule entries', () => {
  const result = scheduleEntry.safeParse({
    user_id: 7,
    status: 'busy',
    start_date: '2026-06-01',
    end_date: '2026-06-01',
    visibility: 'availability_only',
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: 'outlook-1',
    details_shareable: true,
    provider_sensitivity: 'normal',
    note: 'Client review',
  });

  expect(result.success).toBe(true);
  expect(result.data.details_shareable).toBe(true);
  expect(result.data.provider_sensitivity).toBe('normal');
});
```

Add this new describe block near the calendar sync schema tests:

```js
describe('scheduleEntryVisibilityUpdate schema', () => {
  it('accepts supported visibility values', () => {
    expect(scheduleEntryVisibilityUpdate.safeParse({ visibility: 'shared_details' }).success).toBe(true);
    expect(scheduleEntryVisibilityUpdate.safeParse({ visibility: 'availability_only' }).success).toBe(true);
  });

  it('rejects unsupported visibility values', () => {
    expect(scheduleEntryVisibilityUpdate.safeParse({ visibility: 'public' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run validation tests and verify they fail**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/validation/schemas-extended.test.js
```

Expected: fail because `details_shareable`, `provider_sensitivity`, or `scheduleEntryVisibilityUpdate` is not defined/exported.

- [ ] **Step 3: Add the migration**

Create `backend/db/migrations/082_schedule_entry_detail_privacy.sql`:

```sql
SET @dbname = DATABASE();

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'schedule_entries' AND COLUMN_NAME = 'details_shareable');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE schedule_entries ADD COLUMN details_shareable TINYINT DEFAULT 0 AFTER source_event_id',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'schedule_entries' AND COLUMN_NAME = 'provider_sensitivity');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE schedule_entries ADD COLUMN provider_sensitivity VARCHAR(40) NULL AFTER details_shareable',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

- [ ] **Step 4: Add schema fields and export the visibility schema**

In `backend/validation/schemas.js`, update `scheduleEntryFields`:

```js
  details_shareable: z.coerce.boolean().optional(),
  provider_sensitivity: optionalString(40),
```

Add this near `calendarSyncRun`:

```js
const scheduleEntryVisibilityUpdate = z.object({
  visibility: z.enum(scheduleVisibility),
}).strict();
```

Add `scheduleEntryVisibilityUpdate` to `module.exports`.

- [ ] **Step 5: Run validation tests and verify they pass**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/validation/schemas-extended.test.js
```

Expected: pass.

## Task 2: Provider Import Stores Shareable Details Privately

**Files:**
- Modify: `backend/services/calendarSync/providers/outlook.js`
- Modify: `backend/services/calendarSync/providers/google.js`
- Modify: `backend/services/calendarSync/syncEngine.js`
- Test: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Write provider normalization tests**

Add these tests in `describe('Outlook provider adapter', ...)`:

```js
it('stores normal Outlook subjects privately when imported availability is private by default', () => {
  const { normalizeOutlookEvent } = require('../../services/calendarSync/providers/outlook');
  const event = normalizeOutlookEvent({
    id: 'normal-1',
    subject: 'Client strategy call',
    sensitivity: 'normal',
    showAs: 'busy',
    start: { dateTime: '2026-06-01T09:00:00', timeZone: 'Mountain Standard Time' },
    end: { dateTime: '2026-06-01T10:00:00', timeZone: 'Mountain Standard Time' },
  }, { user_id: 7, privacy_default: 'availability_only' });

  expect(event.visibility).toBe('availability_only');
  expect(event.note).toBe('Client strategy call');
  expect(event.details_shareable).toBe(true);
  expect(event.provider_sensitivity).toBe('normal');
});

it('does not mark private Outlook subjects as shareable', () => {
  const { normalizeOutlookEvent } = require('../../services/calendarSync/providers/outlook');
  const event = normalizeOutlookEvent({
    id: 'private-1',
    subject: 'Doctor',
    sensitivity: 'private',
    showAs: 'busy',
    start: { dateTime: '2026-06-01T09:00:00', timeZone: 'Mountain Standard Time' },
    end: { dateTime: '2026-06-01T10:00:00', timeZone: 'Mountain Standard Time' },
  }, { user_id: 7, privacy_default: 'availability_only' });

  expect(event.note).toBeNull();
  expect(event.details_shareable).toBe(false);
  expect(event.provider_sensitivity).toBe('private');
});
```

Update the existing upsert assertion in `imports provider entries and removes stale imported provider entries` to expect `details_shareable` and `provider_sensitivity` in the insert params.

- [ ] **Step 2: Run calendar sync tests and verify they fail**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/services/calendarSync.test.js
```

Expected: fail because provider output and upsert do not include the new fields.

- [ ] **Step 3: Update Outlook normalization**

In `backend/services/calendarSync/providers/outlook.js`, replace `canIncludeSubject` with:

```js
function providerSensitivity(event) {
  return event.sensitivity || 'normal';
}

function canStoreSubject(event) {
  return providerSensitivity(event) === 'normal' && Boolean(event.subject);
}
```

In `normalizeOutlookEvent`, set:

```js
  const sensitivity = providerSensitivity(event);
  const shareable = canStoreSubject(event);
```

Return:

```js
    note: shareable ? (event.subject || null) : null,
    details_shareable: shareable,
    provider_sensitivity: sensitivity,
```

- [ ] **Step 4: Update Google normalization**

In `backend/services/calendarSync/providers/google.js`, return:

```js
    note: event.summary || null,
    details_shareable: Boolean(event.summary),
    provider_sensitivity: event.visibility || null,
```

Google remains feature-flagged, but its provider output should match the sync engine contract.

- [ ] **Step 5: Persist metadata in imported upserts**

In `backend/services/calendarSync/syncEngine.js`, extend the insert column list:

```sql
details_shareable, provider_sensitivity
```

Extend the `ON DUPLICATE KEY UPDATE` list:

```sql
details_shareable=VALUES(details_shareable),
provider_sensitivity=VALUES(provider_sensitivity)
```

Add params after `entry.source_event_id`:

```js
      entry.details_shareable ? 1 : 0,
      entry.provider_sensitivity || null,
```

- [ ] **Step 6: Run calendar sync tests and verify they pass**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/services/calendarSync.test.js
```

Expected: pass.

## Task 3: Owner-Only Provider Visibility Route

**Files:**
- Modify: `backend/services/schedule/privacy.js`
- Modify: `backend/routes/schedule.js`
- Test: `backend/tests/services/schedulePrivacy.test.js`
- Test: `backend/tests/routes/schedule.test.js`

- [ ] **Step 1: Write privacy tests**

Add tests to `backend/tests/services/schedulePrivacy.test.js`:

```js
it('lets the owner see private imported event notes while coworkers see busy', () => {
  const entry = baseEntry({
    user_id: 10,
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: 'evt-1',
    note: 'Client Call',
    visibility: 'availability_only',
    details_shareable: 1,
  });

  expect(presentScheduleEntry(entry, reqFor(10, 'employee'))).toEqual(expect.objectContaining({
    note: 'Client Call',
    private: false,
    details_shareable: true,
  }));
  expect(presentScheduleEntry(entry, reqFor(11, 'employee'))).toEqual(expect.objectContaining({
    note: null,
    display_label: 'Busy',
    private: true,
    details_shareable: true,
  }));
});

it('does not let admins see private provider details by role alone', () => {
  const entry = baseEntry({
    user_id: 10,
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: 'evt-1',
    note: 'Client Call',
    visibility: 'availability_only',
    details_shareable: 1,
  });

  expect(presentScheduleEntry(entry, reqFor(20, 'admin'))).toEqual(expect.objectContaining({
    note: null,
    private: true,
  }));
});
```

- [ ] **Step 2: Write route tests**

Add tests to `backend/tests/routes/schedule.test.js`:

```js
it('lets the owner share a shareable provider-owned event detail', async () => {
  db.query
    .mockResolvedValueOnce([[
      {
        id: 9,
        user_id: 10,
        status: 'busy',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        start_time: null,
        end_time: null,
        timezone: 'America/Denver',
        note: 'Client Call',
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
        status: 'busy',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        start_time: null,
        end_time: null,
        timezone: 'America/Denver',
        note: 'Client Call',
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
  expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
    id: 9,
    note: 'Client Call',
    visibility: 'shared_details',
    private: false,
  }));
});

it('blocks sharing a provider-owned event when the owner does not own it', async () => {
  db.query.mockResolvedValueOnce([[
    {
      id: 9,
      user_id: 99,
      status: 'busy',
      source: 'outlook',
      source_provider: 'outlook',
      source_event_id: 'event-1',
      details_shareable: 1,
      visibility: 'availability_only',
    },
  ]]);

  const res = await makeJsonRequest(app, '/api/schedule/entries/9/visibility', {
    visibility: 'shared_details',
  }, {}, 'PATCH');

  expect(res.status).toBe(403);
  expect(JSON.parse(res.body)).toEqual({
    error: "Only the connected calendar owner can change this event's sharing.",
  });
});

it('blocks sharing a private provider-owned event', async () => {
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
      visibility: 'availability_only',
    },
  ]]);

  const res = await makeJsonRequest(app, '/api/schedule/entries/9/visibility', {
    visibility: 'shared_details',
  }, {}, 'PATCH');

  expect(res.status).toBe(409);
  expect(JSON.parse(res.body)).toEqual({
    error: 'This Outlook event is private and cannot be shared.',
  });
});
```

- [ ] **Step 3: Run schedule tests and verify they fail**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/services/schedulePrivacy.test.js tests/routes/schedule.test.js
```

Expected: fail because presentation fields and route do not exist.

- [ ] **Step 4: Update schedule presentation**

In `backend/services/schedule/privacy.js`, update `presentScheduleEntry` to include:

```js
    details_shareable: Boolean(entry.details_shareable),
    provider_sensitivity: entry.provider_sensitivity || null,
```

Keep `note: visible ? (entry.note || null) : null`.

- [ ] **Step 5: Add visibility route**

In `backend/routes/schedule.js`, import `scheduleEntryVisibilityUpdate`.

Add before `router.put('/entries/:id', ...)`:

```js
router.patch('/entries/:id/visibility', validate(scheduleEntryVisibilityUpdate), async (req, res, next) => {
  try {
    const entry = await fetchEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Schedule entry not found' });
    if (!isProviderOwned(entry)) return res.status(409).json({ error: 'This schedule entry is not managed by a calendar provider.' });
    if (Number(entry.user_id) !== Number(getUserId(req))) {
      return res.status(403).json({ error: "Only the connected calendar owner can change this event's sharing." });
    }
    if (req.body.visibility === 'shared_details' && !entry.details_shareable) {
      return res.status(409).json({ error: `This ${providerName(entry)} event is private and cannot be shared.` });
    }

    await db.query(
      `UPDATE schedule_entries
       SET visibility = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.body.visibility, getUserId(req), entry.id]
    );

    const updated = await fetchEntry(entry.id);
    return res.json(presentScheduleEntry(updated, req));
  } catch (error) {
    return next(error);
  }
});
```

- [ ] **Step 6: Run schedule tests and verify they pass**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/services/schedulePrivacy.test.js tests/routes/schedule.test.js
```

Expected: pass.

## Task 4: Frontend API And View State

**Files:**
- Modify: `Calculators/Company Calendar/calendar-api.js`
- Modify: `Calculators/Company Calendar/calendar-state.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write frontend VM tests for view state helpers**

Add a VM test that loads `calendar-state.js` and asserts:

```js
expect(state.viewMode).toBe('month');
expect(CalendarState.visibleRange({ ...state, viewMode: 'two_months' })).toEqual({
  start_date: '2026-06-01',
  end_date: '2026-07-31',
});
expect(CalendarState.visibleRange({ ...state, viewMode: 'year' })).toEqual({
  start_date: '2026-01-01',
  end_date: '2026-12-31',
});
```

- [ ] **Step 2: Run frontend VM tests and verify they fail**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/frontend/calendarSyncUi.test.js
```

Expected: fail because `viewMode` and `visibleRange` do not exist.

- [ ] **Step 3: Add view state helpers**

In `calendar-state.js`, add `viewMode: 'month'` to `createState()`.

Add:

```js
function visibleRange(state) {
  const viewDate = state.viewDate || new Date();
  if (state.viewMode === 'year') {
    return {
      start_date: `${viewDate.getFullYear()}-01-01`,
      end_date: `${viewDate.getFullYear()}-12-31`,
    };
  }
  if (state.viewMode === 'two_months') {
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 2, 0);
    return { start_date: isoDate(start), end_date: isoDate(end) };
  }
  return monthRange(viewDate);
}
```

Export `visibleRange`.

- [ ] **Step 4: Use visible range and add actions**

In `calendar-main.js`, replace `CalendarState.monthRange(state.viewDate)` with `CalendarState.visibleRange(state)`.

Add actions:

```js
setViewMode(mode) {
  state.viewMode = mode;
  actions.reload();
},
async updateEntryVisibility(id, visibility) {
  try {
    await CalendarApi.updateEntryVisibility(id, visibility);
    await loadEntries();
    CalendarRender.render(app, state, actions);
    showToast(visibility === 'shared_details' ? 'Event details shared.' : 'Event details hidden.', 'success');
  } catch (err) {
    showToast(err.message || 'Unable to update event sharing.', 'error');
  }
},
```

In `calendar-api.js`, add:

```js
updateEntryVisibility: (id, visibility) => request(`/schedule/entries/${id}/visibility`, {
  method: 'PATCH',
  body: JSON.stringify({ visibility }),
}),
```

- [ ] **Step 5: Run frontend VM tests and syntax checks**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/frontend/calendarSyncUi.test.js
cd ..
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-state.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-main.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-api.js"
```

Expected: pass.

## Task 5: View Switcher And Purpose-Built Layouts

**Files:**
- Modify: `Calculators/Company Calendar/calendar-render.js`
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write frontend render tests**

Add VM tests that assert:

```js
expect(CalendarRender.renderViewTabs({ viewMode: 'month' })).toContain('data-view-mode="month"');
expect(CalendarRender.renderViewTabs({ viewMode: 'month' })).toContain('data-view-mode="two_months"');
expect(CalendarRender.renderViewTabs({ viewMode: 'month' })).toContain('data-view-mode="year"');
expect(CalendarRoster.render({ ...state, viewMode: 'year' })).toContain('year-overview');
expect(CalendarRoster.render({ ...state, viewMode: 'two_months' })).toContain('two-month-overview');
expect(CalendarRoster.render({ ...state, viewMode: 'month' })).toContain('month-overview');
```

- [ ] **Step 2: Run frontend tests and verify they fail**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/frontend/calendarSyncUi.test.js
```

Expected: fail because render helpers and view-specific classes do not exist.

- [ ] **Step 3: Add view tabs**

In `calendar-render.js`, add:

```js
function renderViewTabs(state) {
  const modes = [
    ['month', 'Month'],
    ['two_months', '2 Months'],
    ['year', 'Year'],
    ['people', 'People'],
  ];
  return `
    <div class="view-tabs" aria-label="Calendar view">
      ${modes.map(([mode, label]) => `
        <button class="filter-chip ${state.viewMode === mode ? 'is-active' : ''}" type="button" data-view-mode="${mode}" aria-pressed="${state.viewMode === mode ? 'true' : 'false'}">${escapeHtml(label)}</button>
      `).join('')}
    </div>
  `;
}
```

Render it below the header or inside the header controls.

Bind:

```js
root.querySelectorAll('[data-view-mode]').forEach((button) => {
  button.addEventListener('click', () => actions.setViewMode(button.dataset.viewMode));
});
```

Export `renderViewTabs`.

- [ ] **Step 4: Add view-specific roster renderers**

In `calendar-roster.js`, keep existing helper functions and add:

```js
function renderMonthOverview(state) {
  return `<section class="roster-card month-overview" aria-label="Month availability overview">...</section>`;
}

function renderTwoMonthOverview(state) {
  return `<section class="roster-card two-month-overview" aria-label="Two month availability overview">...</section>`;
}

function renderYearOverview(state) {
  return `<section class="roster-card year-overview" aria-label="Year availability overview">...</section>`;
}

function renderPeopleOverview(state) {
  return `<section class="roster-card people-overview" aria-label="People availability overview">...</section>`;
}
```

Use real implementation, not literal ellipses:

- Month: grid all days of current month with `month-day-card` cells.
- 2 Months: two `overview-month-card` grids.
- Year: twelve `year-month-card` summaries.
- People: reuse a focused row/list by person with selected person's entries.

The old wide roster can remain reachable only as part of People view if it is useful, but the default `month` render must not be the old fixed-width day-column grid.

- [ ] **Step 5: Add CSS**

In `styles.css`, add:

```css
.view-tabs {
  margin-bottom: 12px;
}

.month-grid,
.two-month-grid,
.year-grid,
.people-grid {
  display: grid;
  gap: 10px;
}

.month-grid {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.two-month-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.year-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.month-day-card,
.year-month-card,
.overview-month-card {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: #fff;
}
```

Also add mobile media rules so `.month-grid`, `.two-month-grid`, and `.year-grid` use fewer columns without horizontal overflow.

- [ ] **Step 6: Run frontend tests and syntax checks**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/frontend/calendarSyncUi.test.js
cd ..
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-render.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-roster.js"
```

Expected: pass.

## Task 6: Owner Detail Sharing Controls

**Files:**
- Modify: `Calculators/Company Calendar/calendar-detail.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write detail control render tests**

Add frontend VM assertions:

```js
expect(CalendarDetail.render(ownerStateWithShareableProviderEntry)).toContain('data-entry-visibility');
expect(CalendarDetail.render(coworkerStateWithShareableProviderEntry)).not.toContain('data-entry-visibility');
expect(CalendarDetail.render(ownerStateWithPrivateProviderEntry)).toContain('Private in Outlook');
expect(CalendarDetail.render(ownerStateWithPrivateProviderEntry)).not.toContain('data-entry-visibility');
```

- [ ] **Step 2: Run frontend tests and verify they fail**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/frontend/calendarSyncUi.test.js
```

Expected: fail because detail sharing controls do not exist.

- [ ] **Step 3: Add owner/shareability helpers**

In `calendar-detail.js`, add:

```js
function currentUserId(state) {
  const me = state.me || {};
  return String(me.id || me.user_id || me.userId || me.employee_id || me.employeeId || '');
}

function isOwner(entry, state) {
  return entryUserId(entry) === currentUserId(state);
}

function canToggleProviderDetails(entry, state) {
  return isOutlookOwnedEntry(entry) && isOwner(entry, state) && Boolean(entry.details_shareable);
}
```

Render inside each detail entry body:

```js
${canToggleProviderDetails(entry, state) ? `
  <button class="detail-share-toggle" type="button" data-entry-visibility="${escapeHtml(entry.id)}" data-next-visibility="${entry.visibility === 'shared_details' ? 'availability_only' : 'shared_details'}">
    ${entry.visibility === 'shared_details' ? 'Shared' : 'Private'}
  </button>
` : ''}
${isOutlookOwnedEntry(entry) && isOwner(entry, state) && !entry.details_shareable ? '<span class="detail-note">Private in Outlook</span>' : ''}
```

In `bind`, add:

```js
root.querySelectorAll('[data-entry-visibility]').forEach((button) => {
  button.addEventListener('click', () => {
    if (actions.updateEntryVisibility) {
      actions.updateEntryVisibility(button.dataset.entryVisibility, button.dataset.nextVisibility);
    }
  });
});
```

- [ ] **Step 4: Add styles**

Add:

```css
.detail-share-toggle {
  justify-self: start;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
```

- [ ] **Step 5: Run frontend tests and syntax checks**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test -- tests/frontend/calendarSyncUi.test.js
cd ..
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-detail.js"
```

Expected: pass.

## Task 7: Full Verification And Browser Checks

**Files:**
- Test only.

- [ ] **Step 1: Run backend test suite**

Run:

```bash
cd backend
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH npm test
```

Expected: all Vitest files pass.

- [ ] **Step 2: Run frontend syntax checks**

Run:

```bash
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-api.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-state.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-render.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-roster.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-detail.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-main.js"
PATH=/Users/zacharyzink/.nvm/versions/node/v24.13.0/bin:$PATH node --check "Calculators/Company Calendar/calendar-sync.js"
```

Expected: no output and exit 0 for each file.

- [ ] **Step 3: Browser preview**

Create a temporary local preview HTML file with mocked state and delete it after checks. Verify:

- Month view renders without horizontal overflow.
- 2 Months view renders without horizontal overflow.
- Year view renders without horizontal overflow.
- People view renders.
- Settings cog opens the connection dialog.
- Owner share toggle appears only for shareable provider entries.

- [ ] **Step 4: Commit**

Run:

```bash
git add backend/db/migrations/082_schedule_entry_detail_privacy.sql backend/validation/schemas.js backend/services/schedule/privacy.js backend/routes/schedule.js backend/services/calendarSync/providers/outlook.js backend/services/calendarSync/providers/google.js backend/services/calendarSync/syncEngine.js backend/tests/services/calendarSync.test.js backend/tests/services/schedulePrivacy.test.js backend/tests/routes/schedule.test.js backend/tests/validation/schemas-extended.test.js backend/tests/frontend/calendarSyncUi.test.js "Calculators/Company Calendar/calendar-api.js" "Calculators/Company Calendar/calendar-state.js" "Calculators/Company Calendar/calendar-main.js" "Calculators/Company Calendar/calendar-render.js" "Calculators/Company Calendar/calendar-roster.js" "Calculators/Company Calendar/calendar-detail.js" "Calculators/Company Calendar/styles.css"
git commit -m "feat: add calendar view switcher and detail sharing"
git push origin codex/complete-calendar-sync
```

Expected: push succeeds and branch is clean.

## Self-Review

- Spec coverage: The plan covers backend privacy metadata, provider import changes, owner-only visibility route, frontend view modes, purpose-built Month / 2 Months / Year / People layouts, owner detail sharing controls, tests, and browser verification.
- Placeholder scan: This plan contains no `TBD`, `TODO`, `FIXME`, or incomplete steps.
- Type consistency: The plan consistently uses `viewMode`, `visibleRange`, `details_shareable`, `provider_sensitivity`, and `scheduleEntryVisibilityUpdate`.
