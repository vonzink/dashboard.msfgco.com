// Shared board-access and processor-LO assignment helpers
const db = require('../db/connection');

/**
 * Get board IDs accessible to a user (from monday_board_access)
 */
async function getAccessibleBoardIds(userId) {
  const [rows] = await db.query(
    'SELECT board_id FROM monday_board_access WHERE user_id = ?',
    [userId]
  );
  return rows.map(r => r.board_id);
}

/**
 * Get LO IDs that a processor is assigned to
 */
async function getProcessorLOIds(processorUserId) {
  const [assignments] = await db.query(
    'SELECT lo_user_id FROM processor_lo_assignments WHERE processor_user_id = ?',
    [processorUserId]
  );
  return assignments.map(a => a.lo_user_id);
}

/**
 * Get LO IDs that a manager can see: everyone assigned to them, plus
 * themselves.
 *
 * Self is always included because managers originate their own loans — Kray
 * Olson carries a full pipeline of his own. Without this, turning on manager
 * scoping would hide a manager's own loans from them until an admin
 * remembered to assign each manager to himself.
 */
async function getManagerLOIds(managerUserId) {
  const [assignments] = await db.query(
    'SELECT lo_user_id FROM manager_lo_assignments WHERE manager_user_id = ?',
    [managerUserId]
  );
  const ids = assignments.map(a => a.lo_user_id);
  if (managerUserId != null && !ids.includes(managerUserId)) ids.push(managerUserId);
  return ids;
}

/**
 * Resolve the assigned LO IDs for a scoped role (processor or manager).
 * Returns [] for any other role.
 */
async function getAssignedLOIds(role, userId) {
  const r = String(role || '').toLowerCase();
  if (r === 'manager') return getManagerLOIds(userId);
  if (r === 'processor') return getProcessorLOIds(userId);
  return [];
}

module.exports = { getAccessibleBoardIds, getProcessorLOIds, getManagerLOIds, getAssignedLOIds };
