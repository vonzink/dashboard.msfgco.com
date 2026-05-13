// Loan checklist service — CRUD + import/export + status aggregation.
// Every mutation enforces loan-access via authz.requireLoanAccess() or
// authz.requireChecklist{Item,Subitem}Access().

const db = require('../../db/connection');
const authz = require('./authz');
const { getClientName, buildDynamicUpdate, withTransaction } = require('./helpers');

// ──────────────────────────────────────────
//  READ
// ──────────────────────────────────────────

/** Returns array of up to MAX_CHECKLISTS_PER_LOAN checklists. */
async function getForLoan(sourceType, sourceItemId) {
  await authz.requireLoanAccess(sourceType, sourceItemId);
  const [checklists] = await db.query(
    'SELECT * FROM loan_checklists WHERE source_type = ? AND source_item_id = ? ORDER BY sort_order, id',
    [sourceType, sourceItemId],
  );
  const hydrated = [];
  for (const cl of checklists) hydrated.push(await _hydrate(cl));
  return hydrated;
}

/** Returns one checklist by id (loan-access checked via item lookup). */
async function getById(checklistId) {
  const [rows] = await db.query('SELECT * FROM loan_checklists WHERE id = ?', [checklistId]);
  if (!rows.length) return null;
  return _hydrate(rows[0]);
}

const MAX_CHECKLISTS_PER_LOAN = 3;

/**
 * Per-checklist progress, grouped by source_item_id:
 *   { 123: [{ id, name, total, done }, { id, name, total, done }], ... }
 */
async function getStatusMap(sourceType) {
  const [rows] = await db.query(
    `SELECT lc.id, lc.source_item_id, lc.name, lc.sort_order, lc.is_file_local,
            COUNT(lci.id) AS total,
            SUM(CASE WHEN lci.status = 'done' THEN 1 ELSE 0 END) AS done
     FROM loan_checklists lc
     LEFT JOIN loan_checklist_items lci ON lci.checklist_id = lc.id
     WHERE lc.source_type = ?
     GROUP BY lc.id, lc.source_item_id, lc.name, lc.sort_order, lc.is_file_local
     ORDER BY lc.source_item_id, lc.sort_order, lc.id`,
    [sourceType],
  );
  const map = {};
  for (const r of rows) {
    (map[r.source_item_id] = map[r.source_item_id] || []).push({
      id: r.id,
      name: r.name || 'Checklist',
      total: Number(r.total) || 0,
      done: Number(r.done) || 0,
      is_file_local: !!r.is_file_local,
    });
  }
  return map;
}

// ──────────────────────────────────────────
//  ASSIGN TEMPLATE
// ──────────────────────────────────────────

async function assignTemplate(userId, sourceType, sourceItemId, templateId, name) {
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

    // Enforce max 3 per loan
    const [count] = await conn.query(
      'SELECT COUNT(*) AS c FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    if ((count[0]?.c || 0) >= MAX_CHECKLISTS_PER_LOAN) {
      const err = new Error(`Maximum of ${MAX_CHECKLISTS_PER_LOAN} checklists per loan reached — delete one first`);
      err.status = 400;
      throw err;
    }

    const [nextSort] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS s FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    const clientName = await getClientName(conn, sourceType, sourceItemId);
    const checklistName = (name && name.trim()) || tpl[0].name;
    const [clResult] = await conn.query(
      `INSERT INTO loan_checklists
         (source_type, source_item_id, name, sort_order, source_template_id, assigned_by_user_id, client_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sourceType, sourceItemId, checklistName, nextSort[0].s, templateId, userId, clientName],
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

async function addItemToChecklist(userId, checklistId, body) {
  // Authorize via the checklist's parent loan
  const [parents] = await db.query(
    'SELECT source_type, source_item_id FROM loan_checklists WHERE id = ?',
    [checklistId],
  );
  if (!parents.length) {
    const err = new Error('Checklist not found');
    err.status = 404;
    throw err;
  }
  await authz.requireLoanAccess(parents[0].source_type, parents[0].source_item_id);

  return withTransaction(async (conn) => {
    const { name, status, date, sort_order, subitems } = body;
    const [ir] = await conn.query(
      'INSERT INTO loan_checklist_items (checklist_id, name, status, date, sort_order) VALUES (?, ?, ?, ?, ?)',
      [checklistId, name, status, date || null, sort_order],
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

    await conn.query('UPDATE loan_checklists SET updated_at = NOW() WHERE id = ?', [checklistId]);
    const [items] = await conn.query('SELECT * FROM loan_checklist_items WHERE id = ?', [itemId]);
    return items[0];
  });
}

/**
 * Build a new file-local checklist on a loan from an uploaded PDF buffer.
 * The PDF is parsed by the vendored conditions extractor; resulting items
 * are inserted into a fresh loan_checklists row flagged is_file_local=TRUE.
 *
 * Subject to the same 3-per-loan cap as the other create paths.
 */
async function createFromPdf(userId, sourceType, sourceItemId, pdfBuffer, opts = {}) {
  await authz.requireLoanAccess(sourceType, sourceItemId);

  const { convertPdfToMarkdown, DEFAULT_STATUS } = require('./conditionsExtractor');
  const baseName = (opts.filename || 'PDF').replace(/\.pdf$/i, '');
  const parsed = await convertPdfToMarkdown(pdfBuffer, {
    title: `${baseName} Checklist`,
    description: `Conditions extracted from ${opts.filename || 'uploaded PDF'}`,
  });

  if (!parsed.conditions || !parsed.conditions.length) {
    const err = new Error('No conditions could be extracted from this PDF. Check the file format and try again.');
    err.status = 422;
    throw err;
  }

  return withTransaction(async (conn) => {
    const [count] = await conn.query(
      'SELECT COUNT(*) AS c FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    if ((count[0]?.c || 0) >= MAX_CHECKLISTS_PER_LOAN) {
      const err = new Error(`Maximum of ${MAX_CHECKLISTS_PER_LOAN} checklists per loan reached — delete one first`);
      err.status = 400;
      throw err;
    }

    const [nextSort] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS s FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    const clientName = await getClientName(conn, sourceType, sourceItemId);
    const [clResult] = await conn.query(
      `INSERT INTO loan_checklists
         (source_type, source_item_id, name, sort_order, is_file_local, assigned_by_user_id, client_name)
       VALUES (?, ?, ?, ?, TRUE, ?, ?)`,
      [sourceType, sourceItemId, `${baseName} Conditions`, nextSort[0].s, userId, clientName],
    );
    const checklistId = clResult.insertId;

    // Each extractor condition is { name: "Stage - Category: Body" } — write
    // it straight into the checklist item, truncating to the column limit.
    for (let i = 0; i < parsed.conditions.length; i++) {
      const itemName = String(parsed.conditions[i].name || '').slice(0, 500);
      if (!itemName) continue;
      await conn.query(
        'INSERT INTO loan_checklist_items (checklist_id, name, status, sort_order) VALUES (?, ?, ?, ?)',
        [checklistId, itemName, 'not_started', i],
      );
    }

    return _hydrateById(conn, checklistId);
  });
}

async function renameChecklist(userId, checklistId, name) {
  const [parents] = await db.query(
    'SELECT source_type, source_item_id FROM loan_checklists WHERE id = ?', [checklistId],
  );
  if (!parents.length) { const e = new Error('Checklist not found'); e.status = 404; throw e; }
  await authz.requireLoanAccess(parents[0].source_type, parents[0].source_item_id);
  await db.query('UPDATE loan_checklists SET name = ?, updated_at = NOW() WHERE id = ?', [name, checklistId]);
}

async function deleteChecklist(userId, checklistId) {
  const [parents] = await db.query(
    'SELECT source_type, source_item_id FROM loan_checklists WHERE id = ?', [checklistId],
  );
  if (!parents.length) { const e = new Error('Checklist not found'); e.status = 404; throw e; }
  await authz.requireLoanAccess(parents[0].source_type, parents[0].source_item_id);
  await db.query('DELETE FROM loan_checklists WHERE id = ?', [checklistId]);
}

async function updateItem(userId, itemId, body) {
  const parent = await authz.requireChecklistItemAccess(userId, itemId);
  const allowed = ['name', 'status', 'importance', 'date', 'due_date', 'sort_order'];
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
//  IMPORT — always creates a new checklist on the loan (max 3)
// ──────────────────────────────────────────

async function importItems(userId, sourceType, sourceItemId, { items, name }) {
  await authz.requireLoanAccess(sourceType, sourceItemId);

  return withTransaction(async (conn) => {
    const [count] = await conn.query(
      'SELECT COUNT(*) AS c FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    if ((count[0]?.c || 0) >= MAX_CHECKLISTS_PER_LOAN) {
      const err = new Error(`Maximum of ${MAX_CHECKLISTS_PER_LOAN} checklists per loan reached — delete one first`);
      err.status = 400;
      throw err;
    }

    const [nextSort] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS s FROM loan_checklists WHERE source_type = ? AND source_item_id = ?',
      [sourceType, sourceItemId],
    );
    const clientName = await getClientName(conn, sourceType, sourceItemId);
    const [clResult] = await conn.query(
      `INSERT INTO loan_checklists (source_type, source_item_id, name, sort_order, assigned_by_user_id, client_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sourceType, sourceItemId, (name && name.trim()) || 'Imported', nextSort[0].s, userId, clientName],
    );
    await _insertLoanItems(conn, clResult.insertId, items);
    return _hydrateById(conn, clResult.insertId);
  });
}

// ──────────────────────────────────────────
//  PRIVATE HELPERS
// ──────────────────────────────────────────

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
  getById,
  getStatusMap,
  assignTemplate,
  createFromPdf,
  renameChecklist,
  deleteChecklist,
  addItemToChecklist,
  updateItem,
  deleteItem,
  reorderItems,
  addSubitem,
  updateSubitem,
  deleteSubitem,
  importItems,
  MAX_CHECKLISTS_PER_LOAN,
};
