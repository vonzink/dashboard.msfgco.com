# Company Calendar Overhaul Design

Date: 2026-05-25
Status: Approved for implementation planning
Repo: `/Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com`
Target: `Calculators/Company Calendar/calendar.html`

## Summary

Replace the current generic company calendar with a shared employee availability board. The calendar is not a PTO tracker, timecard, or meeting scheduler. Its primary purpose is to let employees open the dashboard calendar and quickly see who is available, who is out, who is remote, who is traveling, and who is tied up in a meeting or event.

The design direction is the roster-style month board from the provided `Calander.zip` handoff, adapted away from "PTO" language and into MSFG schedule/availability language. The dashboard remains the primary shared company view. Optional Outlook and Google sync can enrich each employee's availability, with Outlook treated as the primary provider.

## Goals

- Show a shared, searchable company schedule board where employees can see availability across the company.
- Make the month view useful for scanning people by day without tracking hours.
- Support day/person detail for time-of-day busy blocks when synced calendar data exists.
- Let users create and maintain their own schedule entries manually.
- Let admins and managers manage schedule entries for anyone.
- Support optional Outlook and Google calendar sync with private-by-default imported busy blocks.
- Keep the implementation within the existing dashboard static frontend plus Express/MySQL backend deployment model.

## Non-Goals

- No PTO balances, accruals, approvals, payroll, or paid-time-off reporting.
- No hourly work tracking or timecard behavior.
- No general-purpose meeting-room scheduler.
- No requirement to create a shared Outlook calendar as the primary user experience in the first implementation plan.
- No exposure of imported personal event titles or details unless the employee explicitly enables sharing.

## Existing Context

The current calendar page is a FullCalendar popup under `Calculators/Company Calendar/`. It calls the dashboard backend at `/api/calendar-events` and stores generic events in `calendar_events` with fields such as `title`, `who`, `start`, `end`, `allDay`, `notes`, `color`, recurrence metadata, and `created_by`.

The current permissions model effectively lets any authenticated user edit any event. That is acceptable for a lightweight event board but is too loose for an employee schedule board.

The repo deploys frontend assets to S3/CloudFront through `./deploy.sh`. Backend changes live in the Express app under `backend/`, use MySQL migrations under `backend/db/migrations/`, and require backend deployment when routes, schemas, or tables change.

## Product Model

The rebuilt calendar is a shared availability board. It answers these questions:

- Who is available today?
- Who is out, remote, traveling, or tied up?
- What does a person's schedule look like this month?
- Can I search or filter to one person or a team/role?
- If someone connected Outlook or Google, are they busy during a specific part of the day?

Supported schedule statuses:

- `out`
- `remote`
- `traveling`
- `meeting_event`
- `other`

Manual dashboard entries can include:

- Employee/user
- Status
- Date range
- Optional time range
- Optional note
- Visibility setting

Imported external calendar entries default to private availability blocks. A synced Outlook or Google event should appear as a generic busy/unavailable block unless the employee opts into sharing the event title or detail.

## Permissions

- All authenticated employees can view the shared availability board.
- Employees can create, edit, and delete their own manual schedule entries.
- Admins and managers can create, edit, and delete schedule entries for any employee.
- Imported synced entries belong to the connected employee.
- Admins can view sync health and error status but must not receive private synced event titles/details unless those details were explicitly shared.
- External-user access should remain consistent with existing dashboard policy: external users may access news/announcements and calendar, but any employee availability detail exposed to external users should be deliberately reviewed during implementation.

## UI Design

### Persistent Header

Use the MSFG-branded header direction from the handoff:

- Brand mark/title on the left.
- Previous, Today, and Next controls.
- Current month or selected day display.
- Search/filter controls.
- Primary action for adding a schedule entry.

Language should use "schedule", "availability", "out", and "unavailable", not "PTO" or "time off" as the default product language.

### Summary Strip

The top summary cards should be adapted from the handoff:

- Available Today
- Unavailable Today
- Upcoming Schedule Notes

The summary should respect active search/filter scope when practical. Counts should distinguish manual schedule entries and private imported busy blocks without exposing private details.

### Month Roster View

The month roster is the default view:

- Employees are listed vertically.
- Days of the visible month run horizontally.
- Colored bars show `out`, `remote`, `traveling`, `meeting_event`, and `other`.
- Today, weekends, and holidays get subtle visual treatment.
- Users can search/filter by person and status.
- The board should support selecting an individual employee to focus their schedule.
- Manual entry creation can use click/drag on a person's row when permissions allow.

The month view remains day-level. It should not become an hourly grid.

### Day And Person Detail

The day/person detail view provides a closer look:

- Who is available on the selected day.
- Who is unavailable, remote, traveling, in a meeting/event, or other.
- For connected users, time-of-day busy blocks can appear in detail views.
- Private imported events should render as generic "Busy" or "Unavailable" blocks unless detail sharing is enabled.

### Year/Person Peek

The handoff's year-at-a-glance card is a useful enhancement. It can be included if it does not crowd the first implementation plan. If included, it should show availability density and status color without introducing PTO-specific labels.

## Data Model

The generic `calendar_events` model should be replaced or extended into a schedule-aware model. The implementation plan should choose whether to migrate in place or create new tables, but the target concepts are:

### `schedule_entries`

Stores manual and imported availability entries.

Required conceptual fields:

- `id`
- `user_id`
- `status`
- `start_date`
- `end_date`
- `start_time`
- `end_time`
- `timezone`
- `note`
- `visibility`
- `source`
- `source_provider`
- `source_event_id`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Expected values:

- `status`: `out`, `remote`, `traveling`, `meeting_event`, `other`, `busy`
- `visibility`: `availability_only`, `shared_details`
- `source`: `manual`, `outlook`, `google`

### `calendar_sync_connections`

Stores provider connection state per user.

Required conceptual fields:

- `id`
- `user_id`
- `provider`
- `provider_account_email`
- `encrypted_access_token`
- `encrypted_refresh_token`
- `scopes`
- `sync_enabled`
- `privacy_default`
- `last_sync_at`
- `sync_status`
- `sync_error`
- `created_at`
- `updated_at`

### `calendar_sync_mappings`

Maps dashboard entries to provider events.

Required conceptual fields:

- `id`
- `user_id`
- `schedule_entry_id`
- `provider`
- `provider_calendar_id`
- `provider_event_id`
- `provider_etag`
- `provider_change_token`
- `last_synced_at`

### `calendar_sync_runs`

Records diagnostic sync attempts.

Required conceptual fields:

- `id`
- `connection_id`
- `provider`
- `started_at`
- `finished_at`
- `status`
- `entries_imported`
- `entries_exported`
- `error_message`

## Sync Design

Outlook is the primary provider. Google Calendar is secondary but supported by the same adapter boundary.

Sync is optional per user. A user can use the dashboard calendar manually without connecting any external calendar.

Two-way sync means:

- Dashboard manual entries can create or update corresponding Outlook/Google events for connected users.
- External provider events can import into the dashboard as private busy/unavailable blocks.
- Provider edits update imported entries when a stable mapping exists.
- Provider deletions remove imported entries or sever mappings.

Conflict rules:

- Manual dashboard entries are authoritative over imported busy blocks.
- Imported provider entries should not overwrite manual dashboard notes/statuses unless they are explicitly mapped to that manual dashboard entry.
- Provider deletions must not delete unrelated manual entries.
- Duplicate prevention depends on provider event ids and the mapping table, not title/date matching alone.

Privacy rules:

- Imported events default to `availability_only`.
- Availability-only entries show date/time and generic busy/unavailable state.
- Event titles, descriptions, locations, attendees, and private notes are not shown on the shared board unless the employee opts into `shared_details`.
- Admin diagnostics can show provider/status/error metadata but not private event content.

Sync failure behavior:

- The dashboard board still loads manual and previously imported entries.
- The connected employee sees a sync status and reconnect prompt.
- Failed syncs are logged in `calendar_sync_runs`.
- Token expiration and provider rate limits should be retried without duplicating entries.

## Backend Architecture

Add focused backend routes rather than overloading the old generic event route indefinitely.

Expected route groups:

- `GET /api/schedule/entries`
- `POST /api/schedule/entries`
- `PUT /api/schedule/entries/:id`
- `DELETE /api/schedule/entries/:id`
- `GET /api/schedule/availability`
- `GET /api/schedule/sync/connections`
- `POST /api/schedule/sync/connections/:provider/start`
- `POST /api/schedule/sync/connections/:provider/callback`
- `DELETE /api/schedule/sync/connections/:id`
- `POST /api/schedule/sync/run`
- `GET /api/schedule/sync/status`

Implementation should keep provider-specific logic behind adapter modules, such as:

- `backend/services/calendarSync/outlook.js`
- `backend/services/calendarSync/google.js`
- `backend/services/calendarSync/privacy.js`
- `backend/services/calendarSync/mapping.js`

Validation schemas should live with the existing backend validation pattern and cover status, visibility, date range, optional time range, and ownership-sensitive update payloads.

## Frontend Architecture

Keep the calendar inside the current dashboard static deployment model. Do not introduce a new build system for the first implementation plan.

Split the current inline calendar script into focused files under `Calculators/Company Calendar/`, for example:

- `calendar.html`
- `styles.css`
- `calendar-api.js`
- `calendar-state.js`
- `calendar-render.js`
- `calendar-roster.js`
- `calendar-detail.js`
- `calendar-editor.js`
- `calendar-sync.js`

The implementation should not copy the prototype's React/Babel runtime. The handoff is a design reference, not production infrastructure.

The UI should remain responsive enough for dashboard popup usage. Desktop/tablet is the primary target. A small-screen mobile view can be simplified to list/detail if needed.

## Migration Approach

The implementation plan should include a migration path for existing `calendar_events` data:

- Existing generic events can be converted to `meeting_event` or `other` based on available fields.
- Existing `who` values should be mapped to users only when a reliable user match exists.
- Existing entries without a reliable user mapping can remain company-level schedule notes or be reviewed manually.
- The old route can be kept temporarily as a compatibility layer if needed, but the new UI should use schedule-specific endpoints.

## Testing And Verification

Backend tests:

- Status and visibility validation.
- Create/update/delete ownership rules.
- Admin/manager edit-anyone behavior.
- Imported private busy blocks do not expose title/detail fields.
- Mapping-based duplicate prevention.
- Provider deletion behavior for imported vs manual entries.

Sync tests:

- Mock Outlook import/export/update/delete flows.
- Mock Google import/export/update/delete flows.
- Token failure and reconnect status.
- Rate-limit retry behavior.
- Conflict handling between manual entries and imported provider entries.

Frontend checks:

- Month roster renders employees and day columns correctly.
- Search/filter narrows people and statuses.
- Manual entry create/edit/delete works for permitted users.
- Unauthorized edits are blocked or hidden.
- Private imported busy blocks render as generic unavailable blocks.
- Day/person detail shows time blocks when synced data exists.
- Responsive popup viewport does not overlap key controls.

Deployment verification:

- Frontend deploy through existing S3/CloudFront flow.
- Backend deploy when migrations/routes are added.
- Verify live calendar route with a cache-busted URL.
- Verify backend health and schedule endpoints after deployment.

## Open Implementation Decisions

These are implementation choices for the planning phase, not unresolved product requirements:

- Whether to migrate `calendar_events` in place or introduce `schedule_entries` as a new table.
- Whether the year-at-a-glance card lands in the first implementation phase or a follow-up phase.
- Whether sync runs initially execute on demand, by scheduled backend job, or both.
- Whether external calendar OAuth setup uses existing dashboard Cognito identity context only or additional provider app registration flows.

## Approved Decisions

- Direction B from the visual options: roster-style shared availability board.
- Use availability/schedule language instead of PTO language.
- Statuses: Out, Remote, Traveling, Meeting/Event, Other.
- Outlook and Google are the required sync providers, with Outlook primary.
- Two-way sync is a requirement, but it can be phased after the manual shared board foundation.
- Imported events default to private busy/unavailable blocks.
- Month view is day-level; day/person detail can show time-of-day blocks.
- Keep implementation inside the existing dashboard deployment model and split calendar code into focused static JS/CSS modules.
