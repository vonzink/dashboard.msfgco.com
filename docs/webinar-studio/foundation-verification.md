# Webinar Studio Foundation Verification

Date: 2026-09-03

This evidence is local-only. The integration suite requires an explicit local
`WEBINAR_TEST_DATABASE_URL`; it refuses non-local MySQL hosts, generates a
cryptographically random identifier matching `^[A-Za-z0-9_]{1,64}$`, and drops
only that exact database during teardown. It never drops the database named in
the supplied URL.

## Commands and results

Executed from `backend/`:

```sh
npm test
```

Result: 43 test files, 793 tests: 791 passed and 2 existing Calendar UI tests
failed. The default Vitest config excludes `tests/integration/**`; no integration
test ran in this command.

```sh
npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js
```

Result with no database URL: 1 test file and 1 test skipped, exit 0.

After preflighting that neither the fixed disposable-container name nor local
port 33079 was already in use, a MySQL 8 container created by this task was
started, checked over TCP, and stopped after the run. The credential-bearing
environment value is intentionally redacted:

```sh
WEBINAR_TEST_DATABASE_URL='[redacted local disposable MySQL URL]' \
  npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js
```

Result: 1 test file and 1 test passed. The test applied migration 091 verbatim
to its own generated database, seeded three active nonexternal users, and then
exercised the real mutation, revision, repository, notes, settings, and private
route code.

Focused lint (with ESM parsing explicitly selected because the repository's
flat ESLint config declares every `.js` file CommonJS) passed for the two
JavaScript files created here:

```sh
npx eslint --no-config-lookup --parser-options '{"sourceType":"module","ecmaVersion":"latest"}' \
  --global process --global URL --global fetch --rule 'no-unused-vars:error' \
  --rule 'no-undef:error' tests/integration/webinarStudioFoundation.integration.test.js \
  vitest.webinar-integration.config.js
```

`npm run lint` remains a repository baseline failure: the observed full run
reported 56 errors and 52 warnings, including pre-existing CommonJS parsing
errors for the existing Vitest config and test files, plus unrelated backend
lint errors. It is not evidence against the focused Task 7 files.

## Disposable integration coverage

The live integration asserts all of the following in the disposable database:

- migration foreign keys and unique index names, plus an invalid-owner FK rejection;
- owner and admin access, and a non-owner `403` through private routes;
- creation at revision 1 with audience access disabled;
- two live content saves, then a stale `VERSION_CONFLICT` with zero state or
  revision writes;
- rollback after an injected audit-write failure;
- archive and revision restore using the same stable slide UUID;
- append-only five-revision history with no snapshot/source fields in the
history service or route response;
- user-scoped notes that another permitted user cannot list, update, or delete;
- account-wide presenter settings persisted only for the authenticated user;
- no physical deletion when slides or the webinar are archived.

## Git and operational hold points

Baseline Dashboard worktree commit: `830eb73158845a194145199a11175a31ce86fa91`.
Before staging, `git diff --cached --name-only` was empty, proving no unrelated
Dashboard worktree files were staged. Task 7's commit SHA is recorded in the
task report after the commit is made.

The following gates are deliberately **UNPERFORMED**:

- production migration;
- backend deployment;
- data migration;
- public cutover; and
- credential retirement.

No production database, deployment environment, credential, DNS record, or
public endpoint was changed by this verification.
