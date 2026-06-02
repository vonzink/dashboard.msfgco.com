const db = require('../../db/connection');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

async function persistRefreshedTokens(connection, refreshed) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET encrypted_access_token = ?,
         encrypted_refresh_token = ?,
         access_token_expires_at = ?,
         scopes = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      refreshed.encrypted_access_token,
      refreshed.encrypted_refresh_token,
      refreshed.access_token_expires_at,
      refreshed.scopes || null,
      connection.id,
    ]
  );
}

function prepareConnection(connection) {
  return {
    ...connection,
    persistRefreshedTokens: async (refreshed) => {
      Object.assign(connection, refreshed);
      await persistRefreshedTokens(connection, refreshed);
    },
  };
}

async function loadWritableConnection(userId, provider) {
  const result = await db.query(
    `SELECT *
     FROM calendar_sync_connections
     WHERE user_id = ?
       AND provider = ?
       AND sync_enabled = 1
       AND encrypted_access_token IS NOT NULL
     LIMIT 1`,
    [userId, provider]
  );
  const connection = (getRows(result) || [])[0] || null;
  return connection ? prepareConnection(connection) : null;
}

module.exports = {
  loadWritableConnection,
  prepareConnection,
  persistRefreshedTokens,
};
