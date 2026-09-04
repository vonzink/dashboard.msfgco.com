const express = require('express');
const { z } = require('zod');
const { getUserId, isAdmin } = require('../middleware/userContext');
const { assertCanEdit, WebinarAccessError } = require('../services/webinars/authorization');
const defaultRepository = require('../services/webinars/repository');
const defaultRevisions = require('../services/webinars/revisions');
const defaultMutations = require('../services/webinars/mutations');
const defaultNotes = require('../services/webinars/notes');
const defaultAssetReferences = require('../services/webinarAssets/references');
const {
  getControlledReasonCodeDefinition,
  recordOperationalEvent: defaultRecordOperationalEvent,
} = require('../services/webinars/observability');
const schemas = require('../validation/schemas/webinars');

const webinarIdSchema = z.coerce.number().int().positive();
const revisionIdSchema = z.coerce.number().int().positive();
const noteIdSchema = z.coerce.number().int().positive();
const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const CONTROLLED_ASSET_REFERENCE_ERRORS = Object.freeze({
  ASSET_NOT_FOUND: Object.freeze({ status: 422, message: 'Asset version not found' }),
  ASSET_NOT_AVAILABLE: Object.freeze({ status: 422, message: 'Asset version is not available' }),
  ASSET_TOKEN_FORMAT: Object.freeze({ status: 422, message: 'Asset token is invalid' }),
  ASSET_REFERENCE_INVALID: Object.freeze({ status: 400, message: 'Webinar asset reference is invalid' }),
});

function createWebinarsRouter({
  repository = defaultRepository,
  revisions = defaultRevisions,
  mutations = defaultMutations,
  notes = defaultNotes,
  recordOperationalEvent = defaultRecordOperationalEvent,
} = {}) {
  const router = express.Router();
  const trustedServiceErrorConstructors = [
    defaultMutations.WebinarMutationError,
    defaultNotes.WebinarNoteError,
    mutations.WebinarMutationError,
    notes.WebinarNoteError,
  ].filter((value, index, values) => typeof value === 'function' && values.indexOf(value) === index);

  function isTrustedServiceError(error) {
    return trustedServiceErrorConstructors.some(ErrorType => error instanceof ErrorType);
  }

  function recordDatabaseFailure(req) {
    const fields = {
      actorUserId: getUserId(req),
      statusCode: 500,
      reasonCode: 'DATABASE_FAILURE',
    };
    if (req.params.id && Number.isSafeInteger(Number(req.params.id)) && Number(req.params.id) > 0) {
      fields.webinarId = Number(req.params.id);
    }
    recordOperationalEvent('webinar.database_failure', fields);
  }

  function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(() => {
      recordDatabaseFailure(req);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  function errorBody(error) {
    const body = { error: error.message || 'Request failed', code: error.code };
    if (error.issues) body.issues = error.issues;
    if (error.code === 'VERSION_CONFLICT') {
      if (error.currentVersion !== undefined) body.currentVersion = error.currentVersion;
      if (error.updatedAt !== undefined) body.updatedAt = error.updatedAt;
      if (error.updatedBy !== undefined) body.updatedBy = error.updatedBy;
    }
    return body;
  }

  function operationFor(req) {
    return {
      webinarId: Number(req.params.id),
      actorUserId: getUserId(req),
      actorIsAdmin: isAdmin(req),
    };
  }

  function parseOrRespond(req, res, schema, value) {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map(issue => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    }));
    recordOperationalEvent('webinar.validation_rejected', {
      actorUserId: getUserId(req),
      statusCode: 400,
      reasonCode: 'VALIDATION_FAILED',
    });
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_FAILED', issues });
    return null;
  }

  async function loadAuthorizedWebinar(req, res, { adminOnly = false } = {}) {
    const id = parseOrRespond(req, res, webinarIdSchema, req.params.id);
    if (id === null) return null;
    const webinar = await repository.getPrivateDocument(id);
    if (!webinar) {
      recordOperationalEvent('webinar.validation_rejected', {
        webinarId: id,
        actorUserId: getUserId(req),
        statusCode: 404,
        reasonCode: 'WEBINAR_NOT_FOUND',
      });
      res.status(404).json({ error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' });
      return null;
    }
    try {
      if (adminOnly && !isAdmin(req)) {
        throw new WebinarAccessError(403, 'ADMIN_ACCESS_REQUIRED', 'Admin access required');
      }
      assertCanEdit(req, {
        primary_owner_user_id: webinar.primaryOwnerUserId ?? webinar.primary_owner_user_id,
      });
    } catch (error) {
      const definition = getControlledReasonCodeDefinition(error.code);
      const reasonCode = definition?.eventName === 'webinar.authorization_denied'
        && definition.httpStatus === 403
        ? error.code
        : 'ACCESS_DENIED';
      recordOperationalEvent('webinar.authorization_denied', {
        webinarId: id,
        actorUserId: getUserId(req),
        statusCode: 403,
        reasonCode,
      });
      res.status(error.status || 403).json(errorBody(error));
      return null;
    }
    return { id, webinar };
  }

  function respondWithServiceError(req, res, error) {
    const assetReferenceDefinition = error instanceof defaultAssetReferences.AssetReferenceError
      ? CONTROLLED_ASSET_REFERENCE_ERRORS[error.code]
      : null;
    if (assetReferenceDefinition && error.status === assetReferenceDefinition.status) {
      const fields = {
        actorUserId: getUserId(req),
        statusCode: assetReferenceDefinition.status,
        reasonCode: error.code,
      };
      if (req.params.id && Number.isSafeInteger(Number(req.params.id)) && Number(req.params.id) > 0) {
        fields.webinarId = Number(req.params.id);
      }
      recordOperationalEvent('webinar.validation_rejected', fields);
      return res.status(assetReferenceDefinition.status).json({
        error: assetReferenceDefinition.message,
        code: error.code,
      });
    }

    const definition = getControlledReasonCodeDefinition(error.code);
    const controlled = isTrustedServiceError(error)
      && definition
      && definition.httpStatus !== null
      && definition.httpStatus === error.status
      && definition.eventName;
    if (!controlled) {
      recordDatabaseFailure(req);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const fields = {
      actorUserId: getUserId(req),
      statusCode: definition.httpStatus,
      reasonCode: error.code,
    };
    if (req.params.id && Number.isSafeInteger(Number(req.params.id)) && Number(req.params.id) > 0) {
      fields.webinarId = Number(req.params.id);
    }
    recordOperationalEvent(definition.eventName, fields);
    return res.status(definition.httpStatus).json(errorBody(error));
  }

  async function performMutation(
    req,
    res,
    schema,
    action,
    status = 200,
    { adminOnly = false, restored = false } = {},
  ) {
    const body = parseOrRespond(req, res, schema, req.body);
    if (body === null) return;
    const access = await loadAuthorizedWebinar(req, res, { adminOnly });
    if (!access) return;
    try {
      const result = await action({ ...operationFor(req), ...body }, access.webinar);
      recordOperationalEvent(
        restored ? 'webinar.restore_succeeded' : 'webinar.save_succeeded',
        {
          webinarId: access.id,
          actorUserId: getUserId(req),
          liveVersion: result.liveVersion,
          statusCode: status,
        },
      );
      res.status(status).json(result);
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }

  router.get('/', asyncRoute(async (req, res) => {
    try {
      res.json(await repository.listForRequest(req));
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.post('/', asyncRoute(async (req, res) => {
    if (!isAdmin(req)) {
      recordOperationalEvent('webinar.authorization_denied', {
        actorUserId: getUserId(req),
        statusCode: 403,
        reasonCode: 'ADMIN_ACCESS_REQUIRED',
      });
      return res.status(403).json({
        error: 'Admin access required',
        code: 'ADMIN_ACCESS_REQUIRED',
      });
    }
    const body = parseOrRespond(req, res, schemas.createWebinar, req.body);
    if (body === null) return;
    try {
      const result = await mutations.createWebinar({ ...body, actorUserId: getUserId(req) });
      recordOperationalEvent('webinar.save_succeeded', {
        webinarId: result.webinarId,
        actorUserId: getUserId(req),
        liveVersion: result.liveVersion,
        statusCode: 201,
      });
      res.status(201).json(result);
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.get('/:id/history', asyncRoute(async (req, res) => {
    const access = await loadAuthorizedWebinar(req, res);
    if (!access) return;
    try {
      res.json(await revisions.listHistory(access.id));
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.post('/:id/history/:revisionId/restore', asyncRoute(async (req, res) => {
    const revisionId = parseOrRespond(req, res, revisionIdSchema, req.params.revisionId);
    if (revisionId === null) return;
    await performMutation(
      req,
      res,
      schemas.restoreRevision,
      body => mutations.restoreRevision({ ...body, revisionId }),
      200,
      { restored: true },
    );
  }));

  router.put('/:id/master', asyncRoute(async (req, res) => {
    await performMutation(req, res, schemas.saveMaster, body => mutations.saveMaster(body));
  }));

  router.post('/:id/slides', asyncRoute(async (req, res) => {
    const schema = Object.prototype.hasOwnProperty.call(req.body || {}, 'sourceSlideId')
      ? schemas.duplicateSlide
      : schemas.addSlide;
    await performMutation(
      req,
      res,
      schema,
      body => body.sourceSlideId ? mutations.duplicateSlide(body) : mutations.addSlide(body),
      201,
    );
  }));

  router.put('/:id/slides/order', asyncRoute(async (req, res) => {
    await performMutation(req, res, schemas.reorderSlides, body => mutations.reorderSlides(body));
  }));

  router.put('/:id/slides/:slideId', asyncRoute(async (req, res) => {
    const parsedSlideId = parseOrRespond(req, res, uuidSchema, req.params.slideId);
    if (parsedSlideId === null) return;
    await performMutation(
      req,
      res,
      schemas.saveSlide,
      body => mutations.saveSlide({ ...body, slideId: parsedSlideId }),
    );
  }));

  router.delete('/:id/slides/:slideId', asyncRoute(async (req, res) => {
    const parsedSlideId = parseOrRespond(req, res, uuidSchema, req.params.slideId);
    if (parsedSlideId === null) return;
    await performMutation(
      req,
      res,
      schemas.restoreRevision,
      body => mutations.archiveSlide({ ...body, slideId: parsedSlideId }),
    );
  }));

  router.put('/:id/owner', asyncRoute(async (req, res) => {
    await performMutation(
      req,
      res,
      schemas.changeOwner,
      body => mutations.changeOwner(body),
      200,
      { adminOnly: true },
    );
  }));

  router.put('/:id/audience-access', asyncRoute(async (req, res) => {
    await performMutation(
      req,
      res,
      schemas.changeAudienceAccess,
      body => mutations.changeAudienceAccess(body),
      200,
      { adminOnly: true },
    );
  }));

  router.get('/:id/notes', asyncRoute(async (req, res) => {
    const access = await loadAuthorizedWebinar(req, res);
    if (!access) return;
    try {
      res.json(await notes.listNotes({
        userId: getUserId(req),
        webinarId: access.id,
      }));
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.post('/:id/slides/:slideId/notes', asyncRoute(async (req, res) => {
    const parsedSlideId = parseOrRespond(req, res, uuidSchema, req.params.slideId);
    if (parsedSlideId === null) return;
    const body = parseOrRespond(req, res, schemas.writeNote, req.body);
    if (body === null) return;
    const access = await loadAuthorizedWebinar(req, res);
    if (!access) return;
    try {
      res.status(201).json(await notes.addNote({
        userId: getUserId(req),
        actorIsAdmin: isAdmin(req),
        webinarId: access.id,
        slideId: parsedSlideId,
        ...body,
      }));
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.put('/:id/notes/:noteId', asyncRoute(async (req, res) => {
    const parsedNoteId = parseOrRespond(req, res, noteIdSchema, req.params.noteId);
    if (parsedNoteId === null) return;
    const body = parseOrRespond(req, res, schemas.writeNote, req.body);
    if (body === null) return;
    const access = await loadAuthorizedWebinar(req, res);
    if (!access) return;
    try {
      res.json(await notes.updateNote({
        userId: getUserId(req),
        actorIsAdmin: isAdmin(req),
        webinarId: access.id,
        noteId: parsedNoteId,
        ...body,
      }));
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.delete('/:id/notes/:noteId', asyncRoute(async (req, res) => {
    const parsedNoteId = parseOrRespond(req, res, noteIdSchema, req.params.noteId);
    if (parsedNoteId === null) return;
    const access = await loadAuthorizedWebinar(req, res);
    if (!access) return;
    try {
      await notes.deleteNote({
        userId: getUserId(req),
        actorIsAdmin: isAdmin(req),
        webinarId: access.id,
        noteId: parsedNoteId,
      });
      res.status(204).end();
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.delete('/:id', asyncRoute(async (req, res) => {
    const access = await loadAuthorizedWebinar(req, res, { adminOnly: true });
    if (!access) return;
    try {
      const result = await mutations.archiveWebinar(operationFor(req));
      res.json(result);
    } catch (error) {
      respondWithServiceError(req, res, error);
    }
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const access = await loadAuthorizedWebinar(req, res);
    if (access) res.json(access.webinar);
  }));

  return router;
}

const router = createWebinarsRouter();

module.exports = router;
module.exports.createWebinarsRouter = createWebinarsRouter;
