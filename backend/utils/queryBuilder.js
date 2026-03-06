/**
 * utils/queryBuilder.js
 *
 * Dynamic UPDATE query builder.
 * Replaces the repeated `if (field !== undefined) { updates.push(); values.push(); }` pattern.
 */

/**
 * Build a parameterized UPDATE statement from a data object.
 *
 * @param {string}   table          – Table name
 * @param {string[]} allowedFields  – Whitelist of column names the caller may set
 * @param {object}   data           – Request body (only keys in allowedFields with value !== undefined are used)
 * @param {{ clause: string, values: any[] }} where – WHERE clause and its bind values
 * @returns {{ sql: string, values: any[] } | null} – null when nothing to update
 */
function buildUpdate(table, allowedFields, data, where) {
  const entries = Object.entries(data)
    .filter(([k, v]) => v !== undefined && allowedFields.includes(k));

  if (!entries.length) return null;

  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
  const setValues  = entries.map(([, v]) => v);

  return {
    sql: `UPDATE ${table} SET ${setClauses}, updated_at = NOW() WHERE ${where.clause}`,
    values: [...setValues, ...where.values],
  };
}

module.exports = { buildUpdate };
