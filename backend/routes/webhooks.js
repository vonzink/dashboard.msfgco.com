// Webhook endpoints for Zapier and external integrations
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { validateApiKey, logWebhookCall } = require('../middleware/apiKeyAuth');

// Apply API key authentication to all webhook routes
router.use(validateApiKey);
router.use(logWebhookCall);

// ========================================
// TASK WEBHOOKS
// ========================================

// POST /api/webhooks/tasks - Create task via webhook
router.post('/tasks', async (req, res, next) => {
  try {
    const { title, description, priority, status, due_date, due_time, assigned_to } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    
    // Data is automatically associated with the user who owns the API key
    const userId = req.user ? req.user.id : null;
    
    const [result] = await db.query(
      `INSERT INTO tasks (user_id, title, description, priority, status, due_date, due_time, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, description || null, priority || 'medium', status || 'todo', due_date || null, due_time || null, assigned_to || null]
    );
    
    const [tasks] = await db.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: tasks[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/webhooks/tasks/:id - Update task via webhook
router.put('/tasks/:id', async (req, res, next) => {
  try {
    const { title, description, priority, status, due_date, due_time, assigned_to } = req.body;
    
    const updates = [];
    const values = [];
    
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (due_date !== undefined) { updates.push('due_date = ?'); values.push(due_date); }
    if (due_time !== undefined) { updates.push('due_time = ?'); values.push(due_time); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(req.params.id);
    
    await db.query(
      `UPDATE tasks SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [tasks] = await db.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ success: true, data: tasks[0] });
  } catch (error) {
    next(error);
  }
});

// ========================================
// PRE-APPROVAL WEBHOOKS
// ========================================

// POST /api/webhooks/pre-approvals - Create pre-approval via webhook
router.post('/pre-approvals', async (req, res, next) => {
  try {
    const { client_name, loan_amount, pre_approval_date, expiration_date, status, property_address, loan_type, notes } = req.body;
    
    if (!client_name || !loan_amount || !pre_approval_date || !expiration_date) {
      return res.status(400).json({ error: 'client_name, loan_amount, pre_approval_date, and expiration_date are required' });
    }
    
    // Pre-approval is automatically assigned to the user who owns the API key
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

// PUT /api/webhooks/pre-approvals/:id - Update pre-approval via webhook
router.put('/pre-approvals/:id', async (req, res, next) => {
  try {
    const { client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes } = req.body;
    
    const updates = [];
    const values = [];
    
    if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
    if (loan_amount !== undefined) { updates.push('loan_amount = ?'); values.push(loan_amount); }
    if (pre_approval_date !== undefined) { updates.push('pre_approval_date = ?'); values.push(pre_approval_date); }
    if (expiration_date !== undefined) { updates.push('expiration_date = ?'); values.push(expiration_date); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (assigned_lo_id !== undefined) { updates.push('assigned_lo_id = ?'); values.push(assigned_lo_id); }
    if (assigned_lo_name !== undefined) { updates.push('assigned_lo_name = ?'); values.push(assigned_lo_name); }
    if (property_address !== undefined) { updates.push('property_address = ?'); values.push(property_address); }
    if (loan_type !== undefined) { updates.push('loan_type = ?'); values.push(loan_type); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(req.params.id);
    
    await db.query(
      `UPDATE pre_approvals SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);
    
    if (preApprovals.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }
    
    res.json({ success: true, data: preApprovals[0] });
  } catch (error) {
    next(error);
  }
});

// ========================================
// PIPELINE WEBHOOKS
// ========================================

// POST /api/webhooks/pipeline - Create pipeline item via webhook
router.post('/pipeline', async (req, res, next) => {
  try {
    const { client_name, loan_amount, loan_type, stage, target_close_date, investor, investor_id, status, notes } = req.body;
    
    if (!client_name || !loan_amount || !stage) {
      return res.status(400).json({ error: 'client_name, loan_amount, and stage are required' });
    }
    
    // Pipeline item is automatically assigned to the user who owns the API key
    const assignedLoId = req.user ? req.user.id : null;
    const assignedLoName = req.user ? req.user.name : null;
    
    const [result] = await db.query(
      `INSERT INTO pipeline 
       (client_name, loan_amount, loan_type, stage, target_close_date, assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_name, loan_amount, loan_type || null, stage, target_close_date || null, assignedLoId, assignedLoName, investor || null, investor_id || null, status || 'On Track', notes || null]
    );
    
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: pipeline[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/webhooks/pipeline/:id - Update pipeline item via webhook
router.put('/pipeline/:id', async (req, res, next) => {
  try {
    const { client_name, loan_amount, loan_type, stage, target_close_date, assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes } = req.body;
    
    const updates = [];
    const values = [];
    
    if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
    if (loan_amount !== undefined) { updates.push('loan_amount = ?'); values.push(loan_amount); }
    if (loan_type !== undefined) { updates.push('loan_type = ?'); values.push(loan_type); }
    if (stage !== undefined) { updates.push('stage = ?'); values.push(stage); }
    if (target_close_date !== undefined) { updates.push('target_close_date = ?'); values.push(target_close_date); }
    if (assigned_lo_id !== undefined) { updates.push('assigned_lo_id = ?'); values.push(assigned_lo_id); }
    if (assigned_lo_name !== undefined) { updates.push('assigned_lo_name = ?'); values.push(assigned_lo_name); }
    if (investor !== undefined) { updates.push('investor = ?'); values.push(investor); }
    if (investor_id !== undefined) { updates.push('investor_id = ?'); values.push(investor_id); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(req.params.id);
    
    await db.query(
      `UPDATE pipeline SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [req.params.id]);
    
    if (pipeline.length === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }
    
    res.json({ success: true, data: pipeline[0] });
  } catch (error) {
    next(error);
  }
});

// ========================================
// BULK OPERATIONS (for batch updates from external systems)
// ========================================

// POST /api/webhooks/bulk/tasks - Create multiple tasks
router.post('/bulk/tasks', async (req, res, next) => {
  try {
    const { tasks } = req.body;
    
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: 'tasks must be an array' });
    }
    
    // All tasks are associated with the user who owns the API key
    const userId = req.user ? req.user.id : null;
    
    const results = [];
    
    for (const task of tasks) {
      const { title, description, priority, status, due_date, due_time, assigned_to } = task;
      
      if (!title) continue; // Skip invalid tasks
      
      const [result] = await db.query(
        `INSERT INTO tasks (user_id, title, description, priority, status, due_date, due_time, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, title, description || null, priority || 'medium', status || 'todo', due_date || null, due_time || null, assigned_to || null]
      );
      
      const [created] = await db.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
      results.push(created[0]);
    }
    
    res.status(201).json({ success: true, count: results.length, data: results });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

