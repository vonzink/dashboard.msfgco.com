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

- Pending: requires read-only AWS CLI access to pool `us-west-1_S6iE2uego` and an active-staff count from the dashboard DB.
