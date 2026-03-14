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

module.exports = { getAccessibleBoardIds, getProcessorLOIds };
