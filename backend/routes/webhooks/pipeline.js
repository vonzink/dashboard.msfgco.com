/**
 * routes/webhooks/pipeline.js
 *
 * Webhook endpoints for pipeline CRUD.
 * Handles terminal statuses: Funded → funded_loans, Withdrawn/Denied → delete.
 */
const router = require('express').Router();
const db = require('../../db/connection');
const logger = require('../../lib/logger');
const { buildUpdate } = require('../../utils/queryBuilder');
const {
  isTerminalStatus, isDeleteStatus, isFundedStatus,
  moveLoanToFunded, deletePipelineLoan,
} = require('../../services/loanLifecycle');

const PIPELINE_UPDATE_FIELDS = [
  'loan_amount', 'loan_type', 'stage', 'target_close_date',
  'investor', 'investor_id', 'status', 'notes',
  'loan_number', 'occupancy', 'external_loan_id', 'source_system',
];

const PIPELINE_PUT_FIELDS = [
  'client_name', 'loan_amount', 'loan_type', 'stage', 'target_close_date',
  'assigned_lo_id', 'assigned_lo_name', 'investor', 'investor_id', 'status', 'notes',
];

// POST /api/webhooks/pipeline — Create or update pipeline item via webhook
router.post('/', async (req, res, next) => {
  try {
    const {
      client_name, loan_amount, loan_type, stage, target_close_date,
      investor, investor_id, status, notes, assigned_lo,
      loan_number, occupancy, external_loan_id, source_system, funded_date,
    } = req.body;

    if (!client_name || !loan_amount || !stage) {
      return res.status(400).json({ error: 'client_name, loan_amount, and stage are required' });
    }

    // Look up LO by name if provided, otherwise use API key owner
    let assignedLoId = req.user ? req.user.id : null;
    let assignedLoName = req.user ? req.user.name : null;

    if (assigned_lo) {
      const [users] = await db.query(
        'SELECT id, name FROM users WHERE LOWER(name) = LOWER(?)',
        [assigned_lo.trim()]
      );

      if (users.length > 0) {
        assignedLoId = users[0].id;
        assignedLoName = users[0].name;
      } else {
        logger.warn({ assigned_lo }, 'No user found matching name, using API key owner');
        assignedLoName = assigned_lo;
      }
    }

    // Check if pipeline item already exists (by external_loan_id or client_name)
    let existing = [];

    if (external_loan_id) {
      [existing] = await db.query(
        'SELECT id FROM pipeline WHERE external_loan_id = ? LIMIT 1',
        [external_loan_id]
      );
    }

    if (existing.length === 0) {
      [existing] = await db.query(
        'SELECT id FROM pipeline WHERE client_name = ? ORDER BY created_at DESC LIMIT 1',
        [client_name]
      );
    }

    // ── HANDLE TERMINAL STATUSES ──
    if (isTerminalStatus(status)) {
      if (isFundedStatus(status)) {
        if (existing.length > 0) {
          const fundedLoan = await moveLoanToFunded(existing[0].id, funded_date);
          return res.json({
            success: true, data: fundedLoan, action: 'funded',
            message: 'Loan moved to funded_loans table',
          });
        } else {
          const [result] = await db.query(
            `INSERT INTO funded_loans
             (client_name, loan_amount, loan_type, funded_date, assigned_lo_id, assigned_lo_name,
              investor, investor_id, notes, source_system, external_loan_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              client_name, loan_amount, loan_type || null,
              funded_date || new Date().toISOString().split('T')[0],
              assignedLoId, assignedLoName,
              investor || null, investor_id || null, notes || null,
              source_system || 'Zapier', external_loan_id || null,
            ]
          );

          const [fundedLoans] = await db.query('SELECT * FROM funded_loans WHERE id = ?', [result.insertId]);
          return res.status(201).json({
            success: true, data: fundedLoans[0], action: 'funded',
            message: 'Loan created directly in funded_loans table',
          });
        }
      }

      if (isDeleteStatus(status)) {
        if (existing.length > 0) {
          const deletedLoan = await deletePipelineLoan(existing[0].id);
          return res.json({
            success: true, data: deletedLoan, action: 'deleted',
            message: `Loan deleted due to status: ${status}`,
          });
        } else {
          return res.json({
            success: true, data: null, action: 'skipped',
            message: `No existing loan found to delete for status: ${status}`,
          });
        }
      }
    }

    // ── NORMAL CREATE/UPDATE FLOW ──
    if (existing.length > 0) {
      // UPDATE existing pipeline item
      const update = buildUpdate('pipeline', PIPELINE_UPDATE_FIELDS, req.body, { clause: 'id = ?', values: [existing[0].id] });

      // Always update assigned LO
      const extraSets = 'assigned_lo_id = ?, assigned_lo_name = ?';
      const extraVals = [assignedLoId, assignedLoName];

      if (update) {
        // Merge the buildUpdate SET clauses with the assigned LO fields
        const mergedSql = update.sql.replace(
          ', updated_at = NOW()',
          `, ${extraSets}, updated_at = NOW()`
        );
        const mergedValues = [
          ...update.values.slice(0, -1), // set values (without WHERE value)
          ...extraVals,
          ...update.values.slice(-1),     // WHERE value
        ];
        await db.query(mergedSql, mergedValues);
      } else {
        // No fields from body, but still update assigned LO
        await db.query(
          `UPDATE pipeline SET ${extraSets}, updated_at = NOW() WHERE id = ?`,
          [...extraVals, existing[0].id]
        );
      }

      const [updated] = await db.query('SELECT * FROM pipeline WHERE id = ?', [existing[0].id]);
      res.json({ success: true, data: updated[0], action: 'updated' });
    } else {
      // CREATE new pipeline item
      const [result] = await db.query(
        `INSERT INTO pipeline
         (client_name, loan_number, loan_amount, loan_type, occupancy, stage, target_close_date,
          assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes, external_loan_id, source_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          client_name, loan_number || null, loan_amount, loan_type || null,
          occupancy || null, stage, target_close_date || null,
          assignedLoId, assignedLoName,
          investor || null, investor_id || null, status || 'Active',
          notes || null, external_loan_id || null, source_system || 'Zapier',
        ]
      );

      const [created] = await db.query('SELECT * FROM pipeline WHERE id = ?', [result.insertId]);
      res.status(201).json({ success: true, data: created[0], action: 'created' });
    }
  } catch (error) {
    next(error);
  }
});

// PUT /api/webhooks/pipeline/:id — Update pipeline item via webhook
router.put('/:id', async (req, res, next) => {
  try {
    const { status, funded_date } = req.body;

    // Check if this is a terminal status update
    if (isTerminalStatus(status)) {
      if (isFundedStatus(status)) {
        const fundedLoan = await moveLoanToFunded(req.params.id, funded_date);
        return res.json({
          success: true, data: fundedLoan, action: 'funded',
          message: 'Loan moved to funded_loans table',
        });
      }

      if (isDeleteStatus(status)) {
        const deletedLoan = await deletePipelineLoan(req.params.id);
        if (!deletedLoan) {
          return res.status(404).json({ error: 'Pipeline item not found' });
        }
        return res.json({
          success: true, data: deletedLoan, action: 'deleted',
          message: `Loan deleted due to status: ${status}`,
        });
      }
    }

    // Normal update flow
    const update = buildUpdate('pipeline', PIPELINE_PUT_FIELDS, req.body, { clause: 'id = ?', values: [req.params.id] });

    if (!update) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await db.query(update.sql, update.values);

    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [req.params.id]);

    if (pipeline.length === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }

    res.json({ success: true, data: pipeline[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
