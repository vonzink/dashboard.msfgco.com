const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// GET /api/lendingpad - Get all LendingPad loans
router.get('/', async (req, res, next) => {
  try {
    const [loans] = await db.query(
      'SELECT * FROM lendingpad_loans ORDER BY received_at DESC'
    );
    res.json(loans);
  } catch (error) {
    next(error);
  }
});

// GET /api/lendingpad/:id - Get single loan with full raw JSON
router.get('/:id', async (req, res, next) => {
  try {
    const [loans] = await db.query(
      'SELECT * FROM lendingpad_loans WHERE id = ?',
      [req.params.id]
    );
    if (loans.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    res.json(loans[0]);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
