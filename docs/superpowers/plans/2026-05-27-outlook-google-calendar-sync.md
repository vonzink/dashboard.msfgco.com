# Outlook Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build production Outlook calendar sync for the MSFG Company Calendar, with Google kept behind a disabled feature flag.

**Architecture:** The backend owns OAuth, token storage, provider calls, and sync execution. Outlook is implemented through a provider adapter used by the existing schedule sync routes and sync engine; the frontend only starts OAuth, displays sync state, and requests manual sync. Google keeps the same adapter boundary but remains disabled by config.

**Tech Stack:** Node.js, Express, Vitest, MySQL, Microsoft Graph REST API, browser JavaScript, existing static dashboard deployment.

---

## File Structure

- Modify: `backend/db/migrations/079_calendar_sync.sql`
  - Keep existing base schema accurate for fresh installs.
- Create: `backend/db/migrations/080_calendar_sync_oauth_metadata.sql`
  - Add OAuth state, token expiry, provider calendar ID, and safer sync mapping uniqueness.
- Create: `backend/services/calendarSync/config.js`
  - Read provider config from environment variables and centralize callback/frontend redirect URLs.
- Create: `backend/services/calendarSync/window.js`
  - Compute the 30-day-back and 180-day-forward sync window.
- Create: `backend/services/calendarSync/oauthState.js`
  - Generate, store, and validate OAuth state values tied to a user/provider connection.
- Modify: `backend/services/calendarSync/providers/outlook.js`
  - Add real Microsoft OAuth token exchange, refresh, Graph event listing, Graph event export, and event normalization/filtering.
- Modify: `backend/services/calendarSync/providers/google.js`
  - Keep normalization and expose disabled adapter shape for future config-enabled use.
- Modify: `backend/services/calendarSync/syncEngine.js`
  - Import provider-owned events, delete stale provider-owned events, export MSFG-owned entries, update run/status fields.
- Modify: `backend/routes/scheduleSync.js`
  - Authenticated status/start/run/disconnect/admin-health routes.
- Create: `backend/routes/scheduleSyncPublic.js`
  - Public OAuth callback route mounted before authenticated sync routes.
- Modify: `backend/routes/schedule.js`
  - Block updates/deletes to provider-owned entries server-side and present source metadata needed by the frontend.
- Modify: `backend/services/schedule/privacy.js`
  - Return safe source metadata while preserving hidden provider details.
- Modify: `backend/server.js`
  - Mount public callback route before authenticated sync route and start the optional scheduler.
- Create: `backend/services/calendarSync/scheduler.js`
  - Run enabled connections every 15 minutes without overlapping the same connection.
- Modify: `backend/tests/services/calendarSync.test.js`
  - Add provider config, OAuth, normalization, sync window, import/delete/export tests.
- Modify: `backend/tests/routes/scheduleSync.test.js`
  - Add start/callback/run/disconnect/admin status tests.
- Modify: `backend/tests/routes/schedule.test.js`
  - Add provider-owned read-only tests.
- Modify: `Calculators/Company Calendar/calendar-api.js`
  - Add start connection, manual sync, disconnect, and admin sync status calls.
- Modify: `Calculators/Company Calendar/calendar-sync.js`
  - Render working Outlook connect/sync/disconnect/error UI and hide Google unless enabled.
- Modify: `Calculators/Company Calendar/calendar-detail.js`
  - Show provider-owned entries as read-only with "Edit this in Outlook."
- Modify: `Calculators/Company Calendar/calendar-main.js`
  - Wire sync actions and reload entries after manual sync.
- Modify: `Calculators/Company Calendar/styles.css`
  - Add sync action/error/read-only detail styles.
- Optional production config only, not git: backend environment variables on EC2.

## Execution Notes

- Do not commit Outlook client secret values.
- Use a freshly generated production client secret in the server environment before broad rollout because the initial secret was shared in chat.
- Use this registered redirect URI for Outlook: `https://api.msfgco.com/api/schedule/sync/outlook/callback`.
- Keep `GOOGLE_CALENDAR_SYNC_ENABLED=false` for first release.
- Run backend tests from `backend/`.
- Keep `.planning/` and `.superpowers/` untracked unless the user explicitly asks to include them.

---

### Task 1: Add OAuth Metadata Schema

**Files:**
- Modify: `backend/db/migrations/079_calendar_sync.sql`
- Create: `backend/db/migrations/080_calendar_sync_oauth_metadata.sql`
- Test: schema verification by migration SQL review and backend route tests in later tasks

- [ ] **Step 1: Add metadata columns to the base schema**

In `backend/db/migrations/079_calendar_sync.sql`, update `calendar_sync_connections` so fresh installs include:

```sql
    provider_calendar_id VARCHAR(255) NULL,
    encrypted_access_token TEXT NULL,
    access_token_expires_at TIMESTAMP NULL,
    encrypted_refresh_token TEXT NULL,
    scopes TEXT NULL,
    oauth_state VARCHAR(128) NULL,
    oauth_state_expires_at TIMESTAMP NULL,
```

The column order should be:

```sql
    provider_account_email VARCHAR(255) NULL,
    provider_calendar_id VARCHAR(255) NULL,
    encrypted_access_token TEXT NULL,
    access_token_expires_at TIMESTAMP NULL,
    encrypted_refresh_token TEXT NULL,
    scopes TEXT NULL,
    oauth_state VARCHAR(128) NULL,
    oauth_state_expires_at TIMESTAMP NULL,
```

- [ ] **Step 2: Make mapping uniqueness user-scoped in the base schema**

In `backend/db/migrations/079_calendar_sync.sql`, replace:

```sql
    UNIQUE KEY uq_calendar_sync_mapping (provider, provider_event_id),
```

with:

```sql
    UNIQUE KEY uq_calendar_sync_mapping (user_id, provider, provider_event_id),
```

- [ ] **Step 3: Create the incremental migration**

Create `backend/db/migrations/080_calendar_sync_oauth_metadata.sql`:

```sql
ALTER TABLE calendar_sync_connections
    ADD COLUMN provider_calendar_id VARCHAR(255) NULL AFTER provider_account_email,
    ADD COLUMN access_token_expires_at TIMESTAMP NULL AFTER encrypted_access_token,
    ADD COLUMN oauth_state VARCHAR(128) NULL AFTER scopes,
    ADD COLUMN oauth_state_expires_at TIMESTAMP NULL AFTER oauth_state;

ALTER TABLE calendar_sync_mappings
    DROP INDEX uq_calendar_sync_mapping,
    ADD UNIQUE KEY uq_calendar_sync_mapping (user_id, provider, provider_event_id);
```

- [ ] **Step 4: Verify SQL diff**

Run:

```bash
git diff -- backend/db/migrations/079_calendar_sync.sql backend/db/migrations/080_calendar_sync_oauth_metadata.sql
```

Expected: only the new OAuth metadata columns and mapping uniqueness change appear.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/079_calendar_sync.sql backend/db/migrations/080_calendar_sync_oauth_metadata.sql
git commit -m "feat: add calendar sync oauth metadata"
```

---

### Task 2: Add Provider Config, Sync Window, And OAuth State Helpers

**Files:**
- Create: `backend/services/calendarSync/config.js`
- Create: `backend/services/calendarSync/window.js`
- Create: `backend/services/calendarSync/oauthState.js`
- Modify: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Write failing tests for config and sync window**

At the top of `backend/tests/services/calendarSync.test.js`, change the Vitest import and add `createRequire`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
```

After the imports, add:

```js
const require = createRequire(import.meta.url);
```

Append this to `backend/tests/services/calendarSync.test.js`:

```js
describe('calendar sync configuration', () => {
  beforeEach(() => {
    process.env.OUTLOOK_CLIENT_ID = 'client-id';
    process.env.OUTLOOK_TENANT_ID = 'tenant-id';
    process.env.OUTLOOK_CLIENT_SECRET = 'client-secret';
    process.env.OUTLOOK_REDIRECT_URI = 'https://api.msfgco.com/api/schedule/sync/outlook/callback';
    process.env.GOOGLE_CALENDAR_SYNC_ENABLED = 'false';
  });

  it('builds Outlook config from environment variables', () => {
    const { getOutlookConfig, isProviderEnabled } = require('../../services/calendarSync/config');
    expect(getOutlookConfig()).toEqual(expect.objectContaining({
      clientId: 'client-id',
      tenantId: 'tenant-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://api.msfgco.com/api/schedule/sync/outlook/callback',
    }));
    expect(isProviderEnabled('outlook')).toBe(true);
    expect(isProviderEnabled('google')).toBe(false);
  });

  it('computes the default import window', () => {
    const { getSyncWindow } = require('../../services/calendarSync/window');
    const window = getSyncWindow(new Date('2026-05-27T12:00:00.000Z'));
    expect(window.startDate).toBe('2026-04-27');
    expect(window.endDate).toBe('2026-11-23');
    expect(window.startDateTime).toBe('2026-04-27T00:00:00.000Z');
    expect(window.endDateTime).toBe('2026-11-23T23:59:59.999Z');
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: FAIL because `config.js` and `window.js` do not exist.

- [ ] **Step 3: Implement `config.js`**

Create `backend/services/calendarSync/config.js`:

```js
const DEFAULT_RETURN_URL = 'https://dashboard.msfgco.com/Calculators/Company%20Calendar/calendar.html';

const OUTLOOK_SCOPES = ['offline_access', 'User.Read', 'Calendars.ReadWrite'];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getOutlookConfig() {
  return {
    provider: 'outlook',
    clientId: requiredEnv('OUTLOOK_CLIENT_ID'),
    tenantId: requiredEnv('OUTLOOK_TENANT_ID'),
    clientSecret: requiredEnv('OUTLOOK_CLIENT_SECRET'),
    redirectUri: requiredEnv('OUTLOOK_REDIRECT_URI'),
    scopes: OUTLOOK_SCOPES,
    authorizeUrl: `https://login.microsoftonline.com/${requiredEnv('OUTLOOK_TENANT_ID')}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${requiredEnv('OUTLOOK_TENANT_ID')}/oauth2/v2.0/token`,
  };
}

function getReturnUrl(params = {}) {
  const base = process.env.CALENDAR_SYNC_RETURN_URL || DEFAULT_RETURN_URL;
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
}

function isProviderEnabled(provider) {
  if (provider === 'outlook') return true;
  if (provider === 'google') return process.env.GOOGLE_CALENDAR_SYNC_ENABLED === 'true';
  return false;
}

module.exports = {
  OUTLOOK_SCOPES,
  getOutlookConfig,
  getReturnUrl,
  isProviderEnabled,
};
```

- [ ] **Step 4: Implement `window.js`**

Create `backend/services/calendarSync/window.js`:

```js
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function getSyncWindow(now = new Date()) {
  const today = startOfUtcDay(now);
  const start = new Date(today.getTime() - 30 * DAY_MS);
  const endBase = new Date(today.getTime() + 180 * DAY_MS);
  const end = endOfUtcDay(endBase);

  return {
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
  };
}

module.exports = {
  getSyncWindow,
};
```

- [ ] **Step 5: Implement `oauthState.js`**

Create `backend/services/calendarSync/oauthState.js`:

```js
const crypto = require('crypto');
const db = require('../../db/connection');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function createStateValue() {
  return crypto.randomBytes(32).toString('base64url');
}

function stateExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

async function storeOAuthState(userId, provider, state) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET oauth_state = ?, oauth_state_expires_at = ?
     WHERE user_id = ? AND provider = ?`,
    [state, stateExpiry(), userId, provider]
  );
}

async function consumeOAuthState(provider, state) {
  const result = await db.query(
    `SELECT *
     FROM calendar_sync_connections
     WHERE provider = ? AND oauth_state = ? AND oauth_state_expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [provider, state]
  );
  const rows = getRows(result) || [];
  const connection = rows[0] || null;

  if (!connection) return null;

  await db.query(
    `UPDATE calendar_sync_connections
     SET oauth_state = NULL, oauth_state_expires_at = NULL
     WHERE id = ?`,
    [connection.id]
  );

  return connection;
}

module.exports = {
  createStateValue,
  consumeOAuthState,
  storeOAuthState,
};
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: PASS for the new config/window tests and existing crypto/normalization tests.

Commit:

```bash
git add backend/services/calendarSync/config.js backend/services/calendarSync/window.js backend/services/calendarSync/oauthState.js backend/tests/services/calendarSync.test.js
git commit -m "feat: add calendar sync config helpers"
```

---

### Task 3: Implement Outlook OAuth And Event Adapter

**Files:**
- Modify: `backend/services/calendarSync/providers/outlook.js`
- Modify: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Add failing provider tests**

Append to `backend/tests/services/calendarSync.test.js`:

```js
describe('Outlook provider adapter', () => {
  beforeEach(() => {
    process.env.OUTLOOK_CLIENT_ID = 'client-id';
    process.env.OUTLOOK_TENANT_ID = 'tenant-id';
    process.env.OUTLOOK_CLIENT_SECRET = 'client-secret';
    process.env.OUTLOOK_REDIRECT_URI = 'https://api.msfgco.com/api/schedule/sync/outlook/callback';
  });

  it('builds an Outlook authorization URL with state and delegated scopes', () => {
    const { buildAuthorizationUrl } = require('../../services/calendarSync/providers/outlook');
    const url = new URL(buildAuthorizationUrl('state-123'));

    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/tenant-id/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.msfgco.com/api/schedule/sync/outlook/callback');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });

  it('filters Outlook free and cancelled events', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      { id: 'busy-1', showAs: 'busy', isCancelled: false, start: { dateTime: '2026-06-01T09:00:00' }, end: { dateTime: '2026-06-01T10:00:00' } },
      { id: 'free-1', showAs: 'free', isCancelled: false, start: { dateTime: '2026-06-01T11:00:00' }, end: { dateTime: '2026-06-01T12:00:00' } },
      { id: 'cancelled-1', showAs: 'busy', isCancelled: true, start: { dateTime: '2026-06-01T13:00:00' }, end: { dateTime: '2026-06-01T14:00:00' } },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'availability_only' });

    expect(events.map((event) => event.source_event_id)).toEqual(['busy-1']);
  });

  it('maps Outlook availability states to MSFG statuses', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      { id: 'ooo', showAs: 'outOfOffice', start: { dateTime: '2026-06-01T09:00:00' }, end: { dateTime: '2026-06-01T10:00:00' } },
      { id: 'elsewhere', showAs: 'workingElsewhere', start: { dateTime: '2026-06-01T11:00:00' }, end: { dateTime: '2026-06-01T12:00:00' } },
      { id: 'tentative', showAs: 'tentative', start: { dateTime: '2026-06-01T13:00:00' }, end: { dateTime: '2026-06-01T14:00:00' } },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'availability_only' });

    expect(events.map((event) => event.status)).toEqual(['out', 'remote', 'meeting_event']);
    expect(events.every((event) => event.note === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: FAIL because `buildAuthorizationUrl` and `normalizeOutlookEvents` are not exported.

- [ ] **Step 3: Replace `outlook.js` with the real adapter**

Replace `backend/services/calendarSync/providers/outlook.js` with:

```js
const { decryptToken, encryptToken } = require('../tokenCrypto');
const { getOutlookConfig } = require('../config');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const IMPORTABLE_SHOW_AS = new Set(['busy', 'tentative', 'outOfOffice', 'workingElsewhere']);

function dateParts(value) {
  const text = String(value || '');
  const [date, rawTime = ''] = text.split('T');
  return {
    date: date || null,
    time: rawTime ? rawTime.slice(0, 8) : null,
  };
}

function outlookStatus(showAs) {
  if (showAs === 'outOfOffice') return 'out';
  if (showAs === 'workingElsewhere') return 'remote';
  if (showAs === 'tentative') return 'meeting_event';
  return 'busy';
}

function isImportableEvent(event) {
  if (!event || event.isCancelled) return false;
  return IMPORTABLE_SHOW_AS.has(event.showAs || 'busy');
}

function normalizeOutlookEvent(event, connection) {
  const start = dateParts(event.start?.dateTime);
  const end = dateParts(event.end?.dateTime);
  const visibility = connection.privacy_default || 'availability_only';
  const shared = visibility === 'shared_details';

  return {
    user_id: connection.user_id,
    status: outlookStatus(event.showAs || 'busy'),
    start_date: start.date,
    end_date: end.date || start.date,
    start_time: event.isAllDay ? null : start.time,
    end_time: event.isAllDay ? null : end.time,
    timezone: event.start?.timeZone || 'America/Denver',
    note: shared ? (event.subject || null) : null,
    visibility,
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: event.id,
  };
}

function normalizeOutlookEvents(events, connection) {
  return (events || [])
    .filter(isImportableEvent)
    .map((event) => normalizeOutlookEvent(event, connection))
    .filter((event) => event.start_date && event.end_date && event.source_event_id);
}

function buildAuthorizationUrl(state) {
  const config = getOutlookConfig();
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function tokenRequest(params) {
  const config = getOutlookConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    ...params,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Outlook token request failed');
  }
  return payload;
}

function expiresAt(expiresIn) {
  return new Date(Date.now() + Math.max(Number(expiresIn || 3600) - 60, 60) * 1000);
}

async function exchangeCodeForTokens(code) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
  });
}

async function refreshTokens(connection) {
  const refreshToken = decryptToken(connection.encrypted_refresh_token);
  const payload = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  return {
    encrypted_access_token: encryptToken(payload.access_token),
    encrypted_refresh_token: encryptToken(payload.refresh_token || refreshToken),
    access_token_expires_at: expiresAt(payload.expires_in),
    scopes: payload.scope || connection.scopes || null,
  };
}

function tokenExpired(connection) {
  if (!connection.access_token_expires_at) return true;
  return new Date(connection.access_token_expires_at).getTime() <= Date.now() + 60 * 1000;
}

async function graphRequest(connection, pathOrUrl, options = {}) {
  let accessToken = decryptToken(connection.encrypted_access_token);
  if (tokenExpired(connection) && connection.refreshConnectionTokens) {
    const refreshed = await connection.refreshConnectionTokens(connection);
    Object.assign(connection, refreshed);
    accessToken = decryptToken(connection.encrypted_access_token);
  }

  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      prefer: 'outlook.timezone="America/Denver"',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Outlook Graph request failed');
  }
  return payload;
}

async function getAccountEmail(connection) {
  const me = await graphRequest(connection, '/me?$select=mail,userPrincipalName');
  return me.mail || me.userPrincipalName || connection.provider_account_email || null;
}

async function listEvents(connection, syncWindow) {
  const params = new URLSearchParams({
    startDateTime: syncWindow.startDateTime,
    endDateTime: syncWindow.endDateTime,
    '$select': 'id,subject,start,end,showAs,isCancelled,isAllDay,sensitivity,lastModifiedDateTime,webLink',
    '$top': '50',
  });
  let url = `/me/calendarView?${params.toString()}`;
  const events = [];

  while (url) {
    const payload = await graphRequest(connection, url);
    events.push(...(payload.value || []));
    url = payload['@odata.nextLink'] || '';
  }

  return normalizeOutlookEvents(events, connection);
}

function outlookEventPayload(entry) {
  const subject = entry.note || 'MSFG Schedule';
  const isAllDay = !entry.start_time && !entry.end_time;
  const startDateTime = isAllDay ? `${entry.start_date}T00:00:00` : `${entry.start_date}T${entry.start_time || '00:00:00'}`;
  const endDateTime = isAllDay ? `${entry.end_date}T23:59:59` : `${entry.end_date}T${entry.end_time || entry.start_time || '23:59:59'}`;

  return {
    subject,
    isAllDay,
    showAs: entry.status === 'out' ? 'outOfOffice' : 'busy',
    sensitivity: entry.visibility === 'availability_only' ? 'private' : 'normal',
    categories: ['MSFG Schedule'],
    start: { dateTime: startDateTime, timeZone: entry.timezone || 'America/Denver' },
    end: { dateTime: endDateTime, timeZone: entry.timezone || 'America/Denver' },
  };
}

async function createEvent(connection, entry) {
  const payload = await graphRequest(connection, '/me/events', {
    method: 'POST',
    body: JSON.stringify(outlookEventPayload(entry)),
  });
  return {
    provider_event_id: payload.id,
    provider_etag: payload['@odata.etag'] || null,
  };
}

async function updateEvent(connection, providerEventId, entry) {
  const payload = await graphRequest(connection, `/me/events/${encodeURIComponent(providerEventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(outlookEventPayload(entry)),
  });
  return {
    provider_event_id: payload.id || providerEventId,
    provider_etag: payload['@odata.etag'] || null,
  };
}

module.exports = {
  buildAuthorizationUrl,
  createEvent,
  exchangeCodeForTokens,
  getAccountEmail,
  listEvents,
  normalizeOutlookEvent,
  normalizeOutlookEvents,
  refreshTokens,
  updateEvent,
};
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: PASS for Outlook provider tests.

Commit:

```bash
git add backend/services/calendarSync/providers/outlook.js backend/tests/services/calendarSync.test.js
git commit -m "feat: add outlook calendar adapter"
```

---

### Task 4: Implement Sync Engine Import, Stale Cleanup, And Export

**Files:**
- Modify: `backend/services/calendarSync/syncEngine.js`
- Modify: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Add failing sync engine tests**

Append to `backend/tests/services/calendarSync.test.js`:

```js
describe('calendar sync engine', () => {
  const dbPath = require.resolve('../../db/connection');
  const enginePath = require.resolve('../../services/calendarSync/syncEngine');
  const originalDb = require.cache[dbPath];
  const db = { query: vi.fn() };

  beforeEach(() => {
    db.query.mockReset();
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    delete require.cache[enginePath];
  });

  afterEach(() => {
    delete require.cache[enginePath];
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
  });

  it('upserts imported entries and removes stale provider entries', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 9 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ provider_event_id: 'mapped-event' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const { runSyncForConnection } = require('../../services/calendarSync/syncEngine');
    const adapter = {
      listEvents: vi.fn().mockResolvedValue([
        {
          user_id: 7,
          status: 'busy',
          start_date: '2026-06-01',
          end_date: '2026-06-01',
          start_time: '09:00:00',
          end_time: '10:00:00',
          timezone: 'America/Denver',
          note: null,
          visibility: 'availability_only',
          source: 'outlook',
          source_provider: 'outlook',
          source_event_id: 'imported-event',
        },
        {
          user_id: 7,
          status: 'busy',
          start_date: '2026-06-01',
          end_date: '2026-06-01',
          source_provider: 'outlook',
          source_event_id: 'mapped-event',
        },
      ]),
    };

    const result = await runSyncForConnection({ id: 4, user_id: 7, provider: 'outlook', sync_enabled: 1 }, adapter, {
      startDate: '2026-04-27',
      endDate: '2026-11-23',
      startDateTime: '2026-04-27T00:00:00.000Z',
      endDateTime: '2026-11-23T23:59:59.999Z',
    });

    expect(result.imported).toBe(1);
    expect(adapter.listEvents).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO schedule_entries'), expect.arrayContaining(['imported-event']));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM schedule_entries'), expect.arrayContaining([7, 'outlook']));
  });

  it('exports manual entries using calendar sync mappings', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{
        id: 22,
        user_id: 7,
        status: 'out',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        start_time: null,
        end_time: null,
        timezone: 'America/Denver',
        note: 'Conference',
        visibility: 'shared_details',
        source: 'manual',
        provider_event_id: null,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const { runSyncForConnection } = require('../../services/calendarSync/syncEngine');
    const adapter = {
      createEvent: vi.fn().mockResolvedValue({ provider_event_id: 'created-1', provider_etag: 'etag-1' }),
      listEvents: vi.fn().mockResolvedValue([]),
    };

    const result = await runSyncForConnection({ id: 4, user_id: 7, provider: 'outlook', sync_enabled: 1 }, adapter, {
      startDate: '2026-04-27',
      endDate: '2026-11-23',
      startDateTime: '2026-04-27T00:00:00.000Z',
      endDateTime: '2026-11-23T23:59:59.999Z',
    });

    expect(result.exported).toBe(1);
    expect(adapter.createEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), expect.objectContaining({ id: 22 }));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO calendar_sync_mappings'), expect.arrayContaining([7, 22, 'outlook', 'created-1', 'etag-1']));
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: FAIL because the engine does not export entries or delete stale provider entries.

- [ ] **Step 3: Replace `syncEngine.js`**

Replace `backend/services/calendarSync/syncEngine.js` with:

```js
const db = require('../../db/connection');
const { getSyncWindow } = require('./window');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

async function updateConnectionStatus(connection, status, error = null) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET sync_status = ?, sync_error = ?, last_sync_at = CASE WHEN ? = 'connected' THEN UTC_TIMESTAMP() ELSE last_sync_at END
     WHERE id = ?`,
    [status, error, status, connection.id]
  );
}

async function startRun(connection) {
  const [result] = await db.query(
    `INSERT INTO calendar_sync_runs (connection_id, provider, status)
     VALUES (?, ?, 'running')`,
    [connection.id, connection.provider]
  );
  return result.insertId || null;
}

async function finishRun(runId, status, imported, exported, errorMessage = null) {
  if (!runId) return;
  await db.query(
    `UPDATE calendar_sync_runs
     SET status = ?, finished_at = UTC_TIMESTAMP(), entries_imported = ?, entries_exported = ?, error_message = ?
     WHERE id = ?`,
    [status, imported, exported, errorMessage, runId]
  );
}

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
      entry.start_time || null,
      entry.end_time || null,
      entry.timezone || 'America/Denver',
      entry.note || null,
      entry.visibility || 'availability_only',
      entry.source || entry.source_provider,
      entry.source_provider,
      entry.source_event_id,
    ]
  );
}

async function fetchMappedProviderIds(connection) {
  const result = await db.query(
    `SELECT provider_event_id
     FROM calendar_sync_mappings
     WHERE user_id = ? AND provider = ?`,
    [connection.user_id, connection.provider]
  );
  return new Set((getRows(result) || []).map((row) => String(row.provider_event_id)));
}

async function deleteStaleImportedEntries(connection, syncWindow, importedIds) {
  const baseParams = [connection.user_id, connection.provider, syncWindow.endDate, syncWindow.startDate];
  if (!importedIds.length) {
    await db.query(
      `DELETE FROM schedule_entries
       WHERE user_id = ? AND source_provider = ? AND source_event_id IS NOT NULL
         AND start_date <= ? AND end_date >= ?`,
      baseParams
    );
    return;
  }

  const placeholders = importedIds.map(() => '?').join(', ');
  await db.query(
    `DELETE FROM schedule_entries
     WHERE user_id = ? AND source_provider = ? AND source_event_id IS NOT NULL
       AND start_date <= ? AND end_date >= ?
       AND source_event_id NOT IN (${placeholders})`,
    [...baseParams, ...importedIds]
  );
}

async function fetchManualEntriesForExport(connection, syncWindow) {
  const result = await db.query(
    `SELECT se.*, csm.provider_event_id, csm.provider_etag
     FROM schedule_entries se
     LEFT JOIN calendar_sync_mappings csm
       ON csm.schedule_entry_id = se.id AND csm.provider = ?
     WHERE se.user_id = ?
       AND se.source = 'manual'
       AND se.start_date <= ?
       AND se.end_date >= ?
     ORDER BY se.start_date ASC, se.start_time ASC`,
    [connection.provider, connection.user_id, syncWindow.endDate, syncWindow.startDate]
  );
  return getRows(result) || [];
}

async function upsertMapping(connection, entry, providerResult) {
  await db.query(
    `INSERT INTO calendar_sync_mappings
     (user_id, schedule_entry_id, provider, provider_event_id, provider_etag, last_synced_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       provider_event_id = VALUES(provider_event_id),
       provider_etag = VALUES(provider_etag),
       last_synced_at = UTC_TIMESTAMP(),
       updated_at = CURRENT_TIMESTAMP`,
    [
      connection.user_id,
      entry.id,
      connection.provider,
      providerResult.provider_event_id,
      providerResult.provider_etag || null,
    ]
  );
}

async function exportManualEntries(connection, adapter, syncWindow) {
  if (!adapter.createEvent) return 0;
  const entries = await fetchManualEntriesForExport(connection, syncWindow);
  let exported = 0;

  for (const entry of entries) {
    const providerResult = entry.provider_event_id && adapter.updateEvent
      ? await adapter.updateEvent(connection, entry.provider_event_id, entry)
      : await adapter.createEvent(connection, entry);
    await upsertMapping(connection, entry, providerResult);
    exported += 1;
  }

  return exported;
}

async function importProviderEntries(connection, adapter, syncWindow) {
  const mappedIds = await fetchMappedProviderIds(connection);
  const providerEntries = await adapter.listEvents(connection, syncWindow);
  const importedIds = [];
  let imported = 0;

  for (const entry of providerEntries) {
    if (mappedIds.has(String(entry.source_event_id))) {
      importedIds.push(entry.source_event_id);
      continue;
    }
    await upsertImportedEntry(entry);
    importedIds.push(entry.source_event_id);
    imported += 1;
  }

  await deleteStaleImportedEntries(connection, syncWindow, importedIds);
  return imported;
}

async function runSyncForConnection(connection, adapter, syncWindow = getSyncWindow()) {
  let imported = 0;
  let exported = 0;
  let runId = null;

  try {
    runId = await startRun(connection);
    await updateConnectionStatus(connection, 'syncing');
    connection.refreshConnectionTokens = adapter.refreshConnectionTokens;

    exported = await exportManualEntries(connection, adapter, syncWindow);
    imported = await importProviderEntries(connection, adapter, syncWindow);

    await updateConnectionStatus(connection, 'connected');
    await finishRun(runId, 'success', imported, exported);
    return { imported, exported };
  } catch (error) {
    const message = error.message || 'Calendar sync failed';
    await updateConnectionStatus(connection, 'error', message);
    await finishRun(runId, 'error', imported, exported, message);
    return { imported, exported, error: message };
  }
}

module.exports = {
  deleteStaleImportedEntries,
  exportManualEntries,
  importProviderEntries,
  runSyncForConnection,
  upsertImportedEntry,
};
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: PASS for sync engine tests.

Commit:

```bash
git add backend/services/calendarSync/syncEngine.js backend/tests/services/calendarSync.test.js
git commit -m "feat: sync outlook calendar entries"
```

---

### Task 5: Add Authenticated Sync Routes And Public OAuth Callback

**Files:**
- Modify: `backend/routes/scheduleSync.js`
- Create: `backend/routes/scheduleSyncPublic.js`
- Modify: `backend/server.js`
- Modify: `backend/tests/routes/scheduleSync.test.js`

- [ ] **Step 1: Add failing route tests**

Update `backend/tests/routes/scheduleSync.test.js` so the mocked dependencies include:

```js
const outlookProvider = {
  buildAuthorizationUrl: vi.fn((state) => `https://login.microsoftonline.com/auth?state=${state}`),
  exchangeCodeForTokens: vi.fn(),
  getAccountEmail: vi.fn(),
  refreshTokens: vi.fn(),
  listEvents: vi.fn().mockResolvedValue([]),
};

const oauthState = {
  createStateValue: vi.fn(() => 'state-123'),
  storeOAuthState: vi.fn().mockResolvedValue(),
  consumeOAuthState: vi.fn(),
};
```

Add tests:

```js
it('returns an Outlook authorization URL on connection start', async () => {
  db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

  const res = await makeJsonRequest(app, '/api/schedule/sync/connections/outlook/start', {
    provider: 'outlook',
    privacy_default: 'availability_only',
    sync_enabled: true,
  });

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
    provider: 'outlook',
    status: 'authorization_required',
    authorization_url: 'https://login.microsoftonline.com/auth?state=state-123',
  }));
});

it('disconnects a provider connection', async () => {
  db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

  const res = await makeRequest(app, '/api/schedule/sync/connections/outlook/disconnect', {
    method: 'POST',
  });

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ success: true });
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('encrypted_access_token = NULL'), [7, 'outlook']);
});

it('returns admin sync health for managers and admins only', async () => {
  db.query.mockResolvedValueOnce([[
    {
      id: 1,
      user_id: 7,
      name: 'Test User',
      email: 'user@msfg.us',
      provider: 'outlook',
      sync_enabled: 1,
      sync_status: 'connected',
      last_sync_at: null,
      sync_error: null,
    },
  ]]);

  const res = await makeRequest(app, '/api/schedule/sync/admin/status', {
    headers: { 'x-test-user': 'manager' },
  });

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).connections[0]).toEqual(expect.objectContaining({
    user_id: 7,
    provider: 'outlook',
    sync_status: 'connected',
  }));
});
```

- [ ] **Step 2: Add public callback tests**

Create a separate describe block in `backend/tests/routes/scheduleSync.test.js` for `scheduleSyncPublic`:

```js
it('handles Outlook OAuth callback without app authentication', async () => {
  oauthState.consumeOAuthState.mockResolvedValueOnce({ id: 4, user_id: 7, provider: 'outlook' });
  outlookProvider.exchangeCodeForTokens.mockResolvedValueOnce({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    scope: 'offline_access User.Read Calendars.ReadWrite',
  });
  outlookProvider.getAccountEmail.mockResolvedValueOnce('user@msfg.us');
  db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
  syncEngine.runSyncForConnection.mockResolvedValueOnce({ imported: 1, exported: 0 });

  const publicRoutes = require('../../routes/scheduleSyncPublic');
  const publicApp = express();
  publicApp.use('/api/schedule/sync', publicRoutes);

  const res = await makeRequest(publicApp, '/api/schedule/sync/outlook/callback?code=abc&state=state-123', {
    redirect: 'manual',
  });

  expect([302, 303]).toContain(res.status);
  expect(oauthState.consumeOAuthState).toHaveBeenCalledWith('outlook', 'state-123');
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
cd backend
npm test -- tests/routes/scheduleSync.test.js
```

Expected: FAIL because the new route behavior is not implemented.

- [ ] **Step 4: Implement authenticated route behavior**

In `backend/routes/scheduleSync.js`:

- Import `requireManagerOrAdmin`.
- Import OAuth state helpers.
- Import `isProviderEnabled`.
- Import Outlook provider.
- Add `getAdapter(provider)`.
- Change start route to store state and return `authorization_url`.
- Add disconnect route.
- Add admin status route.
- Change run route to pass the real adapter.

Use this route shape:

```js
const { getUserId, requireDbUser, requireManagerOrAdmin } = require('../middleware/userContext');
const { createStateValue, storeOAuthState } = require('../services/calendarSync/oauthState');
const { isProviderEnabled } = require('../services/calendarSync/config');
const outlookProvider = require('../services/calendarSync/providers/outlook');

function getAdapter(provider) {
  if (provider === 'outlook') return outlookProvider;
  throw new Error('Provider is not enabled');
}
```

The start route response should be:

```js
return res.json({
  provider,
  status: 'authorization_required',
  authorization_url: adapter.buildAuthorizationUrl(state),
});
```

The disconnect SQL should be:

```sql
UPDATE calendar_sync_connections
SET encrypted_access_token = NULL,
    encrypted_refresh_token = NULL,
    access_token_expires_at = NULL,
    oauth_state = NULL,
    oauth_state_expires_at = NULL,
    sync_enabled = 0,
    sync_status = 'not_connected',
    sync_error = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = ? AND provider = ?
```

- [ ] **Step 5: Implement public callback route**

Create `backend/routes/scheduleSyncPublic.js`:

```js
const express = require('express');
const db = require('../db/connection');
const { encryptToken } = require('../services/calendarSync/tokenCrypto');
const { consumeOAuthState } = require('../services/calendarSync/oauthState');
const { getReturnUrl } = require('../services/calendarSync/config');
const { runSyncForConnection } = require('../services/calendarSync/syncEngine');
const outlookProvider = require('../services/calendarSync/providers/outlook');

const router = express.Router();

function adapterFor(provider) {
  if (provider === 'outlook') return outlookProvider;
  return null;
}

function tokenExpiry(expiresIn) {
  return new Date(Date.now() + Math.max(Number(expiresIn || 3600) - 60, 60) * 1000);
}

router.get('/:provider/callback', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const adapter = adapterFor(provider);
    if (!adapter) return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'provider_disabled' }));
    if (req.query.error) return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'provider_denied' }));

    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'missing_code' }));

    const connection = await consumeOAuthState(provider, state);
    if (!connection) return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'invalid_state' }));

    const tokens = await adapter.exchangeCodeForTokens(code);
    const tokenConnection = {
      ...connection,
      encrypted_access_token: encryptToken(tokens.access_token),
      encrypted_refresh_token: encryptToken(tokens.refresh_token),
      access_token_expires_at: tokenExpiry(tokens.expires_in),
      scopes: tokens.scope || null,
    };
    const email = await adapter.getAccountEmail(tokenConnection);

    await db.query(
      `UPDATE calendar_sync_connections
       SET provider_account_email = ?,
           encrypted_access_token = ?,
           encrypted_refresh_token = ?,
           access_token_expires_at = ?,
           scopes = ?,
           sync_enabled = 1,
           sync_status = 'connected',
           sync_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        email,
        tokenConnection.encrypted_access_token,
        tokenConnection.encrypted_refresh_token,
        tokenConnection.access_token_expires_at,
        tokenConnection.scopes,
        connection.id,
      ]
    );

    await runSyncForConnection({ ...tokenConnection, provider_account_email: email }, adapter);
    return res.redirect(getReturnUrl({ sync: 'connected', provider }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
```

- [ ] **Step 6: Mount public callback before authenticated routes**

In `backend/server.js`, add:

```js
const scheduleSyncPublicRoutes = require('./routes/scheduleSyncPublic');
```

Mount it before authenticated schedule routes:

```js
app.use('/api/schedule/sync', scheduleSyncPublicRoutes);
app.use('/api/schedule/sync', authenticate, scheduleSyncRoutes);
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
cd backend
npm test -- tests/routes/scheduleSync.test.js
```

Expected: PASS for sync route tests.

Commit:

```bash
git add backend/routes/scheduleSync.js backend/routes/scheduleSyncPublic.js backend/server.js backend/tests/routes/scheduleSync.test.js
git commit -m "feat: add calendar sync oauth routes"
```

---

### Task 6: Enforce Provider-Owned Read-Only Schedule Entries

**Files:**
- Modify: `backend/routes/schedule.js`
- Modify: `backend/services/schedule/privacy.js`
- Modify: `backend/tests/routes/schedule.test.js`

- [ ] **Step 1: Add failing route tests**

Append to `backend/tests/routes/schedule.test.js`:

```js
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd backend
npm test -- tests/routes/schedule.test.js
```

Expected: FAIL because provider-owned entries can still be modified server-side.

- [ ] **Step 3: Add provider-owned guard**

In `backend/routes/schedule.js`, add:

```js
function isProviderOwned(entry) {
  return Boolean(entry?.source_provider && entry?.source_event_id);
}

function providerName(entry) {
  return entry.source_provider === 'google' ? 'Google' : 'Outlook';
}

function requireEditableEntry(entry, res) {
  if (!isProviderOwned(entry)) return true;
  res.status(409).json({ error: `This schedule entry is managed in ${providerName(entry)}.` });
  return false;
}
```

Call it after `fetchEntry` and before permission checks in both `PUT /entries/:id` and `DELETE /entries/:id`:

```js
if (!requireEditableEntry(existing, res)) return;
```

- [ ] **Step 4: Preserve safe provider source metadata**

In `backend/services/schedule/privacy.js`, add `source_provider` and `source_event_id` to presented entries only as source markers:

```js
    source_provider: entry.source_provider || null,
    source_event_id: entry.source_event_id || null,
```

This does not expose Outlook subject, location, attendees, or notes.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
cd backend
npm test -- tests/routes/schedule.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/routes/schedule.js backend/services/schedule/privacy.js backend/tests/routes/schedule.test.js
git commit -m "fix: protect provider owned schedule entries"
```

---

### Task 7: Add Scheduler For Automatic Sync

**Files:**
- Create: `backend/services/calendarSync/scheduler.js`
- Modify: `backend/server.js`
- Test: `backend/tests/services/calendarSync.test.js`

- [ ] **Step 1: Add failing scheduler tests**

Append to `backend/tests/services/calendarSync.test.js`:

```js
describe('calendar sync scheduler', () => {
  const dbPath = require.resolve('../../db/connection');
  const schedulerPath = require.resolve('../../services/calendarSync/scheduler');
  const originalDb = require.cache[dbPath];
  const db = { query: vi.fn() };

  beforeEach(() => {
    db.query.mockReset();
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    delete require.cache[schedulerPath];
  });

  afterEach(() => {
    delete require.cache[schedulerPath];
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
  });

  it('selects enabled connected sync connections', async () => {
    db.query.mockResolvedValueOnce([[{ id: 4, user_id: 7, provider: 'outlook', sync_status: 'connected' }]]);
    const { loadDueConnections } = require('../../services/calendarSync/scheduler');
    const rows = await loadDueConnections();
    expect(rows).toEqual([expect.objectContaining({ id: 4, provider: 'outlook' })]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("sync_status IN ('connected','error')"));
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: FAIL because `scheduler.js` does not exist.

- [ ] **Step 3: Implement scheduler**

Create `backend/services/calendarSync/scheduler.js`:

```js
const db = require('../../db/connection');
const logger = require('../../lib/logger');
const { runSyncForConnection } = require('./syncEngine');
const outlookProvider = require('./providers/outlook');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const running = new Set();

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function adapterFor(provider) {
  if (provider === 'outlook') return outlookProvider;
  return null;
}

async function loadDueConnections() {
  const result = await db.query(
    `SELECT *
     FROM calendar_sync_connections
     WHERE sync_enabled = 1
       AND encrypted_refresh_token IS NOT NULL
       AND sync_status IN ('connected','error')`
  );
  return getRows(result) || [];
}

async function runScheduledSyncOnce() {
  const connections = await loadDueConnections();
  for (const connection of connections) {
    if (running.has(connection.id)) continue;
    const adapter = adapterFor(connection.provider);
    if (!adapter) continue;
    running.add(connection.id);
    try {
      await runSyncForConnection(connection, adapter);
    } catch (error) {
      logger.warn({ err: error, connectionId: connection.id }, 'Scheduled calendar sync failed');
    } finally {
      running.delete(connection.id);
    }
  }
}

function startCalendarSyncScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (process.env.CALENDAR_SYNC_SCHEDULER_ENABLED === 'false') return null;
  const timer = setInterval(() => {
    runScheduledSyncOnce().catch((error) => {
      logger.warn({ err: error }, 'Calendar sync scheduler tick failed');
    });
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  loadDueConnections,
  runScheduledSyncOnce,
  startCalendarSyncScheduler,
};
```

- [ ] **Step 4: Start scheduler from server**

In `backend/server.js`, import:

```js
const { startCalendarSyncScheduler } = require('./services/calendarSync/scheduler');
```

Call it after route setup and before `app.listen`:

```js
startCalendarSyncScheduler();
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/services/calendarSync/scheduler.js backend/server.js backend/tests/services/calendarSync.test.js
git commit -m "feat: schedule calendar sync runs"
```

---

### Task 8: Wire Calendar Frontend Sync UI

**Files:**
- Modify: `Calculators/Company Calendar/calendar-api.js`
- Modify: `Calculators/Company Calendar/calendar-sync.js`
- Modify: `Calculators/Company Calendar/calendar-detail.js`
- Modify: `Calculators/Company Calendar/calendar-main.js`
- Modify: `Calculators/Company Calendar/styles.css`

- [ ] **Step 1: Add API methods**

In `Calculators/Company Calendar/calendar-api.js`, add methods:

```js
    startSyncConnection: (provider, payload) => request(`/schedule/sync/connections/${encodeURIComponent(provider)}/start`, {
      method: 'POST',
      body: JSON.stringify({ provider, ...(payload || {}) }),
    }),
    runSync: (provider) => request('/schedule/sync/run', {
      method: 'POST',
      body: JSON.stringify(provider ? { provider } : {}),
    }),
    disconnectSyncConnection: (provider) => request(`/schedule/sync/connections/${encodeURIComponent(provider)}/disconnect`, {
      method: 'POST',
    }),
    getAdminSyncStatus: () => request('/schedule/sync/admin/status'),
```

- [ ] **Step 2: Add sync actions**

In `Calculators/Company Calendar/calendar-main.js`, add actions:

```js
    async connectSyncProvider(provider) {
      try {
        const result = await CalendarApi.startSyncConnection(provider, {
          privacy_default: 'availability_only',
          sync_enabled: true,
        });
        if (result.authorization_url) {
          window.location.href = result.authorization_url;
          return;
        }
        await loadSyncStatus();
        CalendarRender.render(app, state, actions);
      } catch (err) {
        showToast(err.message || 'Unable to start calendar connection.', 'error');
      }
    },
    async runSyncProvider(provider) {
      try {
        showToast('Syncing calendar...', 'info');
        await CalendarApi.runSync(provider);
        await loadSyncStatus();
        await loadEntries();
        CalendarRender.render(app, state, actions);
        showToast('Calendar sync complete.', 'success');
      } catch (err) {
        showToast(err.message || 'Unable to sync calendar.', 'error');
      }
    },
    async disconnectSyncProvider(provider) {
      if (window.confirm && !window.confirm('Disconnect this calendar account?')) return;
      try {
        await CalendarApi.disconnectSyncConnection(provider);
        await loadSyncStatus();
        CalendarRender.render(app, state, actions);
        showToast('Calendar disconnected.', 'success');
      } catch (err) {
        showToast(err.message || 'Unable to disconnect calendar.', 'error');
      }
    },
```

- [ ] **Step 3: Replace placeholder sync panel behavior**

In `Calculators/Company Calendar/calendar-sync.js`, keep Outlook in `PROVIDERS` and include Google only when `window.MSFG_CALENDAR_ENABLE_GOOGLE_SYNC === true`.

The provider row should render:

```html
<button class="nav-btn" type="button" data-sync-connect="outlook">Connect</button>
<button class="nav-btn" type="button" data-sync-run="outlook">Sync now</button>
<button class="danger-btn" type="button" data-sync-disconnect="outlook">Disconnect</button>
```

The bind function should call:

```js
actions.connectSyncProvider(provider);
actions.runSyncProvider(provider);
actions.disconnectSyncProvider(provider);
```

Use these labels:

- Not connected
- Connected
- Syncing
- Error
- Paused

- [ ] **Step 4: Improve provider-owned detail message**

In `Calculators/Company Calendar/calendar-detail.js`, update read-only entries so provider-owned entries show:

```html
<span class="detail-note">Managed in Outlook. Edit this event in Outlook.</span>
```

Only show that message when:

```js
entry.source_provider === 'outlook' || entry.source === 'outlook'
```

- [ ] **Step 5: Add CSS for sync states**

In `Calculators/Company Calendar/styles.css`, add:

```css
.sync-provider.is-error {
  border-color: #b85a2e;
}

.sync-provider-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.sync-error {
  color: #b85a2e;
  font-size: 0.85rem;
  margin-top: 4px;
}

.detail-entry.is-readonly .detail-note {
  color: #6a7672;
}
```

- [ ] **Step 6: Manual frontend check**

Serve or open the calendar locally using the repo's current static workflow. In the in-app browser, verify:

- Outlook row shows Connect when not connected.
- Connected row shows Sync now and Disconnect.
- Error row displays the sync error.
- Google is not visible while the flag is disabled.
- Provider-owned entries are not editable and show the Outlook message.

- [ ] **Step 7: Commit**

```bash
git add "Calculators/Company Calendar/calendar-api.js" "Calculators/Company Calendar/calendar-sync.js" "Calculators/Company Calendar/calendar-detail.js" "Calculators/Company Calendar/calendar-main.js" "Calculators/Company Calendar/styles.css"
git commit -m "feat: wire calendar sync ui"
```

---

### Task 9: Full Verification And Production Rollout

**Files:**
- Verify: backend tests
- Verify: local browser calendar
- Configure: EC2 backend environment
- Deploy: existing dashboard deployment flow

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd backend
npm test -- tests/services/calendarSync.test.js tests/routes/scheduleSync.test.js tests/routes/schedule.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full backend tests**

Run:

```bash
cd backend
npm test
```

Expected: PASS.

- [ ] **Step 3: Scan for secret leakage**

Run from repo root:

```bash
rg -n "OUTLOOK_CLIENT_SECRET|client-secret|refresh-token|access-token|encrypted_refresh_token|encrypted_access_token" .
```

Expected: matches only documentation references, schema column names, code identifiers, or test fixture strings. The real Outlook secret value must not appear in tracked files.

- [ ] **Step 4: Push code**

Run:

```bash
git status --short
git push origin main
```

Expected: branch pushes to `origin/main` with only intended tracked changes.

- [ ] **Step 5: Configure backend environment on EC2**

On the server, set the non-secret values exactly:

```bash
OUTLOOK_CLIENT_ID=21b29b21-e5f2-4006-b090-37fc9082002f
OUTLOOK_TENANT_ID=ecf6ca29-38ea-4749-96c8-3fa7a9191e14
OUTLOOK_REDIRECT_URI=https://api.msfgco.com/api/schedule/sync/outlook/callback
GOOGLE_CALENDAR_SYNC_ENABLED=false
```

Set `OUTLOOK_CLIENT_SECRET` to a freshly generated Entra client secret value. Set `CALENDAR_SYNC_ENCRYPTION_KEY` to the output of:

```bash
openssl rand -base64 32
```

Do not paste the secret values into source files.

- [ ] **Step 6: Deploy using the existing dashboard path**

Use the repo's established deploy flow:

```bash
./deploy.sh --backend
./deploy.sh
```

Expected:

- Backend restarts successfully.
- DB migrations run through the normal deploy/restart path.
- S3/CloudFront frontend sync completes.

- [ ] **Step 7: Smoke test production Outlook connect**

Open:

```text
https://dashboard.msfgco.com/Calculators/Company%20Calendar/calendar.html?v=20260527-sync
```

Verify:

- Connect Outlook opens Microsoft login.
- Callback returns to the company calendar.
- Sync status shows connected.
- Outlook busy, tentative, out-of-office, and working-elsewhere events appear as availability.
- Free/cancelled events do not appear.
- Coworkers do not see Outlook subjects, location, attendees, or notes.
- MSFG-created entries export to the user's Outlook calendar.
- A deleted/cancelled Outlook test event is removed from MSFG after sync.

- [ ] **Step 8: Verify live objects if the browser appears stale**

Run:

```bash
curl -s "https://dashboard.msfgco.com/Calculators/Company%20Calendar/calendar.html?v=20260527-sync" | rg "calendar-sync|MSFG Company Schedule"
```

Expected: rendered HTML references the updated calendar sync assets. If the browser still looks stale, hard refresh and verify S3/CloudFront before assuming deployment failed.

---

## Self-Review Checklist

- Spec coverage:
  - Outlook production OAuth and sync: Tasks 2, 3, 4, 5, 7, 9.
  - Google disabled feature flag: Tasks 2 and 8.
  - Availability-only privacy: Tasks 3, 6, 8, 9.
  - Bounded two-way sync: Task 4.
  - Read-only Outlook-owned entries: Tasks 6 and 8.
  - 15-minute sync and manual sync: Tasks 5, 7, 8.
  - Admin status visibility: Task 5.
  - Deployment and smoke testing: Task 9.
- No implementation step requires storing provider secrets in git.
- The callback route matches the registered Outlook URI: `/api/schedule/sync/outlook/callback`.
- Tasks are ordered so each test can fail before implementation and pass after implementation.
