// Loan lifecycle — status helpers + funded/delete transitions
const db = require('../db/connection');

const TERMINAL_STATUSES = {
  FUNDED: 'funded',
  WITHDRAWN: 'withdrawn',
  INCOMPLETE: 'incomplete',
  DENIED: 'denied',
  NOT_ACCEPTED: 'not accepted',
};

const DELETE_STATUSES = [
  TERMINAL_STATUSES.WITHDRAWN,
  TERMINAL_STATUSES.INCOMPLETE,
  TERMINAL_STATUSES.DENIED,
  TERMINAL_STATUSES.NOT_ACCEPTED,
];

function isTerminalStatus(status) {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return normalized === TERMINAL_STATUSES.FUNDED || DELETE_STATUSES.includes(normalized);
}

function isDeleteStatus(status) {
  if (!status) return false;
  return DELETE_STATUSES.includes(status.toLowerCase().trim());
}

function isFundedStatus(status) {
  if (!status) return false;
  return status.toLowerCase().trim() === TERMINAL_STATUSES.FUNDED;
}

/**
 * Move a pipeline loan to funded_loans table and delete from pipeline.
 */
async function moveLoanToFunded(pipelineId, fundedDate = null) {
  const [loans] = await db.query('SELECT * FROM pipeline WHERE id = ?', [pipelineId]);
  if (loans.length === 0) throw new Error('Pipeline loan not found');

  const loan = loans[0];

  const [result] = await db.query(
    `INSERT INTO funded_loans
     (client_name, loan_amount, loan_type, funded_date, assigned_lo_id, assigned_lo_name,
      assigned_processor_id, investor, investor_id, property_address, notes,
      original_pipeline_id, source_system, external_loan_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      loan.client_name, loan.loan_amount, loan.loan_type,
      fundedDate || new Date().toISOString().split('T')[0],
      loan.assigned_lo_id, loan.assigned_lo_name,
      null, loan.investor, loan.investor_id, null,
      loan.notes, loan.id, loan.source_system || 'Zapier', loan.external_loan_id,
    ]
  );

  // Assign processor if LO has one
  if (loan.assigned_lo_id) {
    const [assignments] = await db.query(
      'SELECT processor_user_id FROM processor_lo_assignments WHERE lo_user_id = ?',
      [loan.assigned_lo_id]
    );
    if (assignments.length > 0) {
      await db.query(
        'UPDATE funded_loans SET assigned_processor_id = ? WHERE id = ?',
        [assignments[0].processor_user_id, result.insertId]
      );
    }
  }

  await db.query('DELETE FROM pipeline WHERE id = ?', [pipelineId]);

  const [fundedLoans] = await db.query('SELECT * FROM funded_loans WHERE id = ?', [result.insertId]);
  return fundedLoans[0];
}

/**
 * Delete a pipeline loan (for withdrawn, incomplete, denied, not accepted).
 */
async function deletePipelineLoan(pipelineId) {
  const [loans] = await db.query('SELECT * FROM pipeline WHERE id = ?', [pipelineId]);
  if (loans.length === 0) return null;

  const loan = loans[0];
  await db.query('DELETE FROM pipeline WHERE id = ?', [pipelineId]);
  return loan;
}

module.exports = {
  TERMINAL_STATUSES,
  DELETE_STATUSES,
  isTerminalStatus,
  isDeleteStatus,
  isFundedStatus,
  moveLoanToFunded,
  deletePipelineLoan,
};
