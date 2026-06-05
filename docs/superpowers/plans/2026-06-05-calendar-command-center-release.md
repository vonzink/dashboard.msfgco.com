# Calendar Command Center Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Calendar Command Center release: sync health badges, privacy clarity, day drawer, bulk Outlook sharing, density indicators, search results panel, and admin sync overview.

**Architecture:** Keep the existing standalone calendar app and extend its current modules. Add small focused frontend modules for shared filtering, side panels, and bulk/admin UI, while preserving backend privacy enforcement in `backend/services/schedule/privacy.js` and schedule route ownership checks.

**Tech Stack:** Plain browser JavaScript, CSS, Express routes, MySQL queries through existing `db.query`, Vitest route/frontend tests, local browser verification.

---

### Task 1: Backend Bulk Visibility And Admin Sync Summary

**Files:**
- Modify: `backend/routes/schedule.js`
- Modify: `backend/routes/scheduleSync.js`
- Modify: `backend/validation/schemas.js`
- Test: `backend/tests/routes/schedule.test.js`
- Test: `backend/tests/routes/scheduleSync.test.js`

- [ ] **Step 1: Write failing backend tests**

Add tests that assert:

```js
it('bulk updates visibility for owned shareable Outlook entries', async () => {
  // POST/PATCH /api/schedule/entries/visibility/bulk
  // body: { entry_ids: [9, 10], visibility: 'shared_details' }
  // expected: 200, updated_entries contains both ids, failures is []
});

it('reports blocked private and non-owned entries during bulk visibility updates', async () => {
  // one entry is provider private, one entry is owned by another user
  // expected: eligible entry updates; failures include blocked ids and reasons
});

it('returns admin sync overview with shared hidden private and total counts', async () => {
  // GET /api/schedule/sync/admin/status?start_date=2026-06-01&end_date=2026-06-30
  // expected: connection row includes shared_event_count, hidden_event_count,
  // protected_event_count, total_synced_event_count
});
```

Run:

```bash
cd backend && npx vitest run tests/routes/schedule.test.js tests/routes/scheduleSync.test.js
```

Expected: fail because bulk route and aggregate fields do not exist.

- [ ] **Step 2: Add validation schema**

Add `scheduleEntryBulkVisibilityUpdate`:

```js
const scheduleEntryBulkVisibilityUpdate = z.object({
  entry_ids: z.array(z.coerce.number().int().positive()).min(1).max(100),
  visibility: z.enum(scheduleVisibility),
  viewers: z.array(z.object({
    user_id: z.coerce.number().int().positive(),
  })).optional().default([]),
});
```

Export it with the existing schemas.

- [ ] **Step 3: Implement backend bulk visibility endpoint**

Add `PATCH /entries/visibility/bulk` before `router.patch('/entries/:id/visibility', ...)`.

For each id:

1. Fetch the entry with `fetchEntry`.
2. Attach viewers/attendees when needed for presentation.
3. Require provider-owned entry.
4. Require Outlook provider.
5. Require current user ownership.
6. Require `details_shareable` for `shared_details`.
7. Reject provider-private/protected entries.
8. Update visibility and viewers.
9. Return `updated_entries` and `failures`.

Do not leak entry details in failure records; use `{ id, error }`.

- [ ] **Step 4: Implement admin aggregate counts**

Extend the admin sync status route to accept optional `start_date` and `end_date`. Join or query aggregate counts by `user_id` and `source_provider`.

Each connection row should include:

```js
shared_event_count
hidden_event_count
protected_event_count
total_synced_event_count
```

Use the current range if provided; otherwise return zero counts instead of failing.

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd backend && npx vitest run tests/routes/schedule.test.js tests/routes/scheduleSync.test.js
```

Expected: pass.

---

### Task 2: Shared Frontend Filtering And State

**Files:**
- Create: `Calculators/Company Calendar/calendar-filters.js`
- Modify: `Calculators/Company Calendar/calendar-state.js`
- Modify: `Calculators/Company Calendar/calendar.html`
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write failing frontend filter tests**

Add tests that assert:

```js
expect(CalendarFilters.visibleEntries(state)).toEqual([...]);
expect(CalendarFilters.entriesForDate(state, '2026-06-12')).toEqual([...]);
expect(CalendarFilters.searchResults(state)).toEqual([...]);
```

The tests must cover keyword, selected employee, status, synced-calendar, and date-range filters.

Expected: fail because `CalendarFilters` does not exist.

- [ ] **Step 2: Create `calendar-filters.js`**

Move/duplicate the current filtering rules into a shared `window.CalendarFilters` module with:

```js
visibleEntries(state)
entriesForDate(state, isoDate)
searchResults(state)
entryMatchesKeyword(state, entry)
entryMatchesCalendarFilter(state, entry)
entryPrivacyState(entry, currentUserId)
isBulkShareEligible(entry, currentUserId)
```

The module must not mutate state.

- [ ] **Step 3: Add state fields**

Add:

```js
drawerDate: null,
drawerFocusEntryId: null,
sidePanelMode: null,
selectedBulkEntryIds: new Set(),
adminSyncOverview: [],
adminSyncLoading: false,
adminSyncError: null,
```

- [ ] **Step 4: Wire roster to shared filters**

Update `calendar-roster.js` to use `CalendarFilters.visibleEntries(state)` and `CalendarFilters.entriesForDate(state, iso)`.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd backend && npx vitest run tests/frontend/calendarSyncUi.test.js
```

Expected: pass.

---

### Task 3: Sync Health And Privacy Clarity UI

**Files:**
- Modify: `Calculators/Company Calendar/calendar-render.js`
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Modify: `Calculators/Company Calendar/calendar-detail.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write failing UI tests**

Add tests for:

```js
expect(headerHtml).toContain('sync-health is-connected');
expect(headerHtml).toContain('Last synced');
expect(entryHtml).toContain('Hidden from Team');
expect(entryHtml).toContain('Shared with Team');
expect(entryHtml).toContain('Shared with Selected People');
expect(entryHtml).toContain('Private Provider Event');
```

Expected: fail because health/privacy labels are incomplete.

- [ ] **Step 2: Add sync health render helpers**

Render chip health from `teamSyncConnections`:

- `connected`
- `syncing`
- `error`
- `stale`

Use `last_sync_at` for labels. Avoid showing `sync_error` outside admin UI.

- [ ] **Step 3: Add privacy badge helpers**

Render privacy labels with deterministic rules:

- Provider-protected: `Private Provider Event`.
- Owner + viewers length > 0 + shared details: `Shared with Selected People`.
- Shared details with no viewers: `Shared with Team`.
- Availability only: `Hidden from Team`.
- Non-owner visible selected event: `Shared with You`.

- [ ] **Step 4: Style badges**

Use compact, high-contrast badges that fit inside existing dense calendar views. Do not introduce decorative backgrounds.

- [ ] **Step 5: Run frontend tests**

Run targeted frontend tests and verify pass.

---

### Task 4: Day Drawer And Search Results Panel

**Files:**
- Create: `Calculators/Company Calendar/calendar-panels.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/calendar-render.js`
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Modify: `Calculators/Company Calendar/calendar.html`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write failing panel tests**

Tests:

```js
expect(CalendarPanels.render(stateWithDrawerDate)).toContain('schedule-day-drawer');
expect(CalendarPanels.render(stateWithSearch)).toContain('schedule-search-panel');
expect(dayHtml).toContain('data-day-open="2026-06-12"');
```

Expected: fail because `CalendarPanels` does not exist.

- [ ] **Step 2: Create panel module**

`CalendarPanels.render(state)` should render:

- Day drawer for `drawerDate`.
- Search panel for non-empty `search`.
- Admin sync overview when loaded and settings/admin mode is active.
- Bulk action bar when entries are selected.

- [ ] **Step 3: Add actions**

Add actions in `calendar-main.js`:

```js
openDayDrawer(date, focusEntryId)
closeSidePanel()
focusEntryInDrawer(entryId)
toggleBulkEntry(entryId)
clearBulkSelection()
```

- [ ] **Step 4: Bind day clicks**

Update existing day click handling so month, two-month, and year clicks open the drawer. Day and week entry clicks can still open details/editor as currently designed.

- [ ] **Step 5: Render panels in shell**

Update `calendar-render.js` to include `CalendarPanels.render(state)` and bind `CalendarPanels.bind(...)`.

- [ ] **Step 6: Run frontend tests**

Run targeted frontend tests and verify pass.

---

### Task 5: Bulk Share Frontend And API Client

**Files:**
- Modify: `Calculators/Company Calendar/calendar-api.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/calendar-panels.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write failing tests**

Add API helper test:

```js
await CalendarApi.updateEntryVisibilityBulk([9, 10], 'shared_details', [{ user_id: 12 }]);
expect(calls[0].url).toBe('https://api.msfgco.com/api/schedule/entries/visibility/bulk');
```

Add panel tests for eligible and ineligible bulk checkboxes.

- [ ] **Step 2: Add API helper**

```js
updateEntryVisibilityBulk: (entryIds, visibility, viewers) => request('/schedule/entries/visibility/bulk', {
  method: 'PATCH',
  body: JSON.stringify({ entry_ids: entryIds, visibility, viewers: viewers || [] }),
})
```

- [ ] **Step 3: Add bulk action**

In `calendar-main.js`, add:

```js
async bulkUpdateVisibility(visibility, viewers)
```

It calls the API helper, replaces returned entries in `state.entries`, clears successful selected ids, and shows a toast with success/failure counts.

- [ ] **Step 4: Bind panel controls**

Bind:

- bulk checkboxes
- share with team
- hide from team
- selected people control placeholder using existing viewer picker mechanics where available

- [ ] **Step 5: Run tests**

Run targeted frontend and backend route tests.

---

### Task 6: Density Indicators

**Files:**
- Modify: `Calculators/Company Calendar/calendar-roster.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`

- [ ] **Step 1: Write failing density tests**

Assert:

```js
expect(monthHtml).toContain('day-density');
expect(yearHtml).toContain('density-dot');
expect(yearHtml).not.toContain('Private appointment title');
```

- [ ] **Step 2: Add density helper**

Create helper in `calendar-roster.js`:

```js
function renderDensityIndicators(entries) {
  // up to three status dots, total count, privacy split marker
}
```

- [ ] **Step 3: Update month/two-month/year rendering**

Use event bars for normal density and density indicators for overflow or compact views.

- [ ] **Step 4: Style density indicators**

Keep dots small, status-colored, and stable across mobile/desktop.

- [ ] **Step 5: Run tests**

Run targeted frontend tests.

---

### Task 7: Admin Sync Overview UI

**Files:**
- Modify: `Calculators/Company Calendar/calendar-api.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/calendar-sync.js`
- Modify: `Calculators/Company Calendar/calendar-panels.js`
- Modify: `Calculators/Company Calendar/styles.css`
- Test: `backend/tests/frontend/calendarSyncUi.test.js`
- Test: `backend/tests/routes/scheduleSync.test.js`

- [ ] **Step 1: Write failing admin UI tests**

Assert:

```js
expect(CalendarSync.render(adminState)).toContain('Admin Sync Overview');
expect(CalendarSync.render(nonAdminState)).not.toContain('Admin Sync Overview');
expect(CalendarSync.render(adminState)).toContain('hidden synced');
```

- [ ] **Step 2: Load admin overview lazily**

When settings opens, call `CalendarApi.getAdminSyncStatus(range)` if the user role indicates manager/admin. If request fails with 403, hide admin section and keep normal settings working.

- [ ] **Step 3: Render admin overview**

Show status, last sync, provider account, shared/hidden/protected/total counts, and sync error summary.

- [ ] **Step 4: Run tests**

Run targeted frontend and route tests.

---

### Task 8: Final Verification And Release

**Files:**
- Modify: `Calculators/Company Calendar/calendar.html`
- Verify all changed files.

- [ ] **Step 1: Cache bust calendar assets**

Update all calendar asset query strings to `20260605-command-center`.

- [ ] **Step 2: Run syntax checks**

Run `node --check` for every changed calendar JavaScript file.

- [ ] **Step 3: Run full backend tests**

Run:

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Browser preview**

Create a temporary preview harness with:

- connected synced employees
- shared/hidden/protected Outlook entries
- dense month/year days
- search query
- admin overview data

Verify desktop and mobile:

- no horizontal overflow
- day drawer opens and closes
- search panel renders
- bulk controls appear only for eligible entries
- admin overview does not overlap settings controls

- [ ] **Step 5: Commit and push**

Commit final implementation and push to `main` only after tests and browser verification pass.
