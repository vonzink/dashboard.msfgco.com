// Loan checklist service — CRUD + import/export + status aggregation.
// Every mutation enforces loan-access via authz.requireLoanAccess() or
// authz.requireChecklist{Item,Subitem}Access().

const db = require('../../db/connection');
const authz = require('./authz');
const { getClientName, buildDynamicUpdate, withTransaction } = require('./helpers');

// ──────────────────────────────────────────
//  READ
// ──────────────────────────────────────────

async function getForLoan(sourceType, sourceItemId) {
  await authz.requireLoanAccess(sourceType, sourceItemId);
  const [checklists] = await db.query(
    'SELECT * FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
    [sourceType, sourceItemId],
  );
  if (!checklists.length) return null;
  return _hydrate(checklists[0]);
}

async function getStatusMap(sourceType) {
  const [rows] = await db.query(
    `SELECT lc.source_item_id,
            COUNT(lci.id) AS total,
            SUM(CASE WHEN lci.status = 'done' THEN 1 ELSE 0 END) AS done
     FROM loan_checklists lc
     LEFT JOIN loan_checklist_items lci ON lci.checklist_id = lc.id
     WHERE lc.source_type = ?
     GROUP BY lc.source_item_id`,
    [sourceType],
  );
  const map = {};
  for (const r of rows) {
    map[r.source_item_id] = {
      total: Number(r.total) || 0,
      done: Number(r.done) || 0,
    };
  }
  return map;
}

// ──────────────────────────────────────────
//  ASSIGN TEMPLATE
// ──────────────────────────────────────────

async function assignTemplate(userId, sourceType, sourceItemId, templateId) {
  await authz.requireLoanAccess(sourceType, sourceItemId);

  return withTransaction(async (conn) => {
    // Allow assigning either the user's own templates or any global one
    const [tpl] = await conn.query(
      'SELECT * FROM checklist_templates WHERE id = ? AND (user_id = ? OR is_global = TRUE)',
      [templateId, userId],
    );
    if (!tpl.length) {
      const err = new Error('Template not found');
      err.status = 404;
      throw err;
    }

    // Replace any existing checklist on this loan (1:1 for now)
    await conn.query(
      'DELETE FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );

    const clientName = await getClientName(conn, sourceType, sourceItemId);
    const [clResult] = await conn.query(
      `INSERT INTO loan_checklists
         (source_type, source_item_id, source_template_id, assigned_by_user_id, client_name)
       VALUES (?, ?, ?, ?, ?)`,
      [sourceType, sourceItemId, templateId, userId, clientName],
    );
    const checklistId = clResult.insertId;

    const [tplItems] = await conn.query(
      'SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id',
      [templateId],
    );

    for (const tplItem of tplItems) {
      const [itemResult] = await conn.query(
        'INSERT INTO loan_checklist_items (checklist_id, name, status, sort_order) VALUES (?, ?, ?, ?)',
        [checklistId, tplItem.name, tplItem.default_status || 'not_started', tplItem.sort_order],
      );
      const itemId = itemResult.insertId;

      const [tplSubitems] = await conn.query(
        'SELECT * FROM checklist_template_subitems WHERE item_id = ? ORDER BY sort_order, id',
        [tplItem.id],
      );
      for (const si of tplSubitems) {
        await conn.query(
          'INSERT INTO loan_checklist_subitems (item_id, name, status, sort_order) VALUES (?, ?, ?, ?)',
          [itemId, si.name, si.default_status || 'not_started', si.sort_order],
        );
      }
    }

    // Re-read with hydration outside the transaction would race; hydrate via the same conn.
    return _hydrateById(conn, checklistId);
  });
}

// ──────────────────────────────────────────
//  ITEM CRUD
// ──────────────────────────────────────────

async function addItem(userId, sourceType, sourceItemId, body) {
  await authz.requireLoanAccess(sourceType, sourceItemId);

  return withTransaction(async (conn) => {
    const checklist = await _ensureChecklist(conn, sourceType, sourceItemId, userId);
    const { name, status, date, sort_order, subitems } = body;

    const [ir] = await conn.query(
      'INSERT INTO loan_checklist_items (checklist_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
      [checklist.id, name, status, date || null, sort_order],
    );
    const itemId = ir.insertId;

    if (subitems?.length) {
      for (const si of subitems) {
        await conn.query(
          'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
          [itemId, si.name, si.status || 'not_started', si.date || null, si.sort_order || 0],
        );
      }
    }

    await conn.query('UPDATE loan_checklists SET updated_at = NOW() WHERE id = ?', [checklist.id]);
    const [items] = await conn.query('SELECT * FROM loan_checklist_items WHERE id = ?', [itemId]);
    return items[0];
  });
}

async function updateItem(userId, itemId, body) {
  const parent = await authz.requireChecklistItemAccess(userId, itemId);
  const allowed = ['name', 'status', 'importance', 'date', 'sort_order'];
  const update = buildDynamicUpdate('loan_checklist_items', itemId, allowed, body);
  if (!update) return _readItem(itemId);

  await db.query(update.sql, update.params);
  // Touch parent checklist for cache-busting / freshness
  await db.query('UPDATE loan_checklists SET updated_at = NOW() WHERE id = ?', [parent.id]);
  return _readItem(itemId);
}

/**
 * Batch reorder: accepts [{ id, sort_order }, ...]. Verifies every item
 * belongs to a checklist the user can edit before writing.
 */
async function reorderItems(userId, sourceType, sourceItemId, items) {
  await authz.requireLoanAccess(sourceType, sourceItemId);

  return withTransaction(async (conn) => {
    // Ensure every incoming id belongs to a checklist on THIS loan
    const ids = items.map(i => i.id);
    if (!ids.length) return { updated: 0 };

    const [rows] = await conn.query(
      `SELECT lci.id FROM loan_checklist_items lci
       JOIN loan_checklists lc ON lc.id = lci.checklist_id
       WHERE lc.source_type = ? AND lc.source_item_id = ?
         AND lci.id IN (${ids.map(() => '?').join(',')})`,
      [sourceType, sourceItemId, ...ids],
    );
    const owned = new Set(rows.map(r => r.id));
    for (const id of ids) {
      if (!owned.has(id)) {
        const err = new Error('One or more items do not belong to this loan');
        err.status = 403;
        throw err;
      }
    }

    for (const { id, sort_order } of items) {
      await conn.query(
        'UPDATE loan_checklist_items SET sort_order = ?, updated_at = NOW() WHERE id = ?',
        [sort_order, id],
      );
    }
    // Touch every affected parent checklist
    await conn.query(
      `UPDATE loan_checklists SET updated_at = NOW()
       WHERE id IN (SELECT checklist_id FROM loan_checklist_items WHERE id IN (${ids.map(() => '?').join(',')}))`,
      ids,
    );

    return { updated: ids.length };
  });
}

async function deleteItem(userId, itemId) {
  await authz.requireChecklistItemAccess(userId, itemId);
  await db.query('DELETE FROM loan_checklist_items WHERE id = ?', [itemId]);
}

// ──────────────────────────────────────────
//  SUBITEM CRUD
// ──────────────────────────────────────────

async function addSubitem(userId, itemId, body) {
  await authz.requireChecklistItemAccess(userId, itemId);
  const { name, status, date, sort_order } = body;

  return withTransaction(async (conn) => {
    const [result] = await conn.query(
      'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
      [itemId, name, status || 'not_started', date || null, sort_order || 0],
    );
    const [rows] = await conn.query('SELECT * FROM loan_checklist_subitems WHERE id = ?', [result.insertId]);
    return rows[0];
  });
}

async function updateSubitem(userId, subitemId, body) {
  await authz.requireChecklistSubitemAccess(userId, subitemId);
  const allowed = ['name', 'status', 'date', 'sort_order'];
  const update = buildDynamicUpdate('loan_checklist_subitems', subitemId, allowed, body);
  if (!update) return _readSubitem(subitemId);
  await db.query(update.sql, update.params);
  return _readSubitem(subitemId);
}

async function deleteSubitem(userId, subitemId) {
  await authz.requireChecklistSubitemAccess(userId, subitemId);
  await db.query('DELETE FROM loan_checklist_subitems WHERE id = ?', [subitemId]);
}

// ──────────────────────────────────────────
//  IMPORT (replace | merge)
// ──────────────────────────────────────────

async function importItems(userId, sourceType, sourceItemId, { items, mode, name }) {
  await authz.requireLoanAccess(sourceType, sourceItemId);

  return withTransaction(async (conn) => {
    const [existing] = await conn.query(
      'SELECT id FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );

    if (existing.length && mode === 'merge') {
      await _mergeItems(conn, existing[0].id, items);
    } else {
      // Replace or create
      if (existing.length) {
        await conn.query(
          'DELETE FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
          [sourceType, sourceItemId],
        );
      }
      const clientName = await getClientName(conn, sourceType, sourceItemId);
      const [clResult] = await conn.query(
        'INSERT INTO loan_checklists (source_type, source_item_id, assigned_by_user_id, client_name) VALUES (?, ?, ?, ?)',
        [sourceType, sourceItemId, userId, clientName],
      );
      await _insertLoanItems(conn, clResult.insertId, items);
    }

    const [rows] = await conn.query(
      'SELECT * FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    return _hydrateById(conn, rows[0].id);
  });
}

// ──────────────────────────────────────────
//  PRIVATE HELPERS
// ──────────────────────────────────────────

const STATUS_ORDER = { not_started: 0, in_progress: 1, done: 2, issue: 3, na: 4 };

async function _mergeItems(conn, checklistId, items) {
  const [currentItems] = await conn.query(
    'SELECT * FROM loan_checklist_items WHERE checklist_id = ? ORDER BY sort_order',
    [checklistId],
  );
  const nameMap = {};
  for (const ci of currentItems) nameMap[ci.name.toLowerCase()] = ci;

  let maxSort = currentItems.reduce((m, i) => Math.max(m, i.sort_order), 0);
  for (const incoming of items) {
    const key = incoming.name.toLowerCase();
    const existing = nameMap[key];
    if (existing) {
      const incomingOrder = STATUS_ORDER[incoming.status] ?? 0;
      const currentOrder = STATUS_ORDER[existing.status] ?? 0;
      if (incomingOrder > currentOrder) {
        await conn.query(
          'UPDATE loan_checklist_items SET status = ?, updated_at = NOW() WHERE id = ?',
          [incoming.status, existing.id],
        );
      }
      if (incoming.date && !existing.date) {
        await conn.query(
          'UPDATE loan_checklist_items SET date = ?, updated_at = NOW() WHERE id = ?',
          [incoming.date, existing.id],
        );
      }
    } else {
      maxSort++;
      await _insertOneLoanItem(conn, checklistId, incoming, maxSort);
    }
  }
  await conn.query('UPDATE loan_checklists SET updated_at = NOW() WHERE id = ?', [checklistId]);
}

async function _insertLoanItems(conn, checklistId, items) {
  for (let i = 0; i < items.length; i++) {
    await _insertOneLoanItem(conn, checklistId, items[i], items[i].sort_order ?? i);
  }
}

async function _insertOneLoanItem(conn, checklistId, item, sortOrder) {
  const [ir] = await conn.query(
    'INSERT INTO loan_checklist_items (checklist_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
    [checklistId, item.name, item.status || 'not_started', item.date || null, sortOrder],
  );
  if (item.subitems?.length) {
    for (let j = 0; j < item.subitems.length; j++) {
      const si = item.subitems[j];
      await conn.query(
        'INSERT INTO loan_checklist_subitems (item_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
        [ir.insertId, si.name, si.status || 'not_started', si.date || null, j],
      );
    }
  }
}

async function _ensureChecklist(conn, sourceType, sourceItemId, userId) {
  const [existing] = await conn.query(
    'SELECT * FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
    [sourceType, sourceItemId],
  );
  if (existing.length) return existing[0];

  const clientName = await getClientName(conn, sourceType, sourceItemId);
  const [result] = await conn.query(
    'INSERT INTO loan_checklists (source_type, source_item_id, assigned_by_user_id, client_name) VALUES (?, ?, ?, ?)',
    [sourceType, sourceItemId, userId, clientName],
  );
  return { id: result.insertId, source_type: sourceType, source_item_id: sourceItemId };
}

async function _readItem(itemId) {
  const [rows] = await db.query('SELECT * FROM loan_checklist_items WHERE id = ?', [itemId]);
  return rows[0] || null;
}

async function _readSubitem(subitemId) {
  const [rows] = await db.query('SELECT * FROM loan_checklist_subitems WHERE id = ?', [subitemId]);
  return rows[0] || null;
}

/** Hydrate a checklist row with its items + subitems + template name. */
async function _hydrate(cl) {
  return _hydrateInternal(db, cl);
}

async function _hydrateById(conn, checklistId) {
  const [rows] = await conn.query('SELECT * FROM loan_checklists WHERE id = ?', [checklistId]);
  if (!rows.length) return null;
  return _hydrateInternal(conn, rows[0]);
}

async function _hydrateInternal(queryRunner, cl) {
  // Urgent items float to the top; relative order within each importance
  // group respects user-defined sort_order.
  const [items] = await queryRunner.query(
    `SELECT * FROM loan_checklist_items WHERE checklist_id = ?
     ORDER BY (importance = 'urgent') DESC, sort_order ASC, id ASC`,
    [cl.id],
  );

  let subitems = [];
  if (items.length) {
    const itemIds = items.map(i => i.id);
    [subitems] = await queryRunner.query(
      `SELECT * FROM loan_checklist_subitems WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY sort_order, id`,
      itemIds,
    );
  }
  const subitemsByItem = {};
  for (const si of subitems) {
    (subitemsByItem[si.item_id] = subitemsByItem[si.item_id] || []).push(si);
  }

  cl.items = items.map(item => ({ ...item, subitems: subitemsByItem[item.id] || [] }));

  if (cl.source_template_id) {
    const [tpl] = await queryRunner.query('SELECT name FROM checklist_templates WHERE id = ?', [cl.source_template_id]);
    cl.source_template_name = tpl[0]?.name || null;
  }
  return cl;
}

module.exports = {
  getForLoan,
  getStatusMap,
  assignTemplate,
  addItem,
  updateItem,
  deleteItem,
  reorderItems,
  addSubitem,
  updateSubitem,
  deleteSubitem,
  importItems,
};
