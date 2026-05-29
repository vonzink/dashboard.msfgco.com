// Authorization helpers for checklist routes.
//
// Templates are owned by their creating user. Loan checklists are accessible
// to any DB-authenticated user — they sit on shared loan records, and the
// dashboard's loan tables are already restricted at the route level.
//
// If you tighten loan access later (e.g. assigned-LO-only), extend
// requireLoanAccess() to consult that ACL instead of allowing all DB users.

const db = require('../../db/connection');

/**
 * Throw a ForbiddenError-equivalent if the user does not own the template.
 * Returns the template row on success.
 */
async function requireTemplateAccess(userId, templateId) {
  const [rows] = await db.query(
    'SELECT * FROM checklist_templates WHERE id = ? AND user_id = ?',
    [templateId, userId],
  );
  if (!rows.length) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * Confirm the loan record exists and the user can access it.
 * Currently: any authenticated DB user can edit any loan's checklists.
 * Tighten here if/when per-user loan ACLs are introduced.
 */
async function requireLoanAccess(/* userId, */ sourceType, sourceItemId) {
  const tableBySource = {
    pipeline: 'pipeline',
    application: 'pipeline',
    pre_approval: 'pre_approvals',
    funded: 'funded_loans',
  };
  const table = tableBySource[sourceType];
  if (!table) {
    const err = new Error('Invalid source type');
    err.status = 400;
    throw err;
  }
  // For now, just verify the source row exists — prevents IDOR-by-typo where
  // a caller invents an item ID that doesn't map to a real loan.
  const [rows] = await db.query(`SELECT id FROM ${table} WHERE id = ?`, [sourceItemId]);
  if (!rows.length) {
    const err = new Error('Loan record not found');
    err.status = 404;
    throw err;
  }
}

/**
 * Ensure the given loan_checklist_items row exists and the user can edit it.
 * Returns the parent checklist row.
 */
async function requireChecklistItemAccess(userId, itemId) {
  const [rows] = await db.query(
    `SELECT lci.id AS item_id, lc.id, lc.source_type, lc.source_item_id
     FROM loan_checklist_items lci
     JOIN loan_checklists lc ON lc.id = lci.checklist_id
     WHERE lci.id = ?`,
    [itemId],
  );
  if (!rows.length) {
    const err = new Error('Checklist item not found');
    err.status = 404;
    throw err;
  }
  await requireLoanAccess(rows[0].source_type, rows[0].source_item_id);
  return rows[0];
}

/**
 * Ensure the given loan_checklist_subitems row exists and the user can edit it.
 * Returns the parent item row joined with checklist info.
 */
async function requireChecklistSubitemAccess(userId, subitemId) {
  const [rows] = await db.query(
    `SELECT lcs.id AS subitem_id, lci.id AS item_id, lc.source_type, lc.source_item_id
     FROM loan_checklist_subitems lcs
     JOIN loan_checklist_items lci ON lci.id = lcs.item_id
     JOIN loan_checklists lc ON lc.id = lci.checklist_id
     WHERE lcs.id = ?`,
    [subitemId],
  );
  if (!rows.length) {
    const err = new Error('Checklist subitem not found');
    err.status = 404;
    throw err;
  }
  await requireLoanAccess(rows[0].source_type, rows[0].source_item_id);
  return rows[0];
}

module.exports = {
  requireTemplateAccess,
  requireLoanAccess,
  requireChecklistItemAccess,
  requireChecklistSubitemAccess,
};
