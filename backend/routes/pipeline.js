// Pipeline API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getDbUser, getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// GET /api/pipeline - Get all pipeline items (optionally filtered)
router.get('/', async (req, res, next) => {
  try {
    const { stage, status, investor_id, investor } = req.query;
    
    let query = 'SELECT * FROM pipeline WHERE 1=1';
    const params = [];
    
    if (!isAdmin(req)) {
      query += ' AND assigned_lo_id = ?';
      params.push(getUserId(req));
    }
    
    if (stage) {
      query += ' AND stage = ?';
      params.push(stage);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (investor_id) {
      query += ' AND investor_id = ?';
      params.push(investor_id);
    }
    if (investor) {
      query += ' AND investor = ?';
      params.push(investor);
    }
    
    query += ' ORDER BY target_close_date, created_at DESC';
    
    const [pipeline] = await db.query(query, params);
    res.json(pipeline);
  } catch (error) {
    next(error);
  }
});

// GET /api/pipeline/:id - Get specific pipeline item
router.get('/:id', async (req, res, next) => {
  try {
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [req.params.id]);
    
    if (pipeline.length === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }
    
    const currentUserId = getUserId(req);
    if (!isAdmin(req) && pipeline[0].assigned_lo_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json(pipeline[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/pipeline - Create new pipeline item
router.post('/', async (req, res, next) => {
  try {
    const { client_name, loan_amount, loan_type, stage, target_close_date, assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes } = req.body;
    
    if (!client_name || !loan_amount || !stage) {
      return res.status(400).json({ error: 'client_name, loan_amount, and stage are required' });
    }
    
    const dbUser = getDbUser(req);
    const currentUserId = getUserId(req);
    const finalAssignedLoId = isAdmin(req) ? (assigned_lo_id || currentUserId) : currentUserId;
    const finalAssignedLoName = isAdmin(req) ? (assigned_lo_name || dbUser?.name || null) : (dbUser?.name || null);
    
    const [result] = await db.query(
      `INSERT INTO pipeline 
       (client_name, loan_amount, loan_type, stage, target_close_date, assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_name, loan_amount, loan_type || null, stage, target_close_date || null, finalAssignedLoId, finalAssignedLoName, investor || null, investor_id || null, status || 'On Track', notes || null]
    );
    
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [result.insertId]);
    res.status(201).json(pipeline[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/pipeline/:id - Update pipeline item
router.put('/:id', async (req, res, next) => {
  try {
    const {
      client_name, loan_amount, loan_type, stage, target_close_date,
      assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes,
      // Monday.com-synced fields (also editable locally)
      loan_number, loan_status, lender, subject_property, rate,
      appraisal_status, loan_purpose, occupancy, title_status, hoi_status,
      loan_estimate, application_date, lock_expiration_date, closing_date, funding_date,
      prelims_status, mini_set_status, cd_status,
    } = req.body;
    
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
    if (loan_type !== undefined) { updates.push('loan_type = ?'); values.push(loan_type); }
    if (stage !== undefined) { updates.push('stage = ?'); values.push(stage); }
    if (target_close_date !== undefined) { updates.push('target_close_date = ?'); values.push(target_close_date); }
    if (assigned_lo_name !== undefined) { updates.push('assigned_lo_name = ?'); values.push(assigned_lo_name); }
    if (investor !== undefined) { updates.push('investor = ?'); values.push(investor); }
    if (investor_id !== undefined) { updates.push('investor_id = ?'); values.push(investor_id); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    // Monday.com fields
    if (loan_number !== undefined) { updates.push('loan_number = ?'); values.push(loan_number); }
    if (loan_status !== undefined) { updates.push('loan_status = ?'); values.push(loan_status); }
    if (lender !== undefined) { updates.push('lender = ?'); values.push(lender); }
    if (subject_property !== undefined) { updates.push('subject_property = ?'); values.push(subject_property); }
    if (rate !== undefined) { updates.push('rate = ?'); values.push(rate); }
    if (appraisal_status !== undefined) { updates.push('appraisal_status = ?'); values.push(appraisal_status); }
    if (loan_purpose !== undefined) { updates.push('loan_purpose = ?'); values.push(loan_purpose); }
    if (occupancy !== undefined) { updates.push('occupancy = ?'); values.push(occupancy); }
    if (title_status !== undefined) { updates.push('title_status = ?'); values.push(title_status); }
    if (hoi_status !== undefined) { updates.push('hoi_status = ?'); values.push(hoi_status); }
    if (loan_estimate !== undefined) { updates.push('loan_estimate = ?'); values.push(loan_estimate); }
    if (application_date !== undefined) { updates.push('application_date = ?'); values.push(application_date); }
    if (lock_expiration_date !== undefined) { updates.push('lock_expiration_date = ?'); values.push(lock_expiration_date); }
    if (closing_date !== undefined) { updates.push('closing_date = ?'); values.push(closing_date); }
    if (funding_date !== undefined) { updates.push('funding_date = ?'); values.push(funding_date); }
    if (prelims_status !== undefined) { updates.push('prelims_status = ?'); values.push(prelims_status); }
    if (mini_set_status !== undefined) { updates.push('mini_set_status = ?'); values.push(mini_set_status); }
    if (cd_status !== undefined) { updates.push('cd_status = ?'); values.push(cd_status); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    values.push(req.params.id);
    
    await db.query(
      `UPDATE pipeline SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [req.params.id]);
    res.json(pipeline[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pipeline/:id - Delete pipeline item
router.delete('/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT assigned_lo_id FROM pipeline WHERE id = ?', [req.params.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }
    
    if (!isAdmin(req) && existing[0].assigned_lo_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const [result] = await db.query('DELETE FROM pipeline WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }
    
    res.json({ message: 'Pipeline item deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

