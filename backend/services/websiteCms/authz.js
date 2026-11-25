const { fail } = require('./errors');
/** Actor comes only from verified mapped identity middleware. Grants are repository-owned. */
function authorizeWebsiteAction(actor, action, grants) {
  if (!actor) fail(401, 'website_authentication_required');
  if ((typeof actor.id !== 'string' && typeof actor.id !== 'number') || !String(actor.id) || ![true, 1].includes(actor.is_active)) fail(403, 'website_forbidden');
  const capabilities = grants.find(grant => grant.userId === String(actor.id))?.capabilities ?? [];
  const required = action === 'read' ? ['website.edit', 'website.publish'] : [action];
  if (!required.some(value => capabilities.includes(value))) fail(403, 'website_forbidden');
}
module.exports = { authorizeWebsiteAction };
