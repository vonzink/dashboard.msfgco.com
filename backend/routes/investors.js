// Investors API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// GET /api/investors - Get all investors
router.get('/', async (req, res, next) => {
  try {
    const [investors] = await db.query('SELECT * FROM investors ORDER BY name');
    
    // Get related data for each investor
    for (const investor of investors) {
      // Get team members
      const [team] = await db.query(
        'SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name',
        [investor.id]
      );
      investor.team = team;
      
      // Get lender IDs
      const [lenderIds] = await db.query(
        'SELECT * FROM investor_lender_ids WHERE investor_id = ?',
        [investor.id]
      );
      investor.lenderIds = lenderIds[0] || {};
      
      // Get mortgagee clauses
      const [clauses] = await db.query(
        'SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?',
        [investor.id]
      );
      investor.mortgageeClauses = clauses;
      
      // Get links
      const [links] = await db.query(
        'SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type',
        [investor.id]
      );
      investor.links = links;
    }
    
    res.json(investors);
  } catch (error) {
    next(error);
  }
});

// GET /api/investors/:key - Get specific investor by key
router.get('/:key', async (req, res, next) => {
  try {
    const [investors] = await db.query(
      'SELECT * FROM investors WHERE investor_key = ?',
      [req.params.key]
    );
    
    if (investors.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    
    const investor = investors[0];
    
    // Get related data
    const [team] = await db.query(
      'SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name',
      [investor.id]
    );
    investor.team = team;
    
    const [lenderIds] = await db.query(
      'SELECT * FROM investor_lender_ids WHERE investor_id = ?',
      [investor.id]
    );
    investor.lenderIds = lenderIds[0] || {};
    
    const [clauses] = await db.query(
      'SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?',
      [investor.id]
    );
    investor.mortgageeClauses = clauses;
    
    const [links] = await db.query(
      'SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type',
      [investor.id]
    );
    investor.links = links;
    
    res.json(investor);
  } catch (error) {
    next(error);
  }
});

// PUT /api/investors/:idOrKey - Update investor (by ID or key)
router.put('/:idOrKey', async (req, res, next) => {
  try {
    const { notes, account_executive_name, account_executive_mobile, account_executive_email, account_executive_address } = req.body;
    
    const updates = [];
    const values = [];
    
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }
    if (account_executive_name !== undefined) {
      updates.push('account_executive_name = ?');
      values.push(account_executive_name);
    }
    if (account_executive_mobile !== undefined) {
      updates.push('account_executive_mobile = ?');
      values.push(account_executive_mobile);
    }
    if (account_executive_email !== undefined) {
      updates.push('account_executive_email = ?');
      values.push(account_executive_email);
    }
    if (account_executive_address !== undefined) {
      updates.push('account_executive_address = ?');
      values.push(account_executive_address);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    // Check if idOrKey is numeric (ID) or string (key)
    const isNumeric = /^\d+$/.test(req.params.idOrKey);
    const whereClause = isNumeric 
      ? 'WHERE id = ?' 
      : 'WHERE investor_key = ?';
    
    values.push(req.params.idOrKey);
    
    await db.query(
      `UPDATE investors SET ${updates.join(', ')}, updated_at = NOW() ${whereClause}`,
      values
    );
    
    // Get the updated investor
    const [investors] = await db.query(
      `SELECT * FROM investors ${whereClause}`,
      [req.params.idOrKey]
    );
    
    if (investors.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    
    res.json(investors[0]);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

