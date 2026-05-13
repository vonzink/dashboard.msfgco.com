const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { ok, created, deleted, fail } = require('../utils/response');
const {
  checklistTemplate: templateSchema,
  checklistTemplateUpdate: templateUpdateSchema,
  loanChecklistAssign: assignSchema,
  loanChecklistItemUpdate: itemUpdateSchema,
  loanChecklistItemCreate: itemCreateSchema,
  loanChecklistSubitemCreate: subitemCreateSchema,
  loanChecklistImport: importSchema,
  validate,
} = require('../validation/schemas');

router.use(requireDbUser);

// ════════════════════════════════════════════════
//  CHECKLIST TEMPLATES
// ════════════════════════════════════════════════

// GET /api/checklists/templates
router.get('/templates', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [templates] = await db.query(
      `SELECT id, name, description, created_at, updated_at
       FROM checklist_templates WHERE user_id = ? ORDER BY name`,
      [userId]
    );
    ok(res, templates);
  } catch (err) { next(err); }
});

// GET /api/checklists/templates/:id
router.get('/templates/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [templates] = await db.query(
      'SELECT * FROM checklist_templates WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!templates.length) return fail(res, 'Template not found', 404);

    const template = templates[0];
    const [items] = await db.query(
      'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id',
      [template.id]
    );

    const itemIds = items.map(i => i.id);
    let subitems = [];
    if (itemIds.length) {
      [subitems] = await db.query(
        `SELECT * FROM checklist_template_subitems WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY sort_order, id`,
        itemIds
      );
    }

    const subitemsByItem = {};
    for (const si of subitems) {
      if (!subitemsByItem[si.item_id]) subitemsByItem[si.item_id] = [];
      subitemsByItem[si.item_id].push(si);
    }

    template.items = items.map(item => ({
      ...item,
      subitems: subitemsByItem[item.id] || [],
    }));

    ok(res, template);
  } catch (err) { next(err); }
});

// POST /api/checklists/templates
router.post('/templates', validate(templateSchema), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const { name, description, items } = req.body;

    const [result] = await conn.query(
      'INSERT INTO checklist_templates (user_id, name, description) VALUES (?, ?, ?)',
      [userId, name, description || null]
    );
    const templateId = result.insertId;

    await _insertTemplateItems(conn, templateId, items || []);
    await conn.commit();

    const [tpl] = await db.query('SELECT * FROM checklist_templates WHERE id = ?', [templateId]);
    created(res, tpl[0]);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// PUT /api/checklists/templates/:id
router.put('/templates/:id', validate(templateUpdateSchema), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const { name, description, items } = req.body;

    const [existing] = await conn.query(
      'SELECT id FROM checklist_templates WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (!existing.length) {
      await conn.rollback();
      return fail(res, 'Template not found', 404);
    }

    const updates = [];
    const vals = [];
    if (name !== undefined) { updates.push('name = ?'); vals.push(name); }
    if (description !== undefined) { updates.push('description = ?'); vals.push(description); }
    if (updates.length) {
      updates.push('updated_at = NOW()');
      await conn.query(
        `UPDATE checklist_templates SET ${updates.join(', ')} WHERE id = ?`,
        [...vals, req.params.id]
      );
    }

    if (items !== undefined) {
      await conn.query('DELETE FROM checklist_template_items WHERE template_id = ?', [req.params.id]);
      await _insertTemplateItems(conn, req.params.id, items);
    }

    await conn.commit();
    ok(res, { success: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// DELETE /api/checklists/templates/:id
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [result] = await db.query(
      'DELETE FROM checklist_templates WHERE id = ? AND user_id = ?',
      [req.params.id, userId]
    );
    if (result.affectedRows === 0) return fail(res, 'Template not found', 404);
    deleted(res);
  } catch (err) { next(err); }
});

async function _insertTemplateItems(conn, templateId, items) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const [ir] = await conn.query(
      'INSERT INTO checklist_template_items (template_id, name, default_status, sort_order) VALUES (?, ?, ?, ?)',
      [templateId, item.name, item.default_status || 'not_started', item.sort_order ?? i]
    );
    const itemId = ir.insertId;
    if (item.subitems?.length) {
      for (let j = 0; j < item.subitems.length; j++) {
        const si = item.subitems[j];
        await conn.query(
          'INSERT INTO checklist_template_subitems (item_id, name, default_status, sort_order) VALUES (?, ?, ?, ?)',
          [itemId, si.name, si.default_status || 'not_started', si.sort_order ?? j]
        );
      }
    }
  }
}

// ════════════════════════════════════════════════
//  LOAN CHECKLISTS
// ════════════════════════════════════════════════

// GET /api/checklists/loan/:sourceType/:sourceItemId
router.get('/loan/:sourceType/:sourceItemId', async (req, res, next) => {
  try {
    const { sourceType, sourceItemId } = req.params;
    const checklist = await _getFullLoanChecklist(sourceType, sourceItemId);
    ok(res, checklist);
  } catch (err) { next(err); }
});

// POST /api/checklists/loan/:sourceType/:sourceItemId/assign — apply template
router.post('/loan/:sourceType/:sourceItemId/assign', validate(assignSchema), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const { sourceType, sourceItemId } = req.params;
    const { template_id } = req.body;

    const [tpl] = await conn.query('SELECT * FROM checklist_templates WHERE id = ?', [template_id]);
    if (!tpl.length) { await conn.rollback(); return fail(res, 'Template not found', 404); }

    // Delete existing checklist if any
    await conn.query(
      'DELETE FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId]
    );

    const clientName = await _getClientName(conn, sourceType, sourceItemId);

    const [clResult] = await conn.query(
      `INSERT INTO loan_checklists (source_type, source_item_id, source_template_id, assigned_by_user_id, client_name)
       VALUES (?, ?, ?, ?, ?)`,
      [sourceType, sourceItemId, template_id, userId, clientName]
    );
    const checklistId = clResult.insertId;

    const [tplItems] = await conn.query(
      'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id',
      [template_id]
    );

    for (const tplItem of tplItems) {
      const [itemResult] = await conn.query(
        'INSERT INTO loan_checklist_items (checklist_id, name, status, sort_order) VALUES (?, ?, ?, ?)',
        [checklistId, tplItem.name, tplItem.default_status || 'not_started', tplItem.sort_order]
      );
      const itemId = itemResult.insertId;

      const [tplSubitems] = await conn.query(
        'SELECT * FROM checklist_template_subitems WHERE item_id = ? ORDER BY sort_order, id',
        [tplItem.id]
      );
      for (const si of tplSubitems) {
        await conn.query(
          'INSERT INTO loan_checklist_subitems (item_id, name, status, sort_order) VALUES (?, ?, ?, ?)',
          [itemId, si.name, si.default_status || 'not_started', si.sort_order]
        );
      }
    }

    await conn.commit();
    const checklist = await _getFullLoanChecklist(sourceType, sourceItemId);
    created(res, checklist);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// POST /api/checklists/loan/:sourceType/:sourceItemId/items — add item
router.post('/loan/:sourceType/:sourceItemId/items', validate(itemCreateSchema), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { sourceType, sourceItemId } = req.params;
    const checklist = await _ensureChecklist(conn, sourceType, sourceItemId, getUserId(req));

    const { name, status, date, sort_order, subitems } = req.body;
    const [ir] = await conn.query(
      'INSERT INTO loan_checklist_items (checklist_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
      [checklist.id, name, status, date || null, sort_order]
    );
    const itemId = ir.insertId;

    if (subitems?.length) {
      for (const si of subitems) {
        await conn.query(
          'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
          [itemId, si.name, si.status || 'not_started', si.date || null, si.sort_order || 0]
        );
      }
    }

    await conn.query('UPDATE loan_checklists SET updated_at = NOW() WHERE id = ?', [checklist.id]);
    await conn.commit();
    const [items] = await db.query('SELECT * FROM loan_checklist_items WHERE id = ?', [itemId]);
    created(res, items[0]);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// PUT /api/checklists/loan-items/:itemId — update item
router.put('/loan-items/:itemId', validate(itemUpdateSchema), async (req, res, next) => {
  try {
    const { name, status, date, sort_order } = req.body;
    const updates = [];
    const vals = [];
    if (name !== undefined) { updates.push('name = ?'); vals.push(name); }
    if (status !== undefined) { updates.push('status = ?'); vals.push(status); }
    if (date !== undefined) { updates.push('date = ?'); vals.push(date); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); vals.push(sort_order); }
    updates.push('updated_at = NOW()');

    await db.query(
      `UPDATE loan_checklist_items SET ${updates.join(', ')} WHERE id = ?`,
      [...vals, req.params.itemId]
    );

    // Touch parent checklist
    await db.query(
      `UPDATE loan_checklists SET updated_at = NOW()
       WHERE id = (SELECT checklist_id FROM loan_checklist_items WHERE id = ?)`,
      [req.params.itemId]
    );

    const [items] = await db.query('SELECT * FROM loan_checklist_items WHERE id = ?', [req.params.itemId]);
    ok(res, items[0] || { success: true });
  } catch (err) { next(err); }
});

// DELETE /api/checklists/loan-items/:itemId
router.delete('/loan-items/:itemId', async (req, res, next) => {
  try {
    await db.query('DELETE FROM loan_checklist_items WHERE id = ?', [req.params.itemId]);
    deleted(res);
  } catch (err) { next(err); }
});

// POST /api/checklists/loan-items/:itemId/subitems — add subitem
router.post('/loan-items/:itemId/subitems', validate(subitemCreateSchema), async (req, res, next) => {
  try {
    const { name, status, date, sort_order } = req.body;
    const [result] = await db.query(
      'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
      [req.params.itemId, name, status || 'not_started', date || null, sort_order || 0]
    );
    const [rows] = await db.query('SELECT * FROM loan_checklist_subitems WHERE id = ?', [result.insertId]);
    created(res, rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/checklists/loan-subitems/:subitemId
router.put('/loan-subitems/:subitemId', validate(itemUpdateSchema), async (req, res, next) => {
  try {
    const { name, status, date, sort_order } = req.body;
    const updates = [];
    const vals = [];
    if (name !== undefined) { updates.push('name = ?'); vals.push(name); }
    if (status !== undefined) { updates.push('status = ?'); vals.push(status); }
    if (date !== undefined) { updates.push('date = ?'); vals.push(date); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); vals.push(sort_order); }
    updates.push('updated_at = NOW()');

    await db.query(
      `UPDATE loan_checklist_subitems SET ${updates.join(', ')} WHERE id = ?`,
      [...vals, req.params.subitemId]
    );
    const [rows] = await db.query('SELECT * FROM loan_checklist_subitems WHERE id = ?', [req.params.subitemId]);
    ok(res, rows[0] || { success: true });
  } catch (err) { next(err); }
});

// DELETE /api/checklists/loan-subitems/:subitemId
router.delete('/loan-subitems/:subitemId', async (req, res, next) => {
  try {
    await db.query('DELETE FROM loan_checklist_subitems WHERE id = ?', [req.params.subitemId]);
    deleted(res);
  } catch (err) { next(err); }
});

// POST /api/checklists/loan/:sourceType/:sourceItemId/import — import from parsed MD
router.post('/loan/:sourceType/:sourceItemId/import', validate(importSchema), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const { sourceType, sourceItemId } = req.params;
    const { items, mode } = req.body;

    const [existing] = await conn.query(
      'SELECT id FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId]
    );

    if (existing.length && mode === 'merge') {
      const checklistId = existing[0].id;
      const [currentItems] = await conn.query(
        'SELECT * FROM loan_checklist_items WHERE checklist_id = ? ORDER BY sort_order',
        [checklistId]
      );
      const nameMap = {};
      for (const ci of currentItems) nameMap[ci.name.toLowerCase()] = ci;

      let maxSort = currentItems.reduce((m, i) => Math.max(m, i.sort_order), 0);
      for (const incoming of items) {
        const key = incoming.name.toLowerCase();
        if (nameMap[key]) {
          // Prefer incoming status if it's more progressed
          const statusOrder = { not_started: 0, in_progress: 1, done: 2, issue: 3, na: 4 };
          const incomingOrder = statusOrder[incoming.status] ?? 0;
          const currentOrder = statusOrder[nameMap[key].status] ?? 0;
          if (incomingOrder > currentOrder) {
            await conn.query(
              'UPDATE loan_checklist_items SET status = ?, updated_at = NOW() WHERE id = ?',
              [incoming.status, nameMap[key].id]
            );
          }
          if (incoming.date && !nameMap[key].date) {
            await conn.query(
              'UPDATE loan_checklist_items SET date = ?, updated_at = NOW() WHERE id = ?',
              [incoming.date, nameMap[key].id]
            );
          }
        } else {
          maxSort++;
          const [ir] = await conn.query(
            'INSERT INTO loan_checklist_items (checklist_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
            [checklistId, incoming.name, incoming.status || 'not_started', incoming.date || null, maxSort]
          );
          if (incoming.subitems?.length) {
            for (let j = 0; j < incoming.subitems.length; j++) {
              const si = incoming.subitems[j];
              await conn.query(
                'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
                [ir.insertId, si.name, si.status || 'not_started', si.date || null, j]
              );
            }
          }
        }
      }
      await conn.query('UPDATE loan_checklists SET updated_at = NOW() WHERE id = ?', [checklistId]);
    } else {
      // Replace or create new
      if (existing.length) {
        await conn.query('DELETE FROM loan_checklists WHERE source_type = ? AND source_item_id = ?', [sourceType, sourceItemId]);
      }
      const clientName = await _getClientName(conn, sourceType, sourceItemId);
      const [clResult] = await conn.query(
        'INSERT INTO loan_checklists (source_type, source_item_id, assigned_by_user_id, client_name) VALUES (?, ?, ?, ?)',
        [sourceType, sourceItemId, userId, clientName]
      );
      const checklistId = clResult.insertId;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const [ir] = await conn.query(
          'INSERT INTO loan_checklist_items (checklist_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
          [checklistId, item.name, item.status || 'not_started', item.date || null, item.sort_order ?? i]
        );
        if (item.subitems?.length) {
          for (let j = 0; j < item.subitems.length; j++) {
            const si = item.subitems[j];
            await conn.query(
              'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
              [ir.insertId, si.name, si.status || 'not_started', si.date || null, j]
            );
          }
        }
      }
    }

    await conn.commit();
    const checklist = await _getFullLoanChecklist(sourceType, sourceItemId);
    ok(res, checklist);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// GET /api/checklists/loan/:sourceType/:sourceItemId/export — export as structured JSON for MD generation
router.get('/loan/:sourceType/:sourceItemId/export', async (req, res, next) => {
  try {
    const checklist = await _getFullLoanChecklist(req.params.sourceType, req.params.sourceItemId);
    if (!checklist) return fail(res, 'No checklist found', 404);
    ok(res, checklist);
  } catch (err) { next(err); }
});

// GET /api/checklists/status/:sourceType — batch check which items have checklists
router.get('/status/:sourceType', async (req, res, next) => {
  try {
    const { sourceType } = req.params;
    const [rows] = await db.query(
      `SELECT source_item_id,
              (SELECT COUNT(*) FROM loan_checklist_items WHERE checklist_id = lc.id) AS total,
              (SELECT COUNT(*) FROM loan_checklist_items WHERE checklist_id = lc.id AND status = 'done') AS done
       FROM loan_checklists lc WHERE source_type = ?`,
      [sourceType]
    );
    const map = {};
    for (const r of rows) map[r.source_item_id] = { total: r.total, done: r.done };
    ok(res, map);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════

async function _getFullLoanChecklist(sourceType, sourceItemId) {
  const [checklists] = await db.query(
    'SELECT * FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
    [sourceType, sourceItemId]
  );
  if (!checklists.length) return null;

  const cl = checklists[0];
  const [items] = await db.query(
    'SELECT * FROM loan_checklist_items WHERE checklist_id = ? ORDER BY sort_order, id',
    [cl.id]
  );

  const itemIds = items.map(i => i.id);
  let subitems = [];
  if (itemIds.length) {
    [subitems] = await db.query(
      `SELECT * FROM loan_checklist_subitems WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY sort_order, id`,
      itemIds
    );
  }

  const subitemsByItem = {};
  for (const si of subitems) {
    if (!subitemsByItem[si.item_id]) subitemsByItem[si.item_id] = [];
    subitemsByItem[si.item_id].push(si);
  }

  cl.items = items.map(item => ({
    ...item,
    subitems: subitemsByItem[item.id] || [],
  }));

  // Template name
  if (cl.source_template_id) {
    const [tpl] = await db.query('SELECT name FROM checklist_templates WHERE id = ?', [cl.source_template_id]);
    cl.source_template_name = tpl[0]?.name || null;
  }

  return cl;
}

async function _getClientName(conn, sourceType, sourceItemId) {
  const tableMap = { pipeline: 'pipeline', pre_approval: 'pre_approvals', application: 'pipeline' };
  const table = tableMap[sourceType];
  if (!table) return null;
  try {
    const [rows] = await conn.query(`SELECT client_name FROM ${table} WHERE id = ?`, [sourceItemId]);
    return rows[0]?.client_name || null;
  } catch { return null; }
}

async function _ensureChecklist(conn, sourceType, sourceItemId, userId) {
  const [existing] = await conn.query(
    'SELECT * FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
    [sourceType, sourceItemId]
  );
  if (existing.length) return existing[0];

  const clientName = await _getClientName(conn, sourceType, sourceItemId);
  const [result] = await conn.query(
    'INSERT INTO loan_checklists (source_type, source_item_id, assigned_by_user_id, client_name) VALUES (?, ?, ?, ?)',
    [sourceType, sourceItemId, userId, clientName]
  );
  return { id: result.insertId, source_type: sourceType, source_item_id: sourceItemId };
}

module.exports = router;
