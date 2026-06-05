const express = require('express');
const db = require('../db/connection');
const { getUserId, requireDbUser, requireManagerOrAdmin } = require('../middleware/userContext');
const {
  calendarSyncConnectionStart,
  calendarSyncRun,
  validate,
} = require('../validation/schemas');
const { runSyncForConnection } = require('../services/calendarSync/syncEngine');
const { createStateValue, storeOAuthState } = require('../services/calendarSync/oauthState');
const { isProviderEnabled } = require('../services/calendarSync/config');
const outlookProvider = require('../services/calendarSync/providers/outlook');

const router = express.Router();

router.use(requireDbUser);

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function getAdapter(provider) {
  if (!isProviderEnabled(provider)) return null;
  if (provider === 'outlook') return outlookProvider;
  return null;
}

function defaultSyncOverviewCounts() {
  return {
    shared_event_count: 0,
    hidden_event_count: 0,
    protected_event_count: 0,
    total_synced_event_count: 0,
  };
}

function syncOverviewKey(row) {
  return `${row.user_id}:${row.provider}`;
}

async function disconnectProviderConnection(userId, provider) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `DELETE FROM schedule_entries
       WHERE user_id = ? AND source_provider = ? AND source_event_id IS NOT NULL`,
      [userId, provider]
    );
    await connection.query(
      `DELETE FROM calendar_sync_mappings
       WHERE user_id = ? AND provider = ?`,
      [userId, provider]
    );
    await connection.query(
      `UPDATE calendar_sync_connections
       SET encrypted_access_token = NULL,
           encrypted_refresh_token = NULL,
           access_token_expires_at = NULL,
           oauth_state = NULL,
           oauth_state_expires_at = NULL,
           sync_enabled = 0,
           sync_status = 'not_connected',
           sync_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND provider = ?`,
      [userId, provider]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
    const teamResult = await db.query(
      `SELECT c.user_id,
              u.name,
              u.email,
              c.provider,
              c.provider_account_email,
              c.sync_enabled,
              c.privacy_default,
              c.last_sync_at,
              c.sync_status
       FROM calendar_sync_connections c
       JOIN users u ON u.id = c.user_id
       WHERE c.sync_enabled = 1
         AND c.sync_status IN ('connected', 'syncing', 'error')
       ORDER BY u.name ASC, c.provider ASC`
    );

    res.json({
      connections: getRows(result) || [],
      team_connections: getRows(teamResult) || [],
    });
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

    const adapter = getAdapter(provider);
    if (!adapter) {
      return res.status(400).json({ error: 'Provider is not enabled' });
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

    const state = createStateValue();
    await storeOAuthState(getUserId(req), provider, state);

    return res.json({
      provider,
      status: 'authorization_required',
      authorization_url: adapter.buildAuthorizationUrl(state),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/connections/:provider/disconnect', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (!getAdapter(provider)) {
      return res.status(400).json({ error: 'Provider is not enabled' });
    }

    await disconnectProviderConnection(getUserId(req), provider);

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/run', validate(calendarSyncRun), async (req, res, next) => {
  try {
    const params = [getUserId(req)];
    let where = 'user_id=? AND sync_enabled=1';

    if (req.body.provider) {
      if (!getAdapter(req.body.provider)) {
        return res.status(400).json({ error: 'Provider is not enabled' });
      }
      where += ' AND provider=?';
      params.push(req.body.provider);
    }

    const result = await db.query(`SELECT * FROM calendar_sync_connections WHERE ${where}`, params);
    const connections = getRows(result) || [];
    const results = [];

    for (const connection of connections) {
      const adapter = getAdapter(connection.provider);
      if (!adapter) continue;
      const syncResult = await runSyncForConnection(connection, adapter);
      results.push({ provider: connection.provider, ...syncResult });
    }

    if (results.some((result) => result.error)) {
      return res.status(502).json({ error: 'Calendar sync failed.', results });
    }
    if (results.some((result) => result.skipped)) {
      return res.status(409).json({ error: 'Calendar sync already running.', results });
    }

    return res.json({ results });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/status', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT c.id,
              c.user_id,
              u.name,
              u.email,
              c.provider,
              c.provider_account_email,
              c.sync_enabled,
              c.privacy_default,
              c.last_sync_at,
              c.sync_status,
              c.sync_error
       FROM calendar_sync_connections c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.sync_status DESC, u.name ASC, c.provider ASC`
    );

    const connections = (getRows(result) || []).map((row) => ({
      ...row,
      ...defaultSyncOverviewCounts(),
    }));

    if (req.query.start_date && req.query.end_date) {
      const overviewResult = await db.query(
        `SELECT se.user_id,
                se.source_provider AS provider,
                SUM(CASE WHEN se.visibility = 'shared_details' THEN 1 ELSE 0 END) AS shared_event_count,
                SUM(CASE WHEN se.visibility <> 'shared_details' THEN 1 ELSE 0 END) AS hidden_event_count,
                SUM(CASE WHEN se.details_shareable = 0
                          OR (se.provider_sensitivity IS NOT NULL AND se.provider_sensitivity <> 'normal')
                         THEN 1 ELSE 0 END) AS protected_event_count,
                COUNT(*) AS total_synced_event_count
         FROM schedule_entries se
         WHERE se.source_provider IS NOT NULL
           AND se.source_event_id IS NOT NULL
           AND se.start_date <= ?
           AND se.end_date >= ?
         GROUP BY se.user_id, se.source_provider`,
        [req.query.end_date, req.query.start_date]
      );
      const overviewByConnection = new Map(
        (getRows(overviewResult) || []).map((row) => [syncOverviewKey(row), {
          shared_event_count: Number(row.shared_event_count) || 0,
          hidden_event_count: Number(row.hidden_event_count) || 0,
          protected_event_count: Number(row.protected_event_count) || 0,
          total_synced_event_count: Number(row.total_synced_event_count) || 0,
        }])
      );

      connections.forEach((connection) => {
        Object.assign(connection, overviewByConnection.get(syncOverviewKey(connection)) || defaultSyncOverviewCounts());
      });
    }

    return res.json({ connections });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
