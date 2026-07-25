# Dashboard Suite Pre-Approvals Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's Pre-Approvals page read Tracy Roberts's rows from Suite instead of Monday, behind a per-LO flag, without disturbing any other loan officer.

**Architecture:** A mirror sync, not a live proxy. `services/suite/{client,mapper,sync}.js` pulls Suite board rows with a pre-approval date and no application date, maps them onto the existing `pre_approvals` table keyed by `suite_loan_id`, and marks them `source_system = 'suite'`. The frontend and the entire checklist/notes/preferences object graph are untouched because the rows keep their local integer ids. Three files, three responsibilities: `client.js` owns HTTP and the API key, `mapper.js` is pure and owns Suite's field names, `sync.js` owns the database.

**Tech Stack:** Node 24 / Express, MySQL 2 (promise), Zod validation, Pino logging, vitest.

**Blocked on:** Plan B (`2026-07-25-suite-partner-board-read-endpoint.md`) being **merged and deployed**, and a `loans:read` partner key existing. Task 0 verifies both before any code is written.

**Source spec:** `docs/superpowers/specs/2026-07-25-suite-integrations-preapprovals-design.md` §8

---

## Before you start

- **Branch:** `git checkout -b feat/suite-preapprovals-sync`.
- **Migration rule — read this twice.** `runMigrations()` re-executes **every** migration file on
  **every** boot. There is no `migrations_applied` tracking. A `DELETE`/`UPDATE`/`TRUNCATE`/data
  `INSERT` in a migration therefore runs on every restart. This has already caused one production
  incident (migrations 035/038 wiped the Monday pipeline column mappings on every `--backend`
  deploy). **Migration 090 contains idempotent DDL only.** Row-level seeding goes in
  `backend/db/manual/`.
- **Validation schema rule.** New schemas go in `backend/validation/schemas/suite.js` and are
  consumed by `backend/validation/schemas.js` via **spread re-export only**. Never re-destructure
  individual names in the gateway file — that is what crashed prod once (schema exported but never
  destructured → `ReferenceError` at boot → PM2 errored → nginx 502).
- **Baseline:** `cd backend && npm test` must be green before you start. If it is red, stop and report.
- **Check the next migration number** — another agent may have landed one since this plan was
  written: `ls backend/db/migrations | tail -3`. This plan assumes **090**; use whatever is actually
  next and keep the filename convention.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `backend/db/migrations/090_suite_source.sql` | Create | Idempotent DDL: 3 columns on `pre_approvals`, `suite_lo_flags` table |
| `backend/services/suite/client.js` | Create | HTTP + API key + timeout. Knows nothing about pre-approvals |
| `backend/services/suite/mapper.js` | Create | `BoardRowResponse` → `pre_approvals` columns. **Pure, no I/O** |
| `backend/services/suite/sync.js` | Create | Fetch → map → upsert → reconcile. Owns the DB |
| `backend/services/suite/index.js` | Create | Re-exports, matching `services/monday/index.js` |
| `backend/routes/suite.js` | Create | Admin endpoints: status, test, sync, LO flags |
| `backend/validation/schemas/suite.js` | Create | Zod schemas |
| `backend/validation/schemas.js` | Modify | Spread re-export |
| `backend/server.js` | Modify | Mount `/api/suite` |
| `backend/routes/preApprovals.js` | Modify | Processor scoping branch for Suite rows |
| `backend/.env.example` | Modify | `SUITE_API_BASE_URL`, `SUITE_PARTNER_API_KEY` |
| `js/pre-approvals.js` | Modify | Source badge; read-only controls for Suite rows |
| `Calculators/Admin Settings/admin-settings.html` | Modify | Fill in the Suite group (Phase 1 left it a placeholder) |
| `js/admin/admin-settings.js` | Modify | `loadSuiteSection()`, called from `loadIntegrationsTab()` |
| `backend/tests/services/suite/mapper.test.js` | Create | Pure unit tests |
| `backend/tests/services/suite/sync.test.js` | Create | Sync with `client` stubbed |
| `backend/tests/routes/preApprovals-scoping.test.js` | Create | Role visibility, especially processor |

---

### Task 0: Verify the Suite side is actually live

No code. If this fails, everything downstream is built on sand.

- [ ] **Step 1: Confirm the endpoint is deployed**

```bash
curl -s https://los.msfgco.com/v3/api-docs | grep -o 'partnerGetBoardRows' || echo "NOT DEPLOYED"
```

Expected: `partnerGetBoardRows`. If `NOT DEPLOYED`, **stop** — Plan B has not shipped. Report and wait.

- [ ] **Step 2: Confirm the key works and Tracy has rows**

Ask the user for the `loans:read` key (it is shown once at mint time and is not recoverable). Then:

```bash
curl -s -H "Authorization: Bearer $SUITE_PARTNER_API_KEY" \
  'https://los.msfgco.com/api/partner/v1/board?lo=Tracy%20Roberts&dateField=PRE_APPROVAL&dateFrom=2020-01-01&dateTo=2027-12-31&applicationDateEmpty=true&size=5' \
  | head -c 2000
```

Expected: `{"success":true,"data":{"items":[...]}}`. Record the actual row count and **save one full
row to `/tmp/suite-board-row.json`** — it becomes the mapper test fixture in Task 2, and a real
payload beats an invented one.

- [ ] **Step 3: Report before writing code**

State: whether the endpoint is live, how many rows Tracy has, and paste one row's field names. If
the count is zero, stop — the spec's premise ("Tracy already works in Suite") is wrong and the
phase order needs revisiting.

---

### Task 1: Migration 090

**Files:**
- Create: `backend/db/migrations/090_suite_source.sql`

- [ ] **Step 1: Write the migration**

Follow the `INFORMATION_SCHEMA` + `PREPARE` guard used by every other migration here — see
`backend/db/migrations/037_preapprovals_monday_full_fields.sql` for the exact idiom.

```sql
-- ============================================================
-- Migration 090 - Suite as a pre-approval source
-- Idempotent DDL ONLY. runMigrations() re-runs this file on EVERY boot.
-- NEVER add DELETE/UPDATE/TRUNCATE/data-INSERT here.
-- ============================================================

-- suite_loan_id: the Suite loan UUID. Sync upsert key.
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'suite_loan_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN suite_loan_id CHAR(36) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Unique index so the sync upsert has a real key.
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND INDEX_NAME = 'idx_pa_suite_loan_id');
SET @sql = IF(@idx = 0,
    'ALTER TABLE pre_approvals ADD UNIQUE INDEX idx_pa_suite_loan_id (suite_loan_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- application_date: mirrors Suite applicationReceivedDate. Drives the
-- pre-approval-vs-pipeline rule (null = still a pre-approval).
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'application_date');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN application_date DATE NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- suite_missing_since: soft-delete marker. A Suite row that stops appearing is
-- marked, NEVER deleted — deleting cascades loan_checklists and its items,
-- subitems and call notes away.
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_approvals' AND COLUMN_NAME = 'suite_missing_since');
SET @sql = IF(@col = 0,
    'ALTER TABLE pre_approvals ADD COLUMN suite_missing_since TIMESTAMP NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Per-LO opt-in. No seed rows here — that is backend/db/manual/.
CREATE TABLE IF NOT EXISTS suite_lo_flags (
    lo_user_id INT NOT NULL PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    enabled_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lo_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Note:** `pre_approvals.source_system` already exists (`VARCHAR(50) DEFAULT 'manual'`, added by
`010_monday_boards.sql:50`). Suite rows set it to `'suite'`. Do **not** add a new source column.

- [ ] **Step 2: Verify it is idempotent by running it twice**

```bash
cd backend && npm run migrate && npm run migrate && echo "IDEMPOTENT OK"
```

Expected: both runs succeed, `IDEMPOTENT OK`. A failure on the second run means a guard is missing.

- [ ] **Step 3: Verify no forbidden statements**

```bash
grep -inE '^\s*(DELETE|UPDATE|TRUNCATE)\b|INSERT +INTO' backend/db/migrations/090_suite_source.sql \
  && echo "FORBIDDEN STATEMENT FOUND — fix before committing" || echo "DDL ONLY — OK"
```

Expected: `DDL ONLY — OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/090_suite_source.sql
git commit -m "feat(db): migration 090 — Suite as a pre-approval source"
```

---

### Task 2: The mapper (pure, TDD)

This is the only place that knows Suite's field names, and the only part of this plan that is
genuinely unit-testable without a database. Do it properly.

**Files:**
- Create: `backend/services/suite/mapper.js`
- Test: `backend/tests/services/suite/mapper.test.js`

- [ ] **Step 1: Write the failing test**

Use the real payload you saved in Task 0 Step 2 as the fixture shape.

```js
import { describe, it, expect } from 'vitest';
import { mapBoardRowToPreApproval, UNMAPPED_COLUMNS } from '../../../services/suite/mapper.js';

const row = {
  id: '11111111-2222-3333-4444-555555555555',
  loanNumber: 'L-1001',
  status: 'REGISTERED',
  loanOfficerName: 'Tracy Roberts',
  client: 'Jane Q Homebuyer',
  propertyAddress: '123 Main St',
  propertyCity: 'Bismarck',
  propertyState: 'ND',
  mortgageType: 'CONVENTIONAL',
  loanAmount: 250000,
  purchasePrice: 300000,
  applicationDate: null,
  trackedDates: { pre_approval: '2026-07-02' },
  cellValues: { lp_loan_number: 'LP-77', next_steps: 'Call borrower' },
};

describe('mapBoardRowToPreApproval', () => {
  it('maps identity, dates and the source discriminator', () => {
    const out = mapBoardRowToPreApproval(row);
    expect(out.suite_loan_id).toBe(row.id);
    expect(out.pre_approval_date).toBe('2026-07-02');
    expect(out.application_date).toBeNull();
    expect(out.source_system).toBe('suite');
  });

  it('splits client into first and last name', () => {
    const out = mapBoardRowToPreApproval(row);
    expect(out.borrower_first_name).toBe('Jane');
    expect(out.borrower_last_name).toBe('Q Homebuyer');
  });

  it('handles a single-word client without producing undefined', () => {
    const out = mapBoardRowToPreApproval({ ...row, client: 'Cher' });
    expect(out.borrower_first_name).toBe('Cher');
    expect(out.borrower_last_name).toBeNull();
  });

  it('handles a null client', () => {
    const out = mapBoardRowToPreApproval({ ...row, client: null });
    expect(out.borrower_first_name).toBeNull();
    expect(out.borrower_last_name).toBeNull();
  });

  it('pulls board cell values', () => {
    const out = mapBoardRowToPreApproval(row);
    expect(out.lp_loan_number).toBe('LP-77');
    expect(out.next_steps).toBe('Call borrower');
  });

  it('leaves Monday-only columns null', () => {
    const out = mapBoardRowToPreApproval(row);
    expect(out.monday_item_id).toBeNull();
    expect(out.source_board_id).toBeNull();
  });

  it('does not resolve assigned_lo_id — that needs a DB lookup in sync.js', () => {
    const out = mapBoardRowToPreApproval(row);
    expect(out.assigned_lo_name).toBe('Tracy Roberts');
    expect(out).not.toHaveProperty('assigned_lo_id');
  });

  it('survives a row with no tracked dates and no cell values', () => {
    const out = mapBoardRowToPreApproval({ id: 'x', client: null });
    expect(out.pre_approval_date).toBeNull();
    expect(out.next_steps).toBeNull();
  });

  it('publishes the columns it does not populate, so the UI can show them', () => {
    expect(UNMAPPED_COLUMNS).toContain('expiration_date');
    expect(UNMAPPED_COLUMNS).toContain('dti');
    expect(UNMAPPED_COLUMNS).not.toContain('pre_approval_date');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx vitest run tests/services/suite/mapper.test.js
```

Expected: FAIL — cannot resolve `../../../services/suite/mapper.js`.

- [ ] **Step 3: Write the mapper**

```js
// Suite BoardRowResponse → pre_approvals column object.
// PURE: no HTTP, no database, no clock. Everything that needs I/O (assigned_lo_id
// resolution, last_synced_at) is sync.js's job.

/** pre_approvals columns Suite has no equivalent for. Surfaced in the admin UI so
 *  blank cells read as "not mapped yet" rather than "missing data". */
const UNMAPPED_COLUMNS = [
  'expiration_date', 'citizenship', 'dti', 'ltv', 'credit_report_date',
  'coborrower_first_name', 'coborrower_last_name', 'coborrower_name',
  'coborrower_email', 'coborrower_phone', 'coborrower_dob',
  'borrower_email', 'borrower_phone', 'borrower_dob', 'zip',
  'partners', 'special_request', 'campaign', 'investor_loan_number',
];

function splitClient(client) {
  if (!client || typeof client !== 'string' || !client.trim()) {
    return { first: null, last: null };
  }
  const parts = client.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function mapBoardRowToPreApproval(row) {
  const tracked = row.trackedDates || {};
  const cells = row.cellValues || {};
  const { first, last } = splitClient(row.client);

  return {
    suite_loan_id: row.id ?? null,
    source_system: 'suite',

    pre_approval_date: tracked.pre_approval ?? null,
    application_date: row.applicationDate ?? null,

    borrower_first_name: first,
    borrower_last_name: last,
    assigned_lo_name: row.loanOfficerName ?? null,

    loan_amount: row.loanAmount ?? null,
    purchase_price: row.purchasePrice ?? null,
    loan_type: row.mortgageType ?? null,
    stage: row.status ?? null,

    current_address: row.propertyAddress ?? null,
    city: row.propertyCity ?? null,
    state: row.propertyState ?? null,

    lp_loan_number: cells.lp_loan_number ?? null,
    next_steps: cells.next_steps ?? null,

    // Monday-only identity columns stay null for Suite rows.
    monday_item_id: null,
    source_board_id: null,
  };
}

module.exports = { mapBoardRowToPreApproval, UNMAPPED_COLUMNS, splitClient };
```

> The test file uses ESM `import` and the source uses `module.exports`. That mixture is what the
> existing `backend/tests/validation/schemas.test.js` already does (it `import`s from a CommonJS
> module), so vitest is configured for it. If the import fails, match whatever that file does rather
> than converting the service to ESM — the rest of `backend/` is CommonJS.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx vitest run tests/services/suite/mapper.test.js
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/suite/mapper.js backend/tests/services/suite/mapper.test.js
git commit -m "feat(suite): pure BoardRowResponse -> pre_approvals mapper"
```

---

### Task 3: The client

**Files:**
- Create: `backend/services/suite/client.js`
- Modify: `backend/.env.example`

- [ ] **Step 1: Write the client**

```js
// Suite partner API client. The ONLY place that knows the base URL, the API key,
// and HTTP. Deliberately ignorant of pre-approvals.
//
// The key is a SERVER-SIDE ORG credential and lives in .env — NOT in the
// user_integrations vault, which is per-user and returns masked values to browsers.

const logger = require('../../lib/logger');

const TIMEOUT_MS = 10000;
const MAX_PAGE_SIZE = 200;

function config() {
  return {
    baseUrl: process.env.SUITE_API_BASE_URL,
    apiKey: process.env.SUITE_PARTNER_API_KEY,
  };
}

function isConfigured() {
  const { baseUrl, apiKey } = config();
  return Boolean(baseUrl && apiKey);
}

async function request(path, params = {}) {
  const { baseUrl, apiKey } = config();
  if (!isConfigured()) {
    const err = new Error('Suite integration is not configured (SUITE_API_BASE_URL / SUITE_PARTNER_API_KEY)');
    err.status = 503;
    throw err;
  }

  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item));
    else url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Suite ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One page of board rows. Returns the unwrapped PagedResponse:
 * { items, page, size, total, totalPages }.
 */
async function getBoardRows({ lo, dateField, dateFrom, dateTo, applicationDateEmpty, page = 0, size = MAX_PAGE_SIZE }) {
  const body = await request('/api/partner/v1/board', {
    lo, dateField, dateFrom, dateTo, applicationDateEmpty, page, size: Math.min(size, MAX_PAGE_SIZE),
  });
  return body.data;
}

/** Cheap reachability probe for the admin "Test" button. */
async function testConnection() {
  const data = await getBoardRows({ size: 1 });
  return { reachable: true, total: data.total };
}

module.exports = { getBoardRows, testConnection, isConfigured, MAX_PAGE_SIZE };
```

- [ ] **Step 2: Add the env keys**

Append to `backend/.env.example`:

```
# Suite (los.msfgco.com) partner API — server-side org credential, scope loans:read.
# NOT a per-user credential: do not put this in user_integrations.
SUITE_API_BASE_URL=
SUITE_PARTNER_API_KEY=
```

- [ ] **Step 3: Verify it parses and fails closed when unconfigured**

```bash
cd backend && node -e "
const c = require('./services/suite/client');
console.log('isConfigured (expect false):', c.isConfigured());
c.getBoardRows({}).then(() => console.log('UNEXPECTED SUCCESS')).catch(e => console.log('status', e.status, '|', e.message));
"
```

Expected: `isConfigured (expect false): false` then `status 503 | Suite integration is not
configured ...`. It must throw a 503, not crash and not silently return empty.

- [ ] **Step 4: Commit**

```bash
git add backend/services/suite/client.js backend/.env.example
git commit -m "feat(suite): partner API client with timeout and fail-closed config"
```

---

### Task 4: The sync

**Files:**
- Create: `backend/services/suite/sync.js`, `backend/services/suite/index.js`
- Test: `backend/tests/services/suite/sync.test.js`

- [ ] **Step 1: Write the failing test**

Stub `client.js` and the db module — `sync.js` must be testable without a network or a database.

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/suite/client.js', () => ({
  getBoardRows: vi.fn(),
  isConfigured: vi.fn(() => true),
}));
vi.mock('../../../db/connection.js', () => ({ default: { query: vi.fn() }, query: vi.fn() }));

const client = await import('../../../services/suite/client.js');
const db = await import('../../../db/connection.js');
const { syncSuitePreApprovals } = await import('../../../services/suite/sync.js');

const row = (id, lo = 'Tracy Roberts') => ({
  id, client: 'Jane Buyer', loanOfficerName: lo,
  trackedDates: { pre_approval: '2026-07-02' }, applicationDate: null, cellValues: {},
});

describe('syncSuitePreApprovals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op with a clear result when no LOs are flagged', async () => {
    db.query.mockResolvedValueOnce([[]]);           // suite_lo_flags -> none
    const out = await syncSuitePreApprovals();
    expect(out.created).toBe(0);
    expect(client.getBoardRows).not.toHaveBeenCalled();
  });

  it('requests only the pre-approval-without-application set', async () => {
    db.query.mockResolvedValueOnce([[{ lo_user_id: 7, name: 'Tracy Roberts' }]]);
    client.getBoardRows.mockResolvedValue({ items: [], page: 0, size: 200, total: 0, totalPages: 0 });
    await syncSuitePreApprovals();
    const args = client.getBoardRows.mock.calls[0][0];
    expect(args.dateField).toBe('PRE_APPROVAL');
    expect(args.applicationDateEmpty).toBe(true);
    expect(args.lo).toEqual(['Tracy Roberts']);
  });

  it('resolves assigned_lo_id from the LO name and counts unresolved ones', async () => {
    db.query.mockResolvedValueOnce([[{ lo_user_id: 7, name: 'Tracy Roberts' }]]);
    client.getBoardRows.mockResolvedValue({
      items: [row('a'), row('b', 'Nobody At All')], page: 0, size: 200, total: 2, totalPages: 1,
    });
    const out = await syncSuitePreApprovals();
    expect(out.unresolvedLos).toContain('Nobody At All');
  });

  it('marks disappeared rows instead of deleting them', async () => {
    db.query.mockResolvedValueOnce([[{ lo_user_id: 7, name: 'Tracy Roberts' }]]);
    client.getBoardRows.mockResolvedValue({ items: [], page: 0, size: 200, total: 0, totalPages: 0 });
    await syncSuitePreApprovals();
    const statements = db.query.mock.calls.map(c => String(c[0]).toUpperCase());
    expect(statements.some(s => s.includes('SUITE_MISSING_SINCE'))).toBe(true);
    expect(statements.some(s => s.startsWith('DELETE'))).toBe(false);
  });

  it('refuses to run concurrently', async () => {
    db.query.mockResolvedValue([[]]);
    const [a, b] = await Promise.all([syncSuitePreApprovals(), syncSuitePreApprovals()]);
    expect([a.alreadyRunning, b.alreadyRunning]).toContain(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx vitest run tests/services/suite/sync.test.js
```

Expected: FAIL — `services/suite/sync.js` does not exist.

- [ ] **Step 3: Write the sync**

Implement `syncSuitePreApprovals()` in `backend/services/suite/sync.js` with exactly this contract,
mirroring the structure of `backend/services/monday/sync.js` (read `upsertPreApprovalRow` at line
100 for the userNameMap idiom):

1. In-process `let running = false` guard; if already running return `{ alreadyRunning: true }`.
2. `SELECT f.lo_user_id, u.name FROM suite_lo_flags f JOIN users u ON u.id = f.lo_user_id WHERE f.enabled = 1`.
   Empty → return a zeroed summary without calling the client.
3. Build a lowercase `name → users.id` map from that result.
4. Per LO, page `client.getBoardRows({ lo: [name], dateField: 'PRE_APPROVAL', dateFrom: '2020-01-01',
   dateTo: <today + 1 year, ISO>, applicationDateEmpty: true, size: 200, page: n })` until
   `page >= totalPages`.
   The window is intentionally wide, not rolling: an unconverted pre-approval stays interesting
   indefinitely, and a `PRE_APPROVAL` tracked date can legitimately be post-dated. Both bounds are
   constants in this file, not configuration.
5. Map each row, attach `assigned_lo_id` from the name map (null + record in `unresolvedLos` when
   unmatched), set `last_synced_at = NOW()` and `suite_missing_since = NULL`.
6. Upsert on `suite_loan_id` (`INSERT ... ON DUPLICATE KEY UPDATE`).
7. Reconcile: `UPDATE pre_approvals SET suite_missing_since = NOW() WHERE source_system = 'suite'
   AND suite_missing_since IS NULL AND assigned_lo_id IN (<enabled>) AND suite_loan_id NOT IN (<seen>)`.
   **Never `DELETE`** — that cascades `loan_checklists` and its items, subitems and call notes away.
   Guard the `NOT IN` against an empty seen-set (an empty `IN ()` is a SQL syntax error).
8. Return `{ alreadyRunning: false, loRows: {name: count}, created, updated, missing,
   unresolvedLos: [], unmappedColumns: UNMAPPED_COLUMNS, errors: [] }`.
9. Wrap each LO's fetch in try/catch, push to `errors`, and keep going — one LO's failure must not
   abort the rest.

Then create `backend/services/suite/index.js` re-exporting `{ getBoardRows, testConnection,
isConfigured }` from client, `{ mapBoardRowToPreApproval, UNMAPPED_COLUMNS }` from mapper, and
`{ syncSuitePreApprovals }` from sync — matching the shape of `backend/services/monday/index.js`.

- [ ] **Step 4: Run to verify it passes**

```bash
cd backend && npx vitest run tests/services/suite/sync.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/suite/sync.js backend/services/suite/index.js backend/tests/services/suite/sync.test.js
git commit -m "feat(suite): pre-approvals sync with soft-delete reconcile and overlap guard"
```

---

### Task 5: Routes and validation

**Files:**
- Create: `backend/routes/suite.js`, `backend/validation/schemas/suite.js`
- Modify: `backend/validation/schemas.js`, `backend/server.js`

- [ ] **Step 1: Write the schemas**

`backend/validation/schemas/suite.js`:

```js
const { z } = require('zod');

const suiteLoFlag = z.object({
  enabled: z.boolean(),
});

module.exports = { suiteLoFlag };
```

- [ ] **Step 2: Spread-re-export in the gateway**

In `backend/validation/schemas.js`, add the require alongside the others and spread it into the
export object:

```js
const suiteSchemas = require('./schemas/suite');
```

```js
module.exports = { /* ...existing... */, ...suiteSchemas };
```

**Do not** write `const { suiteLoFlag } = require('./schemas/suite')` and list the name — that is
the prod-crash pattern.

- [ ] **Step 3: Write the routes**

`backend/routes/suite.js` — admin-only, thin orchestration, service does the work:

- `GET  /api/suite/status` → `{ configured, lastSync, lastResult }`
- `POST /api/suite/test` → `client.testConnection()`
- `POST /api/suite/sync` → `syncSuitePreApprovals()` summary
- `GET  /api/suite/lo-flags` → all LOs with their enabled state
- `PUT  /api/suite/lo-flags/:loUserId` → validated with `suiteLoFlag`

Use `next(err)` for errors and the `backend/utils/response.js` helpers (`ok`/`fail`) — the
convention for new code.

- [ ] **Step 4: Mount it**

In `backend/server.js`, alongside the Monday mount:

```js
const suiteRoutes = require('./routes/suite');
```
```js
app.use('/api/suite', authenticate, suiteRoutes);
```

- [ ] **Step 5: Verify the server still boots — this is the 502 guard**

```bash
cd backend && node -e "require('./validation/schemas'); console.log('schemas OK')" \
  && node -e "require('./routes/suite'); console.log('routes OK')" \
  && timeout 20 node server.js 2>&1 | head -20
```

Expected: `schemas OK`, `routes OK`, and the server logging a successful start. A `ReferenceError`
here is the exact failure that took prod down before — fix it now, not after deploy.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/suite.js backend/validation/schemas/suite.js backend/validation/schemas.js backend/server.js
git commit -m "feat(suite): admin routes for status, test, sync and per-LO flags"
```

---

### Task 6: Pre-Approvals scoping — the processor hole

Spec §8.6. The LO and manager branches already key off `assigned_lo_id` and cover Suite rows for
free. **The processor branch is board-id-only and will see zero Suite rows.**

**Files:**
- Modify: `backend/routes/preApprovals.js` (the processor branch, around line 39)
- Test: `backend/tests/routes/preApprovals-scoping.test.js` (create)

- [ ] **Step 1: Write the failing test**

Assert, per role, which rows come back for a `source_system='suite'` row assigned to an LO. Cover
admin, LO, manager, and processor — the processor case is the one being fixed and must fail first.

Model the db-mocking on whatever the existing `backend/tests/routes/` files do; read one first.

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && npx vitest run tests/routes/preApprovals-scoping.test.js
```

Expected: the processor case FAILS (no Suite rows returned); the others pass.

- [ ] **Step 3: Add the Suite clause to the processor branch**

`getProcessorLOIds` already exists at `backend/utils/boardAccess.js:18`.

```js
      } else if (role === 'processor') {
        const loIds = await getProcessorLOIds(currentUserId);
        const conditions = [];
        if (boardIds.length > 0) {
          conditions.push(`pa.source_board_id IN (${boardIds.map(() => '?').join(',')})`);
          params.push(...boardIds);
        }
        if (loIds.length > 0) {
          conditions.push(`(pa.source_system = 'suite' AND pa.assigned_lo_id IN (${loIds.map(() => '?').join(',')}))`);
          params.push(...loIds);
        }
        if (conditions.length === 0) {
          return res.json({ data: [], boards: [], groups: [] });
        }
        query += ` AND (${conditions.join(' OR ')})`;
```

- [ ] **Step 4: Hide soft-deleted rows by default**

In the same handler, exclude rows that Suite has stopped returning:

```js
    query += ' AND pa.suite_missing_since IS NULL';
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd backend && npx vitest run tests/routes/preApprovals-scoping.test.js && npm test
```

Expected: the scoping file passes, and the full backend suite stays green.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/preApprovals.js backend/tests/routes/preApprovals-scoping.test.js
git commit -m "fix(pre-approvals): processors can see Suite-sourced rows; hide missing ones"
```

---

### Task 7: Frontend — source badge and read-only Suite rows

Suite rows must **not** offer edit/delete, because those write to Monday via
`backend/services/monday/writer.js`. Writing a Suite row through the Monday writer would send it to
the wrong system entirely. Write-back is Phase 4.

**Files:**
- Modify: `js/pre-approvals.js`
- Modify: `Calculators/Admin Settings/admin-settings.html` (fill in the Suite group)
- Modify: `js/admin/admin-settings.js` (add `loadSuiteSection()`)

- [ ] **Step 1: Badge and gate the row controls**

In `js/pre-approvals.js`, where a row's action buttons are rendered, branch on
`item.source_system === 'suite'`: render a badge (reuse the existing file-local-checklist badge
class) and replace edit/delete with:

```html
<a class="btn btn-sm btn-secondary" target="_blank" rel="noopener"
   href="https://suite.msfgco.com/loans/${encodeURIComponent(item.suite_loan_id)}">
  Open in Suite <i class="fas fa-arrow-up-right-from-square"></i>
</a>
```

- [ ] **Step 2: Fill in the Suite admin group**

Replace the `.integration-group-empty` placeholder inside `#integrationSuite` (added in the Phase 1
rename) with: connection status, a Test button, Run Sync Now, a last-sync summary, the per-LO
toggle list, and the unmapped-column list from `UNMAPPED_COLUMNS`.

- [ ] **Step 3: Wire the loader**

In `js/admin/admin-settings.js`, extend the existing entry point:

```js
  function loadIntegrationsTab() {
    loadMondayTab();
    loadSuiteSection();
  }
```

- [ ] **Step 4: Verify in the browser**

`preview_start` the `frontend` config, open
`Calculators/Admin Settings/admin-settings.html#integrations`, and confirm via `read_page` that the
Suite group now shows real controls. Then `read_console_messages` — expect no errors.

The admin page gates on `/me`, so a stubbed-auth render is needed exactly as in the Phase 1
verification. See `docs/superpowers/plans/2026-07-25-integrations-tab-rename.md` Task 5.

- [ ] **Step 5: Commit**

```bash
git add js/pre-approvals.js "Calculators/Admin Settings/admin-settings.html" js/admin/admin-settings.js
git commit -m "feat(suite): source badge, read-only Suite rows, Suite admin section"
```

---

### Task 8: End-to-end against Tracy's real data

**Files:** none — verification only.

- [ ] **Step 1: Full backend suite**

```bash
cd backend && npm test
```

Expected: green.

- [ ] **Step 2: Enable Tracy — via `backend/db/manual/`, not a migration**

Create `backend/db/manual/enable_suite_for_tracy.sql`:

```sql
-- One-off. NOT a migration: migrations re-run on every boot.
INSERT INTO suite_lo_flags (lo_user_id, enabled, enabled_at)
SELECT id, 1, NOW() FROM users WHERE email = 'tracy.roberts@msfg.us'
ON DUPLICATE KEY UPDATE enabled = 1, enabled_at = NOW();
```

- [ ] **Step 3: Run the sync and diff against Suite**

Trigger `POST /api/suite/sync` from the Integrations tab. Then compare the dashboard's
Pre-Approvals list for Tracy against the same filter in the Suite console.

Expected: **identical row counts and identical pre-approval dates.** Any mismatch is a mapper or
filter bug — investigate before declaring done, and report the specific rows that differ.

- [ ] **Step 4: Report**

State the row count from each side, whether they match, and the `unresolvedLos` /
`unmappedColumns` from the sync summary. Do not report success on a count mismatch.

---

## Deploy

The user's call. Order matters:

1. **Put `SUITE_API_BASE_URL` and `SUITE_PARTNER_API_KEY` in the EC2 backend `.env` BEFORE
   deploying**, so the first boot after migration 090 has them.
2. **Check the EC2 box's git state first.** It can sit on a non-`main` branch or carry local hotfix
   commits, and `./deploy.sh --backend` does `git pull origin main`, which fails with "divergent
   branches". Do not `git reset --hard` it without backing up whatever is unique to it.
3. `./deploy.sh --backend`. Migration 090 applies on boot.
4. Apply `backend/db/manual/enable_suite_for_tracy.sql`.
5. Run the sync from the Integrations tab; diff against the Suite console.

---

## Self-Review

**Spec coverage (§8 of the design doc):**

| §8 requirement | Task |
|---|---|
| Migration 090: `suite_loan_id`, `application_date`, `suite_missing_since`, `suite_lo_flags` | 1 |
| Reuse existing `source_system` with `'suite'`; no new source column | 1 (note), 2 (mapper) |
| Idempotent DDL only; no data statements | 1, verified in Step 3 |
| `client.js` — env-based key, timeout, fail-closed | 3 |
| Key is server-side, not in `user_integrations` | 3 (comment + `.env.example`) |
| `mapper.js` pure, publishes unmapped columns | 2 |
| `sync.js` — flags, paging, LO resolution, upsert, soft-delete reconcile, overlap guard | 4 |
| Wide date window with stated rationale | 4 Step 3 item 4 |
| `routes/suite.js` — status/test/sync/lo-flags | 5 |
| Schemas via spread re-export only | 5 Steps 1–2, boot-verified Step 5 |
| Processor scoping branch | 6 |
| Source badge + read-only Suite rows + Open in Suite | 7 |
| Suite section in the Integrations tab | 7 |
| Tests: mapper, sync, role scoping | 2, 4, 6 |
| Manual diff against the Suite console | 8 |

No gaps.

**Placeholder scan:** Tasks 4 Step 3, 5 Step 3, 6 Step 1 and 7 Steps 1–2 specify contracts and
point at the exact file to mirror rather than inlining full implementations. That is deliberate for
code whose shape is dictated by an existing file in this repo (`monday/sync.js`, the other
`routes/`, the other `tests/routes/`) — inventing a version that does not match the house style
would be worse than pointing at the real one. Every one of them names the file and line to read.
Everything with a fixed, knowable shape — the migration, the mapper, the client, the schemas, the
processor SQL — is written out in full.

**Type/name consistency:** `mapBoardRowToPreApproval` and `UNMAPPED_COLUMNS` are defined in Task 2
and imported in Tasks 4 and 7 under the same names. `syncSuitePreApprovals` is defined in Task 4
and called in Task 5. `getBoardRows` / `testConnection` / `isConfigured` are defined in Task 3 and
consumed in Tasks 4 and 5. `suite_loan_id`, `source_system`, `application_date` and
`suite_missing_since` are spelled identically in the migration (Task 1), the mapper (Task 2), the
sync (Task 4), the route SQL (Task 6) and the frontend (Task 7). `suiteLoFlag` is defined in Task 5
Step 1 and used in Step 3.

**Cross-plan consistency:** the client calls `dateField=PRE_APPROVAL` and `applicationDateEmpty`,
both of which Plan B Tasks 1–2 create. `MAX_PAGE_SIZE` is 200 on both sides. `loans:read` is the
only scope required.
