# Outlook And Google Calendar Sync Design

Date: 2026-05-27

## Summary

Build Outlook calendar sync as the production path for the MSFG Company Calendar. Google Calendar remains in the architecture as a feature-flagged provider, but it is not broadly enabled in the first release because MSFG primarily uses Outlook and Google personal Gmail OAuth can require extra consent-screen and verification work.

The primary product goal is company-wide schedule visibility: employees should open the MSFG calendar and quickly see who is available, busy, out, tentative, or working elsewhere. This is not a PTO tracker and does not track hours.

## Decisions

- Outlook is the first production provider.
- Google is included as a later provider behind a feature flag.
- Sync is delegated per employee. Each user connects their own account.
- The Microsoft app uses delegated Graph permissions, not tenant-wide application mailbox permissions.
- Two-way sync is bounded:
  - Outlook-owned events import into MSFG as availability blocks.
  - MSFG-created schedule entries may export to that user's Outlook calendar.
  - MSFG does not edit or delete unrelated Outlook-owned events.
- Imported Outlook events default to `availability_only`.
- Coworkers see employee name, availability status, and time block by default.
- Outlook event subject, location, attendees, and notes stay hidden unless a later explicit sharing option is added.
- Import range is 30 days back and 180 days forward.
- Import busy, tentative, out-of-office, and working-elsewhere events.
- Skip free and cancelled/deleted events.
- Remove imported MSFG availability blocks when the source Outlook event is deleted or cancelled.
- Sync runs immediately after connect, every 15 minutes in the background, and on manual "Sync now."
- Admins can see connection health only: provider, connected status, last sync time, and last error.
- Admins cannot see tokens, secrets, hidden event details, personal notes, or personal event metadata.

## Existing Foundation

The repository already contains a partial calendar sync foundation:

- `backend/db/migrations/079_calendar_sync.sql`
- `backend/services/calendarSync/tokenCrypto.js`
- `backend/services/calendarSync/providers/outlook.js`
- `backend/services/calendarSync/providers/google.js`
- `backend/services/calendarSync/syncEngine.js`
- `backend/routes/scheduleSync.js`
- `Calculators/Company Calendar/calendar-sync.js`
- `Calculators/Company Calendar/calendar-api.js`

The existing route and provider code should be extended rather than replaced. Current placeholder behavior, such as returning `authorization_url: null` or syncing from an empty adapter, should become real provider behavior.

## Architecture

The backend owns OAuth, provider API calls, token refresh, and sync execution. The browser never sees OAuth client secrets, access tokens, or refresh tokens.

The existing `/api/schedule/sync` route remains the user-facing sync API surface:

- `GET /status`: return the current user's provider connection status.
- `POST /connections/:provider/start`: validate the provider, create a provider OAuth authorization URL, and return it to the browser.
- `GET /connections/:provider/callback`: validate OAuth state, exchange the code for tokens, store encrypted tokens, and redirect the user back to the calendar.
- `POST /run`: run a manual sync for the current user's enabled connection.
- `POST /connections/:provider/disconnect`: revoke/delete stored provider credentials and disable sync for that provider.

Provider logic should live behind adapter modules with a common interface:

- Build authorization URL.
- Exchange authorization code for tokens.
- Refresh expired access tokens.
- List events within a sync window.
- Create or update provider events for MSFG-owned schedule entries.
- Normalize provider events into MSFG `schedule_entries` fields.

Outlook is implemented first. Google should follow the same adapter shape but remain disabled unless `GOOGLE_CALENDAR_SYNC_ENABLED=true`.

## Data Flow

### Outlook Connection

1. Employee clicks "Connect Outlook."
2. Backend builds the Microsoft OAuth URL from server environment variables.
3. Employee signs into Microsoft and grants consent.
4. Microsoft redirects to `OUTLOOK_REDIRECT_URI`.
5. Backend validates OAuth state and exchanges the authorization code for tokens.
6. Tokens are encrypted and saved in `calendar_sync_connections`.
7. Backend runs the first sync immediately.
8. Browser returns to the company calendar and refreshes sync status.

### Import From Outlook

1. Sync engine loads the user's active Outlook connection.
2. Adapter refreshes the access token when needed.
3. Adapter fetches events from 30 days back through 180 days forward.
4. Adapter skips free, cancelled, and deleted events.
5. Adapter normalizes busy, tentative, out-of-office, and working-elsewhere events.
6. Sync engine upserts imported events into `schedule_entries`.
7. Imported entries are marked as provider-owned and read-only in MSFG.
8. Events missing from the provider response within the sync window are removed from MSFG.

### Export To Outlook

MSFG-created schedule entries can be exported to the connected user's Outlook calendar. The `calendar_sync_mappings` table tracks the provider event ID and sync metadata.

Export applies only to entries owned by MSFG. Outlook-owned entries imported into MSFG are not editable from MSFG and are not pushed back to Outlook.

## Privacy

The first release uses privacy-preserving availability sync:

- `availability_only` is the default for imported provider events.
- Imported event titles are not shown to coworkers.
- Imported locations, attendees, descriptions, and notes are not shown to coworkers.
- Private Outlook events are treated at least as strictly as normal events and remain availability-only.
- Admin status views never expose hidden event details.

The UI can later add a user-controlled "share event details" option, but that is outside the first implementation.

## UI

### Employee Calendar UI

The existing calendar sync panel should become functional:

- Outlook appears as the primary provider.
- Google appears only when enabled by config or omitted from the production UI.
- Provider states include:
  - Not connected
  - Connected
  - Syncing
  - Error
  - Paused
- Actions include:
  - Connect Outlook
  - Sync now
  - Disconnect

Outlook-owned imported entries open in the detail panel as read-only. The panel should tell the user to edit the source event in Outlook.

MSFG-created entries remain editable in MSFG. If the user has Outlook connected, those entries may sync to Outlook.

### Admin Status UI

Admin or manager views should show sync health only:

- User
- Provider
- Connected or disconnected
- Sync enabled or paused
- Last sync time
- Last error

No secrets, tokens, hidden event text, notes, locations, attendees, or private metadata should appear in admin UI.

## Permissions

### Microsoft Graph

Use delegated Microsoft Graph permissions:

- `Calendars.ReadWrite`
- `offline_access`
- `User.Read`

Do not use Microsoft Graph application permissions for this release. Application permissions would create broader tenant-wide mailbox access than this product needs.

### Google

Google remains feature-flagged. Because MSFG expects mostly personal Gmail usage, the Google OAuth app will be an external Google app and may require testing users, consent-screen setup, and later verification. The implementation should support Google structurally but keep it disabled until those steps are worth completing.

## Server Configuration

Required production environment variables:

- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_TENANT_ID`
- `OUTLOOK_CLIENT_SECRET`
- `OUTLOOK_REDIRECT_URI`
- `CALENDAR_SYNC_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_SYNC_ENABLED=false`

The Outlook client secret must not be committed to git, stored in frontend files, logged, or included in documentation. It belongs only in the server environment or a server-side secret store.

`CALENDAR_SYNC_ENCRYPTION_KEY` must decode to 32 bytes, matching the existing token crypto requirement.

## Error Handling

- A failed sync for one user does not block other users.
- Token refresh failure marks that connection as `error` and asks the user to reconnect.
- OAuth callback failures return a clear failure page or redirect back to the calendar with a safe error code.
- Provider rate limits should be stored as sync errors and retried on the next scheduled run.
- Last sync time, sync status, and last error are stored for user/admin visibility.
- User-facing copy should be plain, for example:
  - "Outlook needs to be reconnected."
  - "Sync failed. Try again."
  - "This event is managed in Outlook."

## Sync Cadence

Sync should run:

- Immediately after a user connects Outlook.
- Every 15 minutes for enabled connections.
- On manual "Sync now."

The first implementation can use an existing backend process timer or a small scheduled job, depending on the repo's deployment model. It should avoid overlapping sync runs for the same connection.

## Testing

Required coverage:

- OAuth URL generation.
- OAuth callback validation and token exchange success/failure paths.
- Token encryption and decryption.
- Access token refresh.
- Outlook event normalization.
- Import filtering for free/cancelled/deleted events.
- Upsert of imported entries.
- Removal of stale imported entries.
- Export of MSFG-owned entries to Outlook.
- Blocking edits to Outlook-owned entries in MSFG.
- Route tests for status, start, callback, sync now, disconnect, and error handling.
- Browser check for connected, disconnected, syncing, error, and read-only entry states.

Production smoke test:

1. Deploy backend config and restart API.
2. Connect one MSFG Outlook account.
3. Verify Outlook availability appears in the company calendar.
4. Verify hidden event details remain hidden.
5. Verify an MSFG-created entry exports to Outlook.
6. Delete or cancel an Outlook test event and verify it is removed from MSFG after sync.
7. Confirm admin status shows connection health and no hidden details.

## Rollout

1. Implement Outlook OAuth and sync using the existing sync scaffolding.
2. Keep Google disabled with `GOOGLE_CALENDAR_SYNC_ENABLED=false`.
3. Deploy backend environment variables.
4. Connect and test one MSFG Outlook account.
5. Verify import, export, privacy, and stale-event cleanup.
6. Enable for the team.
7. Revisit Google once Outlook is stable and there is enough demand to complete Google OAuth consent/testing/verification work.

## Out Of Scope For First Release

- PTO accounting.
- Hour tracking.
- Tenant-wide Microsoft application mailbox access.
- Admin viewing of personal calendar details.
- Editing unrelated Outlook-owned meetings from MSFG.
- Broad Google personal Gmail launch before OAuth consent and verification are resolved.
- Provider webhooks/change notifications. Polling every 15 minutes is sufficient for the first release.
