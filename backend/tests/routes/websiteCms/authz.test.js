import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const express = require('express');
const { createWebsiteCmsRouter } = require('../../../routes/websiteCms');
const { createWebsiteCmsService } = require('../../../services/websiteCms/service');
const { createLocalCmsAdapters } = require('../../../services/websiteCms/local');
const roots = []; const servers = [];
async function server(actor, withLibrary = false) {
  const root = await mkdtemp(join(tmpdir(), 'website-cms-route-')); roots.push(root);
  const snapshot = structuredClone(require('../../../contracts/website/v1/fixtures/published.json'));
  const assets = {}; const hash = value => createHash('sha256').update(value).digest('hex');
  for (const set of snapshot.media) for (const file of set.files) { const data = Buffer.from(file.path); assets[file.path] = data; file.bytes = data.length; file.sha256 = hash(data); }
  const manifest = Buffer.from(JSON.stringify(snapshot));
  const seed = { manifest, assets, pointer: { generation: 1, publicationId: snapshot.publicationId, manifestKey: `publications/${snapshot.publicationId}/snapshot.json`, sha256: hash(manifest), schemaVersion: 1, activatedAt: new Date().toISOString() } };
  const adapters = await createLocalCmsAdapters({ editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'published'), seed, grants: { publisher: ['website.edit', 'website.publish'], editor: ['website.edit'] } });
  const heroCatalog = withLibrary ? { entries: [{ id: 'route-hero', content: { name: 'Route hero', category: 'Seasonal', hero: { ...snapshot.pages[0].heroVariants[0], id: 'route-hero', active: false } } }], media: snapshot.media, assets } : undefined;
  const service = createWebsiteCmsService({ ...adapters, heroCatalog });
  if (withLibrary) await service.initializeHeroLibrary();
  const app = express();
  app.use('/api/website-cms', createWebsiteCmsRouter({ service, authenticate: (req, res, next) => { req.user = actor ? { db: actor } : undefined; next(); } }));
  const listener = await new Promise((resolve, reject) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); value.once('error', reject); });
  servers.push(listener);
  return { url: `http://127.0.0.1:${listener.address().port}/api/website-cms`, snapshot };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
describe('injected website CMS HTTP boundary', () => {
  it.each([undefined, { id: 'publisher', is_active: false }, { id: 'ungranted', is_active: true, role: 'admin' }])('ignores role and actor headers for %j', async actor => {
    const { url } = await server(actor);
    const response = await fetch(`${url}/entities`, { headers: { 'x-active-role': 'admin', 'x-actor-id': 'publisher' } });
    expect(response.status).toBe(actor ? 403 : 401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const library = await fetch(`${url}/hero-library`, { headers: { 'x-active-role': 'admin' } });
    expect(library.status).toBe(actor ? 403 : 401);
  });
  it('saves with trusted mapped actor, exposes exact revision content and rejects body impersonation', async () => {
    const { url } = await server({ id: 'publisher', is_active: 1 });
    const listing = await (await fetch(`${url}/entities`)).json();
    expect(listing.entities[0]).toMatchObject({ id: 'page-0', kind: 'page' });
    expect(listing.publication.generation).toBe(1);
    const before = await (await fetch(`${url}/entities/page/page-0`)).json();
    const content = structuredClone(before.latest.content); content.title = 'Route draft';
    const payload = { baseRevisionId: before.latest.revisionId, content };
    const spoofed = await fetch(`${url}/entities/page/page-0/revisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, actor: { id: 'someone-else' } }) });
    expect(spoofed.status).toBe(400);
    const saved = await fetch(`${url}/entities/page/page-0/revisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect(saved.status).toBe(200);
    const after = await (await fetch(`${url}/entities/page/page-0`)).json();
    expect(after.latest.content.title).toBe('Route draft');
    expect(after.published.content.title).toBe(before.published.content.title);
    expect(after.revisions.at(-1).createdBy).toBe('publisher');
    const published = await fetch(`${url}/publications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'route-publish', basePublicationId: listing.publication.publicationId, selections: [{ kind: 'page', id: 'page-0', revisionId: after.latest.revisionId, action: 'replace' }] }) });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ generation: 2, status: 'active' });
  });
  it('rejects editor publish and never returns raw dependency errors', async () => {
    const { url, snapshot } = await server({ id: 'editor', is_active: true });
    const response = await fetch(`${url}/publications`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-active-role': 'admin' }, body: JSON.stringify({ requestId: 'denied', basePublicationId: snapshot.publicationId, selections: [{ kind: 'page', id: 'page-0', revisionId: snapshot.revisions.find(item => item.entity.kind === 'page' && item.entity.id === 'page-0').revisionId, action: 'replace' }] }) });
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'website_forbidden' });
    const malformed = await fetch(`${url}/publications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid secret-path' });
    expect(malformed.status).toBe(400); expect(await malformed.text()).not.toContain('secret-path');
  });
  it('routes all entity kinds and keeps save and publication permissions separate', async () => {
    const { url } = await server({ id: 'editor', is_active: true });
    const listing = await (await fetch(`${url}/entities?kind=all`)).json();
    expect(listing.entities.some(row => row.kind === 'site')).toBe(true);
    for (const [kind, id] of [['site','site'], ['officer','officer-synthetic']]) {
      const detail = await (await fetch(`${url}/entities/${kind}/${id}`)).json();
      const content = structuredClone(detail.latest.content);
      if (kind === 'site') content.contact.email = 'updated@example.com'; else content.biography = 'Updated biography';
      const body = { baseRevisionId: detail.latest.revisionId, content };
      const post = value => fetch(`${url}/entities/${kind}/${id}/revisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      expect((await post({ ...body, actor: 'publisher' })).status).toBe(400);
      const saved = await post(body); expect(saved.status).toBe(200);
      const revision = await saved.json();
      const publication = await fetch(`${url}/publications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `denied-${kind}`, basePublicationId: listing.publication.publicationId, selections: [{ kind, id, revisionId: revision.revisionId, action: 'replace' }] }) });
      expect(publication.status).toBe(403);
    }
    const denied = await fetch(`${url}/entities/page/page-0/content-imports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevisionId: 'revision-one', content: {} }) });
    expect(denied.status).toBe(400);
  });
  it('persists library revisions and assignments through exact-body HTTP routes', async () => {
    const { url } = await server({ id: 'editor', is_active: true }, true);
    const listResponse = await fetch(`${url}/hero-library`);
    expect(listResponse.headers.get('cache-control')).toContain('no-store');
    const list = await listResponse.json(); expect(list.heroes).toHaveLength(1);
    const before = await (await fetch(`${url}/hero-library/route-hero`)).json();
    const body = { baseRevisionId: before.latest.revisionId, content: { ...before.latest.content, name: 'Renamed saved hero' } };
    const post = (path, value) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    expect((await post('/hero-library/route-hero/revisions', { ...body, actor: { id: 'publisher' } })).status).toBe(400);
    const response = await post('/hero-library/route-hero/revisions', body); expect(response.status).toBe(200);
    const saved = await response.json();
    const after = await (await fetch(`${url}/hero-library/route-hero`)).json();
    expect(after.latest.revisionId).toBe(saved.revisionId); expect(after.revisions.at(-1).createdBy).toBe('editor');
    const page = await (await fetch(`${url}/entities/page/page-0`)).json();
    const assignment = { baseRevisionId: page.latest.revisionId, slotId: page.latest.content.heroVariants[0].id, heroId: 'route-hero', heroRevisionId: saved.revisionId, active: false };
    expect((await post('/entities/page/page-0/hero-assignments', { ...assignment, actor: 'publisher' })).status).toBe(400);
    const assigned = await post('/entities/page/page-0/hero-assignments', assignment); expect(assigned.status).toBe(200);
    expect((await post('/entities/page/page-0/hero-assignments', assignment)).status).toBe(409);
    const latest = await (await fetch(`${url}/entities/page/page-0`)).json();
    expect(latest.latest.content.heroVariants[0].active).toBe(false);
    expect(latest.publication.generation).toBe(1);
  });

});
