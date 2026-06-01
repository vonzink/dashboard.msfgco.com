const crypto = require('crypto');
const db = require('../../db/connection');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function getAffectedRows(result) {
  const summary = Array.isArray(result) ? result[0] : result;
  return summary?.affectedRows || 0;
}

function createStateValue() {
  return crypto.randomBytes(32).toString('base64url');
}

async function storeOAuthState(userId, provider, state) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET oauth_state = ?, oauth_state_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)
     WHERE user_id = ? AND provider = ?`,
    [state, userId, provider]
  );
}

async function consumeOAuthState(provider, state) {
  const result = await db.query(
    `SELECT *
     FROM calendar_sync_connections
     WHERE provider = ? AND oauth_state = ? AND oauth_state_expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [provider, state]
  );
  const rows = getRows(result) || [];
  const connection = rows[0] || null;

  if (!connection) return null;

  const updateResult = await db.query(
    `UPDATE calendar_sync_connections
     SET oauth_state = NULL, oauth_state_expires_at = NULL
     WHERE id = ? AND provider = ? AND oauth_state = ? AND oauth_state_expires_at > UTC_TIMESTAMP()`,
    [connection.id, provider, state]
  );

  return getAffectedRows(updateResult) > 0 ? connection : null;
}

module.exports = {
  createStateValue,
  consumeOAuthState,
  storeOAuthState,
};
