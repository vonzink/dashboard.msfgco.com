import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const { createWebsiteCmsService } = require('../../../services/websiteCms/service');
const { createLocalCmsAdapters } = require('../../../services/websiteCms/local');
const fixture = require('../../../contracts/website/v1/fixtures/published.json');
const roots = [];
const actor = { id: 'publisher', is_active: true };
function seed() {
  const snapshot = structuredClone(fixture); const assets = {};
  for (const set of snapshot.media) for (const file of set.files) {
    const bytes = Buffer.from(`synthetic ${file.path}`); assets[file.path] = bytes;
    file.bytes = bytes.length; file.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  const manifest = Buffer.from(JSON.stringify(snapshot));
  return { snapshot, manifest, assets, pointer: { generation: 1, publicationId: snapshot.publicationId, manifestKey: `publications/${snapshot.publicationId}/snapshot.json`, sha256: createHash('sha256').update(manifest).digest('hex'), schemaVersion: 1, activatedAt: new Date().toISOString() } };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'cms-producer-test-')); roots.push(root);
  const initial = seed();
  const adapters = await createLocalCmsAdapters({ editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'published'), seed: initial, grants: { publisher: ['website.edit', 'website.publish'], editor: ['website.edit'], officer: ['website.profile.self'] } });
  return { root, initial, adapters, service: createWebsiteCmsService(adapters) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function draft(service, change, id = 'page-0', who = actor) {
  const current = await service.getEntity({ actor: who, kind: 'page', id });
  const content = structuredClone(current.latest.content); change(content);
  return service.saveRevision({ actor: who, entity: { kind: 'page', id }, baseRevisionId: current.latest.revisionId, content });
}
function request(initial, revisionId, requestId = 'request-one', id = 'page-0') { return { requestId, basePublicationId: initial.pointer.publicationId, selections: [{ kind: 'page', id, revisionId, action: 'replace' }] }; }

describe('local website publishing boundaries', () => {
  it.each([undefined, { id: 'publisher', is_active: false }, { id: 'missing', is_active: true }, { id: 'officer', is_active: true }, { id: 'missing', is_active: true, role: 'admin', capabilities: ['website.edit'] }])('denies unmapped, inactive and ungranted actors: %j', async who => {
    const { service } = await setup(); await expect(service.listEntities({ actor: who })).rejects.toMatchObject({ status: who ? 403 : 401 });
  });
  it('stores immutable drafts, rejects stale bases and never accepts private fields', async () => {
    const { service } = await setup();
    const old = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    const first = await draft(service, page => { page.title = 'Reviewed new title'; });
    expect(first.revisionId).not.toBe(old.latest.revisionId);
    await expect(service.saveRevision({ actor, entity: { kind: 'page', id: 'page-0' }, baseRevisionId: old.latest.revisionId, content: old.latest.content })).rejects.toMatchObject({ status: 409 });
    const current = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    expect(current.published).toEqual(old.published);
    expect(current.revisions.find(item => item.revisionId === old.latest.revisionId).content).toEqual(old.latest.content);
    await expect(draft(service, page => { page.suiteUserId = 'private'; })).rejects.toMatchObject({ status: 422 });
    await expect(service.getEntity({ actor, kind: 'testimonial', id: 'testimonial-synthetic' })).rejects.toMatchObject({ status: 400 });
  });
  it('publishes selected exact revision while later hero and another page remain draft', async () => {
    const { service, initial, adapters } = await setup();
    const text = await draft(service, page => { page.sections[0].heading = 'Selected published title'; });
    await draft(service, page => { page.heroVariants[0].headline = 'Unpublished holiday edit'; });
    await draft(service, page => { page.title = 'Another unselected page'; }, 'page-1');
    const published = await service.publishSelection({ actor, request: request(initial, text.revisionId) });
    expect(published).toMatchObject({ status: 'active', generation: 2 });
    const bundle = await adapters.publicationStore.readCurrent();
    expect(bundle.snapshot.pages[0].sections[0].heading).toBe('Selected published title');
    expect(bundle.snapshot.pages[0].heroVariants[0].headline).toBe(initial.snapshot.pages[0].heroVariants[0].headline);
    expect(bundle.snapshot.pages[1]).toEqual(initial.snapshot.pages[1]);
    expect(bundle.snapshot.revisions).toContainEqual(initial.snapshot.revisions.find(item => item.entity.kind === 'page' && item.entity.id === 'page-1'));
    expect(JSON.stringify(bundle.snapshot)).not.toContain('Unpublished holiday edit');
  });
  it('requires publish grant even when the actor saved their own draft', async () => {
    const { service, initial } = await setup(); const editor = { id: 'editor', is_active: true };
    const revision = await draft(service, page => { page.title = 'Editor draft'; }, 'page-0', editor);
    await expect(service.publishSelection({ actor: editor, request: request(initial, revision.revisionId) })).rejects.toMatchObject({ status: 403 });
  });
  it('serializes independent instances and permits only one winner for the same base', async () => {
    const { service, initial, adapters } = await setup();
    const revision = await draft(service, page => { page.title = 'One winner'; });
    const second = createWebsiteCmsService(adapters);
    const results = await Promise.allSettled([service.publishSelection({ actor, request: request(initial, revision.revisionId, 'race-a') }), second.publishSelection({ actor, request: request(initial, revision.revisionId, 'race-b') })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason.status).toBe(409);
  });
  it('serializes two separate Node processes against the same editorial authority', async () => {
    const { service, initial, root } = await setup();
    const revision = await draft(service, page => { page.title = 'Cross-process winner'; });
    const script = `const {createLocalCmsAdapters}=require('./services/websiteCms/local');const {createWebsiteCmsService}=require('./services/websiteCms/service');(async()=>{const adapters=await createLocalCmsAdapters(JSON.parse(process.argv[1]));try{const value=await createWebsiteCmsService(adapters).publishSelection({actor:{id:'publisher',is_active:true},request:JSON.parse(process.argv[2])});process.stdout.write(JSON.stringify({ok:true,value}));}catch(error){process.stdout.write(JSON.stringify({ok:false,status:error.status}));}})().catch(()=>process.exitCode=1);`;
    const directories = JSON.stringify({ editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'published') });
    const results = await Promise.all(['process-a', 'process-b'].map(requestId => promisify(execFile)(process.execPath, ['-e', script, directories, JSON.stringify(request(initial, revision.revisionId, requestId))], { cwd: process.cwd() })));
    const outcomes = results.map(result => JSON.parse(result.stdout));
    expect(outcomes.filter(result => result.ok)).toHaveLength(1);
    expect(outcomes.find(result => !result.ok).status).toBe(409);
  });
  it('does not activate after a candidate write failure', async () => {
    const { service, initial, adapters } = await setup();
    const revision = await draft(service, page => { page.title = 'Incomplete candidate'; });
    const failing = createWebsiteCmsService({ ...adapters, publicationStore: { ...adapters.publicationStore, writeCandidate: async () => { throw Error('storage failed'); } } });
    await expect(failing.publishSelection({ actor, request: request(initial, revision.revisionId) })).rejects.toMatchObject({ status: 503 });
    expect(await adapters.publicationStore.readPointer()).toEqual(initial.pointer);
  });
  it('reconciles a lost response after activation and rejects request-ID reuse', async () => {
    const { service, initial, adapters } = await setup(); const revision = await draft(service, page => { page.title = 'Exactly once'; });
    let fail = true;
    const unreliable = createWebsiteCmsService({ ...adapters, publicationStore: { ...adapters.publicationStore, activate: async (...args) => { const result = await adapters.publicationStore.activate(...args); if (fail) { fail = false; throw Error('lost response'); } return result; } } });
    const input = request(initial, revision.revisionId);
    await expect(unreliable.publishSelection({ actor, request: input })).rejects.toMatchObject({ status: 503 });
    const retry = await service.publishSelection({ actor, request: input });
    expect(retry.generation).toBe(2);
    expect(await service.publishSelection({ actor, request: input })).toEqual(retry);
    await expect(service.publishSelection({ actor, request: { ...input, selections: [] } })).rejects.toMatchObject({ status: 400 });
    await expect(service.publishSelection({ actor, request: { ...input, basePublicationId: retry.publicationId } })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects corrupt assets without moving the pointer and rollback keeps revocations untouched', async () => {
    const { service, initial, adapters, root } = await setup(); const revision = await draft(service, page => { page.title = 'Rollback me'; });
    const published = await service.publishSelection({ actor, request: request(initial, revision.revisionId) });
    const { writeFile } = await import('node:fs/promises');
    const revoked = JSON.stringify({ version: 8, revokedOfficerIds: ['officer-synthetic'] });
    await writeFile(join(root, 'published/revocations.json'), revoked);
    const result = await service.rollbackPublication({ actor, publicationId: initial.pointer.publicationId, requestId: 'rollback-one', expectedGeneration: published.generation });
    expect(result).toMatchObject({ publicationId: initial.pointer.publicationId, generation: 3, status: 'active' });
    expect(await readFile(join(root, 'published/revocations.json'), 'utf8')).toBe(revoked);
    const asset = initial.snapshot.media[0].files[0].path;
    await writeFile(join(root, 'published', asset), 'corrupt');
    await expect(service.rollbackPublication({ actor, publicationId: published.publicationId, requestId: 'rollback-bad', expectedGeneration: 3 })).rejects.toMatchObject({ status: 422 });
    expect((await adapters.publicationStore.readPointer()).generation).toBe(3);
  });
});
