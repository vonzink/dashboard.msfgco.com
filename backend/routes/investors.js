// Investors API routes — full CRUD with admin guards
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isAdmin } = require('../middleware/userContext');

// ──────────────────────────────────────────────
// GET /api/investors — Get all investors
// ──────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const [investors] = await db.query('SELECT * FROM investors ORDER BY name');

    // Get related data for each investor
    for (const investor of investors) {
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
    }

    res.json(investors);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// GET /api/investors/:key — Get specific investor by key
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// POST /api/investors — Create investor (admin only)
// ──────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      investor_key, name,
      account_executive_name, account_executive_email, account_executive_mobile, account_executive_address,
      states, best_programs, minimum_fico, in_house_dpa,
      epo, max_comp, doc_review_wire, remote_closing_review,
      website_url, logo_url, login_url, notes
    } = req.body;

    if (!investor_key || !name) {
      return res.status(400).json({ error: 'investor_key and name are required' });
    }

    const [result] = await db.query(
      `INSERT INTO investors
        (investor_key, name, account_executive_name, account_executive_email,
         account_executive_mobile, account_executive_address,
         states, best_programs, minimum_fico, in_house_dpa,
         epo, max_comp, doc_review_wire, remote_closing_review,
         website_url, logo_url, login_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_executive_name = VALUES(account_executive_name),
         account_executive_email = VALUES(account_executive_email),
         account_executive_mobile = VALUES(account_executive_mobile),
         account_executive_address = VALUES(account_executive_address),
         states = VALUES(states),
         best_programs = VALUES(best_programs),
         minimum_fico = VALUES(minimum_fico),
         in_house_dpa = VALUES(in_house_dpa),
         epo = VALUES(epo),
         max_comp = VALUES(max_comp),
         doc_review_wire = VALUES(doc_review_wire),
         remote_closing_review = VALUES(remote_closing_review),
         website_url = VALUES(website_url),
         logo_url = VALUES(logo_url),
         login_url = VALUES(login_url),
         notes = VALUES(notes),
         updated_at = NOW()`,
      [
        investor_key, name,
        account_executive_name || null, account_executive_email || null,
        account_executive_mobile || null, account_executive_address || null,
        states || null, best_programs || null, minimum_fico || null, in_house_dpa || null,
        epo || null, max_comp || null, doc_review_wire || null, remote_closing_review || null,
        website_url || null, logo_url || null, login_url || null, notes || null
      ]
    );

    // Fetch newly created / updated row
    const [rows] = await db.query('SELECT * FROM investors WHERE investor_key = ?', [investor_key]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:idOrKey — Update investor
// Admin can update all fields; non-admin can only update notes
// ──────────────────────────────────────────────
router.put('/:idOrKey', async (req, res, next) => {
  try {
    const admin = isAdmin(req);
    const {
      notes,
      name,
      account_executive_name, account_executive_mobile,
      account_executive_email, account_executive_address,
      states, best_programs, minimum_fico, in_house_dpa,
      epo, max_comp, doc_review_wire, remote_closing_review,
      website_url, logo_url, login_url
    } = req.body;

    const updates = [];
    const values = [];

    // Notes — anyone can update
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }

    // All other fields — admin only
    if (admin) {
      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (account_executive_name !== undefined) { updates.push('account_executive_name = ?'); values.push(account_executive_name); }
      if (account_executive_mobile !== undefined) { updates.push('account_executive_mobile = ?'); values.push(account_executive_mobile); }
      if (account_executive_email !== undefined) { updates.push('account_executive_email = ?'); values.push(account_executive_email); }
      if (account_executive_address !== undefined) { updates.push('account_executive_address = ?'); values.push(account_executive_address); }
      if (states !== undefined) { updates.push('states = ?'); values.push(states); }
      if (best_programs !== undefined) { updates.push('best_programs = ?'); values.push(best_programs); }
      if (minimum_fico !== undefined) { updates.push('minimum_fico = ?'); values.push(minimum_fico); }
      if (in_house_dpa !== undefined) { updates.push('in_house_dpa = ?'); values.push(in_house_dpa); }
      if (epo !== undefined) { updates.push('epo = ?'); values.push(epo); }
      if (max_comp !== undefined) { updates.push('max_comp = ?'); values.push(max_comp); }
      if (doc_review_wire !== undefined) { updates.push('doc_review_wire = ?'); values.push(doc_review_wire); }
      if (remote_closing_review !== undefined) { updates.push('remote_closing_review = ?'); values.push(remote_closing_review); }
      if (website_url !== undefined) { updates.push('website_url = ?'); values.push(website_url); }
      if (logo_url !== undefined) { updates.push('logo_url = ?'); values.push(logo_url); }
      if (login_url !== undefined) { updates.push('login_url = ?'); values.push(login_url); }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const isNumeric = /^\d+$/.test(req.params.idOrKey);
    const whereClause = isNumeric ? 'WHERE id = ?' : 'WHERE investor_key = ?';

    values.push(req.params.idOrKey);

    await db.query(
      `UPDATE investors SET ${updates.join(', ')}, updated_at = NOW() ${whereClause}`,
      values
    );

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

// ──────────────────────────────────────────────
// DELETE /api/investors/:idOrKey — Delete investor (admin only)
// ──────────────────────────────────────────────
router.delete('/:idOrKey', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const isNumeric = /^\d+$/.test(req.params.idOrKey);
    const whereClause = isNumeric ? 'WHERE id = ?' : 'WHERE investor_key = ?';

    const [existing] = await db.query(`SELECT id FROM investors ${whereClause}`, [req.params.idOrKey]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    await db.query(`DELETE FROM investors ${whereClause}`, [req.params.idOrKey]);

    res.json({ success: true, message: 'Investor deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
