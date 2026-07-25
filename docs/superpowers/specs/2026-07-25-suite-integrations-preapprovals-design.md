# Suite Integrations — rename the Monday tab, then move Pre-Approvals onto Suite

**Date:** 2026-07-25
**Status:** Approved (design); implementation not started
**Repos touched:** `dashboard.msfgco.com` (Node/MySQL), `msfg-suite` (Spring Boot)

## 1. Goal

Two things, in order:

1. Rename the admin panel's **Monday.com** tab to **Integrations**, and restructure it so
   Monday is one section among several rather than the whole tab.
2. Begin replacing Monday connections with `suite.msfgco.com` (API `los.msfgco.com`) ones,
   starting with the dashboard's **Pre-Approvals** page for a single loan officer —
   Tracy Roberts — scoped to loans that have a pre-approval date and no application date.

The long-term destination is that every Monday connection is gone and the Suite is the
source of truth. This spec covers the first vertical slice and the tab restructure that
makes room for the rest.

## 2. Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Deliverable | Swap the existing dashboard Pre-Approvals page's **data source** from the Monday sync to Suite, feature-flagged per LO, Tracy first | Reuses the whole existing page rather than building a parallel report |
| Integration shape | **Mirror sync** into the existing `pre_approvals` table, with Suite as a second source system | `loan_checklists.source_item_id` is an INT pointing at `pre_approvals.id`; a live proxy has no stable local id and orphans checklists, call notes, and column preferences |
| Suite read access | New `GET /api/partner/v1/board` on the existing `/api/partner/**` machine-auth chain, guarded by the already-reserved `PartnerScope.LOANS_READ` | The partner chain already has API keys, scopes, rate limiting, request logging, and tenant/RLS enforcement |
| Write direction | Dashboard writes back to Suite (not Monday) — but **deferred to Phase 4**, because the partner write surface cannot reach Suite-native loans or tracked dates today | Avoids split-brain, but does not block the read slice |
| Pre-Approvals vs Pipeline split | A Suite loan with a `PRE_APPROVAL` tracked date and `applicationReceivedDate IS NULL` is a **pre-approval**; once `applicationReceivedDate` is set it becomes a **pipeline** row | Suite has no separate pre-approval entity — the same loan would otherwise appear in both dashboard sections |
| Tracy's data | Already lives in Suite; she works there | So Phase 3 can be validated against real rows immediately, with no Monday→Suite backfill |

## 3. Non-goals

- Cutting over any LO other than Tracy.
- Touching the Pipeline or Funded Loans sections.
- Removing any Monday code. Monday stays fully functional for every unflagged LO.
- Deploying the suite `--backend` box for unrelated reasons. Per project memory, the
  calendar feature on `origin/main` is another agent's WIP and is intentionally undeployed.

## 4. Current state (verified)

### Dashboard

- Tab button: `Calculators/Admin Settings/admin-settings.html:40` —
  `<button class="admin-tab" data-tab="monday">` with the label `Monday.com`.
- Panel: `#panel-monday` at `admin-settings.html:1041`, containing six `.monday-section`
  blocks (token, boards, column mappings, display config, webhooks, sync history) plus a
  four-step setup-flow strip.
- Behaviour: `js/admin/admin-settings.js` (3910 lines). Tab dispatch at line 74
  (`if (tabName === 'monday') loadMondayTab();`); the Monday block starts at the
  `MONDAY.COM TAB` banner on line 3032 with `loadMondayTab()` at 3039.
- Deep links into the tab: `js/action-dispatcher.js:107` opens
  `Calculators/Admin Settings/admin-settings.html#monday`.
- Pre-Approvals read path: `GET /api/pre-approvals` in `backend/routes/preApprovals.js:16`
  selects `pre_approvals pa LEFT JOIN monday_boards mb ON pa.source_board_id = mb.board_id`,
  then branches on role.
- Access control helpers: `backend/utils/boardAccess.js` —
  `getAccessibleBoardIds` (reads `monday_board_access`), `getProcessorLOIds`
  (`processor_lo_assignments`), `getManagerLOIds` (`manager_lo_assignments`).
- Frontend: `js/pre-approvals.js` (661 lines), reached through `js/api.js` (`PreApprovals.load`,
  `.render`, `.openCreate`, `.openEdit`, `.deleteItem`).
- Writes today go to Monday via `backend/services/monday/writer.js`
  (`createPreApproval` / `updatePreApproval` / `archivePreApproval`), called from
  `backend/routes/preApprovals.js`.
- Sync today is **manual only** — `syncAllBoards(userId)` at
  `backend/services/monday/sync.js:292`, triggered from the admin "Run Sync Now" button.
  There is no Monday cron; only `calendarSync` has a scheduler (`backend/server.js:264`).
- `pre_approvals` has `pre_approval_date` and `expiration_date` but **no `application_date`**
  (`pipeline` and `funded_loans` both have one).
- Latest migration: `089_manager_lo_assignments.sql`. Next is **090**.

### Suite (`~/MSFG/msfg-suite`, prod `los.msfgco.com`, migrations at V39)

- `GET /api/board` (`loan-core/.../loan/web/BoardController.java`, `operationId=getBoardRows`)
  returns `PagedResponse<BoardRowResponse>` and accepts, among others:
  `lo` (resolved LO names), `status`, `statusExclude`, `dateField`, `dateFrom`, `dateTo`,
  `ids`, `sort`, `page`, `size`.
- `BoardRowResponse` carries `id` (UUID), `loanNumber`, `status`, `loanOfficerId`,
  `loanOfficerName`, `client`, `propertyAddress/City/State`, `propertyType`, `occupancyType`,
  `loanPurpose`, `mortgageType`, `loanAmount`, `interestRate`, `purchasePrice`,
  `appraisedValue`, **`applicationDate`**, `outstandingConditions`,
  `trackedDates` (keyed by lowercase `BoardColumn.key()`), `cellValues`, `commentCounts`,
  `createdAt`, `updatedAt`.
- `BoardDateField.PRE_APPROVAL` maps to `TrackedDateKey.PRE_APPROVAL` ("Pre-Approval",
  CRITICAL, ordinal 1), so `?dateField=PRE_APPROVAL&dateFrom=…&dateTo=…` already filters
  on the pre-approval date.
- `BoardColumn.APPLICATION_DATE` is a `SUITE_FIELD` bound to the loan field
  `applicationReceivedDate`.
- `BoardController` sits behind the **staff** security catch-all (Cognito pool
  `us-west-1_S6iE2uego`, `org_id` claim required) — not reachable by a machine today.
- Machine auth: `PartnerSecurityConfig` installs an `@Order(1)` chain on
  `securityMatcher("/api/partner/**")`, default-deny, with `PartnerApiKeyAuthFilter`
  installing a synthetic `JwtAuthenticationToken` so tenancy/RLS/auditing work unchanged.
- `PartnerScope` already declares **`LOANS_READ("loans:read")`** and
  `DOCUMENTS_READ("documents:read")` — declared but consumed by no controller.
- Existing partner endpoints are **write-only**: `POST /api/partner/v1/loans` (upsert),
  `POST /{externalId}/status`, `/notes`, `/documents`.
- Partner write identity is `(org from key, sourceSystem, externalId)` resolved through the
  `partner_loan_link` table. `assigneeUserId`, `campaign`, and `loanPurpose` are honoured
  **on create only** and deliberately ignored on update — a machine key must never reassign
  a loan. There is no partner path that writes a tracked date, and no way to address a
  Suite-native loan (one with no `partner_loan_link` row).
- OpenAPI is public and unauthenticated at `GET /v3/api-docs`; Swagger UI at
  `/swagger-ui.html`.

## 5. Architecture

Three new units, each independently understandable and testable.

```
Suite (los.msfgco.com)
  └── GET /api/partner/v1/board          [NEW, Phase 2]  scope: loans:read
        │  thin delegation to the existing BoardService.rows
        ▼
Dashboard backend
  ├── services/suite/client.js           [NEW]  HTTP + API key + timeouts. Knows nothing about pre-approvals.
  ├── services/suite/mapper.js           [NEW]  BoardRowResponse → pre_approvals column object. Pure. No I/O.
  ├── services/suite/sync.js             [NEW]  Orchestration: fetch → map → upsert by suite_loan_id. No HTTP, no mapping logic.
  └── routes/suite.js                    [NEW]  Admin endpoints: test connection, run sync, sync history, per-LO flags.
        ▼
  pre_approvals table (existing, +3 columns)
        ▼
  routes/preApprovals.js                 [MODIFIED]  scoping gains a Suite branch
        ▼
  js/pre-approvals.js                    [UNCHANGED]
```

The seam that matters: `mapper.js` is pure and takes a `BoardRowResponse`-shaped object,
returns a column/value object. It is the only place that knows Suite's field names. It can
be unit-tested against a captured fixture with no network and no database.

`client.js` is the only place that knows the API key, base URL, and HTTP. `sync.js` is the
only place that knows about the database. Nothing outside `services/suite/` knows Suite
exists, except the two scoping branches in `preApprovals.js` and the Integrations tab UI.

### Why not a live proxy

`loan_checklists` (`backend/db/migrations/065_checklists.sql:39`) is keyed
`UNIQUE (source_type, source_item_id)` where `source_type='pre_approval'` and
`source_item_id` is an **INT** referencing `pre_approvals.id`. Suite loan ids are UUIDs.
Serving Pre-Approvals directly from Suite means those rows have no stable local integer id,
which orphans every checklist, call note, and per-user column preference attached to Tracy's
pre-approvals. Keeping a local mirrored row preserves the entire existing object graph.

The secondary reasons: Suite latency becomes page latency, Suite downtime becomes a blank
page, and the manager/processor scoping in `preApprovals.js` would have to be reimplemented
against Suite LO names instead of local user ids.

## 6. Phase 1 — rename to Integrations

Frontend-only. Ships on its own via `./deploy.sh`.

**`Calculators/Admin Settings/admin-settings.html`**
- Line 40–41: `data-tab="monday"` → `data-tab="integrations"`; label `Monday.com` →
  `Integrations`; icon `fa-sync-alt` → `fa-plug`.
- Line 1041: `id="panel-monday"` → `id="panel-integrations"`.
- Inside the panel, wrap the existing six `.monday-section` blocks in a
  **Monday.com** sub-heading, and add an empty **Suite** sub-heading below it (populated in
  Phase 3). The four-step setup-flow strip stays inside the Monday sub-section — it is
  Monday-specific.
- `<title>` stays `Admin Settings - MSFG`; the tab rename does not change the page.

**`js/admin/admin-settings.js`**
- Line 74: `if (tabName === 'monday')` → `if (tabName === 'integrations')`, calling a new
  `loadIntegrationsTab()` that calls the existing `loadMondayTab()` (and, in Phase 3,
  `loadSuiteSection()`).
- The `MONDAY.COM TAB` banner at line 3032 becomes `INTEGRATIONS TAB — MONDAY.COM SECTION`.
  Every `monday*` identifier inside keeps its name — they are genuinely Monday-specific and
  renaming them is churn with no benefit.

**`js/action-dispatcher.js`**
- Line 107: `admin-settings.html#monday` → `#integrations`.
- Add a backward-compat shim in `admin-settings.js`: on load, treat a `#monday` hash as
  `#integrations`, so any bookmark or stale cached HTML still lands on the right tab.

**Verification:** open the popup via the header admin button and via the `#integrations`
deep link; confirm the tab reads "Integrations", the Monday sections all still load
(token status, boards table, mapping, webhooks, history), and `#monday` still resolves.

## 7. Phase 2 — Suite partner read endpoint

A PR in `msfg-suite`. No migration — **V39 stays latest**.

**New** `integrations/src/main/java/com/msfg/los/integrations/web/PartnerBoardController.java`

```
@RequestMapping("/api/partner/v1/board")
@GetMapping
@PreAuthorize("hasAuthority('SCOPE_loans:read')")
@Operation(operationId = "partnerGetBoardRows")
ApiResponse<PagedResponse<BoardRowResponse>> rows(...)
```

Design constraints:

- **Delegate, do not reimplement.** The controller builds a `PipelineFilter` and calls the
  same `BoardService.rows(...)` the staff board uses. No duplicated query logic, so the
  partner view can never drift from the staff view.
- **Scope surface deliberately narrower than the staff board.** Accept only
  `lo`, `status`, `statusExclude`, `dateField`, `dateFrom`, `dateTo`, `applicationDateEmpty`,
  `sort`, `page`, `size`. Omit `ids` and the cell-write paths.
- **`applicationDateEmpty` is new.** A `Boolean` that, when true, restricts to
  `applicationReceivedDate IS NULL`. This is what makes "pre-approval date but no
  application date" a single call instead of an over-fetch plus client-side filter. It
  belongs on `PipelineFilter` so the staff board can use it too.
- **Org scope only, never caller scope.** A partner key has no owning LO, so pass
  `orgWideView = true` with the key's org. Tenancy still comes from the synthetic
  principal's `org_id` via `TenantContextFilter` — never from a request parameter.
- **Cap `size`.** Reject `size > 200` with a 400 rather than letting a machine key pull the
  whole org in one request.

**Key provisioning:** mint a key through the existing `PartnerKeyAdminController` with a
single scope, `loans:read`, labelled for the dashboard. No write scopes in Phase 3.

**Tests:** `PartnerBoardIT` covering — 401 with no key; 403 with a key lacking
`loans:read`; 200 returning rows; `dateField=PRE_APPROVAL` narrowing correctly;
`applicationDateEmpty=true` excluding rows that have an application date;
`size=500` → 400; and a foreign-tenant key seeing an empty page (tenant isolation).

## 8. Phase 3 — dashboard read plumbing

### 8.1 Migration `090_suite_source.sql`

Idempotent DDL only, following the `INFORMATION_SCHEMA` + `PREPARE` pattern used by the
existing migrations. **No `DELETE`, `UPDATE`, `TRUNCATE`, or data `INSERT`** —
`runMigrations()` re-executes every file on every boot, so a data statement would re-run on
every restart. (This is the bug that wiped the Monday pipeline mappings from migrations
035/038.)

Add to `pre_approvals`:

| Column | Type | Purpose |
|---|---|---|
| `suite_loan_id` | `CHAR(36) NULL`, unique index | The Suite loan UUID. Sync upsert key. |
| `application_date` | `DATE NULL` | Mirrors Suite `applicationReceivedDate`; drives the pre-approval-vs-pipeline rule. |
| `suite_missing_since` | `TIMESTAMP NULL` | Set when a previously-synced Suite row stops appearing (see §8.4 step 5). Soft-delete marker. |

**No new source column.** `pre_approvals.source_system` already exists —
`VARCHAR(50) DEFAULT 'manual'`, added by
`backend/db/migrations/010_monday_boards.sql:50` — and is already used as exactly this
discriminator: the Monday sync writes `'monday'`
(`backend/services/monday/sync.js:91`), the Zapier webhooks write `'Zapier'`
(`backend/routes/webhooks/pipeline.js:96`). Suite rows use `source_system = 'suite'`.

A useful consequence: the Monday sync's existing prefetch
(`WHERE source_system = 'monday' AND monday_item_id IS NOT NULL`, `sync.js:60` and `:543`)
already excludes Suite rows, so a Monday sync run cannot touch or orphan them. No change
needed there.

New table for the per-LO flag:

| `suite_lo_flags` | |
|---|---|
| `lo_user_id INT PRIMARY KEY` | FK `users(id) ON DELETE CASCADE` |
| `enabled TINYINT(1) NOT NULL DEFAULT 0` | |
| `enabled_at TIMESTAMP NULL` | |

Tracy's flag is turned on by a one-off statement in `backend/db/manual/` — **not** in
`migrations/`, per the established convention.

### 8.2 `backend/services/suite/client.js`

- Base URL from `process.env.SUITE_API_BASE_URL` (e.g. `https://los.msfgco.com`),
  key from `process.env.SUITE_PARTNER_API_KEY`. Follows the
  `process.env.RAG_BRAIN_BASE_URL` / `RAG_BRAIN_*_TOKEN` precedent in
  `backend/services/askAi/askAi.service.js:32`.
- The key is a **server-side org credential**, not a per-user one. It does **not** go in
  `user_integrations` / `routes/integrations.js` — that store is per-user and returns masked
  values to the browser. Add `SUITE_API_BASE_URL` and `SUITE_PARTNER_API_KEY` to
  `backend/.env.example` with empty values.
- Explicit timeout (10s), no retries on 4xx, one retry on a network error or 5xx.
- Throws an error carrying `.status`, so the existing `next(err)` chain and the
  service-error convention in `backend/utils/response.js` handle it.

### 8.3 `backend/services/suite/mapper.js`

Pure. `mapBoardRowToPreApproval(row)` → a plain object of `pre_approvals` columns.

| `pre_approvals` column | Source on `BoardRowResponse` |
|---|---|
| `suite_loan_id` | `id` |
| `pre_approval_date` | `trackedDates['pre_approval']` |
| `application_date` | `applicationDate` |
| `borrower_first_name`, `borrower_last_name` | split from `client` |
| `assigned_lo_name` | `loanOfficerName` |
| `assigned_lo_id` | resolved by `sync.js`, not the mapper — it needs a DB lookup |
| `loan_amount` | `loanAmount` |
| `purchase_price` | `purchasePrice` |
| `loan_type` | `mortgageType` |
| `stage` | `status` (mapped through a Suite `LoanStatus` → dashboard-label table) |
| `current_address`, `city`, `state` | `propertyAddress`, `propertyCity`, `propertyState` |
| `investor_loan_number` | `loanNumber` |
| `lp_loan_number` | `cellValues['lp_loan_number']` |
| `next_steps`, `special_request`, `partners` | `cellValues[…]` where a board cell exists |
| `last_synced_at` | set by `sync.js` |
| `source_system` | literal `'suite'` |
| `monday_item_id`, `source_board_id`, `group_name` | **left NULL** for Suite rows |

Columns with no Suite equivalent (`expiration_date`, `citizenship`, `dti`, `ltv`,
`credit_report_date`, `coborrower_*`, `borrower_email/phone`, `zip`) stay NULL in Phase 3.
Several are reachable later via `GET /api/loans/{id}` but are not worth an N+1 per row now.
The Suite section of the Integrations tab must show which columns are unmapped so this is
visible rather than looking like missing data.

**Unmapped-column honesty:** the mapper exports the list of `pre_approvals` columns it does
*not* populate. The admin UI renders that list. No silent blanks.

### 8.4 `backend/services/suite/sync.js`

`syncSuitePreApprovals()`:

1. Read enabled LOs from `suite_lo_flags`, join `users` for names.
2. For each, call
   `client.getBoardRows({ lo: [name], dateField: 'PRE_APPROVAL', dateFrom: '2020-01-01', dateTo: <today + 1 year>, applicationDateEmpty: true, size: 200 })`,
   paging until exhausted.
   The window is deliberately wide rather than rolling: a pre-approval is interesting for as
   long as it has not converted, so a rolling window would silently drop aged ones. `dateTo`
   runs a year forward because a `PRE_APPROVAL` tracked date can legitimately be
   post-dated. Both bounds are constants in `sync.js`, not configuration.
3. Build a `loanOfficerName` → `users.id` map once (mirrors the `userNameMap` argument
   `upsertPreApprovalRow` already takes at `backend/services/monday/sync.js:100`).
4. Upsert each row by `suite_loan_id`; set `source_system='suite'`, `last_synced_at=NOW()`,
   and clear `suite_missing_since` (a row that reappears is no longer missing).
5. **Reconcile disappearances.** Any `pre_approvals` row with `source_system='suite'` and an
   `assigned_lo_id` in the enabled set that was not seen in this run has either gained an
   application date (→ it is now a pipeline row) or left Suite. Set `suite_missing_since=NOW()`
   if it is currently NULL and exclude it from the default page view. **Never hard-delete** —
   that cascades `loan_checklists` and its items, subitems, and call notes away.
6. Return a summary: `{ loRows: {name: count}, created, updated, missing, unresolvedLos, unmappedColumns, errors[] }`.

Manual-trigger only in Phase 3, matching how Monday sync works today. No scheduler — adding
one is a separate decision, and doing it here would make a first-run bug recur every
interval unattended.

### 8.5 `backend/routes/suite.js`

Admin-only. Mounted in `backend/server.js` alongside the Monday routes.

- `GET  /api/suite/status` — is the key configured, last sync, last result.
- `POST /api/suite/test` — one `size=1` call; returns reachable/unreachable plus the row count.
- `POST /api/suite/sync` — run `syncSuitePreApprovals()`, return the summary.
- `GET  /api/suite/lo-flags` · `PUT /api/suite/lo-flags/:loUserId` — read/toggle the per-LO flag.

Validation schemas go in `backend/validation/schemas/suite.js` and are consumed by
`backend/validation/schemas.js` via **spread re-export only**:

```js
const suiteSchemas = require('./schemas/suite');
module.exports = { ..., ...suiteSchemas, ... };
```

Never re-destructure individual schema names in the gateway file. That is the failure mode
that crashed prod once — a schema exported by name but never destructured throws a
`ReferenceError` at boot, PM2 errors, nginx returns 502.

### 8.6 `backend/routes/preApprovals.js` — scoping

The existing role branches all key off `source_board_id` (via `monday_board_access`) or
`assigned_lo_id`. Suite rows have no board id, so each branch gains a Suite clause:

- **Admin** — unchanged, sees everything.
- **LO** — already matches on `assigned_lo_id` and on `assigned_lo_name`; Suite rows are
  covered as soon as `assigned_lo_id` resolves. Add a name fallback for the unresolved case.
- **Manager** — already uses `getManagerLOIds`, which is LO-id based, so Suite rows are
  covered. The `source_board_id IN (...)` clause is `OR`-ed, so it does not exclude them.
- **Processor** — **this one is board-only today and will see zero Suite rows.** Add
  `OR (pa.source_system = 'suite' AND pa.assigned_lo_id IN (<getProcessorLOIds>))`.
  `getProcessorLOIds` already exists in `backend/utils/boardAccess.js:18`.

The `LEFT JOIN monday_boards` stays — it yields NULL `source_board_name` for Suite rows,
which is correct. The frontend's board filter dropdown gains a "Suite" pseudo-entry so
Tracy's rows are filterable.

### 8.7 Frontend

`js/pre-approvals.js` needs no logic change. Two cosmetic additions:

- A small source badge on rows where `source_system === 'suite'`, reusing the existing
  file-local-checklist badge styling.
- For Suite rows, the edit/delete controls are replaced by an **Open in Suite ↗** link
  (`https://suite.msfgco.com/loans/<suite_loan_id>`) until Phase 4 lands. Editing a Suite
  row through the Monday writer would write to the wrong system.

New Suite section in the Integrations tab: connection status, Test button, Run Sync Now,
last-sync summary, per-LO enable toggles, and the unmapped-column list.

## 9. Phase 4 — write-back (deferred, not designed in detail)

Recorded so the phase-3 read-only decision is understood as temporary, not final.

Two Suite-side gaps must close first:

1. **Addressing.** `POST /api/partner/v1/loans/{externalId}/…` resolves through
   `partner_loan_link`. A Suite-native loan has no such row, so it is unaddressable by a
   partner key. Either add `PATCH /api/partner/v1/loans/by-id/{loanId}` guarded by
   `loans:write`, or let the dashboard adopt Suite loans into `partner_loan_link` on first
   sync (`sourceSystem='dashboard'`, `externalId=<suite uuid>`). The adoption route needs no
   new endpoint but does need a Suite-side link-creation path, since the partner upsert
   creates a *new* loan rather than linking an existing one.
2. **Tracked dates.** No partner endpoint writes a `TrackedDateKey`. Editing the
   pre-approval date — the field this whole feature is about — needs one.

Also unresolved for Phase 4: `assigneeUserId` is ignored on partner update by design, so
reassigning an LO from the dashboard will not be possible without a staff-level path.

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| `SUITE_PARTNER_API_KEY` unset | Sync is a no-op with a clear log line; Integrations tab shows "not configured". Never a 500. |
| Suite unreachable / 5xx | Sync aborts, records the error in the summary, leaves mirrored rows untouched. Pre-Approvals still renders from the last good sync. |
| Key lacks `loans:read` | Suite returns 403 `MISSING_SCOPE`; surfaced verbatim in the admin UI. |
| `loanOfficerName` matches no dashboard user | Row still upserts with `assigned_lo_id = NULL` and `assigned_lo_name` set; counted in the summary as unresolved so it is visible. Admins still see it; the LO sees it via the name fallback. |
| A Suite row gains an application date | Disappears from the pre-approval set on the next sync; marked `suite_missing_since` rather than deleted, so its checklists survive. |
| Suite `LoanStatus` value with no dashboard label | Store the raw enum name and log it once per sync. Do not drop the row. |
| Two syncs overlap | Guard with an in-process flag; the second returns "already running". |

## 11. Testing

- **`services/suite/mapper.js`** — unit tests against a captured `BoardRowResponse` fixture:
  every mapped column, a row with no `pre_approval` tracked date, a row with a non-null
  `applicationDate`, an unknown `LoanStatus`, a single-word `client`, and null-heavy rows.
  Pure function, no network, no DB.
- **`services/suite/sync.js`** — tests with `client.js` stubbed: create, update,
  LO-name resolution, unresolved LO, the missing-row reconcile path, and the overlap guard.
- **`routes/preApprovals.js`** — a test per role (admin / LO / manager / processor) asserting
  Suite rows are visible to exactly the right people, with the processor case explicitly
  covered since that branch is the one being fixed.
- **`validation/schemas`** — extend `backend/tests/validation/schemas.test.js` with the new
  Suite schemas, and assert the gateway still exports every name (guards the spread-re-export rule).
- **Suite side** — `PartnerBoardIT` as listed in §7.
- **Manual** — with Tracy's flag on, diff the dashboard Pre-Approvals list against the same
  filter in the Suite console. Row counts and dates must match exactly.

## 12. Deploy sequence

1. Phase 1 rename → `./deploy.sh` (frontend only, no backend risk).
2. Suite PR merged and the suite box deployed; mint the `loans:read` key; confirm
   `GET /v3/api-docs` lists `partnerGetBoardRows`.
3. Put `SUITE_API_BASE_URL` and `SUITE_PARTNER_API_KEY` in the EC2 backend `.env`
   **before** deploying the dashboard backend, so the first boot after migration 090 has them.
4. Dashboard `./deploy.sh --backend`. **Before running it**, check the EC2 box's git state —
   per project memory it can sit on a non-`main` branch or carry local hotfix commits, and
   `git pull origin main` fails with "divergent branches". Do not `git reset --hard` it
   without backing up whatever is unique to it.
5. Apply the Tracy flag via `backend/db/manual/`.
6. Run the sync from the Integrations tab, diff against the Suite console.

## 13. Open items

- Whether the Pipeline section should also start honouring Suite as a source once
  `application_date` is set. Out of scope here, but reusing `source_system` means that
  becomes the same pattern rather than a new one — `pipeline` already has the column too
  (`backend/db/migrations/002_goals_funded_permissions.sql:180`).
- Whether the Suite sync eventually gets a scheduler. Deferred on purpose: manual-only
  matches Monday's current behaviour and keeps a first-run bug from recurring unattended.
