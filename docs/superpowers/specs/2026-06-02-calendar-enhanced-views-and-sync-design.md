# Company Calendar Enhanced Views and Sync Design

## Goal

The company calendar should make employee availability fast to scan, while still allowing users to control whether event details are shared with the team. It should stop exposing raw internal employee IDs in the UI, add operational day/week/all views, support event colors, and make manual company calendar entries sync back to Outlook when the target employee has connected their company Outlook account.

## Core Decisions

- Employee selection will use names, not raw database IDs.
- NMLS numbers can be shown beside names when available. Example: `Zachary Zink - NMLS 451924`.
- Internal user IDs remain behind the scenes for API payloads.
- Every event defaults to `Hidden from Team`.
- Hidden events are visually dimmed. Shared events are visually brighter. This gives a quick scan of whether an event is team-visible without opening details.
- Users can share or hide details per event when the event is shareable.
- Company email calendars remain employee-owned. The app will sync to another employee's Outlook only through that employee's connected company Outlook account.
- Synced Outlook items owned by the connected employee can be edited from the MSFG calendar and written back to Outlook.
- Imported Outlook items can be reclassified after sync. For example, an event imported as `busy` can be changed to the MSFG `meeting_event` category.
- Invite support should be designed into the Outlook writeback flow, with employee-directory attendee picking and explicit save/send confirmation before new invites or attendee updates are pushed to Outlook.
- The calendar header should use the official MSFG logo asset in the top-right header area:
  `https://msfg-media.s3.us-west-2.amazonaws.com/Assets/LOGOS/MSFG+Home+Loans/MSFG-Color-Transparent.png`.

## Views

The calendar will support these view modes:

- `Day`: one selected day, focused on that day only.
- `Week`: one week with event bars laid across the week.
- `Month`: full month grid.
- `2 Months`: two month grids.
- `Year`: twelve compact month summaries.
- `People`: employee cards stacked with upcoming entries.
- `All`: employee rows stacked vertically, dates across columns like the older roster view.

The `All` view is the dense operations view. It should be the best place to compare all employee schedules at once.

## Multi-Day Event Rendering

Multi-day events should read as one continuous event.

- In `Week` and `All`, a multi-day event renders as one long horizontal bar spanning all covered days.
- In `Month`, a multi-day event renders as connected week-row segments. If an event crosses a week boundary, it continues on the next week row with the same color and label treatment.
- In compact views like `Year`, multi-day events affect day density indicators rather than full labels.

## Event Privacy Display

Every event has a visibility state:

- `availability_only`: details hidden from team.
- `shared_details`: details visible to team.

Visual rules:

- Hidden events are dimmed with lower opacity and softer contrast.
- Shared events are brighter and more saturated.
- Private provider events, such as Outlook private/sensitive items, stay hidden and cannot be made shared.
- The detail panel keeps explicit controls such as `Share details` and `Hide details`.

Imported Outlook/Google events start as `availability_only` even if their title is stored internally for the owner.

Manual events also start as `availability_only`.

## Employee Identity and NMLS

The schedule list and editor should use employee names.

The employee picker will load active employees from the user directory. The directory response should include `nmls_number` when available.

Picker labels:

- If NMLS exists: `Name - NMLS ######`.
- If NMLS is missing: `Name`.

The API still accepts `user_id`, but the UI should not ask the user to type a raw ID.

## Event Colors

Each schedule entry can have an optional color override.

- Existing status colors remain the default.
- The editor exposes color swatches and a custom color input if practical.
- Color applies to event bars and detail markers.
- Hidden/shared brightness is applied on top of the event color.

The first implementation should store the color on `schedule_entries` as `event_color`.

## Outlook Sync Behavior

The current sync model exports manual schedule entries to Outlook through connected user calendar connections. That model stays in place, but Outlook becomes truly two-way for employee-owned company calendar events.

Manual company calendar entry behavior:

- If a user creates an event for themselves and their Outlook is connected, the event exports to their Outlook calendar on sync.
- If a manager/admin creates an event for another employee and that employee has connected company Outlook, the event exports to that employee's Outlook calendar on sync.
- If the target employee has not connected Outlook, the event is saved internally and the UI shows that Outlook sync is not connected for that employee.

Synced Outlook event edit behavior:

- If an Outlook event was imported for the current employee, the employee can edit supported fields in the MSFG calendar and push those changes back to the same Outlook event.
- Managers/admins can edit another employee's Outlook-backed company event only when that employee has a connected Outlook account available for writeback.
- Supported writeback fields are status/category, title/note when details are shareable, start/end date and time, all-day state, visibility/sensitivity where allowed, color/category metadata, and attendees.
- Provider-private or sensitive Outlook events stay protected. They cannot be made shared, and Outlook subject/body/attendee changes should remain blocked for those events.
- Internal-only display changes, such as MSFG status/color labels, can still be saved for protected private events when they do not expose provider details.
- Outlook writeback failures should leave the internal entry visible but mark the entry with a sync warning and offer retry.

Outlook category/status mapping:

- `meeting_event`: Outlook `showAs: busy`, category `MSFG Meeting/Event`.
- `busy`: Outlook `showAs: busy`, category `MSFG Busy`.
- `out`: Outlook `showAs: oof`, category `MSFG Out`.
- `remote`: Outlook `showAs: workingElsewhere`, category `MSFG Remote`.
- `traveling`: Outlook `showAs: busy`, category `MSFG Traveling`.
- `other`: Outlook `showAs: busy`, category `MSFG Other`.

Invite behavior:

- The event editor should allow attendees to be selected from active company employees.
- Attendee data should use company email addresses from the user directory.
- Creating or updating attendees on an Outlook-backed event should use Outlook meeting attendee payloads so Outlook sends or updates invites.
- Because invites notify people, the UI should require an explicit `Save and send updates` action when attendee changes are included.

The app should not use tenant-wide Graph application permissions for this phase. Using each employee's delegated connected company Outlook account is safer and fits the existing architecture.

## Backend Changes

Add or update:

- `schedule_entries.event_color`.
- Sync status fields for provider writeback failures if the existing sync error tracking is not enough for entry-level warnings.
- Event attendee storage for internal entries and Outlook invite writeback.
- User directory fields to include `nmls_number`.
- Schedule list responses to include `event_color` and employee NMLS when available.
- Schedule create/update validation to accept event color.
- Provider-aware update path for Outlook-backed entries, using `source_provider` and `source_event_id` to patch the original Outlook event.
- Outlook provider payload support for status/category mapping, event colors/categories, and attendee create/update data.
- Tests for default `availability_only`, event color validation, NMLS directory data, target-user Outlook export behavior, and Outlook-backed imported event editing.

Manual create/update should continue enforcing existing permissions:

- Users can create/update their own entries.
- Managers/admins can create/update entries for other users.
- Users can update their own Outlook-backed synced entries through the provider-aware edit path.
- Managers/admins can update another employee's Outlook-backed entries only if the target employee has a connected Outlook account and the event is not provider-private/sensitive.
- Provider-private/sensitive entries remain limited to privacy-safe internal display fields and visibility cannot be changed to shared.

## Frontend Changes

Add or update:

- Employee picker in the editor.
- Header logo treatment using the official transparent MSFG logo image, with accessible alt text and responsive sizing.
- Day, Week, and All view modes.
- Multi-day bar layout helpers.
- Event brightness classes for hidden vs shared.
- Color swatch controls in the editor.
- Editable detail panel for supported Outlook-backed synced entries.
- Status/category control that can reclassify imported Outlook `busy` items as `meeting_event`.
- Attendee picker backed by the company employee directory.
- `Save` versus `Save and send updates` treatment when invite changes are present.
- Sync status messaging for target employees without connected Outlook.
- Sync warning and retry treatment for Outlook writeback failures.

Existing search and status filters should continue to work across all views.

## Error Handling

- If the employee directory cannot load, the editor should still allow the current user as a fallback.
- If Outlook sync is unavailable for the selected employee, saving the internal event should still succeed.
- Sync failures should surface as a warning, not block internal schedule visibility.
- If an Outlook-backed edit cannot be written back, the UI should keep the user on the event detail view and show a clear retryable sync warning.
- Invite updates should make it clear that Outlook may notify attendees.
- Private Outlook events cannot be shared and should retain the current private warning behavior.

## Testing

Backend:

- Schema accepts valid event colors and rejects invalid color strings.
- New manual entries default to hidden from team.
- Directory includes NMLS numbers.
- Schedule responses include employee NMLS and event color.
- Manual entries for another employee are exported through that employee's connected Outlook account.
- Imported Outlook event can be changed from `busy` to `meeting_event` and the provider patch includes the correct Outlook `showAs` and category payload.
- Private/sensitive Outlook events reject detail sharing and attendee/title/body writeback.
- Outlook-backed attendee updates include selected company employee emails.
- Managers/admins cannot write back to another employee's Outlook-backed event when the target employee has no connected Outlook account.

Frontend VM tests:

- Editor renders employee names/NMLS labels instead of raw ID labels.
- New entries default to hidden.
- View tabs include Day, Week, and All.
- Hidden event markup uses dimmed class; shared event markup uses bright class.
- Week/All multi-day entries render as spanning bars.
- Imported Outlook `busy` item can be opened and changed to `Meeting/Event`.
- Attendee picker renders employee names and emails and requires `Save and send updates` when attendees change.

Browser verification:

- Desktop and mobile views have no horizontal page overflow except inside intentionally dense `All` view if the date range requires horizontal comparison.
- Hidden/shared brightness is visible at a glance.
- Multi-day bars read as one event.
- Synced Outlook entries show editable supported fields and a clear synced-with-Outlook state.

## Out of Scope for This Phase

- Tenant-wide application permissions to write directly to any mailbox without employee-delegated connection.
- Google writeback expansion.
- PTO/hour tracking.
- Automatic NMLS import from licensing systems.
- Automatic editing of Outlook private/sensitive meeting details.
