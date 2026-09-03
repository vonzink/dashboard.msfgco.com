const express = require('express');
const { getUserId } = require('../middleware/userContext');
const settings = require('../services/webinars/settings');
const { recordOperationalEvent } = require('../services/webinars/observability');
const { writeSettings } = require('../validation/schemas/webinars');

const router = express.Router();

function isControlledSettingsError(error) {
  return error instanceof settings.WebinarSettingsError
    && Number.isInteger(error.status)
    && error.status >= 400
    && error.status < 500
    && typeof error.code === 'string';
}

function respondToSettingsError(req, res, error) {
  const actorUserId = getUserId(req);
  if (isControlledSettingsError(error)) {
    recordOperationalEvent('webinar.validation_rejected', { actorUserId, statusCode: error.status, reasonCode: error.code });
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  recordOperationalEvent('webinar.database_failure', { actorUserId, statusCode: 500, reasonCode: 'DATABASE_FAILURE' });
  return res.status(500).json({ error: 'Internal server error' });
}

function parseBody(req, res) {
  const parsed = writeSettings.safeParse(req.body);
  if (parsed.success) return parsed.data;
  recordOperationalEvent('webinar.validation_rejected', { actorUserId: getUserId(req), statusCode: 400, reasonCode: 'VALIDATION_FAILED' });
  res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_FAILED', issues: parsed.error.issues });
  return null;
}

router.get('/me', async (req, res) => {
  try { res.json((await settings.getSettings(getUserId(req))) || { shortcuts: {}, preferences: {} }); }
  catch (error) { respondToSettingsError(req, res, error); }
});

router.put('/me', async (req, res) => {
  const body = parseBody(req, res); if (!body) return;
  try { res.json(await settings.upsertSettings({ userId: getUserId(req), ...body })); }
  catch (error) { respondToSettingsError(req, res, error); }
});

module.exports = router;
