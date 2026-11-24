const { isDeepStrictEqual: equal } = require('node:util');
const { parseSiteSnapshot } = require('../../contracts/website/v1');
const { fail } = require('./errors');
const { hash, MAX_ASSET_BYTES, MAX_RELEASE_BYTES } = require('./integrity');
const { same, replace, seedPublished } = require('./contentEntities');
const copy = value => structuredClone(value);
/** Trusted composition only: prepared public content/assets become private initial drafts.
 * No HTTP creation, upload, activation or grant changes. Existing heads are never replaced. */
function createContentCatalog({ contentCatalog, transaction, publicationStore, now, makeId }) {
  const catalog = contentCatalog ? { pages: copy(contentCatalog.pages ?? []), officers: copy(contentCatalog.officers ?? []), media: copy(contentCatalog.media ?? []), assets: Object.fromEntries(Object.entries(contentCatalog.assets ?? {}).map(([path, bytes]) => [path, Buffer.from(bytes)])) } : { pages: [], officers: [], media: [], assets: {} };
  if (!Array.isArray(catalog.pages) || catalog.pages.length > 500 || !Array.isArray(catalog.officers) || catalog.officers.length > 1000 || !Array.isArray(catalog.media)) fail(422, 'website_content_catalog_invalid');
  const entries = [...catalog.pages.map(content => ({ entity: { kind: 'page', id: content.id }, content })), ...catalog.officers.map(content => ({ entity: { kind: 'officer', id: content.id }, content }))];
  if (new Set(entries.map(row => `${row.entity.kind}:${row.entity.id}`)).size !== entries.length) fail(422, 'website_content_catalog_invalid');
  const names = new Set(), paths = new Set(); let total = 0;
  for (const set of catalog.media) {
    if (!set || names.has(set.name) || !Array.isArray(set.files)) fail(422, 'website_content_catalog_invalid');
    names.add(set.name);
    for (const file of set.files) {
      const bytes = catalog.assets[file.path];
      if (paths.has(file.path) || !bytes || bytes.length !== file.bytes || bytes.length > MAX_ASSET_BYTES || hash(bytes) !== file.sha256) fail(422, 'website_content_asset_invalid');
      paths.add(file.path); total += bytes.length;
    }
  }
  if (total > MAX_RELEASE_BYTES) fail(422, 'website_content_asset_invalid');
  function merge(snapshot) {
    const candidate = copy(snapshot), known = new Map(candidate.media.map(set => [set.name, set]));
    const files = new Set(candidate.media.flatMap(set => set.files.map(file => file.path)));
    // Include only declared content assets actually referenced by this snapshot.
    const references = JSON.stringify({ site: candidate.site, pages: candidate.pages, officers: candidate.officers });
    for (const set of catalog.media) {
      if (!set.files.some(file => references.includes(JSON.stringify(file.path)))) continue;
      if (known.has(set.name)) { if (!equal(known.get(set.name), set)) fail(422, 'website_content_asset_conflict'); continue; }
      if (set.files.some(file => files.has(file.path))) fail(422, 'website_content_asset_conflict');
      candidate.media.push(copy(set)); known.set(set.name, set); set.files.forEach(file => files.add(file.path));
    }
    return candidate;
  }
  return {
    merge,
    assets: catalog.assets,
    page(id) { const page = catalog.pages.find(row => row.id === id); return page ? copy(page) : undefined; },
    photoAssets(snapshot) { return [...new Set([...snapshot.media, ...catalog.media].flatMap(set => set.files.filter(file => file.contentType.startsWith('image/')).map(file => file.path)))]; },
    async initializeContentCatalog() {
      return transaction(async state => {
        const { snapshot } = await publicationStore.readCurrent();
        // Validate all supplied templates, including IDs that already exist, without replacing their saved values.
        const candidate = copy(snapshot);
        for (const entry of entries) replace(candidate, entry.entity, entry.content, `catalog-validation-${entry.entity.kind}-${entry.entity.id}`.slice(0,128));
        try { parseSiteSnapshot(merge(candidate)); } catch { fail(422, 'website_content_catalog_invalid'); }
        seedPublished(state, snapshot);
        let initialized = 0;
        for (const { entity, content } of entries) {
          if (state.latest.some(row => same(row, entity))) continue;
          const revisionId = `revision-${makeId()}`;
          state.revisions.push({ entity: copy(entity), revisionId, content: copy(content), createdAt: now().toISOString(), createdBy: 'system-bootstrap' });
          state.latest.push({ kind: entity.kind, id: entity.id, revisionId }); initialized++;
          state.audit.push({ action: 'initialize-content', entity: copy(entity), revisionId, actorId: 'system-bootstrap', at: now().toISOString() });
        }
        return { initialized };
      });
    },
  };
}
module.exports = { createContentCatalog };
