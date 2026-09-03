const express = require('express');
const { getUserId } = require('../middleware/userContext');
const defaultSettings = require('../services/webinars/settings');
const {
  getControlledReasonCodeDefinition,
  recordOperationalEvent: defaultRecordOperationalEvent,
} = require('../services/webinars/observability');
const { writeSettings } = require('../validation/schemas/webinars');

function createWebinarPresenterSettingsRouter({
  settings = defaultSettings,
  recordOperationalEvent = defaultRecordOperationalEvent,
} = {}) {
  const router = express.Router();
  const trustedSettingsErrorConstructors = [
    defaultSettings.WebinarSettingsError,
    settings.WebinarSettingsError,
  ].filter((value, index, values) => typeof value === 'function' && values.indexOf(value) === index);

  function controlledSettingsDefinition(error) {
    if (!trustedSettingsErrorConstructors.some(ErrorType => error instanceof ErrorType)) return null;
    const definition = getControlledReasonCodeDefinition(error.code);
    if (!definition
      || definition.httpStatus === null
      || definition.httpStatus !== error.status
      || definition.eventName !== 'webinar.validation_rejected') {
      return null;
    }
    return definition;
  }

  function respondToSettingsError(req, res, error) {
    const actorUserId = getUserId(req);
    const definition = controlledSettingsDefinition(error);
    if (definition) {
      recordOperationalEvent(definition.eventName, {
        actorUserId,
        statusCode: definition.httpStatus,
        reasonCode: error.code,
      });
      return res.status(definition.httpStatus).json({
        error: error.message,
        code: error.code,
      });
    }
    recordOperationalEvent('webinar.database_failure', {
      actorUserId,
      statusCode: 500,
      reasonCode: 'DATABASE_FAILURE',
    });
    return res.status(500).json({ error: 'Internal server error' });
  }

  function parseBody(req, res) {
    const parsed = writeSettings.safeParse(req.body);
    if (parsed.success) return parsed.data;
    recordOperationalEvent('webinar.validation_rejected', {
      actorUserId: getUserId(req),
      statusCode: 400,
      reasonCode: 'VALIDATION_FAILED',
    });
    res.status(400).json({
      error: 'Invalid request',
      code: 'VALIDATION_FAILED',
      issues: parsed.error.issues,
    });
    return null;
  }

  router.get('/me', async (req, res) => {
    try {
      res.json((await settings.getSettings(getUserId(req))) || {
        shortcuts: {},
        preferences: {},
      });
    } catch (error) {
      respondToSettingsError(req, res, error);
    }
  });

  router.put('/me', async (req, res) => {
    const body = parseBody(req, res);
    if (body === null) return;
    try {
      res.json(await settings.upsertSettings({
        userId: getUserId(req),
        ...body,
      }));
    } catch (error) {
      respondToSettingsError(req, res, error);
    }
  });

  return router;
}

const router = createWebinarPresenterSettingsRouter();

module.exports = router;
module.exports.createWebinarPresenterSettingsRouter = createWebinarPresenterSettingsRouter;
