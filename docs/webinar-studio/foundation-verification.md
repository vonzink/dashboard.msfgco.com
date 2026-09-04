# Webinar Studio Foundation Verification

Date: 2026-09-03

This evidence is local-only. No production database, deployment environment,
credential, DNS record, or public endpoint was changed.

## Deployment-hardening result

- HTTP access logs and validation-rejection warnings use one shared request
  pathname serializer. Query strings from `url` and `originalUrl` are omitted
  wholesale, including `api_key`, `token`, OAuth `code` and `state`, mixed-case
  names, encoded values, duplicate parameters, and safe-looking parameters.
  Authorization, cookie, and response set-cookie headers remain omitted.
- The migration parser is stateful across MySQL line comments, hash comments,
  block comments, single- and double-quoted strings, backtick identifiers,
  escaped delimiters, and doubled delimiters. Unterminated constructs fail with
  `MIGRATION_SQL_PARSE_ERROR` before any statement from that file executes.
- Exact error-code/statement matching remains required for strict idempotency,
  including standalone `CREATE INDEX`; compound ALTER operations do not qualify.
- The MySQL 8 `ADD COLUMN IF NOT EXISTS` compatibility rewrite is limited to the
  exact authored statements in migrations 038 and 039. Canonical SQL, Studio
  092+, unversioned/future sources, and mismatched statements reach MySQL
  unchanged and fail closed.
- An explicit compatibility boundary preserves the inherited best-effort
  behavior of immutable/current-main migrations 002 through 091: an unexpected
  error is logged with code and filename and the runner proceeds to the next
  legacy file. Migration 092 and every later or unversioned migration are strict
  and abort on any unexpected error. Webinar Studio postflight verification runs
  only after the complete directory is processed.
- The unperformed Studio files are now exactly
  `092_webinar_studio_foundation.sql`,
  `093_webinar_active_slide_anchors.sql`, and `094_users_is_active.sql`. Each of
  those three ordinals is unique in the current migration directory, and the
  obsolete Studio filenames are absent. Existing historical duplicate ordinals
  073, 078, and 085 were deliberately preserved because they are applied history.
- `DATABASE_SCHEMA.sql` now expresses the current migration-032 key/value shape
  for `user_preferences` and seeds `theme=light` and
  `default_goal_period=monthly` as separate key/value rows.

## MySQL 8 corpus qualification

The integration is intentionally described as a **production-like legacy-baseline
first pass**, not a truly empty installation. The canonical schema alone does
not create every prerequisite expected by the historical corpus. The harness
therefore creates a uniquely named empty database, applies the canonical schema,
applies the repository's `docs/legacy-sql/ADDITIONAL_TABLES.sql`, and creates the
minimal legacy `title_companies` prerequisite. None of those prerequisites creates
a `webinar_*` table. It then calls the production `runMigrations` entry point
twice back-to-back over the complete real migration directory.

The first call and immediate rerun each reached `Migrations completed`, which is
emitted only after Webinar Studio schema postflight succeeds. The integration
asserts both completions. It also asserts that the inherited rerun failure from
`051_investor_notes.sql` (`ER_FK_CANNOT_DROP_PARENT`) is logged only through the
legacy compatibility boundary, while focused tests prove the same unexpected
error in 092 or later aborts.

The disposable runner uses MySQL `8.0`, a cryptographically random validated
container name (`webinar-studio-it-` plus 24 lowercase hexadecimal characters),
a Docker-assigned loopback port, and a mode-0700 temporary secret directory.
Name-based removal is armed before `docker create`, so cleanup is attempted even
if creation may have succeeded but `docker start` fails. Cleanup preserves the
primary exit status and removes the credential file and directory.

Executed from `backend/`:

```sh
tests/integration/runWebinarStudioFoundationMysql.sh
```

Final recorded result: 1 test file and 5 tests passed. The real production runner
completed and passed Studio postflight twice. The run used container
`webinar-studio-it-3a020a944ebfad001869e39e` on `127.0.0.1:61276`; teardown
reported its removal. Follow-up checks returned `CONTAINER_ABSENT`, `PORT_FREE`,
zero matching containers, and no `webinar-studio-it.*` temporary directory.

The same 5/5 integration also exercises real Webinar Studio mutations,
transactions, revisions, schema constraints, authorization, private notes,
presenter settings, history redaction, rollback, archive behavior, and cleanup
failure aggregation.

Without an explicit database URL, integration remains inert:

```sh
env -u WEBINAR_TEST_DATABASE_URL npx vitest run \
  --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js
```

Result: 1 test file and 5 tests skipped, exit 0. No MySQL connection, database,
container, or teardown was attempted.

Review fix round 1 did not rerun the disposable MySQL corpus. Its migration
change only narrows the compatibility rewrite from a global pattern to the exact
038/039 source-and-statement pairs already exercised by the recorded corpus.
Focused tests execute both authorized pairs and prove that canonical, Studio,
future, unversioned, and mismatched historical statements reach the executor
byte-for-byte unchanged and propagate its parse failure. No runner ordering,
schema, parser, error boundary, postflight, or migration file changed.

## Focused regression verification

Executed from `backend/`:

```sh
npx vitest run \
  tests/lib/httpLogging.test.js \
  tests/validation/validate-middleware.test.js \
  tests/db/migrations.test.js \
  tests/db/webinarStudioFoundationMigration.test.js \
  tests/db/webinarStudioMysqlLifecycle.test.js \
  tests/middleware/userContext.test.js \
  tests/routes/webinarPresenterSettings.test.js \
  tests/routes/webinars.test.js \
  tests/services/webinars/audit.test.js \
  tests/services/webinars/authorization.test.js \
  tests/services/webinars/contentPolicy.test.js \
  tests/services/webinars/mutations.test.js \
  tests/services/webinars/notes.test.js \
  tests/services/webinars/observability.test.js \
  tests/services/webinars/repository.test.js \
  tests/services/webinars/revisions.test.js \
  tests/services/webinars/settings.test.js \
  tests/validation/webinars.schema.test.js
```

Result: 18 test files and 506 tests passed. This includes 55 focused migration
parser/context/idempotency/boundary/postflight tests, 37 Studio migration and
canonical-schema tests, 2 HTTP logging tests, 8 validation middleware tests,
and the deterministic create-success/start-failure cleanup regression.

## Full backend verification

```sh
TZ=UTC npm test -- --reporter=dot
```

Result: 48 test files, 922 tests total: 920 passed and exactly the two accepted
Calendar UI baseline tests failed. The default Vitest configuration excludes
`tests/integration/**`; the disposable MySQL run above is separate.

The accepted failures are unchanged:

- `calendar sync health and privacy labels > renders sync health indicators for synced calendar filter chips` expects `sync-health is-connected`.
- `calendar side panels > renders bulk controls only for eligible synced Outlook entries` expects `data-bulk-entry="501"`.

## Static and provenance checks

```sh
npx eslint lib/httpLogging.js db/migrations.js validation/schemas.js
```

Result: zero errors. Node printed the repository's existing typeless-package
ESLint configuration warning.

```sh
npx eslint --no-config-lookup \
  --parser-options '{"sourceType":"module","ecmaVersion":"latest"}' \
  --global process --global URL --global fetch --global setImmediate --global console \
  --rule 'no-unused-vars:error' --rule 'no-undef:error' \
  tests/lib/httpLogging.test.js \
  tests/validation/validate-middleware.test.js \
  tests/db/migrations.test.js \
  tests/db/webinarStudioFoundationMigration.test.js \
  tests/db/webinarStudioMysqlLifecycle.test.js \
  tests/integration/webinarStudioFoundation.integration.test.js \
  vitest.webinar-integration.config.js
sh -n tests/integration/runWebinarStudioFoundationMysql.sh
git diff --check
```

Result: all completed with no output and exit 0.

The three Studio migration contents remain byte-identical to their pre-rename
versions (SHA-256 respectively `3ed8cff4ee0a1fd7024ea498f753769c768adbf33fc1a928a248de19d8aa62f5`,
`488d3a3bfd662ac0e310ca66a71a941adbdc4ed72c837ff79e5511ae11cf2613`,
and `8e1f4fed9979afe3295c20cf1387e13a352873f3dab7f03867899ed81d6dd9e7`).
Plaud source, tests, migration, script, IAM policy, and documentation were all
checked byte-for-byte against `origin/main` and match.

## Git and hold points

The clean starting Dashboard worktree was branch `codex/webinar-studio` at
`b63f0db5de96bea2b83cebea38e4537a8a675e1c`. Local `origin/main` was
`49cb9e4b982215c943d5f28e2c7da68fbe7df5fb` and is an ancestor of that base.
Review fix round 1 began from the clean reviewed implementation commit
`3be0176ff3e2ea6e979803caaf9b0f7f8f1ec1ba`.

The following gates remain deliberately **UNPERFORMED**:

- production migration;
- backend deployment;
- data migration;
- public cutover; and
- credential retirement.

## Known migration-governance debt

The repository has no migration ledger and replays immutable historical files at
every startup. Some of those files are destructive or not rerun-safe; migration
051's drop is one demonstrated example. The compatibility boundary is explicit
and observable, but it necessarily means a legacy failure can leave a historical
feature partially migrated while startup continues. Introducing a ledger and
remediating applied-history governance is separate work and was expressly kept
out of this targeted Studio deployment-hardening task.
