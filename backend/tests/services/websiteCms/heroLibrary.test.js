import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createWebsiteCmsService } = require('../../../services/websiteCms/service');
const { createLocalCmsAdapters } = require('../../../services/websiteCms/local');
const { hash } = require('../../../services/websiteCms/integrity');
const fixture = require('../../../contracts/website/v1/fixtures/published.json');
const actor = { id: 'publisher', is_active: true };
const editor = { id: 'editor', is_active: true };
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
function seed() {
  const snapshot = structuredClone(fixture); const assets = {};
  for (const set of snapshot.media) for (const file of set.files) {
    const bytes = Buffer.from(`synthetic ${file.path}`); assets[file.path] = bytes;
    file.bytes = bytes.length; file.sha256 = hash(bytes);
  }
  const manifest = Buffer.from(JSON.stringify(snapshot));
  return { snapshot, manifest, assets, pointer: { generation: 1, publicationId: snapshot.publicationId, manifestKey: `publications/${snapshot.publicationId}/snapshot.json`, sha256: hash(manifest), schemaVersion: 1, activatedAt: new Date().toISOString() } };
}
function catalog(initial) {
  const assets = {}; const media = [];
  for (const name of ['library-video', 'unused-video']) {
    media.push({ name, kind: 'hero-video', files: ['poster.jpg', '720p.mp4', '1080p-av1.mp4', '1080p.mp4'].map(file => {
      const path = `/heroes/${name}/${file}`; const bytes = Buffer.from(`synthetic library ${path}`); assets[path] = bytes;
      return { path, bytes: bytes.length, sha256: hash(bytes), contentType: file.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4' };
    }) });
  }
  const path = '/brand/library-triangle.svg'; const bytes = Buffer.from('<svg/>'); assets[path] = bytes;
  media.push({ name: 'library-triangle', kind: 'image', files: [{ path, bytes: bytes.length, sha256: hash(bytes), contentType: 'image/svg+xml' }] });
  const hero = { ...initial.snapshot.pages[0].heroVariants[0], id: 'library-one', active: false, headline: 'Original library headline', artworkAsset: path, media: { kind: 'video', name: 'library-video' }, primary: { label: 'Explore purchase', href: '/buy' }, secondary: { label: 'Our team', href: '/loan-officers' } };
  return { entries: [{ id: 'library-one', content: { name: 'Winter sample', category: 'Seasonal', hero } }], media, assets };
}
async function setup(configure = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'cms-hero-test-')); roots.push(root);
  const initial = seed(); const heroCatalog = catalog(initial);
  configure(initial.snapshot, heroCatalog);
  initial.manifest = Buffer.from(JSON.stringify(initial.snapshot));
  initial.pointer.sha256 = hash(initial.manifest);
  const config = { editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'published'), seed: initial, grants: { publisher: ['website.edit', 'website.publish'], editor: ['website.edit'], officer: ['website.profile.self'] } };
  const adapters = await createLocalCmsAdapters(config);
  const service = createWebsiteCmsService({ ...adapters, heroCatalog });
  return { root, config, initial, heroCatalog, adapters, service };
}
async function initialized() { const ctx = await setup(); await ctx.service.initializeHeroLibrary(); return ctx; }
async function assign(service, heroRevisionId, who = actor) {
  const page = await service.getEntity({ actor: who, kind: 'page', id: 'page-0' });
  return service.assignHero({ actor: who, id: 'page-0', baseRevisionId: page.latest.revisionId, slotId: page.latest.content.heroVariants[0].id, heroId: 'library-one', heroRevisionId, active: true });
}
function request(initial, revisionId) { return { requestId: 'publish-library-one', basePublicationId: initial.pointer.publicationId, selections: [{ kind: 'page', id: 'page-0', revisionId, action: 'replace' }] }; }

describe('private saved hero library', () => {
  it.each([{ label: 'Begin your journey', href: '/buy' }, { label: 'Talk with our team', href: '/contact' }])('derives private home preview defaults from current navigation: %j', async application => {
    const { service, adapters, initial } = await setup(snapshot => { snapshot.site.navigation.application = application; });
    const home = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    expect(home.previewDefaults).toEqual({ primary: application, secondary: { label: 'Explore Loan Options', href: '#services' } });
    expect(await service.getEntity({ actor, kind: 'page', id: 'page-5' })).not.toHaveProperty('previewDefaults');
    home.previewDefaults.primary.label = 'Local preview only';
    expect((await service.getEntity({ actor, kind: 'page', id: 'page-0' })).previewDefaults.primary).toEqual(application);
    expect(home.latest.content).not.toHaveProperty('previewDefaults');
    expect((await adapters.publicationStore.readCurrent()).snapshot).toEqual(initial.snapshot);
  });
  it.each([false, true])('validates library creatives independently of slot IDs and page order (product first: %s)', async productFirst => {
    const { service, adapters, initial } = await setup(snapshot => {
      const home = snapshot.pages.find(page => page.path === '/');
      // This valid page slot deliberately matches the separate library creative ID.
      home.heroVariants[1].id = 'library-one';
      if (productFirst) {
        const product = snapshot.pages.find(page => page.path === '/buy');
        product.heroVariants = [];
        snapshot.pages = [product, ...snapshot.pages.filter(page => page !== product)];
      }
    });
    expect(await service.initializeHeroLibrary()).toEqual({ initialized: 1 });
    const first = await service.getHero({ actor, id: 'library-one' });
    const content = structuredClone(first.latest.content);
    content.hero.headline = 'Saved with reordered pages';
    const saved = await service.saveHeroRevision({ actor, id: 'library-one', baseRevisionId: first.latest.revisionId, content });
    expect((await service.getHero({ actor, id: 'library-one' })).latest).toEqual({ revisionId: saved.revisionId, content });
    expect(content.hero.id).toBe('library-one');
    expect((await adapters.publicationStore.readCurrent()).snapshot).toEqual(initial.snapshot);
  });
  it('requires explicit initialization, survives restart, and never resets saved revisions', async () => {
    const { service, adapters, config, heroCatalog, initial } = await setup();
    expect((await service.listHeroes({ actor })).heroes).toHaveLength(0);
    expect(await service.initializeHeroLibrary()).toEqual({ initialized: 1 });
    const first = await service.getHero({ actor, id: 'library-one' });
    const content = structuredClone(first.latest.content); content.hero.headline = 'Saved centrally';
    const saved = await service.saveHeroRevision({ actor, id: 'library-one', baseRevisionId: first.latest.revisionId, content });
    const reopened = createWebsiteCmsService({ ...await createLocalCmsAdapters(config), heroCatalog });
    expect(await reopened.initializeHeroLibrary()).toEqual({ initialized: 0 });
    const result = await reopened.getHero({ actor, id: 'library-one' });
    expect(result.latest).toEqual({ revisionId: saved.revisionId, content });
    expect(result.revisions[0].content.hero.headline).toBe('Original library headline');
    expect((await adapters.publicationStore.readCurrent()).snapshot).toEqual(initial.snapshot);
  });
  it.each([undefined, { id: 'publisher', is_active: false }, { id: 'officer', is_active: true }, { id: 'ungranted', is_active: true, role: 'admin' }])('denies untrusted actors %j', async who => {
    const { service } = await initialized();
    await expect(service.listHeroes({ actor: who })).rejects.toMatchObject({ status: who ? 403 : 401 });
    await expect(service.getHero({ actor: who, id: 'library-one' })).rejects.toMatchObject({ status: who ? 403 : 401 });
  });
  it('retains immutable revisions and allows only one same-base writer', async () => {
    const { service, adapters, heroCatalog } = await initialized();
    const first = await service.getHero({ actor, id: 'library-one' });
    const second = createWebsiteCmsService({ ...adapters, heroCatalog });
    const attempts = await Promise.allSettled([service, second].map((target, i) => target.saveHeroRevision({ actor, id: 'library-one', baseRevisionId: first.latest.revisionId, content: { ...first.latest.content, name: `Writer ${i}` } })));
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(item => item.status === 'rejected').reason.status).toBe(409);
    const result = await service.getHero({ actor, id: 'library-one' });
    expect(result.revisions).toHaveLength(2); expect(result.revisions[0]).toEqual(first.revisions[0]);
  });
  it('rejects undeclared/private fields, invalid links, foreign artwork and activation in the library', async () => {
    const { service } = await initialized();
    const first = await service.getHero({ actor, id: 'library-one' });
    for (const change of [c => { c.privateNotes = 'private'; }, c => { c.hero.privateNotes = 'private'; }, c => { c.hero.primary.href = 'javascript:alert(1)'; }, c => { c.hero.artworkAsset = '/brand/not-declared.svg'; }, c => { c.hero.active = true; }, c => { c.name = ''; }]) {
      const content = structuredClone(first.latest.content); change(content);
      await expect(service.saveHeroRevision({ actor, id: 'library-one', baseRevisionId: first.latest.revisionId, content })).rejects.toMatchObject({ status: 422 });
    }
    await expect(service.saveHeroRevision({ actor, id: 'unknown', baseRevisionId: first.latest.revisionId, content: first.latest.content })).rejects.toMatchObject({ status: 404 });
  });
  it('copies an exact saved library revision into an existing slot and publishes no other draft', async () => {
    const { service, adapters, initial } = await initialized();
    const original = await service.getHero({ actor, id: 'library-one' });
    const newer = structuredClone(original.latest.content); newer.hero.headline = 'A newer library draft';
    await service.saveHeroRevision({ actor, id: 'library-one', baseRevisionId: original.latest.revisionId, content: newer });
    const saved = await assign(service, original.latest.revisionId);
    expect((await adapters.publicationStore.readPointer()).generation).toBe(1);
    const page = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    expect(page.latest.content.heroVariants[0]).toEqual({ ...original.latest.content.hero, id: initial.snapshot.pages[0].heroVariants[0].id, active: true });
    const unsaved = structuredClone(page.latest.content); unsaved.heroVariants[0].headline = 'A newer page draft';
    await service.saveRevision({ actor, entity: page.entity, baseRevisionId: saved.revisionId, content: unsaved });
    await service.publishSelection({ actor, request: request(initial, saved.revisionId) });
    const published = await adapters.publicationStore.readCurrent();
    expect(published.snapshot.pages[0].heroVariants[0].headline).toBe('Original library headline');
    expect(published.snapshot.pages[0].heroVariants).toHaveLength(5);
    expect(published.snapshot.pages[1]).toEqual(initial.snapshot.pages[1]);
    expect(published.snapshot.media.some(set => set.name === 'library-video')).toBe(true);
    expect(published.snapshot.media.some(set => set.name === 'unused-video')).toBe(false);
    expect(JSON.stringify(published.snapshot)).not.toMatch(/Winter sample|A newer library draft|A newer page draft|createdBy/);
    expect(published.assets['/brand/library-triangle.svg'].toString()).toBe('<svg/>');
  });
  it('rejects missing slots/revisions and stale page assignments', async () => {
    const { service } = await initialized();
    const hero = await service.getHero({ actor, id: 'library-one' });
    const page = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    const input = { actor, id: 'page-0', baseRevisionId: page.latest.revisionId, slotId: page.latest.content.heroVariants[0].id, heroId: 'library-one', heroRevisionId: hero.latest.revisionId, active: true };
    await expect(service.assignHero({ ...input, slotId: 'new-slot' })).rejects.toMatchObject({ status: 404 });
    await expect(service.assignHero({ ...input, heroRevisionId: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(service.assignHero({ ...input, active: 'true' })).rejects.toMatchObject({ status: 400 });
    await service.assignHero(input);
    await expect(service.assignHero(input)).rejects.toMatchObject({ status: 409 });
  });
  it('lets an editor save and assign but not publish', async () => {
    const { service, initial } = await initialized(); const hero = await service.getHero({ actor: editor, id: 'library-one' });
    const saved = await assign(service, hero.latest.revisionId, editor);
    await expect(service.publishSelection({ actor: editor, request: request(initial, saved.revisionId) })).rejects.toMatchObject({ status: 403 });
  });
  it('rejects corrupt catalog bytes and does not activate a failed media publication', async () => {
    const { service, adapters, initial, heroCatalog } = await initialized();
    const corrupt = { ...heroCatalog, assets: { ...heroCatalog.assets, '/brand/library-triangle.svg': Buffer.from('bad') } };
    expect(() => createWebsiteCmsService({ ...adapters, heroCatalog: corrupt })).toThrow();
    const hero = await service.getHero({ actor, id: 'library-one' }); const saved = await assign(service, hero.latest.revisionId);
    const failing = createWebsiteCmsService({ ...adapters, heroCatalog, publicationStore: { ...adapters.publicationStore, writeCandidate: async () => { throw Error('failed asset upload'); } } });
    await expect(failing.publishSelection({ actor, request: request(initial, saved.revisionId) })).rejects.toMatchObject({ status: 503 });
    expect(await adapters.publicationStore.readPointer()).toEqual(initial.pointer);
  });
});
