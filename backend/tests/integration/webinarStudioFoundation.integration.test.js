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

describeWithMysql('webinar studio foundation', () => {
  beforeAll(async () => {
    const source = parseDisposableDatabaseUrl(process.env.WEBINAR_TEST_DATABASE_URL);
    mysql = require('mysql2/promise');
    sourceConnection = await mysql.createConnection(source);
    createdDatabase = createDatabaseName();
    await sourceConnection.query(`CREATE DATABASE \`${createdDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

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
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
    if (sourceConnection && createdDatabase && identifier.test(createdDatabase)) {
      await sourceConnection.query(`DROP DATABASE IF EXISTS \`${createdDatabase}\``);
    }
    if (sourceConnection) await sourceConnection.end();
  });

  it('uses the exact migration constraints and real private services without leaking state', async () => {
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
      title: 'Integration Foundation',
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
    const master = '<main>{{SLIDE_CONTENT}}</main>';
    expect(await mutations.saveMaster({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 1,
      masterHtml: master, masterCss: '.frame { color: navy; }',
    })).toMatchObject({ liveVersion: 2 });
    expect(await mutations.saveSlide({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 2, slideId: stableSlideId,
      anchor: 'opening', title: 'Opening', targetSeconds: 60, speakerNotes: 'Shared presenter note',
      html: '<section>Welcome</section>', css: '.slide { display: grid; }', javascript: 'const ready = true;',
    })).toMatchObject({ liveVersion: 3 });

    const [beforeConflict] = await db.query(
      'SELECT live_version, master_css FROM webinar_presentations WHERE id = ?', [webinar.webinarId],
    );
    const [revisionCountBeforeConflict] = await db.query(
      'SELECT COUNT(*) AS count FROM webinar_revisions WHERE webinar_id = ?', [webinar.webinarId],
    );
    await expect(mutations.saveMaster({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 2,
      masterHtml: master, masterCss: '.stale { color: red; }',
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    const [afterConflict] = await db.query(
      'SELECT live_version, master_css FROM webinar_presentations WHERE id = ?', [webinar.webinarId],
    );
    const [revisionCountAfterConflict] = await db.query(
      'SELECT COUNT(*) AS count FROM webinar_revisions WHERE webinar_id = ?', [webinar.webinarId],
    );
    expect(afterConflict).toEqual(beforeConflict);
    expect(revisionCountAfterConflict).toEqual(revisionCountBeforeConflict);

    const rollbackMutations = createMutationService({
      db,
      recordAuditEvent: async () => { throw new Error('injected audit write failure'); },
    });
    await expect(rollbackMutations.saveMaster({
      webinarId: webinar.webinarId, actorUserId: owner.id, expectedVersion: 3,
      masterHtml: master, masterCss: '.rollback { color: black; }',
    })).rejects.toThrow('injected audit write failure');
    const [afterRollback] = await db.query(
      'SELECT live_version, master_css FROM webinar_presentations WHERE id = ?', [webinar.webinarId],
    );
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

    const history = await revisions.listHistory(webinar.webinarId);
    expect(history).toHaveLength(5);
    expect(history.map(item => item.version)).toEqual([5, 4, 3, 2, 1]);
    expect(history.every(item => !Object.hasOwn(item, 'snapshot') && !Object.hasOwn(item, 'html'))).toBe(true);
    const ownerHistory = await request('GET', `/api/webinars/${webinar.webinarId}/history`, undefined, owner);
    expect(ownerHistory.status).toBe(200);
    expect(JSON.stringify(ownerHistory.body)).not.toContain('Welcome');
    expect((await request('GET', `/api/webinars/${webinar.webinarId}/history`, undefined, other)).status).toBe(403);

    const ownerNote = await notes.addNote({
      userId: owner.id, webinarId: webinar.webinarId, slideId: stableSlideId, body: 'Owner private note',
    });
    expect(await notes.listNotes({ userId: admin.id, webinarId: webinar.webinarId })).toEqual([]);
    await expect(notes.updateNote({
      userId: admin.id, webinarId: webinar.webinarId, noteId: ownerNote.id, body: 'not allowed',
    })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
    await expect(notes.deleteNote({
      userId: admin.id, webinarId: webinar.webinarId, noteId: ownerNote.id,
    })).rejects.toMatchObject({ code: 'NOTE_NOT_FOUND' });
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
  });
});
