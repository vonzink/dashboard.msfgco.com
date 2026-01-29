// Notifications/Reminders API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// GET /api/notifications - Get notifications for user
router.get('/', async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    
    let query = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];
    
    if (!isAdmin(req)) {
      query += ' AND user_id = ?';
      params.push(getUserId(req));
    } else if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    
    query += ' ORDER BY reminder_date, reminder_time';
    
    const [notifications] = await db.query(query, params);
    res.json(notifications);
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications - Create notification/reminder
router.post('/', async (req, res, next) => {
  try {
    const { user_id, reminder_date, reminder_time, note } = req.body;
    
    if (!user_id || !reminder_date || !reminder_time || !note) {
      return res.status(400).json({ 
        error: 'user_id, reminder_date, reminder_time, and note are required' 
      });
    }
    
    const currentUserId = getUserId(req);
    const finalUserId = isAdmin(req) ? (user_id || currentUserId) : currentUserId;

    const [result] = await db.query(
      'INSERT INTO notifications (user_id, reminder_date, reminder_time, note) VALUES (?, ?, ?, ?)',
      [finalUserId, reminder_date, reminder_time, note]
    );
    
    const [notifications] = await db.query('SELECT * FROM notifications WHERE id = ?', [result.insertId]);
    res.status(201).json(notifications[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT user_id FROM notifications WHERE id = ?', [req.params.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    if (!isAdmin(req) && existing[0].user_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const [result] = await db.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

