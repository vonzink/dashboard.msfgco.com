// Shared helpers for checklist services.

const db = require('../../db/connection');

/**
 * Resolve the client_name for a (sourceType, sourceItemId).
 * Used to snapshot the client name into loan_checklists at insert-time.
 *
 * Returns null on miss. Throws on driver errors so callers see real problems
 * instead of silently nulling.
 */
async function getClientName(conn, sourceType, sourceItemId) {
  switch (sourceType) {
    case 'pipeline':
    case 'application': {
      const [rows] = await conn.query(
        'SELECT client_name FROM pipeline WHERE id = ?', [sourceItemId],
      );
      return rows[0]?.client_name || null;
    }
    case 'pre_approval': {
      const [rows] = await conn.query(
        'SELECT client_name FROM pre_approvals WHERE id = ?', [sourceItemId],
      );
      return rows[0]?.client_name || null;
    }
    case 'funded': {
      const [rows] = await conn.query(
        'SELECT client_name FROM funded_loans WHERE id = ?', [sourceItemId],
      );
      return rows[0]?.client_name || null;
    }
    default:
      return null;
  }
}

/**
 * Build dynamic UPDATE clause from a body and an allowlist of column names.
 * Returns `null` if nothing to update.
 */
function buildDynamicUpdate(table, id, allowedFields, body) {
  const updates = [];
  const vals = [];
  for (const f of allowedFields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      vals.push(body[f]);
    }
  }
  if (!updates.length) return null;
  updates.push('updated_at = NOW()');
  return {
    sql: `UPDATE ${table} SET ${updates.join(', ')} WHERE id = ?`,
    params: [...vals, id],
  };
}

/**
 * Run an async function inside a MySQL transaction. Auto-commits on success,
 * rolls back on throw. Always releases the connection.
 */
async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getClientName,
  buildDynamicUpdate,
  withTransaction,
};
