# Suite Pipeline Displays — Design

**Date:** 2026-09-16
**Status:** Draft — awaiting user review
**Repos:** dashboard.msfgco.com, msfg-suite (API), msfg-suite-web
**Supersedes:** `2026-07-25-suite-integrations-preapprovals-design.md` (mirror-sync approach for pre-approvals)

## 1. Goal

Replace the four Monday.com-backed dashboard sections (Pre-Approvals, Applications, Loan Pipeline, Loans Funded) with up to four live views of the msfg-suite Pipeline page. Each view offers the suite's filters (status, loan type, loan officers, lenders, more filters) and views (Board, Kanban, Calendar, To Do, Reports), and lets users open a loan and change its status from dashboard.msfgco.com. All changes are built and tested locally and on staging before production.

## 2. Decisions

| # | Decision |
|---|----------|
| D1 | One pipeline component, four configurable **display slots** (A–D) — each is the same suite pipeline with different default filters. |
| D2 | Slot configuration (name, default filters, visibility) lives in **User Settings**, not on the main dashboard. At least one slot must stay visible. |
| D3 | Delivery: **embeddable bundle built from msfg-suite-web**, mounted by the dashboard. No iframe, no vanilla-JS rebuild. |
| D4 | Suite enforces loan visibility and status permissions. Dashboard adds no loan-level authorization. |
| D5 | Monday.com is fully disconnected from the dashboard at go-live. |
| D6 | Suite notes are the system of record going forward. Existing dashboard notes (and checklists) are migrated into suite loans. |
| D7 | Old tables are kept as a read-only, admin-only archive with no UI. |

### Default slots (new users / no saved settings)

| Slot | Name | Default filter |
|------|------|----------------|
| A | Pre-Approvals | `PRE_APPROVAL` tracked date set, `applicationDateEmpty=true` |
| B | Applications | application date set, status not in funded/closed-out statuses |
| C | Loan Pipeline | in-process statuses (application submitted through clear-to-close) |
| D | Loans Funded | status `FUNDED` or `dateField=FUNDING` set |

Exact status lists for B/C are fixed in the phase 3 plan against `loanStatus.ts` (29 statuses).

## 3. Architecture

### 3.1 msfg-suite-web — embed build

- Second Vite build entry producing `pipeline-embed.<version>.js` + `.css`, published under a versioned path on suite.msfgco.com. Dashboard pins a version.
- Global API:
  - `MsfgSuite.mountPipeline(el, { title, defaultFilters, getToken, apiBaseUrl })` → returns `{ unmount, setFilters }`.
  - `MsfgSuite.mountFilterEditor(el, { value, getToken, apiBaseUrl, onChange })` → reuses `BoardToolbar` filter UI; emits a serializable filter object.
- **Embedded mode:** no app shell/nav; row/card click opens a loan side drawer (summary + `StatusEditor` using existing transitions endpoints) instead of navigating to `/loans/:id`; drawer offers "Open in Suite" link.
- CSS scoped (root class prefix / shadow-safe reset) so neither app's styles bleed.
- Filter object shape = the query params already built in `features/board/api.ts:64-95`, so saved settings map 1:1 to `GET /api/board`.

### 3.2 msfg-suite API

- Add `https://dashboard.msfgco.com`, `https://staging-dashboard.msfgco.com`, and local dev origins to `LOS_CORS_ALLOWED_ORIGINS`.
- Verify dashboard Cognito id_tokens (client `2t9edrhu5crf8vq3ivigv6jopf`, same pool) carry `org_id` and pass `OrgScopedJwtAuthenticationConverter`. If `org_id` is missing, fix in the pre-token Lambda, not with a workaround.
- No new data endpoints expected. Uses: `/api/board`, `/api/board/columns|loan-officers|lenders|groups|summary|layout|reports`, `/api/loans/{id}`, `/api/loans/{id}/status/transitions`, `POST /api/loans/{id}/status`.
- Gaps to fill only if found during phase 1 (candidate: Kanban drag → status transition; notes/tasks write endpoints for migration).

### 3.3 dashboard

- **Main page (`index.html`):** remove `#preApprovalsSection`, `#applicationsSection`, `#pipelineSection`, `#fundedLoansSection` and their scripts (`pre-approvals.js`, `applications.js`, `pipeline.js`, `funded-loans.js`). Add a `pipeline-displays.js` module that loads slot settings and mounts one container per visible slot.
- **User Settings:** new "Pipeline Displays" panel — for each slot A–D: name input, Visible toggle (last visible slot's toggle disabled), and `mountFilterEditor`.
- **Backend:** `GET/PUT /api/user/pipeline-displays` (authenticated, non-external, own user only). Table `user_pipeline_displays (user_id, slot CHAR(1), name, visible, filters JSON, updated_at, PK(user_id, slot))`. PUT validates: slots ∈ A–D, name 1–40 chars, ≥1 visible, filters is an object.
- **Config (`js/config.js`):** `suiteApiBaseUrl` and `suiteEmbedUrl` resolved by hostname (localhost → local, staging-dashboard → staging, else prod). Replaces the hard-coded API URL approach for these values.

### 3.4 Data flow

1. Dashboard loads → `GET /api/user/pipeline-displays` (fallback to defaults).
2. Loads pinned embed script; calls `mountPipeline` per visible slot with `getToken` returning the dashboard's current Cognito token.
3. Embed calls suite API directly with `Authorization: Bearer`.
4. Status changes go directly to suite. Dashboard backend never handles loan data.

## 4. Auth & Permissions

- `getToken()` is called per request. On 401 the embed re-calls it once and retries; second failure shows "Session expired — sign in again" linking to dashboard login.
- Loan visibility and status-change rights come solely from suite (`accessGuard.assertCanModify`, org scoping, Cognito groups).
- External users remain blocked from the slot containers (`requireNonExternal` equivalent on the frontend + settings endpoint).
- Archive tables: no API route; DB access for admins only.

## 5. Error Handling

| Failure | Behavior |
|---------|----------|
| Suite API unreachable/5xx | Affected slot shows error + Retry; rest of dashboard unaffected |
| Embed script fails to load | All slots show "Pipeline unavailable"; no fallback to Monday data |
| Status transition rejected | Error in drawer; card/row not moved |
| Settings GET fails | Use default slots, show small warning |
| Saved filter references missing value (e.g. removed lender) | Ignored at mount; flagged in Settings |

## 6. Sandbox & Environments

- **Local:** suite API on `localhost:8080` (`run-suite-local.sh` / docker-compose), suite-web embed build in watch mode, dashboard frontend served locally, dashboard backend with local `.env` against a PII-scrubbed DB copy.
- **Staging:**
  - `staging-dashboard.msfgco.com` — own S3 bucket + CloudFront, same Cognito pool (callback URL added).
  - Suite API staging container on the suite EC2 (port 8083) with its own DB (copy of prod).
  - suite-web `deploy/config.staging.json` filled in.
  - Staging never writes to production suite data.

## 7. Migration & Monday Cutover

- **Matching** (dashboard row → suite loan), in order: (1) loan number; (2) borrower last name + property address. Unmatched rows → CSV report for manual review; never guessed.
- **Notes** (`pre_approval_notes`, `pipeline_notes`, `funded_loan_notes`) → suite loan notes, preserving author and timestamp, tagged "Imported from dashboard".
- **Checklists** (`loan_checklists`) → suite loan tasks if an equivalent exists; otherwise a single imported note per checklist.
- Script is idempotent (tracks migrated source IDs), has `--dry-run`, and is run on staging first; user reviews counts + unmatched report before prod.
- **Archive:** rename `pre_approvals`, `pre_approval_notes`, `pipeline`, `pipeline_notes`, `funded_loans`, `funded_loan_notes`, `monday_boards`, `monday_board_access`, `loan_checklists` → `archive_*`; revoke write grants from the app DB user.
- **Disconnect:** disable Monday sync scheduler and `/api/monday` routes in the dashboard backend.

## 8. Rollout

1. Deploy suite API changes (CORS etc.) — inert on their own.
2. Deploy suite embed bundle — unused until referenced.
3. Deploy dashboard to staging; click-through with LO and admin accounts.
4. Cutover: run migration → disable Monday sync → archive tables → deploy dashboard frontend + backend to prod.
5. **Rollback:** redeploy previous dashboard build and rename tables back. Monday stays connected (idle) ~2 weeks after go-live so rollback is possible, then removed.

## 9. Phases (each gets its own implementation plan)

1. **Suite API access** — token/`org_id` verification, CORS, confirm notes/tasks APIs and loan-number coverage.
2. **Sandbox** — local stack, environment-aware `config.js`, staging dashboard + suite staging.
3. **Settings** — `user_pipeline_displays` table, endpoint, User Settings panel.
4. **Embed bundle** — suite-web embed entry, embedded mode, loan drawer, filter editor; dashboard mount module.
5. **Cutover** — migration script, Monday disconnect, archive, deploy.

## 10. Testing

- suite-web: Vitest tests for embed mount/unmount, filter serialization, embedded-mode drawer, 401 retry.
- dashboard backend: tests for `/api/user/pipeline-displays` (validation, ≥1 visible, own-user isolation).
- Migration: dry-run against staging with expected counts.
- Manual sandbox click-through (local → staging) with an LO and an admin account before prod.

## 11. Open Questions (resolve in Phase 1)

- Does suite expose note-create and task/checklist endpoints suitable for migration?
- Is loan number reliably populated on both dashboard rows and suite loans?
- Exact status sets for default slots B and C.
