const express = require('express');
/** Importing this injectable router cannot connect to DB, AWS or real authentication. */
function createWebsiteCmsRouter({ service, authenticate }) {
  if (!service || typeof authenticate !== 'function') throw Error('website_router_dependencies_required');
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate);
  router.use(express.json({ limit: '256kb', strict: true }));
  const run = operation => async (req, res, next) => { try { res.json(await operation(req)); } catch (error) { next(error); } };
  const actor = req => req.user?.db;
  const exactBody = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
  router.get('/hero-library', run(req => service.listHeroes({ actor: actor(req) })));
  router.get('/hero-library/:id', run(req => service.getHero({ actor: actor(req), id: req.params.id })));
  router.post('/hero-library/:id/revisions', (req, res, next) => {
    if (!exactBody(req.body, ['baseRevisionId', 'content'])) return res.status(400).json({ error: 'website_hero_revision_invalid' });
    return run(req => service.saveHeroRevision({ actor: actor(req), id: req.params.id, baseRevisionId: req.body.baseRevisionId, content: req.body.content }))(req, res, next);
  });
  router.post('/entities/page/:id/hero-assignments', (req, res, next) => {
    if (!exactBody(req.body, ['baseRevisionId', 'slotId', 'heroId', 'heroRevisionId', 'active'])) return res.status(400).json({ error: 'website_hero_assignment_invalid' });
    return run(req => service.assignHero({ actor: actor(req), id: req.params.id, ...req.body }))(req, res, next);
  });
  router.post('/entities/page/:id/content-imports', (req, res, next) => {
    if (!exactBody(req.body, ['baseRevisionId'])) return res.status(400).json({ error: 'website_revision_invalid' });
    return run(req => service.importPageContent({ actor: actor(req), id: req.params.id, baseRevisionId: req.body.baseRevisionId }))(req, res, next);
  });
  router.get('/entities', run(req => service.listEntities({ actor: actor(req), kind: req.query.kind ?? 'page' })));
  router.get('/entities/:kind/:id', run(req => service.getEntity({ actor: actor(req), kind: req.params.kind, id: req.params.id })));
  router.post('/entities/:kind/:id/revisions', (req, res, next) => {
    if (!exactBody(req.body, ['baseRevisionId', 'content'])) return res.status(400).json({ error: 'website_revision_invalid' });
    return run(req => service.saveRevision({ actor: actor(req), entity: { kind: req.params.kind, id: req.params.id }, baseRevisionId: req.body.baseRevisionId, content: req.body.content }))(req, res, next);
  });
  router.post('/publications', run(req => service.publishSelection({ actor: actor(req), request: req.body })));
  router.get('/publications/:id', run(req => service.getPublication({ actor: actor(req), publicationId: req.params.id })));
  router.post('/publications/:id/rollback', (req, res, next) => {
    if (!exactBody(req.body, ['requestId', 'expectedGeneration'])) return res.status(400).json({ error: 'website_rollback_invalid' });
    return run(req => service.rollbackPublication({ actor: actor(req), publicationId: req.params.id, requestId: req.body.requestId, expectedGeneration: req.body.expectedGeneration }))(req, res, next);
  });
  router.use((error, req, res, next) => {
    const status = [400, 401, 403, 404, 409, 422, 503].includes(error.status) ? error.status : error.type === 'entity.too.large' ? 400 : 503;
    const code = /^website_[a-z_]+$/.test(error.code ?? '') ? error.code : status === 400 ? 'website_request_invalid' : 'website_dependency_unavailable';
    res.status(status).json({ error: code });
  });
  return router;
}
module.exports = { createWebsiteCmsRouter };
