/**
 * routes/webhooks/tasks.js
 *
 * Webhook endpoints for task CRUD and bulk task creation.
 */
const router = require('express').Router();
const db = require('../../db/connection');
const { buildUpdate } = require('../../utils/queryBuilder');

const TASK_FIELDS = ['title', 'description', 'priority', 'status', 'due_date', 'due_time', 'assigned_to'];

// POST /api/webhooks/tasks — Create task via webhook
router.post('/', async (req, res, next) => {
  try {
    const { title, description, priority, status, due_date, due_time, assigned_to } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

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

// PUT /api/webhooks/tasks/:id — Update task via webhook
router.put('/:id', async (req, res, next) => {
  try {
    const update = buildUpdate('tasks', TASK_FIELDS, req.body, { clause: 'id = ?', values: [req.params.id] });

    if (!update) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await db.query(update.sql, update.values);

    const [tasks] = await db.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);

    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true, data: tasks[0] });
  } catch (error) {
    next(error);
  }
});

// POST /api/webhooks/bulk/tasks — Create multiple tasks (mounted at /bulk/tasks via index.js)
router.post('/tasks', async (req, res, next) => {
  try {
    const { tasks } = req.body;

    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: 'tasks must be an array' });
    }

    const userId = req.user ? req.user.id : null;
    const results = [];

    for (const task of tasks) {
      const { title, description, priority, status, due_date, due_time, assigned_to } = task;

      if (!title) continue;

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
