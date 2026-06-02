# Calendar View Switcher And Detail Privacy Design

Date: 2026-06-01
Status: Draft for user review
Repo: `/Users/zacharyzink/MSFG/WebProjects/dashboard.msfgco.com`
Target: `Calculators/Company Calendar/calendar.html`

## Summary

Improve the MSFG Company Calendar after the initial Outlook sync release by replacing the horizontal-scrolling roster as the only primary view with a purpose-built view switcher:

- `Month`
- `2 Months`
- `Year`
- `People`

The primary goal remains company-wide availability visibility. Employees should be able to open the calendar and see the full month, a two-month planning window, or a year overview without fighting a horizontal scrollbar.

Outlook event details stay private by default. The syncing employee can selectively reveal details for individual imported events. Outlook private or sensitive events remain private and cannot be revealed to the shared company calendar.

## Approved Direction

The approved direction is option A from the visual design review: a view switcher with purpose-built layouts, not one oversized grid reused for every time range.

This means the app should not try to squeeze every employee and every day into one permanently wide table. Each view should answer a different scanning question:

- Month: "Who is available this month?"
- 2 Months: "What does near-term staffing look like?"
- Year: "Where are heavier absence or busy periods?"
- People: "What does this person's schedule look like?"

## Goals

- Remove the poor horizontal-scroll experience from the default calendar workflow.
- Make a full month visible at once on normal desktop widths.
- Add a two-month view for near-term planning.
- Add a year view for availability density and month-level scanning.
- Preserve employee search and status filtering.
- Keep calendar sync settings behind the existing settings cog.
- Keep Outlook details private by default.
- Let users reveal event details one imported event at a time.
- Prevent Outlook private/sensitive event details from being shared.

## Non-Goals

- No PTO balances, approval workflow, accruals, or hours tracking.
- No all-day hourly scheduler grid.
- No tenant-wide admin access to employee Outlook calendars.
- No automatic sharing of all Outlook event titles by default.
- No editing of Outlook-owned event times, titles, or attendees from MSFG.

## View Model

Add a calendar view mode to frontend state.

Expected modes:

- `month`
- `two_months`
- `year`
- `people`

The selected mode controls:

- The date range requested from `/api/schedule/entries`.
- The visible layout component.
- The header date label.
- The previous and next navigation step.

Navigation steps:

- Month: previous/next month.
- 2 Months: previous/next two-month window.
- Year: previous/next year.
- People: previous/next month while focused on selected/search-filtered people.

The backend already allows query ranges up to 370 days, which supports the year view without changing the public entries endpoint range limit.

## Month View

Month view is the default operational view.

The month view should fit the full month without horizontal scrolling on normal desktop widths. It should use compact day cells with availability markers and a detail panel instead of one fixed-width column per day.

Expected behavior:

- Show the full selected month.
- Keep weekends and today visually distinct.
- Show compact per-day availability markers.
- Let users click a day to inspect all entries for that date.
- Let users filter by employee, role/name search, and status.
- Show event titles only when the entry is shared or the current viewer is the owner.
- Use generic labels such as `Busy`, `Out`, or `Remote` for private imported entries.

Month view does not need to show every event title inline. It should prioritize density and scannability, with details available in the side panel.

## 2-Month View

The two-month view is a planning view.

Expected behavior:

- Show two adjacent months in one screen.
- Use month-card layouts rather than an employee-by-day table.
- Emphasize days with notable unavailable or busy counts.
- Allow clicking a day to open the same selected-day detail panel.
- Respect the same filters as month view.

This view is not meant to expose every event inline. It should help managers and employees notice upcoming staffing pressure.

## Year View

The year view is an overview, not a detailed schedule grid.

Expected behavior:

- Show all twelve months for the selected year.
- Use compact month cards with availability-density indicators.
- Highlight heavy unavailable/busy days or weeks.
- Let users click into a month or day to move to a more detailed view.
- Respect employee/status filters where practical.

Year view should make patterns visible without implying PTO balances or tracked hours.

## People View

People view focuses the calendar around employees.

Expected behavior:

- Keep the search-first workflow for finding a person.
- Show a selected person's month schedule in a readable layout.
- Allow clearing the person focus back to company-wide view.
- Provide the best place for the connected employee to review and manage imported event detail sharing.

This view can reuse the selected-day detail panel and provider detail controls.

## Outlook Detail Privacy

Default behavior:

- Imported Outlook entries are private by default.
- Coworkers see only availability, such as `Busy`, `Out`, `Remote`, or `Meeting/Event`.
- The event owner can see their own imported event title when Outlook permits it.
- The event owner can toggle a normal imported event to share details with coworkers.
- Outlook private or sensitive events remain private and cannot be toggled into shared detail mode.

This creates the product behavior the user requested: details are available by choice, not automatically shared.

## Data Model

The current `schedule_entries` table already has:

- `note`
- `visibility`
- `source`
- `source_provider`
- `source_event_id`

The next implementation should extend this model so imported provider details can be stored privately without making them visible by default.

Recommended additions:

- `details_shareable TINYINT DEFAULT 0`
- `provider_sensitivity VARCHAR(40) NULL`

Use `note` to store the event subject/title when the provider allows it and the event is not private/sensitive. Use `visibility` to decide whether coworkers can see that note.

Rules:

- Normal Outlook event:
  - `note` stores the event title.
  - `details_shareable = 1`.
  - `visibility = 'availability_only'` by default.
  - Owner can switch visibility to `shared_details`.
- Private/sensitive Outlook event:
  - `note` stays null or generic.
  - `details_shareable = 0`.
  - `visibility` remains `availability_only`.
  - UI does not offer a reveal-details toggle.

The public schedule presentation layer must continue to hide `note` unless `visibility = 'shared_details'` or the viewer is the owner. Admins should not see private provider details merely because they are admins.

## API Changes

Add a narrow route for imported event detail sharing. It should not make provider-owned events generally editable.

Recommended route:

- `PATCH /api/schedule/entries/:id/visibility`

Allowed body:

- `visibility: 'availability_only' | 'shared_details'`

Rules:

- Only the owner of a provider-owned entry can change provider-owned visibility.
- Admin/manager role does not override provider-event privacy for imported details.
- `shared_details` is allowed only when `details_shareable = 1`.
- Manual entries can keep using the existing create/update paths.
- The route returns the presented schedule entry after updating.

This avoids reopening broad edit permissions for Outlook-owned entries.

## Sync Import Changes

Outlook import should store event titles privately when safe:

- Fetch subject and sensitivity as it does today.
- For normal events, store subject in `note` even when connection default is `availability_only`.
- For private/sensitive events, do not store a shareable subject.
- Set `details_shareable` based on provider sensitivity and title availability.
- Keep imported visibility default as `availability_only`.

Existing users who already connected Outlook may need to run `Sync now` after this change to populate private event titles for owner review.

## UI Changes

### Header

Add a segmented view control near the month navigation:

- Month
- 2 Months
- Year
- People

Keep the settings cog for calendar connections. Do not reintroduce the full connection panel into the main calendar surface.

### Detail Panel

The selected-day/person detail panel should:

- Show normal shared titles to coworkers.
- Show private imported entries as generic availability.
- Show event titles to the owner when the provider permits them.
- Show a detail-sharing toggle for owner-viewed, provider-owned, shareable entries.
- Show a disabled/private note for provider private/sensitive entries.

Suggested labels:

- Toggle off: `Private`
- Toggle on: `Shared`
- Private provider item: `Private in Outlook`

### Calendar Cells

Calendar cells should use compact availability markers:

- Label or color for status.
- Count or stacked markers when multiple people/events overlap.
- Event title only if it is shared or the viewer is the owner.

The cells should not expand the month beyond the viewport.

## Error Handling

- If a visibility update fails because the event is not shareable, show `This Outlook event is private and cannot be shared.`
- If a visibility update fails because the user does not own the event, show `Only the connected calendar owner can change this event's sharing.`
- If a sync run fails, keep the current settings cog error state.
- If event details have not been imported yet, show the availability block and ask the owner to run sync again.

## Testing

Backend tests:

- Outlook normalization stores normal subjects privately even with `availability_only`.
- Outlook normalization does not store private/sensitive subjects as shareable.
- Presentation hides provider notes from coworkers while visibility is `availability_only`.
- Owner can see their own imported note.
- Owner can switch shareable imported event visibility to `shared_details`.
- Owner cannot share a non-shareable private/sensitive event.
- Admin cannot reveal provider-owned private details through the visibility route.
- Sync upsert preserves or updates detail-sharing fields correctly.

Frontend tests:

- View switcher renders Month, 2 Months, Year, and People modes.
- Month mode does not render the old permanently wide roster grid as the only view.
- Detail panel shows share toggle only for the owner on shareable provider events.
- Detail panel hides toggle for private/sensitive provider events.
- Settings cog remains the only entry point for provider connection controls.

Browser verification:

- Month view fits without horizontal scrolling at desktop width.
- Month view remains usable on mobile.
- 2-month and year views render without overflow.
- Owner can toggle an imported event from private to shared and back.
- Coworker view changes from `Busy` to the event title only after sharing.

## Rollout

1. Add database migration for detail-sharing metadata.
2. Update provider normalization and sync upsert.
3. Add visibility-only route for provider-owned entries.
4. Add frontend state for view mode.
5. Build month, two-month, year, and people render paths.
6. Add owner-only detail-sharing controls.
7. Run backend tests, frontend syntax checks, and browser visual checks.
8. Deploy backend first, then frontend S3/CloudFront.

The initial rollout can keep current connected users and imported entries. After deploy, users can run `Sync now` to import shareable event titles for owner-side review.
