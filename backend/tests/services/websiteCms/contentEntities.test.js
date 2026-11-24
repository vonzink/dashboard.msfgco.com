import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createWebsiteCmsService } = require('../../../services/websiteCms/service');
const { createLocalCmsAdapters } = require('../../../services/websiteCms/local');
const fixture = require('../../../contracts/website/v1/fixtures/published.json');
const actor = { id: 'publisher', is_active: true };
const roots = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function setup(catalog) {
  const root = await mkdtemp(join(tmpdir(), 'cms-content-test-')); roots.push(root);
  const snapshot = structuredClone(fixture), assets = {};
  for (const set of snapshot.media) for (const file of set.files) {
    const bytes = Buffer.from(`synthetic ${file.path}`); assets[file.path] = bytes; file.bytes = bytes.length; file.sha256 = hash(bytes);
  }
  const manifest = Buffer.from(JSON.stringify(snapshot));
  const seed = { snapshot, manifest, assets, pointer: { generation: 1, publicationId: snapshot.publicationId, manifestKey: `publications/${snapshot.publicationId}/snapshot.json`, sha256: hash(manifest), schemaVersion: 1, activatedAt: snapshot.createdAt } };
  const adapters = await createLocalCmsAdapters({ editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'published'), seed, grants: { publisher: ['website.edit', 'website.publish'], editor: ['website.edit'], officer: ['website.profile.self'] } });
  return { root, snapshot, adapters, service: createWebsiteCmsService({ ...adapters, contentCatalog: catalog }) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function save(service, kind, id, change) {
  const detail = await service.getEntity({ actor, kind, id }); const content = structuredClone(detail.latest.content); change(content);
  return service.saveRevision({ actor, entity: { kind, id }, baseRevisionId: detail.latest.revisionId, content });
}
async function publish(service, adapters, kind, id, revisionId, requestId = 'request-content') {
  const pointer = await adapters.publicationStore.readPointer();
  return service.publishSelection({ actor, request: { requestId, basePublicationId: pointer.publicationId, selections: [{ kind, id, revisionId, action: 'replace' }] } });
}
describe('page, officer and site content revisions', () => {
  it('lists all supported entities while retaining page default and deny-by-default grants', async () => {
    const { service } = await setup();
    expect((await service.listEntities({ actor })).entities.every(row => row.kind === 'page')).toBe(true);
    expect((await service.listEntities({ actor, kind: 'all' })).entities.map(row => row.kind)).toEqual(expect.arrayContaining(['page', 'site', 'officer']));
    await expect(service.listEntities({ actor: { id: 'officer', is_active: true }, kind: 'all' })).rejects.toMatchObject({ status: 403 });
  });
  it.each([['site', 'site', content => { content.contact.email = 'published@example.com'; }], ['officer', 'officer-synthetic', content => { content.biography = 'Chosen officer biography'; }]])('publishes exact selected %s revision without leaking newer drafts', async (kind, id, change) => {
    const { service, adapters } = await setup();
    const chosen = await save(service, kind, id, change);
    await save(service, kind, id, content => { if (kind === 'site') content.contact.email = 'unselected@example.com'; else content.biography = 'Unselected later biography'; });
    const input = { actor, request: { requestId: 'same-request', basePublicationId: (await adapters.publicationStore.readPointer()).publicationId, selections: [{ kind, id, revisionId: chosen.revisionId, action: 'replace' }] } };
    const result = await service.publishSelection(input);
    expect(await service.publishSelection(input)).toEqual(result);
    const bundle = await adapters.publicationStore.readCurrent();
    const content = kind === 'site' ? bundle.snapshot.site : bundle.snapshot.officers[0];
    expect(kind === 'site' ? content.contact.email : content.biography).toBe(kind === 'site' ? 'published@example.com' : 'Chosen officer biography');
    expect(JSON.stringify(bundle.snapshot)).not.toContain('unselected');
    expect(bundle.snapshot.calculatorCompatibility).toEqual(fixture.calculatorCompatibility);
  });
  it('rejects protected fields, topology changes, private data and malformed FAQ answers', async () => {
    const { service } = await setup();
    await expect(save(service, 'site', 'site', content => { content.navigation.application.href = '/other'; })).rejects.toMatchObject({ status: 422 });
    await expect(save(service, 'site', 'site', content => { content.company.legalName = 'Changed'; })).rejects.toMatchObject({ status: 422 });
    await expect(save(service, 'officer', 'officer-synthetic', content => { content.slug = 'changed'; })).rejects.toMatchObject({ status: 422 });
    await expect(save(service, 'officer', 'officer-synthetic', content => { content.suiteUserId = 'private'; })).rejects.toMatchObject({ status: 422 });
    await expect(save(service, 'page', 'page-0', content => { content.sections.reverse(); })).rejects.toMatchObject({ status: 422 });
    await expect(save(service, 'page', 'page-0', content => { content.sections.find(row => row.type === 'faq').items[0].answer = '<script>bad</script>'; })).rejects.toMatchObject({ status: 422 });
  });
  it('persists nested FAQ and card content while preserving the approved section layout', async () => {
    const { service, adapters } = await setup();
    const revision = await save(service, 'page', 'page-0', content => {
      content.sections.find(row => row.type === 'faq').items.push({ question: 'New question?', answer: [{ type: 'paragraph', content: [{ type: 'text', text: 'A reviewed answer.' }] }] });
      content.sections.find(row => row.type === 'service-cards').cards[0].description = 'Updated card copy.';
    });
    await publish(service, adapters, 'page', 'page-0', revision.revisionId);
    const home = (await adapters.publicationStore.readCurrent()).snapshot.pages[0];
    expect(home.sections.find(row => row.type === 'faq').items.at(-1).question).toBe('New question?');
    expect(home.sections.find(row => row.type === 'service-cards').cards[0].description).toBe('Updated card copy.');
  });
  it('requires current bases and publication grants for new entity kinds', async () => {
    const { service, adapters } = await setup();
    const detail = await service.getEntity({ actor, kind: 'site', id: 'site' });
    const saved = await save(service, 'site', 'site', content => { content.legal.address = 'Updated public address'; });
    await expect(service.saveRevision({ actor, entity: { kind: 'site', id: 'site' }, baseRevisionId: detail.latest.revisionId, content: detail.latest.content })).rejects.toMatchObject({ status: 409 });
    const pointer = await adapters.publicationStore.readPointer();
    await expect(service.publishSelection({ actor: { id: 'editor', is_active: true }, request: { requestId: 'no-grant', basePublicationId: pointer.publicationId, selections: [{ kind: 'site', id: 'site', revisionId: saved.revisionId, action: 'replace' }] } })).rejects.toMatchObject({ status: 403 });
  });
  it('seeds trusted missing drafts without activation or overwriting saved content and scopes heads by kind', async () => {
    const officer = { ...structuredClone(fixture.officers[0]), id: 'page-0', slug: 'new-officer', biography: 'Private catalog biography' };
    const catalog = { pages: [], officers: [officer], media: [], assets: {} };
    const { service, adapters } = await setup(catalog);
    const initial = await adapters.publicationStore.readPointer();
    expect(await service.initializeContentCatalog()).toEqual({ initialized: 1 });
    expect((await service.getEntity({ actor, kind: 'officer', id: 'page-0' })).published).toBeNull();
    expect((await service.getEntity({ actor, kind: 'page', id: 'page-0' })).latest.content.path).toBe('/');
    const saved = await save(service, 'officer', 'page-0', content => { content.biography = 'Saved editorial biography'; });
    expect(await service.initializeContentCatalog()).toEqual({ initialized: 0 });
    expect((await service.getEntity({ actor, kind: 'officer', id: 'page-0' })).latest.revisionId).toBe(saved.revisionId);
    expect(await adapters.publicationStore.readPointer()).toEqual(initial);
    expect(JSON.stringify((await adapters.publicationStore.readCurrent()).snapshot)).not.toContain('Saved editorial');
    await publish(service, adapters, 'officer', 'page-0', saved.revisionId);
    expect((await adapters.publicationStore.readCurrent()).snapshot.officers.find(row => row.id === 'page-0').biography).toBe('Saved editorial biography');
  });
  it('imports vetted page copy into a draft while retaining chosen heroes and rejecting stale imports', async () => {
    const page = structuredClone(fixture.pages[0]); page.title = 'Reviewed page title'; page.sections[0].heading = 'Reviewed section heading';
    const { service, adapters } = await setup({ pages: [page], officers: [], media: [], assets: {} });
    await service.initializeContentCatalog();
    await save(service, 'page', 'page-0', content => { content.heroVariants[0].headline = 'Keep this chosen hero'; });
    const before = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    expect(before.hasContentImport).toBe(true);
    const imported = await service.importPageContent({ actor, id: 'page-0', baseRevisionId: before.latest.revisionId });
    const after = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    expect(after.latest.content.title).toBe(page.title);
    expect(after.latest.content.heroVariants).toEqual(before.latest.content.heroVariants);
    expect(after.latest.content.sections).toEqual(page.sections);
    expect(after.published).toEqual(before.published);
    expect((await adapters.publicationStore.readPointer()).generation).toBe(1);
    await expect(service.importPageContent({ actor, id: 'page-0', baseRevisionId: before.latest.revisionId })).rejects.toMatchObject({ status: 409 });
    expect(imported.revisionId).toBe(after.latest.revisionId);
  });
  it('publishes catalog photo bytes only with a selected entity and rejects tampered assets', async () => {
    const path = '/media/new-officer/photo.jpg', bytes = Buffer.from('prepared photo');
    const file = { path, bytes: bytes.length, sha256: hash(bytes), contentType: 'image/jpeg' };
    const catalog = { pages: [], officers: [{ ...structuredClone(fixture.officers[0]), id: 'new-officer', slug: 'new-officer', photoAsset: path }], media: [{ name: 'new-officer', kind: 'image', files: [file] }], assets: { [path]: bytes } };
    const { service, adapters } = await setup(catalog);
    await service.initializeContentCatalog();
    const detail = await service.getEntity({ actor, kind: 'officer', id: 'new-officer' });
    expect(detail.photoAssets).toContain(path);
    expect((await adapters.publicationStore.readCurrent()).assets[path]).toBeUndefined();
    await publish(service, adapters, 'officer', 'new-officer', detail.latest.revisionId);
    expect((await adapters.publicationStore.readCurrent()).assets[path]).toEqual(bytes);
    expect(() => createWebsiteCmsService({ ...adapters, contentCatalog: { ...catalog, assets: { [path]: Buffer.from('corrupt') } } })).toThrow();
  });
});
