const express = require('express');
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const {
  calendarSyncConnectionStart,
  calendarSyncRun,
  validate,
} = require('../validation/schemas');
const { runSyncForConnection } = require('../services/calendarSync/syncEngine');

const router = express.Router();

router.use(requireDbUser);

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

router.get('/status', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, provider, provider_account_email, sync_enabled, privacy_default, last_sync_at, sync_status, sync_error
       FROM calendar_sync_connections
       WHERE user_id=?
       ORDER BY provider ASC`,
      [getUserId(req)]
    );

    res.json({ connections: getRows(result) || [] });
  } catch (error) {
    next(error);
  }
});

router.post('/connections/:provider/start', validate(calendarSyncConnectionStart), async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (provider !== req.body.provider) {
      return res.status(400).json({ error: 'Provider mismatch' });
    }

    await db.query(
      `INSERT INTO calendar_sync_connections (user_id, provider, sync_enabled, privacy_default, sync_status)
       VALUES (?, ?, ?, ?, 'not_connected')
       ON DUPLICATE KEY UPDATE
         sync_enabled=VALUES(sync_enabled),
         privacy_default=VALUES(privacy_default),
         updated_at=CURRENT_TIMESTAMP`,
      [getUserId(req), provider, req.body.sync_enabled ? 1 : 0, req.body.privacy_default]
    );

    return res.json({
      provider,
      status: 'not_connected',
      authorization_url: null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/run', validate(calendarSyncRun), async (req, res, next) => {
  try {
    const params = [getUserId(req)];
    let where = 'user_id=? AND sync_enabled=1';

    if (req.body.provider) {
      where += ' AND provider=?';
      params.push(req.body.provider);
    }

    const result = await db.query(`SELECT * FROM calendar_sync_connections WHERE ${where}`, params);
    const connections = getRows(result) || [];
    const results = [];

    for (const connection of connections) {
      const syncResult = await runSyncForConnection(connection, { listEvents: async () => [] });
      results.push({ provider: connection.provider, ...syncResult });
    }

    return res.json({ results });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
