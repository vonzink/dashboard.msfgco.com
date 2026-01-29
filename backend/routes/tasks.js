// Tasks API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// GET /api/tasks - Get all tasks (optionally filtered by user, status, etc.)
router.get('/', async (req, res, next) => {
  try {
    const { status, priority } = req.query;
    
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    
    if (!isAdmin(req)) {
      query += ' AND user_id = ?';
      params.push(getUserId(req));
    }
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (priority) {
      query += ' AND priority = ?';
      params.push(priority);
    }
    
    query += ' ORDER BY due_date, due_time, created_at DESC';
    
    const [tasks] = await db.query(query, params);
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

// GET /api/tasks/:id - Get specific task
router.get('/:id', async (req, res, next) => {
  try {
    const [tasks] = await db.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const currentUserId = getUserId(req);
    if (!isAdmin(req) && tasks[0].user_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json(tasks[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks - Create new task
router.post('/', async (req, res, next) => {
  try {
    const { title, description, priority, status, due_date, due_time, assigned_to, user_id } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    const currentUserId = getUserId(req);
    const userId = isAdmin(req) ? (user_id || currentUserId) : currentUserId;
    
    const [result] = await db.query(
      `INSERT INTO tasks (user_id, title, description, priority, status, due_date, due_time, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, description || null, priority || 'medium', status || 'todo', due_date || null, due_time || null, assigned_to || null]
    );
    
    const [tasks] = await db.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
    res.status(201).json(tasks[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', async (req, res, next) => {
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
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    values.push(req.params.id);
    
    const [existingTasks] = await db.query('SELECT user_id FROM tasks WHERE id = ?', [req.params.id]);
    
    if (existingTasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const currentUserId = getUserId(req);
    if (!isAdmin(req) && existingTasks[0].user_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await db.query(
      `UPDATE tasks SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [tasks] = await db.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.json(tasks[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    const [existingTasks] = await db.query('SELECT user_id FROM tasks WHERE id = ?', [req.params.id]);
    
    if (existingTasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const currentUserId = getUserId(req);
    if (!isAdmin(req) && existingTasks[0].user_id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const [result] = await db.query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

