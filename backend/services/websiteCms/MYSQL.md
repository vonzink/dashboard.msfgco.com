# Durable editorial storage

The adapter supports the existing page editor and publication service. The independent publication store owns release manifests, assets and the active pointer. Website grants, drafts, outbox records and audit history stay in MySQL.

## Operator sequence

1. Apply migration 097 to the intended dashboard schema. Its foreign key expects the dashboard's signed INT users.id column. The migration runner can reapply all six CREATE TABLE IF NOT EXISTS statements.
2. Inject a dedicated mysql2 promise pool configured for one database on one writable primary. The repository acquires and returns its own sessions. Configure pool acquisition, connection and external-store timeouts at composition time.
3. Read the verified active publication through the publication store, then call repository.initialize({ snapshot }). The adapter validates the snapshot and seeds immutable page revisions, latest pointers and an attributed bootstrap audit record atomically. An identical snapshot is a no-op. Different seed content conflicts even if the publication ID matches. Reopening an initialized repository requires only constructing the adapter.
4. An operator separately calls bootstrapRoleManager({ userId }) for the designated active dashboard user. This method grants only website.roles.manage. Its permanent database marker prevents another bootstrap after grant revocation. Keep this operator function outside HTTP routing.
5. An authenticated, active manager calls setGrants({ actor, userId, capabilities }) with the complete replacement list. An empty array revokes the target's permissions even while that existing user is inactive. Nonempty grants require an active target. Audits read stored prior grants, so inactive-account revocations retain accurate history. The method audits each change with prior and new capabilities. Choose active role managers before removing the last manager. A lost final manager requires a separately authorized recovery procedure.

    const { createMysqlCmsRepository } = require('./mysql');
    const repository = createMysqlCmsRepository({ pool, lockTimeoutSeconds: 5 });
    const service = createWebsiteCmsService({ repository, publicationStore });

The current capability allowlist is website.edit, website.publish, website.profile.self and website.roles.manage. Only the existing page service consumes edit/publish. A dashboard role alone grants no website capability.

## Writer and failure behavior

Every service operation and grant-management operation acquires the same database-scoped MySQL named lock on its checked-out session. All editorial clients must use this adapter and the same primary. Named locks are server-local. Multiple writable primaries or independent editorial authorities pointing at the same publication store require a separate coordination design. The lock timeout is a whole number of seconds from 0 to 30.

The adapter loads grants joined to active user rows on each transaction and holds shared locks on granted users during each SQL transaction. A checkpoint writes deltas and commits, then begins a new transaction, verifies named-lock ownership and checks active grants again before returning. Website grant changes use the same named lock and wait through pointer activation. A concurrent user deactivation during a checkpoint can stop the operation with the publication intent retained. Restrict SQL access to protect the authority, grants, immutable history and audit from out-of-band writes.

The page service can publish a selected older revision while retaining newer drafts. A checkpoint commits the pending request before activation. If activation or its acknowledgment fails, a later authorized request can reconcile the observed pointer or retry the same retained intent. The repository does not replay ambiguous commits. An external pointer store must independently provide generation-conditional activation. SQL and the pointer store cannot be committed atomically. A database session can disconnect after the last ownership check.

SQLite, in-memory tests and isolated JS locks do not exercise named locks, committed checkpoints or user-row locking. The separately gated integration suite runs against an explicitly provisioned empty msfg_cms_test schema on loopback. Set MYSQL_CMS_TEST_PORT, MYSQL_CMS_TEST_USER and MYSQL_CMS_TEST_PASSWORD for the disposable fixture, then run node --test tests/integration/websiteCmsMysql.integration.cjs in backend. Without the port the test is skipped. The default Vitest suite excludes this directory.

## Operational scope

The existing repository callback consumes the full page revision, request and audit history in memory. Measure data size, memory and lock duration before scheduling production activation. The immutable revision and audit tables are written incrementally. Request phase and result are the only mutable outbox fields. Request intent retains its original JSON ordering because the existing service computes idempotency hashes over JSON serialization. Existing draft service callers and public contract bytes do not change.
