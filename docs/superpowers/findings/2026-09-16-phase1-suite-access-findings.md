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
- **Result:** ACTION — cross-check that one group-less user against active dashboard staff (needs dashboard DB, Task 5); if staff, add to the right group (owner-gated) before phase 4 rollout.

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
- Carried forward: §2 group-less user check; §3–4 (loan-number coverage, notes import path) need DB access.
