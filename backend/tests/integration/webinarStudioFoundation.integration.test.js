import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const describeWithMysql = process.env.WEBINAR_TEST_DATABASE_URL ? describe : describe.skip;
const migrationPath = path.resolve(import.meta.dirname, '../../db/migrations/091_webinar_studio_foundation.sql');
const localMysqlHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const identifier = /^[A-Za-z0-9_]{1,64}$/;
const NO_INTEGRATION_FAILURE = Symbol('no integration failure');

let mysql;
let sourceConnection;
let createdDatabase;
let db;
let server;
let notes;
let revisions;
let createMutationService;
let owner;
let admin;
let other;
let webinar;
let disposableLifecycle;
let primaryFailure;
let hasPrimaryFailure = false;

function parseDisposableDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEBINAR_TEST_DATABASE_URL must be a valid MySQL URL');
  }
  if (url.protocol !== 'mysql:' || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('WEBINAR_TEST_DATABASE_URL must identify a local MySQL source database');
  }
  if (!localMysqlHosts.has(url.hostname.toLowerCase())) {
    throw new Error('WEBINAR_TEST_DATABASE_URL must use localhost, 127.0.0.1, or ::1');
  }
  let user;
  let password;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('WEBINAR_TEST_DATABASE_URL contains invalid encoded credentials');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user,
    password,
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

function createDatabaseName() {
  const name = `webinar_studio_it_${randomBytes(12).toString('hex')}`;
  if (!identifier.test(name)) throw new Error('Generated disposable database identifier is unsafe');
  return name;
}

function createDisposableLifecycle(sourceDatabase) {
  return { sourceDatabase, name: null, createdByThisRun: false };
}

function isSafeDisposableName(name, sourceDatabase) {
  return typeof name === 'string' && identifier.test(name) && name !== sourceDatabase;
}

async function createDisposableDatabase({ lifecycle, generateName, query, maximumAttempts = 8 }) {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const name = generateName();
    if (!identifier.test(name)) throw new Error('Generated disposable database identifier is unsafe');
    if (name === lifecycle.sourceDatabase) continue;

    const [existing] = await query(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [name],
    );
    if (existing.length) continue;

    try {
      // No IF NOT EXISTS: a race must fail rather than adopting an existing database.
      await query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (error) {
      if (error?.code === 'ER_DB_CREATE_EXISTS') continue;
      throw error;
    }
    lifecycle.name = name;
    lifecycle.createdByThisRun = true;
    return lifecycle;
  }
  throw new Error('Unable to create a unique disposable webinar database');
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

async function cleanupDisposableResources({ server, pool, lifecycle, sourceConnection }) {
  const failures = [];
  async function attempt(step, operation) {
    try {
      await operation();
    } catch (error) {
      failures.push({ step, error });
    }
  }

  await attempt('server', () => closeServer(server));
  await attempt('pool', async () => { if (pool) await pool.end(); });
  if (sourceConnection && lifecycle?.createdByThisRun && isSafeDisposableName(lifecycle.name, lifecycle.sourceDatabase)) {
    await attempt('database', async () => {
      await sourceConnection.query(`DROP DATABASE \`${lifecycle.name}\``);
      lifecycle.createdByThisRun = false;
    });
  }
  await attempt('source', async () => { if (sourceConnection) await sourceConnection.end(); });
  return failures;
}

function cleanupFailureAggregate(failures) {
  const aggregate = new AggregateError(failures.map(failure => failure.error), 'Disposable resource cleanup failed');
  aggregate.cleanupFailures = failures;
  aggregate.cleanupSteps = failures.map(failure => failure.step);
  return aggregate;
}

function finalizeIntegrationFailure({ hasPrimary, primary, cleanupFailures }) {
  if (!hasPrimary) return cleanupFailures.length ? cleanupFailureAggregate(cleanupFailures) : NO_INTEGRATION_FAILURE;
  if (!cleanupFailures.length) return primary;
  const aggregate = new AggregateError(
    [primary, ...cleanupFailures.map(failure => failure.error)],
    'Integration execution and cleanup failed',
  );
  aggregate.cause = primary;
  aggregate.primaryFailure = primary;
  aggregate.cleanupFailures = cleanupFailures;
  aggregate.cleanupSteps = cleanupFailures.map(failure => failure.step);
  return aggregate;
}

async function applyMigration091(connection) {
  const migration = readFileSync(migrationPath, 'utf8');
  for (const statement of migration.split(';')) {
    const sql = statement.trim();
    if (sql) await connection.query(sql);
  }
}

function testIdentity(user) {
  return { db: { id: user.id, role: user.role, is_active: 1 }, groups: [user.role] };
}

async function request(method, requestPath, body, user) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': JSON.stringify(testIdentity(user)),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function jsonSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

async function captureWebinarMutationState(webinarId) {
  const state = {};
  const tables = [
    ['presentation', 'SELECT * FROM webinar_presentations WHERE id = ? ORDER BY id'],
    ['slides', 'SELECT * FROM webinar_slides WHERE webinar_id = ? ORDER BY id'],
    ['revisions', 'SELECT * FROM webinar_revisions WHERE webinar_id = ? ORDER BY id'],
    ['audit', 'SELECT * FROM webinar_audit_events WHERE webinar_id = ? ORDER BY id'],
    ['notes', 'SELECT * FROM webinar_presenter_notes WHERE webinar_id = ? ORDER BY id'],
  ];
  for (const [name, sql] of tables) {
    const [rows] = await db.query(sql, [webinarId]);
    state[name] = jsonSnapshot(rows);
  }
  const [referenceTables] = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'webinar%reference%' ORDER BY TABLE_NAME`,
  );
  state.references = {};
  for (const { TABLE_NAME: tableName } of referenceTables) {
    if (!identifier.test(tableName)) throw new Error('Unexpected webinar reference table identifier');
    const [rows] = await db.query(`SELECT * FROM \`${tableName}\` ORDER BY 1`);
    state.references[tableName] = jsonSnapshot(rows);
  }
  return state;
}

const sensitiveCanaries = Object.freeze({
  masterHtml: 'CANARY_MASTER_HTML_9c84',
  masterCss: 'CANARY_MASTER_CSS_9c84',
  slideHtml: 'CANARY_SLIDE_HTML_9c84',
  slideCss: 'CANARY_SLIDE_CSS_9c84',
  slideJavascript: 'CANARY_SLIDE_JAVASCRIPT_9c84',
  speakerNotes: 'CANARY_SPEAKER_NOTES_9c84',
  title: 'CANARY_PRIVATE_TITLE_9c84',
  note: 'CANARY_PRIVATE_NOTE_9c84',
  resourcePolicy: 'CANARY_RESOURCE_POLICY_9c84',
});
const historyItemKeys = ['changeSummary', 'changeType', 'createdAt', 'createdBy', 'id', 'version'];
const historyCreatorKeys = ['name'];
const historySummaries = new Map([
  ['webinar_created', 'Created webinar'],
  ['master_saved', 'Updated master presentation'],
  ['slide_saved', 'Updated slide'],
  ['slide_archived', 'Archived slide'],
  ['revision_restored', 'Restored revision'],
]);
const forbiddenHistorySemantics = new Set([
  'snapshot', 'source', 'sourcecode', 'sourcehtml', 'sourcecss', 'sourcejavascript',
  'masterhtml', 'mastercss', 'html', 'css', 'javascript', 'slidehtml', 'slidecss',
  'slidejavascript', 'speakernotes', 'resourcepolicy', 'resources', 'resource',
  'slides', 'notes', 'note', 'code', 'content', 'privatecontent', 'assetstoragekey',
]);

function normalizeHistoryKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function assertNoForbiddenHistoryKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    expect(forbiddenHistorySemantics.has(normalizeHistoryKey(key))).toBe(false);
    assertNoForbiddenHistoryKeys(nested);
  }
}

function isValidHistoryTimestamp(value) {
  if (!(value instanceof Date) && typeof value !== 'string') return false;
  return Number.isFinite(new Date(value).getTime());
}

function assertSafeHistoryContract(items, canaries) {
  expect(Array.isArray(items)).toBe(true);
  for (const item of items) {
    expect(Object.keys(item).sort()).toEqual(historyItemKeys);
    expect(Object.keys(item.createdBy).sort()).toEqual(historyCreatorKeys);
    expect(Number.isSafeInteger(item.id) && item.id > 0).toBe(true);
    expect(Number.isSafeInteger(item.version) && item.version > 0).toBe(true);
    expect(historySummaries.has(item.changeType)).toBe(true);
    expect(item.changeSummary).toBe(historySummaries.get(item.changeType));
    expect(isValidHistoryTimestamp(item.createdAt)).toBe(true);
    expect(typeof item.createdBy.name).toBe('string');
    expect(item.createdBy.name).toMatch(/^Webinar (?:Admin|Owner)$/);
    assertNoForbiddenHistoryKeys(item);
    const serialized = JSON.stringify(item);
    for (const canary of Object.values(canaries)) expect(serialized).not.toContain(canary);
  }
}

describeWithMysql('webinar studio foundation', () => {
  it('never adopts a source-named or existing database during disposable creation', async () => {
    const calls = [];
    const candidates = ['mysql', 'webinar_studio_it_existing', 'webinar_studio_it_fresh'];
    const lifecycle = createDisposableLifecycle('mysql');
    const query = async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT SCHEMA_NAME') && params[0] === 'webinar_studio_it_existing') {
        return [[{ SCHEMA_NAME: 'webinar_studio_it_existing' }]];
      }
      return [[]];
    };

    await expect(createDisposableDatabase({
      lifecycle,
      generateName: () => candidates.shift(),
      query,
    })).resolves.toEqual({
      sourceDatabase: 'mysql', name: 'webinar_studio_it_fresh', createdByThisRun: true,
    });
    expect(calls.filter(call => call.sql.startsWith('CREATE DATABASE'))).toHaveLength(1);
    expect(calls.find(call => call.sql.startsWith('CREATE DATABASE')).sql).toContain('webinar_studio_it_fresh');
    expect(calls.some(call => call.params[0] === 'mysql')).toBe(false);
  });

  it('does not mark a database droppable when creation fails or races with a collision', async () => {
    const lifecycle = createDisposableLifecycle('mysql');
    const candidates = ['webinar_studio_it_race', 'webinar_studio_it_after_race'];
    const calls = [];
    await expect(createDisposableDatabase({
      lifecycle,
      generateName: () => candidates.shift(),
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.startsWith('CREATE DATABASE') && sql.includes('webinar_studio_it_race')) {
          const error = new Error('database exists');
          error.code = 'ER_DB_CREATE_EXISTS';
          throw error;
        }
        return [[]];
      },
    })).resolves.toMatchObject({ name: 'webinar_studio_it_after_race', createdByThisRun: true });
    expect(calls.filter(call => call.sql.startsWith('CREATE DATABASE'))).toHaveLength(2);

    const failedLifecycle = createDisposableLifecycle('mysql');
    await expect(createDisposableDatabase({
      lifecycle: failedLifecycle,
      generateName: () => 'webinar_studio_it_create_failure',
      query: async sql => {
        if (sql.startsWith('SELECT SCHEMA_NAME')) return [[]];
        throw new Error('create failed');
      },
    })).rejects.toThrow('create failed');
    expect(failedLifecycle).toEqual({ sourceDatabase: 'mysql', name: null, createdByThisRun: false });
  });

  it('continues cleanup in exact order and drops only a database conclusively created by this run', async () => {
    const calls = [];
    const lifecycle = {
      sourceDatabase: 'mysql', name: 'webinar_studio_it_cleanup', createdByThisRun: true,
    };
    const failures = await cleanupDisposableResources({
      server: { close: callback => { calls.push('server'); callback(new Error('server close failed')); } },
      pool: { end: async () => { calls.push('pool'); throw new Error('pool end failed'); } },
      lifecycle,
      sourceConnection: {
        query: async sql => { calls.push(sql.startsWith('DROP DATABASE') ? 'drop' : 'unexpected-query'); throw new Error('drop failed'); },
        end: async () => { calls.push('source'); throw new Error('source end failed'); },
      },
    });
    expect(calls).toEqual(['server', 'pool', 'drop', 'source']);
    expect(failures.map(failure => failure.step)).toEqual(['server', 'pool', 'database', 'source']);
    expect(lifecycle.createdByThisRun).toBe(true);

    const nonDroppableCalls = [];
    await cleanupDisposableResources({
      lifecycle: { sourceDatabase: 'mysql', name: 'mysql', createdByThisRun: true },
      sourceConnection: {
        query: async () => { nonDroppableCalls.push('drop'); },
        end: async () => { nonDroppableCalls.push('source'); },
      },
    });
    await cleanupDisposableResources({
      lifecycle: { sourceDatabase: 'mysql', name: 'webinar_studio_it_unproven', createdByThisRun: false },
      sourceConnection: {
        query: async () => { nonDroppableCalls.push('drop'); },
        end: async () => { nonDroppableCalls.push('source'); },
      },
    });
    expect(nonDroppableCalls).toEqual(['source', 'source']);
  });

  it('preserves primary and actual cleanup failures without suppressing any cleanup call', () => {
    const primary = new Error('primary integration failure', { cause: new Error('primary cause') });
    const cleanupOne = new Error('cleanup one failure', { cause: new Error('cleanup one cause') });
    const cleanupTwo = { marker: 'non-error cleanup value' };
    const failures = [
      { step: 'server', error: cleanupOne },
      { step: 'source', error: cleanupTwo },
    ];

    expect(finalizeIntegrationFailure({ hasPrimary: true, primary, cleanupFailures: [] })).toBe(primary);

    expect(finalizeIntegrationFailure({ hasPrimary: false, primary: undefined, cleanupFailures: [] })).toBe(NO_INTEGRATION_FAILURE);

    const cleanupOnly = finalizeIntegrationFailure({ hasPrimary: false, primary: undefined, cleanupFailures: failures });
    expect(cleanupOnly).toBeInstanceOf(AggregateError);
    expect(cleanupOnly.errors).toEqual([cleanupOne, cleanupTwo]);
    expect(cleanupOnly.cleanupFailures).toBe(failures);
    expect(cleanupOnly.cleanupSteps).toEqual(['server', 'source']);
    expect(cleanupOnly.errors[0]).toBe(cleanupOne);
    expect(cleanupOnly.errors[0].cause.message).toBe('cleanup one cause');

    const combinedOne = finalizeIntegrationFailure({ hasPrimary: true, primary, cleanupFailures: [failures[0]] });
    expect(combinedOne.errors).toEqual([primary, cleanupOne]);
    expect(combinedOne.primaryFailure).toBe(primary);
    expect(combinedOne.cleanupFailures).toEqual([failures[0]]);

    const combined = finalizeIntegrationFailure({ hasPrimary: true, primary, cleanupFailures: failures });
    expect(combined).toBeInstanceOf(AggregateError);
    expect(combined.errors).toEqual([primary, cleanupOne, cleanupTwo]);
    expect(combined.errors[0]).toBe(primary);
    expect(combined.cause).toBe(primary);
    expect(combined.primaryFailure).toBe(primary);
    expect(combined.cleanupFailures).toBe(failures);
    expect(combined.errors[1].cause.message).toBe('cleanup one cause');

    const nonErrorPrimary = { marker: 'non-error primary value' };
    const combinedNonError = finalizeIntegrationFailure({ hasPrimary: true, primary: nonErrorPrimary, cleanupFailures: failures });
    expect(combinedNonError.errors).toEqual([nonErrorPrimary, cleanupOne, cleanupTwo]);
    expect(combinedNonError.cause).toBe(nonErrorPrimary);

    for (const falsyPrimary of [false, 0, '', null, undefined]) {
      expect(finalizeIntegrationFailure({ hasPrimary: true, primary: falsyPrimary, cleanupFailures: [] })).toBe(falsyPrimary);
      const combinedFalsy = finalizeIntegrationFailure({ hasPrimary: true, primary: falsyPrimary, cleanupFailures: failures });
      expect(combinedFalsy.errors).toEqual([falsyPrimary, cleanupOne, cleanupTwo]);
      expect(combinedFalsy.errors[0]).toBe(falsyPrimary);
      expect(combinedFalsy.cause).toBe(falsyPrimary);
      expect(combinedFalsy.primaryFailure).toBe(falsyPrimary);
    }
  });

  beforeAll(async () => {
    try {
      const source = parseDisposableDatabaseUrl(process.env.WEBINAR_TEST_DATABASE_URL);
      mysql = require('mysql2/promise');
      sourceConnection = await mysql.createConnection(source);
      disposableLifecycle = await createDisposableDatabase({
        lifecycle: createDisposableLifecycle(source.database),
        generateName: createDatabaseName,
        query: (...args) => sourceConnection.query(...args),
      });
      createdDatabase = disposableLifecycle.name;

      const target = { ...source, database: createdDatabase };
      const setup = await mysql.createConnection(target);
      try {
        await setup.query(`CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL DEFAULT 'user',
        is_active TINYINT(1) NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await applyMigration091(setup);
        await setup.query(
        `INSERT INTO users (email, name, role, is_active) VALUES
         ('webinar-owner@example.test', 'Webinar Owner', 'user', 1),
         ('webinar-admin@example.test', 'Webinar Admin', 'admin', 1),
         ('webinar-other@example.test', 'Webinar Other', 'user', 1)`,
        );
        const [users] = await setup.query('SELECT id, email, role FROM users ORDER BY id');
        [owner, admin, other] = users;
      } finally {
        await setup.end();
      }

      process.env.DB_HOST = target.host;
      process.env.DB_PORT = String(target.port);
      process.env.DB_USER = target.user;
      process.env.DB_PASSWORD = target.password;
      process.env.DB_NAME = createdDatabase;

      db = require('../../db/connection');
      ({ createMutationService } = require('../../services/webinars/mutations'));
      notes = require('../../services/webinars/notes');
      revisions = require('../../services/webinars/revisions');
      const { createApp } = require('../../server');
      const app = createApp({
        webinarAuthenticate(req, _res, next) {
          req.user = JSON.parse(req.get('x-test-user') || '{}');
          next();
        },
        webinarOperationalLogger: { info() {} },
        webinarWriteLimit: 100,
      });
      server = await new Promise(resolve => {
        const listener = app.listen(0, () => resolve(listener));
      });
    } catch (error) {
      primaryFailure = error;
      hasPrimaryFailure = true;
      throw error;
    }
  });

  afterAll(async () => {
    const failures = await cleanupDisposableResources({
      server,
      pool: db,
      lifecycle: disposableLifecycle,
      sourceConnection,
    });
    const finalFailure = finalizeIntegrationFailure({ hasPrimary: hasPrimaryFailure, primary: primaryFailure, cleanupFailures: failures });
    if (finalFailure !== NO_INTEGRATION_FAILURE) throw finalFailure;
  });

  it('uses the exact migration constraints and real private services without leaking state', async () => {
    try {
    const [foreignKeys] = await db.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       AND TABLE_NAME IN ('webinar_presentations', 'webinar_slides', 'webinar_revisions', 'webinar_presenter_settings', 'webinar_presenter_notes')`,
    );
    expect(foreignKeys.map(row => row.CONSTRAINT_NAME)).toEqual(expect.arrayContaining([
      'fk_webinar_owner', 'fk_webinar_slide_webinar', 'fk_webinar_revision_webinar',
      'fk_webinar_settings_user', 'fk_webinar_note_user',
    ]));
    const [uniqueIndexes] = await db.query(
      `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
       AND TABLE_NAME IN ('webinar_presentations', 'webinar_slides', 'webinar_revisions')`,
    );
    expect(uniqueIndexes.map(row => row.INDEX_NAME)).toEqual(expect.arrayContaining([
      'uq_webinar_slug', 'uq_webinar_slide_anchor', 'uq_webinar_slide_position',
      'uq_webinar_revision_version',
    ]));

    const mutations = require('../../services/webinars/mutations');
    webinar = await mutations.createWebinar({
      slug: 'integration-foundation',
      title: `Integration Foundation ${sensitiveCanaries.title}`,
      primaryOwnerUserId: owner.id,
      actorUserId: admin.id,
    });
    expect(webinar).toMatchObject({ liveVersion: 1, audienceEnabled: false, primaryOwnerUserId: owner.id });
    await expect(db.query(
      `INSERT INTO webinar_presentations
       (slug, title, primary_owner_user_id, master_html, master_css, created_by_user_id, updated_by_user_id)
       VALUES ('invalid-owner', 'Invalid owner', 999999, ?, '', ?, ?)`,
      ['<main>{{SLIDE_CONTENT}}</main>', owner.id, owner.id],
    )).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });
    const [createdRevision] = await db.query(
      'SELECT version FROM webinar_revisions WHERE webinar_id = ?', [webinar.webinarId],
    );
    expect(createdRevision).toEqual([{ version: 1 }]);

    expect((await request('GET', `/api/webinars/${webinar.webinarId}`, undefined, owner)).status).toBe(200);
    expect((await request('GET', `/api/webinars/${webinar.webinarId}`, undefined, admin)).status).toBe(200);
    expect((await request('GET', `/api/webinars/${webinar.webinarId}`, undefined, other)).status).toBe(403);

    const [slides] = await db.query(
      'SELECT id FROM webinar_slides WHERE webinar_id = ? AND archived_at IS NULL', [webinar.webinarId],
    );
    const stableSlideId = slides[0].id;
    const master = `<main data-private-canary="${sensitiveCanaries.masterHtml}">{{SLIDE_CONTENT}}</main>`;
    expect(await mutations.saveMaster({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 1,
      masterHtml: master, masterCss: `.${sensitiveCanaries.masterCss} { color: navy; }`,
    })).toMatchObject({ liveVersion: 2 });
    expect(await mutations.saveSlide({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 2, slideId: stableSlideId,
      anchor: 'opening', title: 'Opening', targetSeconds: 60, speakerNotes: sensitiveCanaries.speakerNotes,
      html: `<section data-private-canary="${sensitiveCanaries.slideHtml}">Welcome</section>`,
      css: `.${sensitiveCanaries.slideCss} { display: grid; }`,
      javascript: `const ${sensitiveCanaries.slideJavascript} = true;`,
    })).toMatchObject({ liveVersion: 3 });

    const beforeConflict = await captureWebinarMutationState(webinar.webinarId);
    await expect(mutations.saveMaster({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 2,
      masterHtml: master, masterCss: '.stale { color: red; }',
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    const afterConflict = await captureWebinarMutationState(webinar.webinarId);
    expect(afterConflict).toEqual(beforeConflict);

    const rollbackMutations = createMutationService({
      db,
      recordAuditEvent: async () => { throw new Error('injected audit write failure'); },
    });
    await expect(rollbackMutations.saveMaster({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 3,
      masterHtml: master, masterCss: '.rollback { color: black; }',
    })).rejects.toThrow('injected audit write failure');
    const afterRollback = await captureWebinarMutationState(webinar.webinarId);
    expect(afterRollback).toEqual(beforeConflict);

    expect(await mutations.archiveSlide({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 3, slideId: stableSlideId,
    })).toMatchObject({ liveVersion: 4 });
    const [archivedSlide] = await db.query(
      'SELECT id, archived_at, position FROM webinar_slides WHERE id = ?', [stableSlideId],
    );
    expect(archivedSlide[0]).toMatchObject({ id: stableSlideId, position: null });
    expect(archivedSlide[0].archived_at).not.toBeNull();
    const [revisionThree] = await db.query(
      'SELECT id FROM webinar_revisions WHERE webinar_id = ? AND version = 3', [webinar.webinarId],
    );
    expect(await mutations.restoreRevision({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 4, revisionId: revisionThree[0].id,
    })).toMatchObject({ liveVersion: 5 });
    const [restoredSlide] = await db.query(
      'SELECT id, archived_at FROM webinar_slides WHERE id = ?', [stableSlideId],
    );
    expect(restoredSlide[0]).toMatchObject({ id: stableSlideId, archived_at: null });

    const ownerNote = await notes.addNote({
      userId: owner.id, webinarId: webinar.webinarId, slideId: stableSlideId, body: sensitiveCanaries.note,
    });
    await db.query(`CREATE TABLE webinar_test_resource_policies (
      webinar_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      resource_policy JSON NOT NULL,
      CONSTRAINT fk_webinar_test_resource_policy_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(
      'INSERT INTO webinar_test_resource_policies (webinar_id, resource_policy) VALUES (?, ?)',
      [webinar.webinarId, JSON.stringify({ resourcePolicy: sensitiveCanaries.resourcePolicy })],
    );
    const [resourcePolicyRows] = await db.query(
      'SELECT resource_policy FROM webinar_test_resource_policies WHERE webinar_id = ?', [webinar.webinarId],
    );
    expect(JSON.stringify(resourcePolicyRows)).toContain(sensitiveCanaries.resourcePolicy);

    const history = await revisions.listHistory(webinar.webinarId);
    expect(history).toHaveLength(5);
    expect(history.map(item => item.version)).toEqual([5, 4, 3, 2, 1]);
    assertSafeHistoryContract(history, sensitiveCanaries);
    const ownerHistory = await request('GET', `/api/webinars/${webinar.webinarId}/history`, undefined, owner);
    expect(ownerHistory.status).toBe(200);
    assertSafeHistoryContract(ownerHistory.body, sensitiveCanaries);
    expect((await request('GET', `/api/webinars/${webinar.webinarId}/history`, undefined, other)).status).toBe(403);

    const [notesBeforeRejectedMutations] = await db.query(
      'SELECT * FROM webinar_presenter_notes WHERE webinar_id = ? ORDER BY id', [webinar.webinarId],
    );
    expect(await notes.listNotes({ userId: admin.id, webinarId: webinar.webinarId })).toEqual([]);
    expect((await request('GET', `/api/webinars/${webinar.webinarId}/notes`, undefined, admin)).body).toEqual([]);
    await expect(notes.updateNote({
      userId: admin.id, webinarId: webinar.webinarId, noteId: ownerNote.id, body: 'not allowed',
    })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await expect(notes.deleteNote({
      userId: admin.id, webinarId: webinar.webinarId, noteId: ownerNote.id,
    })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    const [notesAfterRejectedMutations] = await db.query(
      'SELECT * FROM webinar_presenter_notes WHERE webinar_id = ? ORDER BY id', [webinar.webinarId],
    );
    expect(jsonSnapshot(notesAfterRejectedMutations)).toEqual(jsonSnapshot(notesBeforeRejectedMutations));
    expect((await request('GET', `/api/webinars/${webinar.webinarId}/notes`, undefined, admin)).body).toEqual([]);
    expect(await notes.listNotes({ userId: owner.id, webinarId: webinar.webinarId })).toHaveLength(1);

    expect((await request('PUT', '/api/webinar-presenter-settings/me', {
      shortcuts: { nextSlide: 'ArrowRight' }, preferences: { theme: 'dark' },
    }, owner)).status).toBe(200);
    expect((await request('GET', '/api/webinar-presenter-settings/me', undefined, admin)).body)
      .toEqual({ shortcuts: {}, preferences: {} });
    const [settingsRows] = await db.query(
      'SELECT user_id FROM webinar_presenter_settings ORDER BY user_id',
    );
    expect(settingsRows).toEqual([{ user_id: owner.id }]);

    expect(await mutations.archiveWebinar({ webinarId: webinar.webinarId, actorUserId: admin.id }))
      .toMatchObject({ webinarId: webinar.webinarId });
    const [archivedWebinar] = await db.query(
      'SELECT id, archived_at FROM webinar_presentations WHERE id = ?', [webinar.webinarId],
    );
    const [survivingSlide] = await db.query(
      'SELECT id FROM webinar_slides WHERE id = ?', [stableSlideId],
    );
    expect(archivedWebinar[0].archived_at).not.toBeNull();
    expect(survivingSlide).toEqual([{ id: stableSlideId }]);
    } catch (error) {
      primaryFailure = error;
      hasPrimaryFailure = true;
      throw error;
    }
  });
});
