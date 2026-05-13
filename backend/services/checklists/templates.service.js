// Template CRUD service. All callers must pass userId — every read/write is
// scoped to the owning user.

const db = require('../../db/connection');
const authz = require('./authz');
const { withTransaction } = require('./helpers');

/**
 * List templates visible to a user: their own templates plus the platform's
 * global ("general") templates. Sort: globals first (by name), then personals.
 */
async function list(userId) {
  const [rows] = await db.query(
    `SELECT id, name, description, is_global, user_id, created_at, updated_at
     FROM checklist_templates
     WHERE user_id = ? OR is_global = TRUE
     ORDER BY is_global DESC, name`,
    [userId],
  );
  return rows;
}

async function getById(userId, templateId) {
  const template = await _readForAccess(userId, templateId);

  const [items] = await db.query(
    'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id',
    [template.id],
  );

  let subitems = [];
  if (items.length) {
    const itemIds = items.map(i => i.id);
    [subitems] = await db.query(
      `SELECT * FROM checklist_template_subitems WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY sort_order, id`,
      itemIds,
    );
  }

  const subitemsByItem = {};
  for (const si of subitems) {
    (subitemsByItem[si.item_id] = subitemsByItem[si.item_id] || []).push(si);
  }

  template.items = items.map(item => ({
    ...item,
    subitems: subitemsByItem[item.id] || [],
  }));

  return template;
}

async function create(userId, { name, description, items }) {
  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      'INSERT INTO checklist_templates (user_id, name, description) VALUES (?, ?, ?)',
      [userId, name, description || null],
    );
    const templateId = result.insertId;
    await _insertTemplateItems(conn, templateId, items || []);
    const [tpl] = await conn.query('SELECT * FROM checklist_templates WHERE id = ?', [templateId]);
    return tpl[0];
  });
}

async function update(userId, templateId, { name, description, items }) {
  return withTransaction(async (conn) => {
    // Ownership check — global templates are read-only for users.
    const [existing] = await conn.query(
      'SELECT id, is_global FROM checklist_templates WHERE id = ? AND user_id = ?',
      [templateId, userId],
    );
    if (!existing.length) {
      const err = new Error('Template not found or is read-only');
      err.status = 404;
      throw err;
    }
    if (existing[0].is_global) {
      const err = new Error('Global templates are read-only — copy it to your library first');
      err.status = 403;
      throw err;
    }

    const updates = [];
    const vals = [];
    if (name !== undefined) { updates.push('name = ?'); vals.push(name); }
    if (description !== undefined) { updates.push('description = ?'); vals.push(description); }
    if (updates.length) {
      updates.push('updated_at = NOW()');
      await conn.query(
        `UPDATE checklist_templates SET ${updates.join(', ')} WHERE id = ?`,
        [...vals, templateId],
      );
    }

    if (items !== undefined) {
      await conn.query('DELETE FROM checklist_template_items WHERE template_id = ?', [templateId]);
      await _insertTemplateItems(conn, templateId, items);
    }

    return { success: true };
  });
}

async function remove(userId, templateId) {
  // Global templates cannot be deleted by regular users — only personal ones.
  const [result] = await db.query(
    'DELETE FROM checklist_templates WHERE id = ? AND user_id = ? AND is_global = FALSE',
    [templateId, userId],
  );
  if (result.affectedRows === 0) {
    const err = new Error('Template not found or is read-only');
    err.status = 404;
    throw err;
  }
}

/**
 * Read a template for read-only access (user-owned OR global).
 * Returns the row. Throws 404 on miss.
 */
async function _readForAccess(userId, templateId) {
  const [rows] = await db.query(
    'SELECT * FROM checklist_templates WHERE id = ? AND (user_id = ? OR is_global = TRUE)',
    [templateId, userId],
  );
  if (!rows.length) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

async function _insertTemplateItems(conn, templateId, items) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const [ir] = await conn.query(
      'INSERT INTO checklist_template_items (template_id, name, default_status, sort_order) VALUES (?, ?, ?, ?)',
      [templateId, item.name, item.default_status || 'not_started', item.sort_order ?? i],
    );
    const itemId = ir.insertId;
    if (item.subitems?.length) {
      for (let j = 0; j < item.subitems.length; j++) {
        const si = item.subitems[j];
        await conn.query(
          'INSERT INTO checklist_template_subitems (item_id, name, default_status, sort_order) VALUES (?, ?, ?, ?)',
          [itemId, si.name, si.default_status || 'not_started', si.sort_order ?? j],
        );
      }
    }
  }
}

module.exports = { list, getById, create, update, remove };
