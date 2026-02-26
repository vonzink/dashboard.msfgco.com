// Pre-Approvals API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getDbUser, getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { preApproval, validate } = require('../validation/schemas');

router.use(requireDbUser);

// GET /api/pre-approvals - Get all pre-approvals (optionally filtered)
router.get('/', async (req, res, next) => {
  try {
    const { status, loan_type } = req.query;
    
    let query = 'SELECT * FROM pre_approvals WHERE 1=1';
    const params = [];
    
    if (!isAdmin(req)) {
      query += ' AND assigned_lo_id = ?';
      params.push(getUserId(req));
    }
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (loan_type) {
      query += ' AND loan_type = ?';
      params.push(loan_type);
    }
    
    query += ' ORDER BY pre_approval_date DESC, expiration_date';
    
    const [preApprovals] = await db.query(query, params);
    res.json(preApprovals);
  } catch (error) {
    next(error);
  }
});

// GET /api/pre-approvals/:id - Get specific pre-approval
router.get('/:id', async (req, res, next) => {
  try {
    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);
    
    if (preApprovals.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }
    
    const currentUserId = getUserId(req);
    if (!isAdmin(req) && preApprovals[0].assigned_lo_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json(preApprovals[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/pre-approvals - Create new pre-approval
router.post('/', validate(preApproval), async (req, res, next) => {
  try {
    const { client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes } = req.body;
    
    const dbUser = getDbUser(req);
    const currentUserId = getUserId(req);
    const finalAssignedLoId = isAdmin(req) ? (assigned_lo_id || currentUserId) : currentUserId;
    const finalAssignedLoName = isAdmin(req) ? (assigned_lo_name || dbUser?.name || null) : (dbUser?.name || null);
    
    const [result] = await db.query(
      `INSERT INTO pre_approvals 
       (client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_name, loan_amount, pre_approval_date, expiration_date, status || 'active', finalAssignedLoId, finalAssignedLoName, property_address || null, loan_type || null, notes || null]
    );
    
    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [result.insertId]);
    res.status(201).json(preApprovals[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/pre-approvals/:id - Update pre-approval
router.put('/:id', async (req, res, next) => {
  try {
    const { client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes } = req.body;
    
    const updates = [];
    const values = [];
    
    if (assigned_lo_id !== undefined) {
      if (!isAdmin(req) && assigned_lo_id !== getUserId(req)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      updates.push('assigned_lo_id = ?');
      values.push(assigned_lo_id);
    }
    
    if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
    if (loan_amount !== undefined) { updates.push('loan_amount = ?'); values.push(loan_amount); }
    if (pre_approval_date !== undefined) { updates.push('pre_approval_date = ?'); values.push(pre_approval_date); }
    if (expiration_date !== undefined) { updates.push('expiration_date = ?'); values.push(expiration_date); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (assigned_lo_name !== undefined) { updates.push('assigned_lo_name = ?'); values.push(assigned_lo_name); }
    if (property_address !== undefined) { updates.push('property_address = ?'); values.push(property_address); }
    if (loan_type !== undefined) { updates.push('loan_type = ?'); values.push(loan_type); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    values.push(req.params.id);
    
    await db.query(
      `UPDATE pre_approvals SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);
    res.json(preApprovals[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pre-approvals/:id - Delete pre-approval
router.delete('/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT assigned_lo_id FROM pre_approvals WHERE id = ?', [req.params.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }
    
    if (!isAdmin(req) && existing[0].assigned_lo_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const [result] = await db.query('DELETE FROM pre_approvals WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }
    
    res.json({ message: 'Pre-approval deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

