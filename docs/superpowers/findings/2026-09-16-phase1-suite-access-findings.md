# Phase 1 Findings — Suite API Access (2026-09-16)

## 1. Token check

- **Admin token** (dashboard login, client `2t9edrhu5crf8vq3ivigv6jopf`): token_use=id, org_id=present (valid UUID), groups=`Manager, LO, Admin, Processor, External`. Suite's CognitoRolesConverter drops `External` (unmapped) and grants ADMIN/MANAGER/LO/PROCESSOR.
- Against prod `https://los.msfgco.com` (before CORS deploy):

| Request | Origin header | Status |
|---------|---------------|--------|
| GET /api/me | none | 200 |
| GET /api/board?size=1 | none | 200 (288 loans visible) |
| GET /api/me | https://suite.msfgco.com | 200 |
| OPTIONS /api/board | https://dashboard.msfgco.com | 403, no ACAO |
| GET /api/me | https://dashboard.msfgco.com | 403, no ACAO |

- **Conclusion:** the suite accepts dashboard-issued id tokens (same pool, different app client; `org_id` present). The only blocker is CORS: Spring rejects any request carrying a non-allowlisted `Origin`, including simple GETs. Task 4 (msfg-suite PR #113) fixes this.
- LO token: not yet tested — admin token covers auth mechanics; an LO-only token matters for per-role visibility and is checked in the phase 4 staging click-through.
- Probe note: `probe.mjs` sends the dashboard `Origin` on every call, so before the CORS deploy `/api/me` reads 403 even with a good token. Expected; after deploy it's the right end-to-end check.
- **Result:** PASS (auth). ACTION: deploy CORS (Task 6).

## 2. Staff Cognito groups

Pool `us-west-1_S6iE2uego`, read-only audit (counts only):

| Group | Members |
|-------|---------|
| LO | 13 |
| Admin | 3 |
| Processor | 3 |
| Manager | 3 |
| CLOSER | 0 |
| UNDERWRITER | 0 |
| Borrower | 6 |
| External | 1 |
| RealEstateAgent | 0 |

- 26 users total; 19 in at least one staff group; 7 without: 6 are Borrower/External, **1 user has no group at all** (the suite would treat them as BORROWER).
- **Result:** PASS — cross-checked in §3: the group-less user is not an active dashboard user.

## 3. Loan-number coverage (read-only, 2026-09-16)

Dashboard (MySQL via 52.203.186.217, `START TRANSACTION READ ONLY`, rolled back):

| Table | Rows | `loan_number` set | `lp_loan_number` set | Either set |
|-------|------|-------------------|----------------------|------------|
| pre_approvals | 108 | 107 | 56 | 108 |
| pipeline | 32 | 32 | 32 | 32 |
| funded_loans | 2,731 | 0 | 2,669 | 2,669 |

Suite (Postgres `loan` table via 52.2.71.106, `default_transaction_read_only=on`): 310 loans; `loan_number` 310 (all 10-digit suite numbers), `internal_loan_number` 274 (LendingPad style `A999999`), `investor_loan_number` 238.

- **Match key is suite `internal_loan_number`, not `loan_number`.** Exact `loan_number` matches: 0. Dashboard numbers matched against suite `internal_loan_number` (114 hits) or `investor_loan_number` (59 hits).
- Rows matched to a suite loan: pipeline 32/32, pre_approvals 26/108, funded_loans 47/2,731 (most funded/pre-approval rows predate or never entered the suite; they stay in the archive).
- Active dashboard users: 20 (admin 3, manager 2, LO 12, processor 3). Every active dashboard user that has a `cognito_sub` is in a suite staff group. The one group-less Cognito user is **not** an active dashboard user → no action. 2 active dashboard users have no `cognito_sub` (not linked to Cognito); they can't use the embed until linked.
- **Result:** PASS with change — migration matching order becomes (1) dashboard `loan_number`/`lp_loan_number`/`investor_loan_number` → suite `internal_loan_number`, then `investor_loan_number`; (2) last name + address; (3) unmatched report.

## 4. Notes & checklist import path

Volume is tiny:

| Source | Count | On rows with a number |
|--------|-------|-----------------------|
| pre_approval_notes | 8 (1 author) | 8 |
| pipeline_notes | 1 | 1 |
| funded_loan_notes | 0 | — |
| inline `notes` column | pipeline 1, funded_loans 44 | — |
| loan_checklists | 21 (18 pipeline, 3 pre_approval) | — |
| loan_checklist_items / subitems / item notes | 598 / 4 / 4 | — |

- Rows carrying notes or checklists: 11 (14 attached records); **6 match a suite loan today**, 5 don't.
- **15 of 18 pipeline checklists are orphaned** (their `pipeline` row no longer exists) — they migrate nowhere; archive only.
- Suite targets:
  - Notes: `POST /api/loans/{loanId}/notes` takes only `content`, `columnKey` → no author/timestamp. Given 9 notes from 1 author, an admin import endpoint (handoff S3) is optional: prefixing content with `[Imported from dashboard — <author>, <date>]` is enough. **Ruling for phase 5 plan:** use the existing endpoint with a prefix unless the user wants true authorship.
  - Checklists: suite has loan checklists (`/api/loans/{loanId}/checklists`, incl. `POST /import`) — a closer fit than `/api/todo/tasks` (which also accepts `loanId`). Phase 5 targets loan checklists.
  - Inline `notes` column (45 rows, mostly funded) → import as one note per matched loan; unmatched stay archived.

## 5. Phase 1 exit (CORS)

- PR #113 merged and deployed via `deploy-suite.sh` (container recreated 2026-09-16 19:59Z) — **not sufficient on its own**.
- **Host override:** the suite host (52.2.71.106) sets `LOS_CORS_ALLOWED_ORIGINS` in `/home/ubuntu/apps/msfg-suite/deploy/.env` (loaded via docker-compose), which overrides `application-prod.yml`. Any future origin change must be made there too (or the override removed so the yml is the source of truth).
- Appended `https://dashboard.msfgco.com,https://staging-dashboard.msfgco.com` to that line (backup: `deploy/.env.bak-dashboard-cors`), recreated the app container, health UP in ~42s.
- Probe after fix (admin token):

| Origin | OPTIONS /api/board | GET /api/me | GET /api/board?size=1 |
|--------|--------------------|-------------|------------------------|
| https://dashboard.msfgco.com | 200, exact ACAO | 200 | 200 |
| https://staging-dashboard.msfgco.com | 200, exact ACAO | 200 | 200 |
| https://suite.msfgco.com (regression) | 200 | 200 | 200 |
| https://dashboard.msfgco.com.evil.example | 403 | — | — |

- Browser check from dashboard.msfgco.com: pending (user).
- Carried forward: link 2 active dashboard users without `cognito_sub` (§3) before phase 4 rollout; browser check.
