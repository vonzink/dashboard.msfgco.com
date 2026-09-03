const express = require('express');
const { getUserId } = require('../middleware/userContext');
const settings = require('../services/webinars/settings');
const { recordOperationalEvent } = require('../services/webinars/observability');
const { writeSettings } = require('../validation/schemas/webinars');

const router = express.Router();

function parseBody(req, res) {
  const parsed = writeSettings.safeParse(req.body);
  if (parsed.success) return parsed.data;
  recordOperationalEvent('webinar.validation_rejected', { actorUserId: getUserId(req), statusCode: 400, reasonCode: 'VALIDATION_FAILED' });
  res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_FAILED', issues: parsed.error.issues });
  return null;
}

router.get('/me', async (req, res, next) => {
  try { res.json((await settings.getSettings(getUserId(req))) || { shortcuts: {}, preferences: {} }); }
  catch (error) { next(error); }
});

router.put('/me', async (req, res, next) => {
  const body = parseBody(req, res); if (!body) return;
  try { res.json(await settings.upsertSettings({ userId: getUserId(req), ...body })); }
  catch {
    recordOperationalEvent('webinar.database_failure', { actorUserId: getUserId(req), statusCode: 500, reasonCode: 'DATABASE_FAILURE' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
