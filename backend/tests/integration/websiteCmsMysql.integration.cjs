/* global process, Buffer, structuredClone, __dirname, __filename */
// Standalone node:test. Requires an explicitly provisioned, empty loopback-only disposable schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const mysql = require('mysql2/promise');
const { createMysqlCmsRepository } = require('../../services/websiteCms/mysql');
const { createWebsiteCmsService } = require('../../services/websiteCms/service');
const { createLocalCmsAdapters } = require('../../services/websiteCms/local');
const fixture = require('../../contracts/website/v1/fixtures/published.json');

const actor = { id: 1, is_active: true };
const editor = { id: 2, is_active: true };
const options = () => ({
  host: '127.0.0.1', port: Number(process.env.MYSQL_CMS_TEST_PORT), database: 'msfg_cms_test',
  user: process.env.MYSQL_CMS_TEST_USER, password: process.env.MYSQL_CMS_TEST_PASSWORD,
});
function seed() {
  const snapshot = structuredClone(fixture);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const assets = {};
  for (const set of snapshot.media) for (const file of set.files) {
    const bytes = Buffer.from('synthetic ' + file.path);
    file.bytes = bytes.length;
    file.sha256 = hash(bytes);
    assets[file.path] = bytes;
  }
  const manifest = Buffer.from(JSON.stringify(snapshot));
  const pointer = { generation: 1, publicationId: snapshot.publicationId, manifestKey: 'publications/' + snapshot.publicationId + '/snapshot.json', sha256: hash(manifest), schemaVersion: 1, activatedAt: snapshot.createdAt };
  return { snapshot, pointer, manifest, assets };
}
function save(service, base, title) {
  return service.saveRevision({ actor: editor, entity: { kind: 'page', id: 'page-0' }, baseRevisionId: base.revisionId, content: { ...base.content, title } });
}
async function childSave() {
  const pool = mysql.createPool(options());
  try {
    const { directories, base, title } = JSON.parse(process.argv[3]);
    const { publicationStore } = await createLocalCmsAdapters(directories);
    const service = createWebsiteCmsService({ publicationStore, repository: createMysqlCmsRepository({ pool }) });
    try { process.stdout.write(JSON.stringify(await save(service, base, title))); }
    catch (error) { process.stdout.write(JSON.stringify({ code: error.code })); }
  } finally { await pool.end(); }
}
if (process.argv[2] === 'child-save') {
  childSave().catch(() => { process.exitCode = 1; });
} else test('durable MySQL editorial repository', { skip: !process.env.MYSQL_CMS_TEST_PORT }, async t => {
  const config = options();
  assert.ok(Number.isInteger(config.port) && config.port > 1024 && config.port < 65536);
  assert.ok(config.user, 'explicit disposable DB user required');
  const pool = mysql.createPool(config);
  t.after(() => pool.end());
  const [tables] = await pool.query('SHOW TABLES');
  assert.equal(tables.length, 0, 'integration requires an empty disposable schema');
  await pool.query('CREATE TABLE users (id INT PRIMARY KEY, is_active BOOLEAN NOT NULL) ENGINE=InnoDB');
  await pool.query('INSERT INTO users VALUES (1,1),(2,1),(3,0),(4,1)');
  const migration = (await Promise.all(['097_website_cms_editorial.sql', '098_website_cms_hero_library.sql', '099_website_cms_content_entities.sql'].map(name => readFile(join(__dirname, '../../db/migrations', name), 'utf8')))).join('\n');
  async function applyMigration() {
    for (const sql of migration.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(sql);
  }
  await applyMigration();
  await applyMigration();
  const root = await mkdtemp(join(tmpdir(), 'cms-mysql-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = { editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'published') };
  const initial = seed();
  const { publicationStore } = await createLocalCmsAdapters({ ...directories, seed: initial, grants: {} });
  const makeRepo = () => createMysqlCmsRepository({ pool });
  const repository = makeRepo();
  const service = createWebsiteCmsService({ repository, publicationStore });
  const get = () => service.getEntity({ actor: editor, kind: 'page', id: 'page-0' });
  const status = expected => error => error.status === expected;

  await t.test('explicit seed and first role manager, active targeted grants only', async () => {
    await assert.rejects(repository.transaction(() => {}), status(503));
    await repository.initialize(initial);
    await assert.rejects(repository.bootstrapRoleManager({ userId: 3 }), status(400));
    await assert.rejects(repository.bootstrapRoleManager({ userId: 9 }), status(400));
    await assert.rejects(repository.setGrants({ actor, userId: 1, capabilities: ['website.roles.manage'] }), status(403));
    await repository.bootstrapRoleManager({ userId: 1 });
    await assert.rejects(repository.bootstrapRoleManager({ userId: 2 }), status(409));
    await assert.rejects(service.listEntities({ actor }), status(403));
    await repository.setGrants({ actor, userId: 3, capabilities: [] });
    await assert.rejects(repository.setGrants({ actor, userId: 2, capabilities: ['website.admin'] }), status(400));
    await repository.setGrants({ actor, userId: 1, capabilities: ['website.publish','website.roles.manage'] });
    await repository.setGrants({ actor, userId: 2, capabilities: ['website.edit'] });
    await pool.query('UPDATE users SET is_active=0 WHERE id=2');
    await assert.rejects(get(), status(403));
    await pool.query('UPDATE users SET is_active=1 WHERE id=2');
    assert.ok((await get()).latest);
    await assert.rejects(repository.setGrants({ actor: editor, userId: 2, capabilities: ['website.publish'] }), status(403));
  });

  await t.test('case-sensitive revision keys preserve both variants', async () => {
    const ids = ['TestCase', 'testcase'];
    const writer = createWebsiteCmsService({ repository, publicationStore, makeId: () => ids.shift() });
    const first = await save(writer, (await get()).latest, 'Case variant A');
    const second = await save(writer, (await get()).latest, 'Case variant B');
    assert.equal(first.revisionId, 'revision-TestCase');
    assert.equal(second.revisionId, 'revision-testcase');
    const entity = await get();
    assert.equal(entity.latest.revisionId, second.revisionId);
    assert.ok(entity.revisions.some(r => r.revisionId === first.revisionId && r.content.title === 'Case variant A'));
    assert.ok(entity.revisions.some(r => r.revisionId === second.revisionId && r.content.title === 'Case variant B'));
  });

  await t.test('revokes inactive publisher grants permanently before account reactivation', async () => {
    const formerPublisher = { id: 4, is_active: true };
    await repository.setGrants({ actor, userId: 4, capabilities: ['website.publish'] });
    await pool.query('UPDATE users SET is_active=0 WHERE id=4');
    await assert.rejects(service.listEntities({ actor: formerPublisher }), status(403));
    await repository.setGrants({ actor, userId: 4, capabilities: [] });
    await pool.query('UPDATE users SET is_active=1 WHERE id=4');
    await assert.rejects(service.listEntities({ actor: formerPublisher }), status(403));
    const state = await repository.transaction(s => structuredClone(s));
    assert.ok(state.audit.some(entry => entry.userId === '4' && entry.prior?.includes('website.publish') && entry.capabilities.length === 0));
  });

  const original = (await get()).latest;
  await t.test('same-base cross-process edit has one winner and one conflict', async () => {
    const run = async title => JSON.parse((await promisify(execFile)(process.execPath, [__filename, 'child-save', JSON.stringify({ directories, base: original, title })])).stdout);
    const results = await Promise.all([run('Cross process A'), run('Cross process B')]);
    assert.equal(results.filter(r => r.revisionId).length, 1);
    assert.equal(results.filter(r => r.code === 'website_revision_conflict').length, 1);
  });

  const selected = (await get()).latest;
  const later = await save(service, selected, 'Retained newer draft');
  const request = { requestId: 'durable-publish', basePublicationId: initial.pointer.publicationId, selections: [{ kind: 'page', id: 'page-0', revisionId: selected.revisionId, action: 'replace' }] };
  await t.test('preserves pre-activation intent across recreation and publishes selected revision only', async () => {
    const interrupted = createWebsiteCmsService({ repository, publicationStore: { ...publicationStore, activate: async () => { throw Error('synthetic interruption'); } } });
    await assert.rejects(interrupted.publishSelection({ actor, request }), status(503));
    assert.equal((await publicationStore.readPointer()).generation, 1);
    const resumed = createWebsiteCmsService({ repository: makeRepo(), publicationStore });
    const pending = (await resumed.listEntities({ actor })).pendingPublication;
    assert.deepEqual(pending, request);
    const result = await resumed.publishSelection({ actor, request: pending });
    assert.equal(result.generation, 2);
    assert.deepEqual(await resumed.publishSelection({ actor, request }), result);
    const entity = await get();
    assert.equal(entity.published.revisionId, selected.revisionId);
    assert.equal(entity.latest.revisionId, later.revisionId);
  });

  await t.test('hero revisions survive recreation, reject races and preserve exact assigned copies', async () => {
    const heroCatalog = { entries: [{ id: 'hero-library-test', content: { name: 'Durable library hero', category: 'Seasonal', hero: { ...structuredClone(initial.snapshot.pages[0].heroVariants[0]), id: 'hero-library-test', active: false, headline: 'Original library content' } } }], media: initial.snapshot.media, assets: initial.assets };
    const create = () => createWebsiteCmsService({ repository: makeRepo(), publicationStore, heroCatalog });
    const library = create();
    assert.deepEqual(await library.initializeHeroLibrary(), { initialized: 1 });
    const first = await library.getHero({ actor: editor, id: 'hero-library-test' });
    const results = await Promise.allSettled([library, create()].map((writer, index) => writer.saveHeroRevision({ actor: editor, id: first.id, baseRevisionId: first.latest.revisionId, content: { ...first.latest.content, name: 'Concurrent hero ' + index } })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
    const resumed = create();
    assert.deepEqual(await resumed.initializeHeroLibrary(), { initialized: 0 });
    const restored = await resumed.getHero({ actor: editor, id: first.id });
    assert.equal(restored.revisions.length, 2);
    assert.deepEqual(restored.revisions[0].content, first.latest.content);
    const page = await resumed.getEntity({ actor: editor, kind: 'page', id: 'page-1' });
    const assignment = await resumed.assignHero({ actor: editor, id: 'page-1', baseRevisionId: page.latest.revisionId, slotId: page.latest.content.heroVariants[0].id, heroId: first.id, heroRevisionId: first.latest.revisionId, active: true });
    const assigned = await resumed.getEntity({ actor: editor, kind: 'page', id: 'page-1' });
    assert.equal(assigned.latest.revisionId, assignment.revisionId);
    assert.equal(assigned.latest.content.heroVariants[0].headline, 'Original library content');
    assert.equal((await publicationStore.readPointer()).generation, 2);
    await assert.rejects(makeRepo().transaction(state => { state.heroRevisions[0].content.name = 'Mutated'; }), status(409));
    await assert.rejects(makeRepo().transaction(state => { state.heroLatest.pop(); }), status(409));
    const before = await makeRepo().transaction(state => structuredClone(state));
    await applyMigration();
    assert.deepEqual(await makeRepo().transaction(state => structuredClone(state)), before);
  });

  await t.test('immutable history, independent grant management, failed transaction rollback and seed identity', async () => {
    const read = () => repository.transaction(state => structuredClone(state));
    const before = await read();
    await applyMigration();
    assert.deepEqual(await read(), before);
    await assert.rejects(repository.bootstrapRoleManager({ userId: 2 }), status(409));
    for (const change of [s => s.revisions.pop(), s => s.revisions[0].content.title = 'mutated', s => s.audit.shift(), s => s.requests[0].actorId = '2', s => s.grants.pop()]) {
      await assert.rejects(repository.transaction(s => change(s)), status(409));
    }
    await assert.rejects(repository.transaction(s => {
      s.revisions.push({ ...s.revisions[0], revisionId: 'synthetic-rolled-back' });
      s.audit.pop();
    }), status(409));
    await assert.rejects(repository.transaction(s => { s.audit.push({ action: 'uncommitted' }); throw Error('stop'); }), /stop/);
    await repository.initialize(initial);
    const other = structuredClone(initial.snapshot);
    other.pages[0].title = 'Conflicting bootstrap';
    await assert.rejects(repository.initialize({ snapshot: other }), status(409));
    assert.deepEqual(await read(), before);
    await repository.setGrants({ actor, userId: 2, capabilities: [] });
    await service.rollbackPublication({ actor, publicationId: initial.pointer.publicationId, requestId: 'durable-rollback', expectedGeneration: 2 });
    await assert.rejects(get(), status(403));
    const after = await makeRepo().transaction(s => structuredClone(s));
    assert.equal(after.requests.length, 2);
    assert.ok(after.audit.some(item => item.userId === '2' && item.prior?.includes('website.edit') && item.capabilities.length === 0));
    assert.equal(after.latest.find(r => r.id === 'page-0').revisionId, later.revisionId);
  });
  await t.test('site and officer selected revisions survive recreation with kind-scoped catalog heads', async () => {
    await repository.setGrants({ actor, userId: 2, capabilities: ['website.edit'] });
    for (const [kind, id] of [['site','site'], ['officer','officer-synthetic']]) {
      const before = await service.getEntity({ actor: editor, kind, id });
      const content = structuredClone(before.latest.content);
      if (kind === 'site') content.contact.email = 'durable@example.com'; else content.biography = 'Durable selected biography';
      const selected = await service.saveRevision({ actor: editor, entity: { kind, id }, baseRevisionId: before.latest.revisionId, content });
      const newer = structuredClone(content);
      if (kind === 'site') newer.contact.email = 'private@example.com'; else newer.biography = 'Private newer biography';
      await service.saveRevision({ actor: editor, entity: { kind, id }, baseRevisionId: selected.revisionId, content: newer });
      const resumed = createWebsiteCmsService({ repository: makeRepo(), publicationStore });
      const pointer = await publicationStore.readPointer();
      await resumed.publishSelection({ actor, request: { requestId: `publish-${kind}`, basePublicationId: pointer.publicationId, selections: [{ kind, id, revisionId: selected.revisionId, action: 'replace' }] } });
      const after = await resumed.getEntity({ actor: editor, kind, id });
      assert.deepEqual(after.published.content, content);
      assert.deepEqual(after.latest.content, newer);
    }
    const officer = { ...structuredClone(initial.snapshot.officers[0]), id: 'page-0', slug: 'catalog-officer' };
    const contentCatalog = { pages: [], officers: [officer], media: [], assets: {} };
    const create = () => createWebsiteCmsService({ repository: makeRepo(), publicationStore, contentCatalog });
    assert.deepEqual(await create().initializeContentCatalog(), { initialized: 1 });
    assert.deepEqual(await create().initializeContentCatalog(), { initialized: 0 });
    const draft = await create().getEntity({ actor: editor, kind: 'officer', id: 'page-0' });
    assert.equal(draft.published, null);
    assert.equal((await create().getEntity({ actor: editor, kind: 'page', id: 'page-0' })).latest.content.path, '/');
    const pointer = await publicationStore.readPointer();
    await create().publishSelection({ actor, request: { requestId: 'catalog-officer-publish', basePublicationId: pointer.publicationId, selections: [{ kind: 'officer', id: 'page-0', revisionId: draft.latest.revisionId, action: 'replace' }] } });
    assert.deepEqual((await create().getEntity({ actor: editor, kind: 'officer', id: 'page-0' })).published.content, officer);
    await assert.rejects(makeRepo().transaction(state => { state.revisions.find(row => row.entity.kind === 'site').content.contact.email = 'mutated@example.com'; }), status(409));
    await assert.rejects(makeRepo().transaction(state => { state.latest = state.latest.filter(row => row.kind !== 'officer'); }), status(409));
  });

});
