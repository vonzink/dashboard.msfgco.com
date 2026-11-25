const { randomUUID } = require('node:crypto');
const { parseSiteSnapshot, parsePublishRequest } = require('../../contracts/website/v1');
const { authorizeWebsiteAction } = require('./authz');
const { CmsError, fail } = require('./errors');
const { hash, validateBundle } = require('./integrity');
const { createHeroLibrary } = require('./heroLibrary');
const { createContentCatalog } = require('./contentCatalog');
const { kinds, same, validateEntity, contentFor, seedPublished, replace, protect } = require('./contentEntities');
const copy = value => structuredClone(value);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function createWebsiteCmsService({ repository, publicationStore, heroCatalog, contentCatalog, now = () => new Date(), makeId = () => randomUUID() }) {
  if (!repository?.transaction || !publicationStore?.readCurrent) throw Error('website_adapters_required');
  async function transaction(operation) {
    try { return await repository.transaction(operation); }
    catch (error) { if (error instanceof CmsError) throw error; fail(503, 'website_dependency_unavailable'); }
  }
  const contentLibrary = createContentCatalog({ contentCatalog, transaction, publicationStore, now, makeId });
  const library = createHeroLibrary({ heroCatalog, transaction, publicationStore, now, makeId, mergeContent: contentLibrary.merge });
  const merged = snapshot => library.merge(contentLibrary.merge(snapshot));
  function validationSnapshot(state, snapshot) {
    const candidate = copy(snapshot);
    // New trusted templates may reference another new entity before either is published.
    // These drafts are used only to validate saved input; publish validates selected revisions alone.
    for (const head of state.latest) {
      const entity = { kind: head.kind ?? 'page', id: head.id };
      if (contentFor(candidate, entity)) continue;
      const revision = state.revisions.find(row => same(row.entity, entity) && row.revisionId === head.revisionId);
      if (revision) replace(candidate, entity, revision.content, revision.revisionId);
    }
    return candidate;
  }
  const resultFor = pointer => ({ publicationId: pointer.publicationId, generation: pointer.generation, status: 'active' });
  async function reconcile(state, persist) {
    const current = await publicationStore.readPointer();
    for (const record of state.requests.filter(record => record.phase === 'pending')) {
      if (current.generation === record.pointer.generation && current.publicationId === record.pointer.publicationId && current.sha256 === record.pointer.sha256) {
        record.phase = 'active'; record.result = resultFor(record.pointer);
        state.audit.push({ action: 'activation-reconciled', requestId: record.requestId, actorId: record.actorId, at: now().toISOString() });
        await persist();
      } else if (current.generation !== record.expectedGeneration) { record.phase = 'conflict'; await persist(); }
    }
  }
  async function activate(record, state, persist) {
    await publicationStore.activate(record.pointer, record.expectedGeneration);
    record.phase = 'active'; record.result = resultFor(record.pointer);
    state.audit.push({ action: record.kind, requestId: record.requestId, actorId: record.actorId, at: now().toISOString() });
    await persist(); return copy(record.result);
  }
  async function retainedRequest({ state, persist, actor, requestId, requestHash }) {
    await reconcile(state, persist);
    const prior = state.requests.find(item => item.requestId === requestId);
    if (prior) {
      if (prior.actorId !== String(actor.id) || prior.requestHash !== requestHash || prior.phase === 'conflict') fail(409, 'website_request_conflict');
      return prior.phase === 'active' ? copy(prior.result) : activate(prior, state, persist);
    }
    if (state.requests.some(item => item.phase === 'pending')) fail(503, 'website_activation_pending');
  }
  return {
    initializeHeroLibrary: library.initializeHeroLibrary,
    initializeContentCatalog: contentLibrary.initializeContentCatalog,
    listHeroes: library.listHeroes,
    getHero: library.getHero,
    saveHeroRevision: library.saveHeroRevision,
    assignHero: library.assignHero,
    async listEntities({ actor, kind = 'page' } = {}) {
      if (kind !== 'all' && !kinds.has(kind)) fail(400, 'website_entity_invalid');
      return transaction(async (state, persist) => {
        authorizeWebsiteAction(actor, 'read', state.grants);
        await reconcile(state, persist);
        const { snapshot, pointer } = await publicationStore.readCurrent();
        seedPublished(state, snapshot);
        const canPublish = state.grants.find(grant => grant.userId === String(actor.id))?.capabilities.includes('website.publish');
        const pending = canPublish && state.requests.find(record => record.phase === 'pending' && record.kind === 'publish' && record.actorId === String(actor.id));
        const entities = state.latest.filter(head => kind === 'all' || (head.kind ?? 'page') === kind).map(head => {
          const entity = { kind: head.kind ?? 'page', id: head.id };
          const revision = state.revisions.find(row => same(row.entity, entity) && row.revisionId === head.revisionId);
          if (!revision) fail(503, 'website_editorial_state_invalid');
          const content = revision.content;
          return { ...entity, path: entity.kind === 'page' ? content.path : entity.kind === 'officer' ? `/loan-officers/${content.slug}` : '/contact', title: entity.kind === 'page' ? content.title : entity.kind === 'officer' ? content.name : 'Company contact details', latestRevisionId: head.revisionId, publishedRevisionId: snapshot.revisions.find(row => same(row.entity, entity))?.revisionId ?? null };
        });
        return { pendingPublication: pending?.request ? copy(pending.request) : null, entities, publication: resultFor(pointer) };
      });
    },
    async getEntity({ actor, kind, id }) {
      const entity = { kind, id }; validateEntity(entity);
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'read', state.grants);
        const { snapshot, pointer } = await publicationStore.readCurrent();
        seedPublished(state, snapshot);
        const published = contentFor(snapshot, entity);
        const latestId = state.latest.find(row => same(row, entity))?.revisionId;
        const latest = state.revisions.find(row => row.revisionId === latestId && same(row.entity, entity));
        if (!latest) fail(404, 'website_entity_not_found');
        return { ...(kind === 'page' && latest.content.path === '/' ? { previewDefaults: { primary: copy(snapshot.site.navigation.application), secondary: { label: 'Explore Loan Options', href: '#services' } } } : {}), ...(kind === 'officer' ? { photoAssets: contentLibrary.photoAssets(snapshot) } : {}), ...(kind === 'page' ? { hasContentImport: !!contentLibrary.page(id) } : {}), entity, published: published ? { revisionId: snapshot.revisions.find(row => same(row.entity, entity)).revisionId, content: copy(published) } : null, latest: { revisionId: latest.revisionId, content: copy(latest.content) }, revisions: copy(state.revisions.filter(row => same(row.entity, entity))), publication: resultFor(pointer) };
      });
    },
    async importPageContent({ actor, id, baseRevisionId }) {
      const entity = { kind: 'page', id }; validateEntity(entity);
      if (typeof baseRevisionId !== 'string' || !idPattern.test(baseRevisionId)) fail(400, 'website_revision_invalid');
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'website.edit', state.grants);
        const { snapshot } = await publicationStore.readCurrent();
        seedPublished(state, snapshot);
        const latest = state.latest.find(row => same(row, entity));
        if (!latest) fail(404, 'website_entity_not_found');
        if (latest.revisionId !== baseRevisionId) fail(409, 'website_revision_conflict');
        const source = contentLibrary.page(id);
        const original = state.revisions.find(row => same(row.entity, entity) && row.revisionId === latest.revisionId);
        if (!source || !original) fail(404, 'website_content_import_unavailable');
        if (source.path !== original.content.path || source.template !== original.content.template || source.officerId !== original.content.officerId) fail(422, 'website_content_import_invalid');
        const content = { ...copy(original.content), title: source.title, description: source.description, sections: copy(source.sections) };
        const candidate = validationSnapshot(state, snapshot); replace(candidate, entity, content, baseRevisionId);
        try { parseSiteSnapshot(merged(candidate)); } catch { fail(422, 'website_content_invalid'); }
        const revisionId = `revision-${makeId()}`;
        state.revisions.push({ revisionId, entity, content, createdAt: now().toISOString(), createdBy: String(actor.id) });
        latest.revisionId = revisionId;
        state.audit.push({ action: 'import-page-content', revisionId, pageId: id, actorId: String(actor.id), at: now().toISOString() });
        return { revisionId };
      });
    },
    async saveRevision({ actor, entity, baseRevisionId, content }) {
      validateEntity(entity);
      if (typeof baseRevisionId !== 'string' || !idPattern.test(baseRevisionId)) fail(400, 'website_revision_invalid');
      return transaction(async state => {
        authorizeWebsiteAction(actor, 'website.edit', state.grants);
        const { snapshot } = await publicationStore.readCurrent();
        seedPublished(state, snapshot);
        const latest = state.latest.find(row => same(row, entity));
        if (!latest) fail(404, 'website_entity_not_found');
        if (latest.revisionId !== baseRevisionId) fail(409, 'website_revision_conflict');
        const original = state.revisions.find(row => same(row.entity, entity) && row.revisionId === latest.revisionId);
        if (!original) fail(503, 'website_editorial_state_invalid');
        protect(entity, original.content, content);
        const candidate = validationSnapshot(state, snapshot);
        replace(candidate, entity, content, baseRevisionId);
        try { parseSiteSnapshot(merged(candidate)); } catch { fail(422, 'website_content_invalid'); }
        const revisionId = `revision-${makeId()}`;
        state.revisions.push({ revisionId, entity: copy(entity), content: copy(content), createdAt: now().toISOString(), createdBy: String(actor.id) });
        latest.revisionId = revisionId;
        state.audit.push({ action: `save-${entity.kind}-revision`, revisionId, actorId: String(actor.id), at: now().toISOString() });
        return { revisionId };
      });
    },
    async publishSelection({ actor, request }) {
      let input;
      try { input = parsePublishRequest(copy(request)); } catch { fail(400, 'website_publish_request_invalid'); }
      if (input.selections.some(selection => !kinds.has(selection.kind) || (selection.kind !== 'page' && selection.action !== 'replace'))) fail(400, 'website_entity_invalid');
      const requestHash = hash(Buffer.from(JSON.stringify({ operation: 'publish', request: input })));
      return transaction(async (state, persist) => {
        authorizeWebsiteAction(actor, 'website.publish', state.grants);
        const previous = await retainedRequest({ state, persist, actor, requestId: input.requestId, requestHash });
        if (previous) return previous;
        const current = await publicationStore.readCurrent();
        if (current.pointer.publicationId !== input.basePublicationId) fail(409, 'website_publication_conflict');
        let snapshot = copy(current.snapshot);
        for (const selection of input.selections) {
          const revision = state.revisions.find(item => item.revisionId === selection.revisionId && item.entity.kind === selection.kind && item.entity.id === selection.id);
          if (!revision) fail(404, 'website_revision_not_found');
          if (selection.action === 'remove') {
            const index = snapshot.pages.findIndex(page => page.id === selection.id);
            if (index < 0) fail(404, 'website_entity_not_found');
            snapshot.pages.splice(index, 1);
            snapshot.revisions = snapshot.revisions.filter(row => !same(row.entity, selection));
          } else replace(snapshot, revision.entity, revision.content, revision.revisionId);
        }
        snapshot = merged(snapshot);
        snapshot.publicationId = `publication-${makeId()}`; snapshot.createdAt = now().toISOString();
        try { parseSiteSnapshot(snapshot); } catch { fail(422, 'website_publication_invalid'); }
        const manifest = Buffer.from(JSON.stringify(snapshot));
        const pointer = { generation: current.pointer.generation + 1, publicationId: snapshot.publicationId, manifestKey: `publications/${snapshot.publicationId}/snapshot.json`, sha256: hash(manifest), schemaVersion: 1, activatedAt: now().toISOString() };
        await publicationStore.writeCandidate(validateBundle({ pointer, manifest, assets: library.publicationAssets(snapshot, { ...contentLibrary.assets, ...current.assets }) }));
        const record = { request: copy(input), requestId: input.requestId, requestHash, actorId: String(actor.id), kind: 'publish', phase: 'pending', pointer, expectedGeneration: current.pointer.generation };
        state.requests.push(record); await persist(); // Intent precedes pointer activation.
        return activate(record, state, persist);
      });
    },
    async getPublication({ actor, publicationId }) {
      if (typeof publicationId !== 'string' || !idPattern.test(publicationId)) fail(400, 'website_publication_invalid');
      return transaction(async (state, persist) => {
        authorizeWebsiteAction(actor, 'read', state.grants); await reconcile(state, persist);
        const current = await publicationStore.readPointer();
        if (current.publicationId === publicationId) return resultFor(current);
        const record = state.requests.findLast(item => item.pointer.publicationId === publicationId);
        if (!record) fail(404, 'website_publication_not_found');
        return record.phase === 'active' ? copy(record.result) : { publicationId, generation: record.pointer.generation, status: record.phase === 'conflict' ? 'failed' : 'candidate' };
      });
    },
    async rollbackPublication({ actor, publicationId, requestId, expectedGeneration }) {
      if (![publicationId, requestId].every(value => typeof value === 'string' && idPattern.test(value)) || !Number.isSafeInteger(expectedGeneration) || expectedGeneration < 1) fail(400, 'website_rollback_invalid');
      const requestHash = hash(Buffer.from(JSON.stringify({ operation: 'rollback', publicationId, expectedGeneration })));
      return transaction(async (state, persist) => {
        authorizeWebsiteAction(actor, 'website.publish', state.grants);
        const previous = await retainedRequest({ state, persist, actor, requestId, requestHash });
        if (previous) return previous;
        const current = await publicationStore.readPointer();
        if (current.generation !== expectedGeneration) fail(409, 'website_publication_conflict');
        const target = await publicationStore.readRelease(publicationId);
        const pointer = { ...target.pointer, generation: expectedGeneration + 1, activatedAt: now().toISOString() };
        validateBundle({ ...target, pointer });
        const record = { requestId, requestHash, actorId: String(actor.id), kind: 'rollback', phase: 'pending', pointer, expectedGeneration };
        state.requests.push(record); await persist();
        // No revocation read/write: authorization remains independent of content rollback.
        return activate(record, state, persist);
      });
    },
  };
}
module.exports = { createWebsiteCmsService };
