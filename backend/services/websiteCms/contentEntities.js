const { isDeepStrictEqual: equal } = require('node:util');
const { fail } = require('./errors');
const kinds = new Set(['page', 'site', 'officer']);
const copy = value => structuredClone(value);
const same = (row, entity) => (row.kind ?? 'page') === entity.kind && row.id === entity.id;
function validateEntity(entity) {
  if (!entity || !kinds.has(entity.kind) || typeof entity.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entity.id)) fail(400, 'website_entity_invalid');
}
function contentFor(snapshot, entity) {
  if (entity.kind === 'page') return snapshot.pages.find(row => row.id === entity.id);
  if (entity.kind === 'officer') return snapshot.officers.find(row => row.id === entity.id);
  return snapshot.revisions.some(row => row.entity.kind === 'site' && row.entity.id === entity.id) ? snapshot.site : undefined;
}
function allEntities(snapshot) {
  return snapshot.revisions.filter(row => kinds.has(row.entity.kind)).map(row => ({ ...row, content: contentFor(snapshot, row.entity) })).filter(row => row.content);
}
function seedPublished(state, snapshot) {
  for (const { entity, revisionId, content } of allEntities(snapshot)) {
    if (state.latest.some(row => same(row, entity))) continue;
    if (!state.revisions.some(row => same(row.entity, entity) && row.revisionId === revisionId)) state.revisions.push({ entity: copy(entity), revisionId, content: copy(content), createdAt: snapshot.createdAt, createdBy: 'system-bootstrap' });
    state.latest.push({ kind: entity.kind, id: entity.id, revisionId });
  }
}
function replace(snapshot, entity, content, revisionId) {
  if (entity.kind === 'site') snapshot.site = copy(content);
  else {
    const list = entity.kind === 'page' ? snapshot.pages : snapshot.officers;
    const index = list.findIndex(row => row.id === entity.id);
    if (index < 0) list.push(copy(content)); else list[index] = copy(content);
  }
  snapshot.revisions = snapshot.revisions.filter(row => !same(row.entity, entity));
  snapshot.revisions.push({ entity: copy(entity), revisionId });
}
function protect(entity, original, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) fail(422, 'website_content_invalid');
  if (entity.kind === 'site') {
    const allowed = copy(original);
    allowed.contact = copy(content.contact);
    if (!allowed.legal || !content.legal) fail(422, 'website_content_invalid');
    allowed.legal.address = content.legal.address;
    if (!equal(allowed, content)) fail(422, 'website_protected_content');
  } else if (entity.kind === 'officer') {
    if (content.id !== entity.id || content.slug !== original.slug) fail(422, 'website_protected_content');
  } else {
    if (content.id !== entity.id || content.path !== original.path || content.template !== original.template || content.officerId !== original.officerId
      || !Array.isArray(content.sections) || !equal(content.sections.map(row => [row.id, row.type]), original.sections.map(row => [row.id, row.type]))) fail(422, 'website_protected_content');
  }
}
module.exports = { kinds, same, validateEntity, contentFor, allEntities, seedPublished, replace, protect };
