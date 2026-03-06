/**
 * routes/webhooks/preApprovals.js
 *
 * Webhook endpoints for pre-approval CRUD.
 */
const router = require('express').Router();
const db = require('../../db/connection');
const { buildUpdate } = require('../../utils/queryBuilder');

const PRE_APPROVAL_FIELDS = [
  'client_name', 'loan_amount', 'pre_approval_date', 'expiration_date',
  'status', 'assigned_lo_id', 'assigned_lo_name', 'property_address',
  'loan_type', 'notes',
];

// POST /api/webhooks/pre-approvals — Create pre-approval via webhook
router.post('/', async (req, res, next) => {
  try {
    const { client_name, loan_amount, pre_approval_date, expiration_date, status, property_address, loan_type, notes } = req.body;

    if (!client_name || !loan_amount || !pre_approval_date || !expiration_date) {
      return res.status(400).json({ error: 'client_name, loan_amount, pre_approval_date, and expiration_date are required' });
    }

    const assignedLoId = req.user ? req.user.id : null;
    const assignedLoName = req.user ? req.user.name : null;

    const [result] = await db.query(
      `INSERT INTO pre_approvals
       (client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_name, loan_amount, pre_approval_date, expiration_date, status || 'active', assignedLoId, assignedLoName, property_address || null, loan_type || null, notes || null]
    );

    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: preApprovals[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/webhooks/pre-approvals/:id — Update pre-approval via webhook
router.put('/:id', async (req, res, next) => {
  try {
    const update = buildUpdate('pre_approvals', PRE_APPROVAL_FIELDS, req.body, { clause: 'id = ?', values: [req.params.id] });

    if (!update) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await db.query(update.sql, update.values);

    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);

    if (preApprovals.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }

    res.json({ success: true, data: preApprovals[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
