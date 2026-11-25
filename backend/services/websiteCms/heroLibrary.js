const { isDeepStrictEqual: equal } = require('node:util');
const { parseSiteSnapshot } = require('../../contracts/website/v1');
const { authorizeWebsiteAction } = require('./authz');
const { fail } = require('./errors');
const { hash, MAX_ASSET_BYTES, MAX_RELEASE_BYTES } = require('./integrity');
const copy = value => structuredClone(value);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// eslint-disable-next-line no-control-regex
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);

/** Explicit, already-validated media only. This module neither uploads nor transcodes. */
function createHeroLibrary({ heroCatalog, transaction, publicationStore, now, makeId, mergeContent = snapshot => snapshot }) {
  const catalog = heroCatalog ? { entries: copy(heroCatalog.entries), media: copy(heroCatalog.media), assets: Object.fromEntries(Object.entries(heroCatalog.assets ?? {}).map(([path, bytes]) => [path, Buffer.from(bytes)])) } : { entries: [], media: [], assets: {} };
  if (!Array.isArray(catalog.entries) || catalog.entries.length > 100 || !Array.isArray(catalog.media)) fail(422, 'website_hero_catalog_invalid');
  const ids = new Set(); const media = new Map(); const files = new Map();
  for (const entry of catalog.entries) {
    if (!exact(entry, ['id', 'content']) || typeof entry.id !== 'string' || !idPattern.test(entry.id) || ids.has(entry.id)) fail(422, 'website_hero_catalog_invalid');
    ids.add(entry.id);
  }
  let total = 0;
  for (const set of catalog.media) {
    if (!set || typeof set.name !== 'string' || media.has(set.name) || !Array.isArray(set.files)) fail(422, 'website_hero_catalog_invalid');
    media.set(set.name, set);
    for (const file of set.files) {
      const bytes = catalog.assets[file.path];
      if (files.has(file.path) || !bytes || bytes.length !== file.bytes || bytes.length > MAX_ASSET_BYTES || hash(bytes) !== file.sha256) fail(422, 'website_hero_asset_invalid');
      files.set(file.path, set); total += bytes.length;
    }
  }
  if (total > MAX_RELEASE_BYTES) fail(422, 'website_hero_asset_invalid');

  function merge(snapshot, all = false) {
    const merged = copy(mergeContent(snapshot));
    const names = new Map(merged.media.map(set => [set.name, set]));
    const knownFiles = new Set(merged.media.flatMap(set => set.files.map(file => file.path)));
    function add(set) {
      if (!set) return; // The public validator rejects an unresolved reference.
      if (names.has(set.name)) {
        if (!equal(names.get(set.name), set)) fail(422, 'website_hero_asset_conflict');
        return;
      }
      if (set.files.some(file => knownFiles.has(file.path))) fail(422, 'website_hero_asset_conflict');
      merged.media.push(copy(set)); names.set(set.name, set);
      set.files.forEach(file => knownFiles.add(file.path));
    }
    function image(path) { if (files.has(path)) add(files.get(path)); }
    if (all) catalog.media.forEach(add);
    else for (const page of merged.pages) {
      for (const hero of page.heroVariants) {
        if (hero.media?.kind === 'video') add(media.get(hero.media.name));
        else { image(hero.media?.desktopAsset); image(hero.media?.mobileAsset); }
        image(hero.artworkAsset);
      }
      image(page.fallbackImage?.desktopAsset); image(page.fallbackImage?.mobileAsset);
    }
    return merged;
  }
  function validateContent(id, content, snapshot) {
    if (!ids.has(id)) fail(404, 'website_hero_not_found');
    if (!exact(content, ['name', 'category', 'hero']) || !text(content.name, 120) || !text(content.category, 60) || content.hero?.id !== id || content.hero?.active !== false) fail(422, 'website_hero_content_invalid');
    const candidate = copy(snapshot);
    const home = candidate.pages.find(page => page.path === '/');
    if (!home?.heroVariants?.length) fail(422, 'website_hero_content_invalid');
    // The required homepage supplies a slot regardless of page order. Preserve its
    // identity because library creative IDs and page slot IDs are separate namespaces.
    home.heroVariants[0] = { ...copy(content.hero), id: home.heroVariants[0].id };
    try { parseSiteSnapshot(merge(candidate)); } catch { fail(422, 'website_hero_content_invalid'); }
  }
  function arrays(state) { state.heroRevisions ??= []; state.heroLatest ??= []; }
  function get(state, id) {
    if (!ids.has(id)) fail(404, 'website_hero_not_found');
    const latest = state.heroLatest?.find(row => row.id === id);
    const revision = state.heroRevisions?.find(row => row.id === id && row.revisionId === latest?.revisionId);
    if (!revision) fail(404, 'website_hero_not_found');
    return revision;
  }
  function revision(state, id, content, actorId) {
    const row = { id, revisionId: `hero-revision-${makeId()}`, content: copy(content), createdAt: now().toISOString(), createdBy: actorId };
    state.heroRevisions.push(row);
    const latest = state.heroLatest.find(item => item.id === id);
    if (latest) latest.revisionId = row.revisionId; else state.heroLatest.push({ id, revisionId: row.revisionId });
    return row;
  }
  return {
    merge,
    publicationAssets(snapshot, existing) {
      const result = {};
      for (const set of snapshot.media) for (const file of set.files) {
        const bytes = existing[file.path] ?? catalog.assets[file.path];
        if (!bytes || bytes.length !== file.bytes || hash(bytes) !== file.sha256) fail(422, 'website_hero_asset_invalid');
        result[file.path] = bytes;
      }
      return result;
    },
    async initializeHeroLibrary() {
      if (!heroCatalog) return { initialized: 0 };
      return transaction(async state => {
        const { snapshot } = await publicationStore.readCurrent();
        try { parseSiteSnapshot(merge(snapshot, true)); } catch { fail(422, 'website_hero_catalog_invalid'); }
        for (const entry of catalog.entries) validateContent(entry.id, entry.content, snapshot);
        arrays(state); let initialized = 0;
        for (const entry of catalog.entries) {
          if (state.heroLatest.some(row => row.id === entry.id)) continue;
          const row = revision(state, entry.id, entry.content, 'system-bootstrap'); initialized++;
          state.audit.push({ action: 'initialize-hero', heroId: entry.id, revisionId: row.revisionId, actorId: 'system-bootstrap', at: now().toISOString() });
        }
        return { initialized };
      });
    },
    async listHeroes({ actor } = {}) {
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'read', state.grants);
        return {
          heroes: (state.heroLatest ?? []).filter(row => ids.has(row.id)).map(row => { const value = get(state, row.id); return { id: row.id, revisionId: value.revisionId, content: copy(value.content) }; }),
          media: catalog.media.filter(set => set.kind === 'hero-video').map(set => ({ kind: 'video', name: set.name })),
          artwork: catalog.media.filter(set => set.kind === 'image').flatMap(set => set.files.filter(file => file.contentType.startsWith('image/')).map(file => ({ path: file.path, label: file.path.split('/').pop().replace(/\.svg$/, '').replace(/^msfg-triangle-/, '').replace(/-/g, ' ') }))),
        };
      });
    },
    async getHero({ actor, id }) {
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'read', state.grants);
        const latest = get(state, id);
        return { id, latest: { revisionId: latest.revisionId, content: copy(latest.content) }, revisions: copy(state.heroRevisions.filter(row => row.id === id)) };
      });
    },
    async saveHeroRevision({ actor, id, baseRevisionId, content }) {
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'website.edit', state.grants);
        const latest = get(state, id);
        if (typeof baseRevisionId !== 'string' || latest.revisionId !== baseRevisionId) fail(409, 'website_hero_revision_conflict');
        const { snapshot } = await publicationStore.readCurrent();
        validateContent(id, content, snapshot);
        const row = revision(state, id, content, String(actor.id));
        state.audit.push({ action: 'save-hero-revision', heroId: id, revisionId: row.revisionId, actorId: String(actor.id), at: now().toISOString() });
        return { revisionId: row.revisionId };
      });
    },
    async assignHero({ actor, id, baseRevisionId, slotId, heroId, heroRevisionId, active }) {
      if (![id, baseRevisionId, slotId, heroId, heroRevisionId].every(value => typeof value === 'string' && idPattern.test(value)) || typeof active !== 'boolean') fail(400, 'website_hero_assignment_invalid');
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'website.edit', state.grants);
        const latest = state.latest.find(row => (row.kind ?? 'page') === 'page' && row.id === id);
        if (!latest) fail(404, 'website_entity_not_found');
        if (latest.revisionId !== baseRevisionId) fail(409, 'website_revision_conflict');
        get(state, heroId);
        const source = state.heroRevisions.find(row => row.id === heroId && row.revisionId === heroRevisionId);
        if (!source) fail(404, 'website_hero_revision_not_found');
        const original = state.revisions.find(row => row.entity.kind === 'page' && row.entity.id === id && row.revisionId === latest.revisionId);
        if (!original) fail(404, 'website_revision_not_found');
        const content = copy(original.content);
        const index = content.heroVariants.findIndex(hero => hero.id === slotId);
        if (index < 0) fail(404, 'website_hero_slot_not_found');
        content.heroVariants[index] = { ...copy(source.content.hero), id: slotId, active };
        const { snapshot } = await publicationStore.readCurrent();
        const candidate = copy(snapshot);
        if (candidate.pages.some(page => page.id === id)) candidate.pages = candidate.pages.map(page => page.id === id ? content : page);
        else { candidate.pages.push(content); candidate.revisions.push({ entity: { kind: 'page', id }, revisionId: latest.revisionId }); }
        try { parseSiteSnapshot(merge(candidate)); } catch { fail(422, 'website_content_invalid'); }
        const revisionId = `revision-${makeId()}`;
        state.revisions.push({ revisionId, entity: { kind: 'page', id }, content, createdAt: now().toISOString(), createdBy: String(actor.id) });
        latest.revisionId = revisionId;
        state.audit.push({ action: 'assign-hero-revision', heroId, heroRevisionId, pageId: id, slotId, revisionId, actorId: String(actor.id), at: now().toISOString() });
        return { revisionId };
      });
    },
  };
}
module.exports = { createHeroLibrary };
