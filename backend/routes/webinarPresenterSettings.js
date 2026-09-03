const express = require('express');
const { getUserId } = require('../middleware/userContext');
const settings = require('../services/webinars/settings');
const { assertCandidateWithinLimits } = require('../services/webinars/contentPolicy');
const { writeSettings } = require('../validation/schemas/webinars');

const router = express.Router();

function parseBody(req, res) {
  try { assertCandidateWithinLimits(req.body || {}); }
  catch (error) { res.status(413).json({ error: error.message, code: error.code || 'CONTENT_LIMIT_EXCEEDED', issues: error.issues }); return null; }
  const parsed = writeSettings.safeParse(req.body);
  if (parsed.success) return parsed.data;
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
  catch (error) { res.status(error.status || 500).json({ error: error.message, code: error.code || 'SETTINGS_FAILED' }); }
});

module.exports = router;
