const crypto = require('crypto');
const db = require('../../db/connection');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function createStateValue() {
  return crypto.randomBytes(32).toString('base64url');
}

function stateExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

async function storeOAuthState(userId, provider, state) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET oauth_state = ?, oauth_state_expires_at = ?
     WHERE user_id = ? AND provider = ?`,
    [state, stateExpiry(), userId, provider]
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

  await db.query(
    `UPDATE calendar_sync_connections
     SET oauth_state = NULL, oauth_state_expires_at = NULL
     WHERE id = ?`,
    [connection.id]
  );

  return connection;
}

module.exports = {
  createStateValue,
  consumeOAuthState,
  storeOAuthState,
};
