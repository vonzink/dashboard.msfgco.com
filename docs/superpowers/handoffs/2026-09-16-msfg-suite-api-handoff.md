# Handoff to msfg-suite: API + Embed Work for Dashboard Pipeline Displays

**From:** dashboard.msfgco.com · **Date:** 2026-09-16
**Full spec:** `dashboard.msfgco.com/docs/superpowers/specs/2026-09-16-suite-pipeline-displays-design.md`
**Phase 1 plan:** `dashboard.msfgco.com/docs/superpowers/plans/2026-09-16-phase1-suite-api-access.md`

Paste this whole file into a Claude session opened in `/Users/zacharyzink/MSFG/msfg-suite` (items S1–S5) or `/Users/zacharyzink/MSFG/msfg-suite-web` (items W1–W4). Use the brainstorming → writing-plans flow per item; do not deploy to prod without the owner's explicit yes.

## Context

dashboard.msfgco.com is replacing its four Monday.com-backed sections (Pre-Approvals, Applications, Loan Pipeline, Loans Funded) with up to four user-configurable **display slots**, each a live copy of the suite Pipeline page (filters + Board / Kanban / Calendar / To Do / Reports + open loan + change status). The dashboard will load a versioned **embed bundle built from msfg-suite-web** and call the suite API directly with the user's Cognito **id token** (same pool `us-west-1_S6iE2uego`, dashboard client `2t9edrhu5crf8vq3ivigv6jopf`). The suite stays the authority on loan visibility and status permissions. Monday is disconnected at go-live; existing dashboard notes/checklists migrate into suite loans.

## Guardrails

- CORS: exact origins only, never wildcards, `allowCredentials=false`.
- Do not weaken `OrgScopedJwtAuthenticationConverter` (fail-closed on missing `org_id`).
- No new per-dashboard authorization rules in the suite — dashboard users get exactly their suite permissions.
- Work on branches/worktrees off `main`; the msfg-suite checkout currently has another feature branch with uncommitted files.

---

## msfg-suite (API)

### S1 — CORS allowlist (Phase 1, required first)
Add `https://dashboard.msfgco.com`, `https://staging-dashboard.msfgco.com` to prod and `http://localhost:5190` to local. Move the prod list to a shared key `los.cors.prod-allowed-origins` in `application.yml`; `application-prod.yml` uses `${LOS_CORS_ALLOWED_ORIGINS:${los.cors.prod-allowed-origins}}`. Add `CorsDashboardOriginsIT` in `CorsIT.java` (dashboard origins → 200 + exact ACAO; lookalike `dashboard.msfgco.com.evil.example` → 403). Before deploy, check `deploy/.env` on the suite host (52.2.71.106) for a `LOS_CORS_ALLOWED_ORIGINS` override — prod origins are effectively controlled by `deploy/.env` (dashboard findings §5); the yml list is only the fallback. Exact steps: phase 1 plan, Task 4 + Task 6.

- **Follow-up:** either remove the `deploy/.env` override so `application-prod.yml` governs, or document (in the yml comment and a deploy env example) that prod's value actually lives in `deploy/.env` — the current split is a drift risk.

### S2 — Staff Cognito groups (Phase 1, audit) — **Status: done**
The pre-token Lambda defaults group-less users to `Borrower`. Any dashboard staff user without a staff group (per `CognitoRolesConverter`) gets no staff role in the suite and 403s on staff endpoints. Audit group membership vs. active dashboard staff; report counts; add missing users to the right groups only with owner approval. See dashboard findings §2–3: 26 users audited, 19 in a staff group; the 1 group-less user is not an active dashboard user; every active dashboard staff user with a `cognito_sub` already has a suite staff group. No group changes needed.

### S3 — Admin note import endpoint — **Dropped**
Not needed. Owner decision 2026-09-16: dashboard notes (9, plus 45 inline) migrate through the existing `POST /api/loans/{loanId}/notes` with a `[Imported from dashboard — <author>, <date>]` content prefix. The migration script (dashboard phase 5) handles idempotency on its side.

### S4 — Checklist target (Phase 5 migration)
Target suite loan checklists, not `/api/todo/tasks`: `GET/POST /api/loans/{loanId}/checklists` and `POST /api/loans/{loanId}/checklists/import` (see dashboard findings §4 — loan checklists are a closer fit than todo tasks). Determine whether `POST /import` preserves item completion state (`loan_checklist_items.completed`/dates), or whether an ADMIN import variant is needed to carry that state with `sourceRef` idempotency. Orphaned checklists — dashboard rows whose source `pipeline`/`pre_approval` row no longer exists — have no migration target; they are archive-only, not imported.

### S5 — Loan lookup for migration matching (Phase 5)
Migration matches dashboard rows to suite loans by (1) suite `internal_loan_number`, then `investor_loan_number` — dashboard `loan_number`/`lp_loan_number`/`investor_loan_number` values are checked against both, in that order; suite `loan_number` is its own 10-digit number and never matches (see dashboard findings §3) — then (2) borrower last name + property address. Confirm `GET /api/loans/search` supports lookup by `internal_loan_number`/`investor_loan_number` and last-name + address; if not, add an ADMIN `POST /api/admin/import/loan-match` taking a batch of `{ sourceRef, dashboardLoanNumber, lastName, address }` and returning `{ sourceRef, loanId | null, matchedBy }`. Never fuzzy-guess; ambiguous → null.

### S6 — Staging API (Phase 2)
Stand up a staging container on the suite EC2 (port 8083) with its own Postgres DB (copy of prod). Staging needs its own `LOS_CORS_ALLOWED_ORIGINS` in its own env file — separate from prod's `deploy/.env` (see S1 follow-up and dashboard findings §5 on override drift) — including `https://staging-dashboard.msfgco.com` and `http://localhost:5190`. Staging must never write to prod data. Document in `docs/`.

---

## msfg-suite-web (Embed bundle — Phase 4)

### W1 — Embed build entry
Second Vite entry producing `pipeline-embed.<version>.js` + `.css`, published to a versioned path on suite.msfgco.com (immutable once published). Exposes:

```ts
window.MsfgSuite.mountPipeline(el, {
  title: string,
  defaultFilters: BoardFilters,          // same shape as the query built in features/board/api.ts:64-95
  getToken: () => Promise<string>,       // called per request
  apiBaseUrl: string,
}) => { unmount(): void; setFilters(f: BoardFilters): void }

window.MsfgSuite.mountFilterEditor(el, {
  value: BoardFilters, getToken, apiBaseUrl,
  onChange: (f: BoardFilters) => void,
}) => { unmount(): void }
```

Filter object must be JSON-serializable (dashboard stores it per user).

### W2 — Embedded mode
No app shell/nav/router navigation. Row/card click opens a loan side drawer (summary + existing `StatusEditor` / transitions endpoints) with an "Open in Suite" link. All five views (Board, Kanban, Calendar, To Do, Reports) and `BoardToolbar` filters work. CSS scoped under a root class so it neither leaks into nor inherits from the host page. Multiple instances on one page must not share state (separate QueryClient or keyed caches per mount).

### W3 — Auth + errors inside the embed
Use `getToken()` for every request (not the suite's own Cognito session). On 401: call `getToken()` again, retry once; second failure → "Session expired — sign in again" state. API unreachable → per-instance error + Retry. Status transition rejected → error in drawer, no optimistic move. Unknown saved filter values (e.g. removed lender) are ignored and reported via an `onWarning` callback.

### W4 — Kanban drag → status (optional, confirm with owner)
Today Kanban drag only sets a board cell (`KanbanView.tsx:36-40`). If grouping by status, drag should call `POST /api/loans/{id}/status`. Confirm desired behavior with the owner before building.

**Tests (Vitest):** mount/unmount, two instances isolated, filter serialization round-trip, drawer status change success + rejection, 401 retry-once, filter editor `onChange`.

---

## Order

1. S1, S2 (phase 1) → unblock everything.
2. S6 (phase 2 sandbox).
3. W1–W3 (phase 4), W4 if approved.
4. S4–S5 (phase 5, before cutover).

Report back to the dashboard session: PR links, the published embed version URL, staging API URL, and S2/S4/S5 findings.
