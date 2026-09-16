# Phase 1 — Suite API Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a dashboard.msfgco.com login can call the msfg-suite API from the browser, open the suite's CORS allowlist to the dashboard, and answer the spec's open questions (notes/tasks import, loan-number coverage, staff Cognito groups).

**Architecture:** Two repos. Dashboard repo gets a read-only diagnostic script (`scripts/suite-access/`) that decodes a dashboard id_token and probes the suite API, plus a findings doc. Suite repo (`/Users/zacharyzink/MSFG/msfg-suite`) gets CORS allowlist additions with integration tests. No loan data endpoints change.

**Tech Stack:** Node 20 (built-in `node:test`, global `fetch`, no new deps) · Java 21 / Spring Boot / Gradle (`./gradlew`) · MockMvc integration tests (`AbstractIntegrationTest`) · AWS CLI (read-only Cognito calls).

**Spec:** `docs/superpowers/specs/2026-09-16-suite-pipeline-displays-design.md` (§3.2, §4, §9 phase 1, §11)

## Global Constraints

- Suite CORS: exact origin allowlist, **never wildcards**, `allowCredentials=false` (existing `CorsIT` invariants must still pass).
- Suite auth is fail-closed on missing/invalid `org_id` (`OrgScopedJwtAuthenticationConverter`) — do not weaken it.
- Dashboard origins to allow: `https://dashboard.msfgco.com`, `https://staging-dashboard.msfgco.com` (prod profile); `http://localhost:5190` (local profile — dashboard frontend local port, reserved here for phase 2).
- Nothing in this phase writes to production data. Cognito and DB steps are **read-only**.
- Production deploys (suite API) are owner-gated: stop and ask the user before running `deploy-suite.sh`.
- Never print full tokens, emails, or borrower PII in committed files or logs; findings use counts and redacted examples.
- Suite work happens on a new branch from `main` in msfg-suite (that repo currently has another feature branch checked out with uncommitted files — use a worktree, don't disturb it).

## Known facts (from research, 2026-09-16)

- Dashboard stores `id_token || access_token` as `auth_token` (`login-callback.html:88`); sends `Authorization: Bearer` (`js/api-server.js:185`).
- Pool `us-west-1_S6iE2uego` pre-token Lambda (`msfg-suite/infra/cognito/pretoken-org-claim`) stamps `org_id` on **id tokens only**, and defaults **group-less users to `Borrower`**. A dashboard staff user with no Cognito group would reach the suite as a BORROWER → 403 on staff endpoints. Must audit.
- Suite prod allowlist: `application-prod.yml:34`, overridable by `LOS_CORS_ALLOWED_ORIGINS` env on the EC2 host (52.2.71.106). Local: `application-local.yml:16`.
- Suite notes: `POST /api/loans/{loanId}/notes` body `CreateNoteRequest(content, columnKey)` — **no author/timestamp override**, so migrating notes with original author/date needs a new import path (phase 5).
- Suite todo: `/api/todo/tasks` (+ subitems, notes) exists — candidate target for checklists.
- `Loan.loanNumber` exists in suite (`loan-core/.../domain/Loan.java:19`).

---

## File Structure

**Dashboard repo**
- Create `scripts/suite-access/jwt-inspect.mjs` — pure functions: decode JWT payload, evaluate suite readiness (org_id UUID, staff group, token_use, expiry). No I/O.
- Create `scripts/suite-access/jwt-inspect.test.mjs` — `node:test` unit tests.
- Create `scripts/suite-access/probe.mjs` — CLI: reads token from `SUITE_PROBE_TOKEN` env, prints readiness report, calls suite `GET /api/me` and `GET /api/board?size=1` with an `Origin` header, prints status + ACAO header.
- Create `scripts/suite-access/README.md` — how to grab a token from the browser and run it.
- Create `docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md` — answers to spec §11 + group audit + loan-number coverage.
- Modify `docs/superpowers/specs/2026-09-16-suite-pipeline-displays-design.md` §11 — link findings, record resolutions.

**Suite repo** (`/Users/zacharyzink/MSFG/msfg-suite`)
- Modify `app/src/main/resources/application-prod.yml:34` — add dashboard origins.
- Modify `app/src/main/resources/application-local.yml:16` — add `http://localhost:5190`.
- Modify `app/src/test/java/com/msfg/los/config/CorsIT.java` — add `CorsDashboardOriginsIT` class.

---

### Task 1: JWT readiness inspector (dashboard repo)

**Files:**
- Create: `scripts/suite-access/jwt-inspect.mjs`
- Test: `scripts/suite-access/jwt-inspect.test.mjs`

**Interfaces:**
- Produces:
  - `decodeJwtPayload(token: string): object` — throws `Error('not a JWT')` if not 3 dot-separated parts.
  - `assessSuiteReadiness(payload: object, nowSec: number): { ok: boolean, problems: string[], summary: { tokenUse, orgId, groups, clientId, expiresInSec } }`
  - `STAFF_GROUPS: string[]` = `['Admin','LO','Processor','Underwriter','Closer','Manager']` (case-insensitive match)

- [ ] **Step 1: Confirm suite's Cognito group names**

Run: `sed -n 1,80p /Users/zacharyzink/MSFG/msfg-suite/app/src/main/java/com/msfg/los/config/CognitoRolesConverter.java`
Expected: a mapping of `cognito:groups` values → roles. If group names differ from `STAFF_GROUPS` above, use the converter's exact names in Steps 2–3 (and in `STAFF_GROUPS`).

- [ ] **Step 2: Write the failing tests**

```js
// scripts/suite-access/jwt-inspect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwtPayload, assessSuiteReadiness } from './jwt-inspect.mjs';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64u({ alg: 'RS256' })}.${b64u(payload)}.sig`;
const NOW = 1_800_000_000;
const good = {
  token_use: 'id',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  'cognito:groups': ['LO'],
  aud: '2t9edrhu5crf8vq3ivigv6jopf',
  exp: NOW + 600,
};

test('decodes payload', () => {
  assert.deepEqual(decodeJwtPayload(jwt(good)), good);
});

test('rejects non-JWT', () => {
  assert.throws(() => decodeJwtPayload('abc'), /not a JWT/);
});

test('good staff id token is ready', () => {
  const r = assessSuiteReadiness(good, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.summary.clientId, '2t9edrhu5crf8vq3ivigv6jopf');
  assert.equal(r.summary.expiresInSec, 600);
});

test('access token is flagged (no org_id stamped on access tokens)', () => {
  const r = assessSuiteReadiness({ ...good, token_use: 'access', aud: undefined, client_id: 'x' }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /access token/);
});

test('missing or non-UUID org_id is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, org_id: undefined }, NOW).problems.join(), /org_id missing/);
  assert.match(assessSuiteReadiness({ ...good, org_id: 'nope' }, NOW).problems.join(), /org_id not a UUID/);
});

test('borrower-only or group-less user is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, 'cognito:groups': ['Borrower'] }, NOW).problems.join(), /no staff group/);
  assert.match(assessSuiteReadiness({ ...good, 'cognito:groups': undefined }, NOW).problems.join(), /no staff group/);
});

test('staff group match is case-insensitive', () => {
  assert.equal(assessSuiteReadiness({ ...good, 'cognito:groups': ['admin'] }, NOW).ok, true);
});

test('expired token is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, exp: NOW - 1 }, NOW).problems.join(), /expired/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/suite-access/`
Expected: FAIL — `Cannot find module .../jwt-inspect.mjs`

- [ ] **Step 4: Implement**

```js
// scripts/suite-access/jwt-inspect.mjs
// Pure helpers for checking whether a dashboard Cognito token will be accepted by the msfg-suite API.
export const STAFF_GROUPS = ['Admin', 'LO', 'Processor', 'Underwriter', 'Closer', 'Manager'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeJwtPayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export function assessSuiteReadiness(payload, nowSec) {
  const problems = [];
  const groups = payload['cognito:groups'] || [];
  const orgId = payload.org_id;

  if (payload.token_use !== 'id') problems.push(`access token sent (token_use=${payload.token_use}); suite needs the id token`);
  if (orgId == null || String(orgId).trim() === '') problems.push('org_id missing');
  else if (!UUID_RE.test(String(orgId).trim())) problems.push('org_id not a UUID');

  const staff = STAFF_GROUPS.map((g) => g.toLowerCase());
  if (!groups.some((g) => staff.includes(String(g).toLowerCase()))) {
    problems.push(`no staff group (groups=${JSON.stringify(groups)}); suite will treat user as Borrower`);
  }
  if (typeof payload.exp === 'number' && payload.exp <= nowSec) problems.push('token expired');

  return {
    ok: problems.length === 0,
    problems,
    summary: {
      tokenUse: payload.token_use,
      orgId,
      groups,
      clientId: payload.aud || payload.client_id,
      expiresInSec: typeof payload.exp === 'number' ? payload.exp - nowSec : null,
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/suite-access/`
Expected: 8 tests pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add scripts/suite-access/jwt-inspect.mjs scripts/suite-access/jwt-inspect.test.mjs
git commit -m "feat(suite-access): JWT readiness inspector for suite API calls"
```

---

### Task 2: Suite access probe CLI (dashboard repo)

**Files:**
- Create: `scripts/suite-access/probe.mjs`
- Create: `scripts/suite-access/README.md`

**Interfaces:**
- Consumes: `decodeJwtPayload`, `assessSuiteReadiness` from Task 1.
- Produces: CLI `node scripts/suite-access/probe.mjs [--api https://los.msfgco.com] [--origin https://dashboard.msfgco.com]`, token via env `SUITE_PROBE_TOKEN`. Exit 0 if readiness ok and `/api/me` is 200; else exit 1.

- [ ] **Step 1: Implement the probe**

```js
// scripts/suite-access/probe.mjs
// Read-only probe: does this dashboard token work against the suite API, and does CORS allow the dashboard origin?
import { decodeJwtPayload, assessSuiteReadiness } from './jwt-inspect.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const api = (args.api || 'https://los.msfgco.com').replace(/\/$/, '');
const origin = args.origin || 'https://dashboard.msfgco.com';
const token = process.env.SUITE_PROBE_TOKEN;

if (!token) {
  console.error('Set SUITE_PROBE_TOKEN to a dashboard auth_token (see README.md).');
  process.exit(2);
}

const r = assessSuiteReadiness(decodeJwtPayload(token), Math.floor(Date.now() / 1000));
console.log('Token summary:', { ...r.summary, orgId: r.summary.orgId ? 'present' : 'missing' });
console.log(r.ok ? 'Readiness: OK' : `Readiness problems:\n - ${r.problems.join('\n - ')}`);

async function call(method, path) {
  const res = await fetch(api + path, {
    method,
    headers: method === 'OPTIONS'
      ? { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' }
      : { Origin: origin, Authorization: `Bearer ${token}` },
  });
  console.log(`${method} ${path} -> ${res.status}  ACAO=${res.headers.get('access-control-allow-origin') ?? '(none)'}`);
  return res.status;
}

const preflight = await call('OPTIONS', '/api/board');
const me = await call('GET', '/api/me');
await call('GET', '/api/board?size=1');

if (preflight !== 200) console.log(`CORS: ${origin} not allowed yet (expected before Task 4 deploy).`);
process.exit(r.ok && me === 200 ? 0 : 1);
```

- [ ] **Step 2: Write the README**

````markdown
# suite-access probe

Checks whether a dashboard login token will be accepted by the msfg-suite API. Read-only.

## Get a token
1. Log in at https://dashboard.msfgco.com.
2. DevTools → Console: `copy(localStorage.getItem('auth_token'))`
3. In a terminal (token stays out of shell history with a leading space):
   ` export SUITE_PROBE_TOKEN='<paste>'`

## Run
```bash
node --test scripts/suite-access/            # unit tests
node scripts/suite-access/probe.mjs           # prod suite, dashboard origin
node scripts/suite-access/probe.mjs --api http://localhost:8080 --origin http://localhost:5190
```

Never commit or paste tokens into docs. Unset when done: `unset SUITE_PROBE_TOKEN`.
````

- [ ] **Step 3: Smoke-test argument handling without a token**

Run: `node scripts/suite-access/probe.mjs; echo "exit=$?"`
Expected: `Set SUITE_PROBE_TOKEN ...` and `exit=2`.

- [ ] **Step 4: Commit**

```bash
git add scripts/suite-access/probe.mjs scripts/suite-access/README.md
git commit -m "feat(suite-access): CLI probe for dashboard token against suite API"
```

---

### Task 3: Run probes + Cognito group audit (read-only, needs user)

**Files:**
- Create: `docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md` (sections 1–2)

**Interfaces:**
- Consumes: probe CLI from Task 2.
- Produces: findings sections "Token check" and "Staff Cognito groups", each ending with a PASS/ACTION line that Task 6 reads.

- [ ] **Step 1: Ask the user for tokens**

Ask the user to run the README "Get a token" steps as (a) an LO and (b) an admin, and run `node scripts/suite-access/probe.mjs` with each (the `!` prefix lets output land in the session). Do not ask them to paste the token itself into chat.

Expected before Task 4 deploys: readiness OK, `GET /api/me -> 200` (server-side calls ignore CORS), `OPTIONS -> 403` with no ACAO.

- [ ] **Step 2: Audit Cognito group membership (read-only)**

```bash
aws cognito-idp list-groups --user-pool-id us-west-1_S6iE2uego --region us-west-1 --query 'Groups[].GroupName'
for g in $(aws cognito-idp list-groups --user-pool-id us-west-1_S6iE2uego --region us-west-1 --query 'Groups[].GroupName' --output text); do
  echo "$g: $(aws cognito-idp list-users-in-group --user-pool-id us-west-1_S6iE2uego --region us-west-1 --group-name "$g" --query 'length(Users)')"
done
```

Then compare against active dashboard staff (dashboard DB, run on the dashboard backend host or via its read replica — read-only):

```sql
SELECT role, COUNT(*) FROM users WHERE is_active = 1 GROUP BY role;
```

(If column names differ, check `backend/` user model first: `grep -rn "CREATE TABLE users" backend/`.)

List dashboard staff emails lacking any staff Cognito group **locally only** (do not commit emails); record just the count.

- [ ] **Step 3: Write findings §1–2**

```markdown
# Phase 1 Findings — Suite API Access (2026-09-16)

## 1. Token check
- LO token: token_use=<id|access>, org_id=<present|missing>, groups=<list>, /api/me=<status>
- Admin token: same fields
- Result: PASS | ACTION: <what must change>

## 2. Staff Cognito groups
- Cognito groups and member counts: <table>
- Active dashboard staff: <count by role>
- Staff with no staff Cognito group: <count>
- Result: PASS | ACTION: add missing users to groups (owner-gated Cognito change, done before phase 4 rollout)
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md
git commit -m "docs(findings): phase 1 token and Cognito group audit"
```

---

### Task 4: Suite CORS allowlist for the dashboard (suite repo)

**Files:**
- Modify: `/Users/zacharyzink/MSFG/msfg-suite/app/src/main/resources/application-prod.yml:34`
- Modify: `/Users/zacharyzink/MSFG/msfg-suite/app/src/main/resources/application-local.yml:16`
- Test: `/Users/zacharyzink/MSFG/msfg-suite/app/src/test/java/com/msfg/los/config/CorsIT.java`

**Interfaces:**
- Produces: suite API returns `Access-Control-Allow-Origin` for `https://dashboard.msfgco.com`, `https://staging-dashboard.msfgco.com` (prod) and `http://localhost:5190` (local). Phases 2 and 4 depend on these exact origins.

- [ ] **Step 1: Create an isolated worktree**

```bash
cd /Users/zacharyzink/MSFG/msfg-suite
git fetch origin
git worktree add .worktrees/dashboard-cors -b feat/dashboard-cors origin/main
cd .worktrees/dashboard-cors
```

- [ ] **Step 2: Write the failing test**

The test must read the real `application-prod.yml` value (a `@TestPropertySource` hardcoding the new origins would pass without the yml change). Append to `CorsIT.java`:

```java
/**
 * The dashboard (dashboard.msfgco.com) mounts the suite pipeline embed and calls the API
 * cross-origin. Loads the prod profile's allowlist so removing the dashboard origins from
 * application-prod.yml fails this test.
 */
@TestPropertySource(properties = "los.cors.allowed-origins=${los.cors.prod-allowed-origins}")
class CorsDashboardOriginsIT extends AbstractIntegrationTest {

    @Autowired
    MockMvc mvc;

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
            "https://dashboard.msfgco.com",
            "https://staging-dashboard.msfgco.com"})
    void preflightFromDashboardOriginIsPermitted(String origin) throws Exception {
        mvc.perform(options("/api/board")
                .header("Origin", origin)
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", origin))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void lookalikeDashboardOriginIsRejected() throws Exception {
        mvc.perform(options("/api/board")
                .header("Origin", "https://dashboard.msfgco.com.evil.example")
                .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
```

Loading the whole prod profile in tests would pull prod datasource/issuer settings, so the prod list moves to a shared key `los.cors.prod-allowed-origins` in `application.yml` (Step 4). `application-prod.yml` references it, and this test resolves it — one source of truth, and the test fails if the dashboard origins are removed. Until Step 4 the key doesn't exist, so the context fails to start — that counts as the failing run.

- [ ] **Step 3: Run test to verify it fails**

Run: `./gradlew :app:test --tests 'com.msfg.los.config.CorsDashboardOriginsIT'`
Expected: FAIL — `Could not resolve placeholder 'los.cors.prod-allowed-origins'`.

- [ ] **Step 4: Add the origins**

`application.yml` (under `los.cors`):

```yaml
    # Production frontend origins. Referenced by application-prod.yml and CorsDashboardOriginsIT.
    # dashboard/staging-dashboard = dashboard.msfgco.com mounting the suite pipeline embed.
    prod-allowed-origins: "https://app.msfgco.com,https://los.msfgco.com,https://apply.msfgco.com,https://suite.msfgco.com,https://dashboard.msfgco.com,https://staging-dashboard.msfgco.com"
```

`application-prod.yml:34`:

```yaml
    allowed-origins: ${LOS_CORS_ALLOWED_ORIGINS:${los.cors.prod-allowed-origins}}
```

`application-local.yml:16` — append `,http://localhost:5190` and extend the comment: `+ 5190 dashboard.msfgco.com local frontend (suite pipeline embed)`.

- [ ] **Step 5: Run CORS tests to verify they pass**

Run: `./gradlew :app:test --tests 'com.msfg.los.config.Cors*'`
Expected: all `CorsIT`, `CorsProductionOriginsIT`, `CorsLocalFunnelIT`, `CorsDashboardOriginsIT` pass.

- [ ] **Step 6: Run the config test package**

Run: `./gradlew :app:test --tests 'com.msfg.los.config.*'`
Expected: PASS (no regression in `SecurityConfigTest`, `OrgScopedJwtAuthenticationConverterTest`).

- [ ] **Step 7: Commit and open PR**

```bash
git add app/src/main/resources/application.yml app/src/main/resources/application-prod.yml app/src/main/resources/application-local.yml app/src/test/java/com/msfg/los/config/CorsIT.java
git commit -m "feat(cors): allow dashboard.msfgco.com origins for pipeline embed"
git push -u origin feat/dashboard-cors
gh pr create --title "Allow dashboard.msfgco.com in suite CORS allowlist" --body "Adds dashboard + staging-dashboard (prod) and localhost:5190 (local) origins for the suite pipeline embed. Spec: dashboard.msfgco.com docs/superpowers/specs/2026-09-16-suite-pipeline-displays-design.md"
```

---

### Task 5: Data-readiness queries (read-only, needs user)

**Files:**
- Modify: `docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md` (add §3–4)

**Interfaces:**
- Produces: findings §3 "Loan number coverage" and §4 "Notes & checklist import path", each ending with PASS/ACTION.

- [ ] **Step 1: Dashboard-side counts (dashboard DB, read-only)**

First confirm column names: `grep -rn "CREATE TABLE \(pre_approvals\|pipeline\|funded_loans\|loan_checklists\)" backend/`. Then:

```sql
SELECT 'pre_approvals' t, COUNT(*) total, SUM(loan_number IS NOT NULL AND loan_number <> '') with_loan_no FROM pre_approvals
UNION ALL SELECT 'pipeline', COUNT(*), SUM(loan_number IS NOT NULL AND loan_number <> '') FROM pipeline
UNION ALL SELECT 'funded_loans', COUNT(*), SUM(loan_number IS NOT NULL AND loan_number <> '') FROM funded_loans;

SELECT 'pre_approval_notes' t, COUNT(*) FROM pre_approval_notes
UNION ALL SELECT 'pipeline_notes', COUNT(*) FROM pipeline_notes
UNION ALL SELECT 'funded_loan_notes', COUNT(*) FROM funded_loan_notes
UNION ALL SELECT 'loan_checklists', COUNT(*) FROM loan_checklists;
```

Also count how many **notes** belong to rows with a loan number (join each notes table to its parent on its FK).

- [ ] **Step 2: Suite-side coverage (suite Postgres, read-only)**

```sql
SELECT COUNT(*) total, COUNT(*) FILTER (WHERE loan_number IS NOT NULL AND loan_number <> '') with_loan_no FROM loans;
```

- [ ] **Step 3: Cross-match estimate**

Export dashboard loan numbers and suite loan numbers to local CSVs in the scratchpad (not the repo) and count the intersection:

```bash
comm -12 <(sort -u dash_loan_numbers.csv) <(sort -u suite_loan_numbers.csv) | wc -l
```

- [ ] **Step 4: Document the import path**

Record in §4:
- `POST /api/loans/{loanId}/notes` accepts only `content`, `columnKey` → cannot preserve original author/timestamp. **ACTION (phase 5):** add an admin-only note import endpoint (e.g. `POST /api/admin/import/loan-notes` with `authorEmail`, `createdAt`, `sourceRef` for idempotency).
- `/api/todo/tasks` exists; read `todo/src/main/java/com/msfg/los/todo/web/dto/` and note whether tasks can attach to a loan. If yes → checklists map to tasks; if no → checklists import as notes (spec §7 fallback).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md
git commit -m "docs(findings): loan-number coverage and notes import path"
```

---

### Task 6: Deploy CORS + end-to-end verify + close open questions

**Files:**
- Modify: `docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md` (add §5)
- Modify: `docs/superpowers/specs/2026-09-16-suite-pipeline-displays-design.md` §11

**Interfaces:**
- Consumes: merged PR from Task 4; probe from Task 2; findings §1–4.
- Produces: phase 1 exit report; spec §11 resolved (feeds phase 2/5 plans).

- [ ] **Step 1: STOP — ask the user to approve the suite prod deploy**

Tell the user: PR merged, deploy will restart the suite API container on 52.2.71.106. Proceed only on explicit yes.

- [ ] **Step 2: Check for an env override on the host**

```bash
ssh -i "$EC2_KEY" "$EC2_HOST" "cd \$EC2_DIR && grep -n LOS_CORS_ALLOWED_ORIGINS .env docker-compose*.yml 2>/dev/null"
```

If set, it overrides the yml: append `,https://dashboard.msfgco.com,https://staging-dashboard.msfgco.com` to it (with user approval) before deploying.

- [ ] **Step 3: Deploy**

Run: `./deploy-suite.sh` from msfg-suite `main`.
Expected: health check on :8082 passes.

- [ ] **Step 4: Verify from the probe**

Run: `node scripts/suite-access/probe.mjs`
Expected: `OPTIONS /api/board -> 200  ACAO=https://dashboard.msfgco.com`, `GET /api/me -> 200`, `GET /api/board?size=1 -> 200`, exit 0.

- [ ] **Step 5: Verify from a real browser**

On https://dashboard.msfgco.com (logged in), DevTools Console:

```js
fetch('https://los.msfgco.com/api/board?size=1', { headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') } })
  .then(r => console.log('suite board', r.status))
```

Expected: `suite board 200`, no CORS error in console.

- [ ] **Step 6: Write §5 and update spec §11**

Findings §5:

```markdown
## 5. Phase 1 exit
- CORS deployed: <date>, probe + browser fetch 200 from dashboard origin
- Blocking actions carried forward: <list from §1–4 ACTION lines, or "none">
```

Spec §11: replace each open question with its resolution and a link to the findings section.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/findings/2026-09-16-phase1-suite-access-findings.md docs/superpowers/specs/2026-09-16-suite-pipeline-displays-design.md
git commit -m "docs: phase 1 exit — suite API reachable from dashboard; resolve spec open questions"
```
