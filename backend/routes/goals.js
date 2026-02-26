// Goals API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { goalsUpdate, validate } = require('../validation/schemas');

router.use(requireDbUser);

// GET /api/goals - Get goals
router.get('/', async (req, res, next) => {
  try {
    const { user_id, period_type, period_value } = req.query;
    
    let query = 'SELECT * FROM goals WHERE 1=1';
    const params = [];
    
    if (!isAdmin(req)) {
      query += ' AND user_id = ?';
      params.push(getUserId(req));
    } else if (user_id) {
      query += ' AND user_id = ?';
      params.push(user_id);
    }
    if (period_type) {
      query += ' AND period_type = ?';
      params.push(period_type);
    }
    if (period_value) {
      query += ' AND period_value = ?';
      params.push(period_value);
    }
    
    query += ' ORDER BY period_type, period_value, goal_type';
    
    const [goals] = await db.query(query, params);
    res.json(goals);
  } catch (error) {
    next(error);
  }
});

// PUT /api/goals - Update or create goals
router.put('/', validate(goalsUpdate), async (req, res, next) => {
  try {
    const goals = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    
    for (const goal of goals) {
      const { user_id, period_type, period_value, goal_type, current_value, target_value } = goal;
      
      if (!period_type || !period_value || !goal_type || target_value === undefined) {
        continue; // Skip invalid goals
      }
      
      // Use INSERT ... ON DUPLICATE KEY UPDATE
      const currentUserId = getUserId(req);
      const finalUserId = isAdmin(req) ? (user_id || currentUserId) : currentUserId;

      const [result] = await db.query(
        `INSERT INTO goals (user_id, period_type, period_value, goal_type, current_value, target_value)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         current_value = VALUES(current_value),
         target_value = VALUES(target_value),
         updated_at = NOW()`,
        [finalUserId || null, period_type, period_value, goal_type, current_value || null, target_value]
      );
      
      // Get the updated/inserted goal
      const [updated] = await db.query(
        'SELECT * FROM goals WHERE period_type = ? AND period_value = ? AND goal_type = ? AND (user_id = ? OR (user_id IS NULL AND ? IS NULL))',
        [period_type, period_value, goal_type, finalUserId, finalUserId]
      );
      
      if (updated[0]) {
        results.push(updated[0]);
      }
    }
    
    res.json(results);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

