# Webinar Studio Foundation Verification

Date: 2026-09-03

This evidence is local-only. The integration suite requires an explicit local
`WEBINAR_TEST_DATABASE_URL`; it refuses non-local MySQL hosts, generates a
cryptographically random identifier matching `^[A-Za-z0-9_]{1,64}$`, and drops
only that exact database during teardown. Before creation it proves the
candidate differs from the source database and does not already exist; it uses
`CREATE DATABASE` without `IF NOT EXISTS`, and enables teardown only after that
create succeeds. It never drops the database named in the supplied URL.

## Commands and results

Executed from `backend/`:

```sh
npx vitest run \
  tests/lib/httpLogging.test.js \
  tests/db/migrations.test.js \
  tests/db/webinarStudioFoundationMigration.test.js \
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

The consolidated Foundation regression selection passed 16 files and 459 tests.
It covers logging, migration execution/postflight, identity mapping, private
routes, transactions, revisions, content policy, settings, notes, repository,
authorization, observability, and request schemas.

```sh
TZ=UTC npm test
```

Result: 47 test files and 882 tests: 880 passed and only the two accepted
Calendar UI tests failed. The default Vitest config excludes
`tests/integration/**`; no integration test ran in this command.

A plain `npm test` under this workstation's `America/Denver` timezone also
reproduces three zone-less timestamp failures in the newly merged Plaud tests.
The Plaud service and tests are byte-for-byte identical to `origin/main`, and
the Plaud suite passes 10/10 under `TZ=UTC`. No Plaud behavior was changed by
this remediation.

```sh
npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js
```

Result with no database URL: 1 test file and 5 tests skipped, exit 0. No MySQL
connection, database creation, or teardown is attempted in that mode.

### Credential-safe disposable MySQL lifecycle

The commands below create a private random password in a mode-`0700` temporary
directory, mount it through MySQL's `_FILE` interface, and never put the
credential itself in command history, Docker configuration, or test output.
They also refuse to adopt an existing container or listener. Run them from
`backend/` in one shell:

```sh
set -eu
WEBINAR_IT_CONTAINER='webinar-studio-final-it'
WEBINAR_IT_PORT='33079'
WEBINAR_IT_CREATED='0'

if docker container inspect "$WEBINAR_IT_CONTAINER" >/dev/null 2>&1; then
  echo 'Refusing to reuse an existing integration container' >&2
  exit 1
fi
if lsof -nP -iTCP:"$WEBINAR_IT_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Refusing to reuse an occupied integration port' >&2
  exit 1
fi

WEBINAR_IT_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/webinar-studio-it.XXXXXX")"
chmod 700 "$WEBINAR_IT_SECRET_DIR"
WEBINAR_IT_SECRET_FILE="$WEBINAR_IT_SECRET_DIR/mysql-root-password"
umask 077
openssl rand -hex 32 > "$WEBINAR_IT_SECRET_FILE"

cleanup_webinar_it() {
  if [ "$WEBINAR_IT_CREATED" = '1' ]; then
    docker rm --force "$WEBINAR_IT_CONTAINER" >/dev/null
    WEBINAR_IT_CREATED='0'
  fi
  unset WEBINAR_TEST_DATABASE_URL WEBINAR_IT_PASSWORD
  rm -f -- "$WEBINAR_IT_SECRET_FILE"
  rmdir -- "$WEBINAR_IT_SECRET_DIR"
}
trap cleanup_webinar_it EXIT INT TERM HUP

docker run --detach --name "$WEBINAR_IT_CONTAINER" \
  --publish "127.0.0.1:${WEBINAR_IT_PORT}:3306" \
  --mount "type=bind,source=${WEBINAR_IT_SECRET_FILE},target=/run/secrets/mysql-root-password,readonly" \
  --env MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root-password \
  --health-cmd='MYSQL_PWD="$(cat /run/secrets/mysql-root-password)" mysqladmin ping --host=127.0.0.1 --user=root --silent' \
  --health-interval=1s --health-timeout=5s --health-retries=90 \
  mysql:8.0 >/dev/null
WEBINAR_IT_CREATED='1'

WEBINAR_IT_STATUS='starting'
for WEBINAR_IT_ATTEMPT in $(seq 1 90); do
  WEBINAR_IT_STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$WEBINAR_IT_CONTAINER")"
  [ "$WEBINAR_IT_STATUS" = 'healthy' ] && break
  [ "$WEBINAR_IT_STATUS" = 'unhealthy' ] && break
  sleep 1
done
test "$WEBINAR_IT_STATUS" = 'healthy'

IFS= read -r WEBINAR_IT_PASSWORD < "$WEBINAR_IT_SECRET_FILE"
export WEBINAR_TEST_DATABASE_URL="mysql://root:${WEBINAR_IT_PASSWORD}@127.0.0.1:${WEBINAR_IT_PORT}/mysql"
npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js

cleanup_webinar_it
trap - EXIT INT TERM HUP
! docker container inspect "$WEBINAR_IT_CONTAINER" >/dev/null 2>&1
! lsof -nP -iTCP:"$WEBINAR_IT_PORT" -sTCP:LISTEN >/dev/null 2>&1
test ! -e "$WEBINAR_IT_SECRET_DIR"
```

The recorded run used this lifecycle. The credential-bearing environment value
is intentionally not printed:

```sh
WEBINAR_TEST_DATABASE_URL='[redacted local disposable MySQL URL]' \
  npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js
```

Result: 1 test file and 5 tests passed. Cleanup then confirmed that the exact
container was absent, port 33079 was free, and the secret directory was gone.
The test applied migrations 091, 092,
and 093 verbatim to its own generated database, seeded three active nonexternal
users, and then exercised the real mutation, revision, repository, notes,
settings, and private route code.

Focused lint of every changed production JavaScript file completed with zero
errors. It retained one pre-existing `server.js:276` unused-catch-variable
warning (blamed to `b6f00f80`, outside this work). The integration harness and
config also passed focused ESM lint:

```sh
npx eslint --no-config-lookup --parser-options '{"sourceType":"module","ecmaVersion":"latest"}' \
  --global process --global URL --global fetch --rule 'no-unused-vars:error' \
  --rule 'no-undef:error' tests/integration/webinarStudioFoundation.integration.test.js \
  vitest.webinar-integration.config.js
```

`git diff --check` passed.

## Disposable integration coverage

The live integration asserts all of the following in the disposable database:

- migration foreign keys and unique index names, plus an invalid-owner FK rejection;
- local URL parsing that normalizes the standard bracketed `[::1]` URL hostname
  to the unbracketed `::1` value expected by the MySQL driver;
- adversarial disposable-database lifecycle cases: source-name rejection,
  pre-existing-name collision, create-time race, create failure, exact ordered
  cleanup, drop failure, server/pool/source-close failure, and non-drop guards;
- primary-failure and cleanup-failure aggregation that retains the original
  primary value first, preserves every cleanup error object/cause, aggregates
  cleanup-only failures, and rethrows a primary-only failure unchanged,
  including `false`, `0`, empty-string, `null`, and `undefined` values;
- owner and admin access, and a non-owner `403` through private routes;
- creation at revision 1 with audience access disabled;
- two live content saves, then a stale `VERSION_CONFLICT` with byte/deep-equal
  presentation, slides, revisions, audits, notes, and discovered reference
  tables before and after rejection;
- rollback after an injected audit-write failure;
- archive and revision restore using the same stable slide UUID;
- append-only six-revision history whose service and route items have only the
  explicit allowed key sets, positive IDs and versions, valid timestamps, known
  change types, and the constrained server-generated summaries for this exact
  sequence. Normalized source/code/note/resource-policy semantics are rejected
  recursively, and unique canaries in saved master/slide/source/note surfaces
  are absent from every returned history value. Before both history reads, the
  test persists a private-note canary and a disposable resource-policy fixture
  row; neither appears in the service or authenticated route history response;
- user-scoped notes that another permitted user cannot list, update, or delete,
  with the complete note rows (including body and timestamps) unchanged after
  rejected mutations;
- account-wide presenter settings persisted only for the authenticated user;
- no physical deletion when slides or the webinar are archived.

## Git and operational hold points

The clean starting Dashboard worktree commit was
`89d2d8c4711aab346be5caa5f414ff8e6a7fe16e`. Fetched `origin/main` was
`49cb9e4b982215c943d5f28e2c7da68fbe7df5fb` and was merged before remediation
in `bca5d79c7b8b72cdc74a7fb617b0186874c73170`. The source/test remediation
commits through this evidence run are `72a8371`, `d849087`, `82ffd18`,
`3b057b6`, `c7f6c39`, and `dd7bfe5`.

The following gates are deliberately **UNPERFORMED**:

- production migration;
- backend deployment;
- data migration;
- public cutover; and
- credential retirement.

No production database, deployment environment, credential, DNS record, or
public endpoint was changed by this verification.

## Accepted baseline waiver

The two Calendar UI failures were reproduced on untouched `main` and explicitly
accepted by the user as a baseline waiver:

- `renders sync health indicators for synced calendar filter chips` expects
  `sync-health is-connected`;
- `renders bulk controls only for eligible synced Outlook entries` expects
  `data-bulk-entry="501"`.

The exit criterion is zero new failures. The current Task 7 verification meets
that criterion; the default suite is not represented as fully green.
