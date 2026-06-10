# Calendar Command Center Release Design

Date: 2026-06-05
Project: MSFG Dashboard Company Calendar
Scope: `Calculators/Company Calendar` frontend and schedule/sync backend APIs

## Objective

Turn the company calendar into a clearer availability workspace while keeping the primary goal unchanged: employees should quickly see who is available, who is out, and which synced company calendars are current and shared.

This release ships as one large calendar improvement, but the implementation must be split into bounded modules so each behavior can be tested independently.

## Approved Features

1. Sync health indicators for synced employees.
2. Clearer privacy labels for synced events.
3. Click-to-edit day drawer.
4. Bulk sharing controls for synced Outlook events.
5. Better event density in month, two-month, and year views.
6. Search results panel.
7. Admin sync overview.

## Non-Goals

- Do not replace the existing calendar entry point or create a separate application.
- Do not expose details for hidden/private provider events.
- Do not add PTO/hour tracking.
- Do not add Google writeback beyond the existing feature-flagged Google sync posture.
- Do not make private/provider-protected Outlook events shareable.

## Current System Context

The calendar currently loads from `calendar.html` and is composed of:

- `calendar-state.js` for view state and filter state.
- `calendar-main.js` for boot, API calls, actions, and mutations.
- `calendar-render.js` for top-level header, summary, tabs, filters, and shell event binding.
- `calendar-roster.js` for month/week/day/all/person rendering and entry filtering.
- `calendar-detail.js` for event detail display and owner sharing controls.
- `calendar-editor.js` for add/edit form behavior.
- `calendar-sync.js` for connection settings.
- `backend/routes/schedule.js` for schedule entries and visibility changes.
- `backend/routes/scheduleSync.js` for sync status, user sync operations, and admin sync status.
- `backend/services/schedule/privacy.js` for server-side visibility enforcement.

Recent selector work already added `team_connections` to `/api/schedule/sync/status` so connected employees can be selected even when they have no visible events in the current date range. This release should extend that path instead of deriving sync availability only from visible entries.

## Approach

Use a "Calendar Command Center" layout:

- The existing top toolbar remains the primary navigation and filtering surface.
- The left/main area remains the calendar view.
- A right side panel becomes the contextual workspace for search results, day details, bulk sharing, and admin sync overview.
- The settings cog remains the entry point for calendar connection settings and admin sync overview.

The release should avoid nested cards and keep the app operational and dense. Controls should be direct and familiar: chips for filters, badges for sync/privacy states, checkboxes for bulk selection, and side drawer panels for contextual editing.

## Feature Design

### 1. Sync Health Indicators

Each synced calendar filter chip should include a small health indicator:

- Connected: green dot or check badge.
- Syncing: neutral spinner or pulsing dot.
- Error: red warning badge.
- Not recently synced: amber clock badge.

The chip should expose a short tooltip or accessible label with:

- Provider name.
- Employee name.
- Sync status.
- Last sync timestamp when available.

User-facing chips should not expose raw token or OAuth errors. Admin views may show `sync_error`.

Data source:

- Extend `team_connections` from `/api/schedule/sync/status` if needed with `last_sync_at`, `sync_status`, and a derived health label.
- Keep raw sensitive fields out of normal employee-facing responses.

### 2. Privacy Clarity

Every synced event should show one clear privacy state:

- `Hidden from Team`: details are not visible to other employees.
- `Shared with Team`: details are visible to everyone who can access the calendar.
- `Shared with Selected People`: details are visible only to selected viewers.
- `Private Provider Event`: provider marked private or not shareable; details cannot be shared.

Owner view:

- Show the actual state and allow valid changes.
- Show selected viewers when applicable.

Non-owner view:

- Do not reveal hidden details.
- If the viewer can see a selected event, label it as `Shared with You`; do not show the full viewer list to non-owners.

Server rule:

- Privacy enforcement remains in `backend/services/schedule/privacy.js`.
- Frontend labels must never be treated as permission checks.

### 3. Click-To-Edit Day Drawer

Clicking a day in month, two-month, or year view opens a right-side drawer for that exact date.

Drawer contents:

- Date header.
- Events grouped by employee and time.
- Privacy badge on every synced event.
- Sync/provider badge on synced events.
- Quick add button for a manual event on that date.
- Edit controls for eligible events.
- Share/hide controls for synced Outlook events owned by the current user.
- Empty state with "Add Schedule".

Interaction:

- Day drawer does not replace the full calendar view.
- Selecting an event inside the drawer opens the existing editor or an inline edit panel using the same validation and save path.
- Escape and close button close the drawer.
- Drawer should preserve current calendar filters.

State additions:

- `drawerDate`
- `drawerMode` or equivalent for day/search/admin
- `selectedBulkEntryIds`

### 4. Bulk Sharing Controls

Bulk sharing applies only to eligible synced Outlook events.

Eligible entries:

- `source_provider = outlook`
- Provider-owned event.
- Current user is the owner.
- `details_shareable` is true.
- Event is not provider-private/protected.

Bulk actions:

- Share with team.
- Hide from team.
- Share with selected people.

Backend:

- Add a bulk visibility endpoint, for example `PATCH /api/schedule/entries/visibility/bulk`.
- Request body should include `entry_ids`, `visibility`, and optional `viewers`.
- The endpoint must validate each event server-side.
- It should return updated entries plus per-entry failures for blocked/private events.
- It should not partially leak details for entries the requester cannot manage.

Frontend:

- Checkboxes appear only where bulk selection makes sense: drawer and search results panel.
- A bulk action bar appears when at least one eligible synced Outlook event is selected.
- Ineligible events can be visible but cannot be selected; show a short reason on hover or in disabled text.

### 5. Better Event Density

Month, two-month, and year views should communicate busyness without overcrowding.

Month and two-month:

- Keep direct event bars for low-density days.
- When a day has more than the visual limit, show status-colored dots and a count badge such as `+4`.
- Preserve multi-day visual continuity where possible.

Year:

- Replace tiny full labels with density indicators:
  - Up to three status dots.
  - Total count.
  - A split privacy marker when both shared and hidden synced events are present on the same day.
- Clicking any year day opens the day drawer.

Density logic:

- Counts must respect current filters.
- Hidden/private entries count as availability only and must not expose details.
- Density indicators should use existing status colors from `STATUS_META`.

### 6. Search Results Panel

Keyword search should continue filtering the visible calendar, but it should also open a results panel when the query is non-empty.

Panel contents:

- Result count.
- Entries sorted by date, time, employee.
- Employee name.
- Date and time.
- Category/status.
- Provider badge.
- Privacy badge.
- Event title or safe display label.
- Quick edit/share controls when allowed.

Behavior:

- Clicking a result opens the day drawer focused on that event.
- Clearing search closes or empties the results panel.
- Employee dropdown and synced-calendar filters should narrow results consistently with the main calendar.

Implementation boundary:

- Build one shared filtered-entry helper so the calendar view and search panel do not drift.

### 7. Admin Sync Overview

Admins and managers get an admin-only sync overview in calendar settings.

Data shown:

- Employee name and email.
- Provider.
- Provider account email.
- Sync enabled state.
- Sync status.
- Last sync timestamp.
- Error summary when present.
- Count of visible shared events in the current calendar range.
- Count of hidden/private synced events in the current calendar range.

Backend:

- Extend `GET /api/schedule/sync/admin/status` or add a dedicated summary endpoint.
- Keep manager/admin protection through `requireManagerOrAdmin`.
- Return aggregate counts from schedule entries for the current calendar range: shared visible count, hidden synced count, protected/private count, and total synced count.

Frontend:

- Admin overview appears inside the settings dialog or a settings side panel.
- Non-admin users should not see the admin section.
- Failed admin requests should fail quietly with a non-blocking message.

## Data Flow

Boot sequence:

1. Load current user.
2. Load employee directory.
3. Load schedule entries for visible range.
4. Load sync status, including current user connections and team connections.
5. If user is manager/admin, lazy-load admin sync overview when settings panel opens.

User interactions:

- Calendar filter chips update `selectedCalendarKeys`.
- Day clicks update `drawerDate` and open the drawer.
- Search updates `search` and opens results panel.
- Bulk selection updates `selectedBulkEntryIds`.
- Bulk share calls the backend bulk visibility endpoint, then replaces updated entries in state.

## Error Handling

- Sync health errors appear as badges and concise messages, not blocking page load.
- Bulk share errors return per-entry results so successful updates are not hidden.
- Private/provider-protected events show a clear disabled state.
- Admin overview failure should not break normal calendar use.
- Existing toast behavior should be reused for save/share errors.

## Testing Plan

Frontend tests:

- Sync health badges render from `teamSyncConnections`.
- Privacy labels render for hidden, shared team, selected people, and protected provider events.
- Day clicks open a drawer with events for that date.
- Search query renders a results panel with safe labels and filtered results.
- Bulk selection appears only for eligible Outlook events.
- Month/year density indicators respect filters and do not expose private details.
- Admin section renders only when admin data is available.

Backend tests:

- Sync status/admin summary returns health fields without sensitive tokens.
- Bulk visibility endpoint updates eligible entries.
- Bulk visibility endpoint rejects or reports ineligible/private/non-owned entries.
- Privacy service continues to hide details from non-viewers.
- Admin sync overview is manager/admin only.

Browser verification:

- Desktop and mobile calendar previews.
- Month/year density layout has no horizontal overflow.
- Day drawer opens and closes cleanly.
- Search panel and drawer do not overlap controls.
- Bulk share success and blocked-event states are visible and readable.

## Rollout

This is one large release, but implementation should land in one branch with atomic commits:

1. Backend support for sync health, admin overview, and bulk visibility.
2. Shared frontend filtering/search helpers and state additions.
3. Sync health and privacy label UI.
4. Day drawer and search results panel.
5. Bulk selection/share UI.
6. Density indicators.
7. Browser verification, final tests, merge to main, and deploy.

## Acceptance Criteria

- Robert Hoff, Mike Wilson, and other connected employees remain selectable even without visible entries in the current range.
- Each synced calendar chip shows a health state and last synced context.
- Every synced event has a clear privacy indicator.
- Clicking a day opens a drawer where users can view, add, edit, or share eligible items.
- Users can bulk share/hide eligible Outlook events.
- Month/year views are easier to scan and do not overflow.
- Keyword search produces a results panel in addition to filtering.
- Admins can inspect team sync health from calendar settings.
- Hidden/private events do not leak details in any view.
