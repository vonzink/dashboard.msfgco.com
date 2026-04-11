// Investor Details — team, lender IDs, mortgagee clauses, links, turn times, custom toggles
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { requireAdmin } = require('../../middleware/userContext');

// PUT /api/investors/:id/team
router.put('/:id/team', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { team } = req.body;

    if (!Array.isArray(team)) {
      return res.status(400).json({ error: 'team must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) return res.status(404).json({ error: 'Investor not found' });

    await db.query('DELETE FROM investor_team WHERE investor_id = ?', [investorId]);

    for (let i = 0; i < team.length; i++) {
      const m = team[i];
      if (!m.name && !m.role) continue;
      await db.query(
        'INSERT INTO investor_team (investor_id, role, name, phone, email, photo_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [investorId, m.role || null, m.name || null, m.phone || null, m.email || null, m.photo_url || null, m.sort_order ?? i]
      );
    }

    const [rows] = await db.query('SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name', [investorId]);
    res.json(rows);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/lender-ids
router.put('/:id/lender-ids', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fha_id, va_id, rd_id } = req.body;

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) return res.status(404).json({ error: 'Investor not found' });

    await db.query(
      `INSERT INTO investor_lender_ids (investor_id, fha_id, va_id, rd_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE fha_id = ?, va_id = ?, rd_id = ?`,
      [investorId, fha_id || null, va_id || null, rd_id || null, fha_id || null, va_id || null, rd_id || null]
    );

    const [rows] = await db.query('SELECT * FROM investor_lender_ids WHERE investor_id = ?', [investorId]);
    res.json(rows[0] || {});
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/mortgagee-clauses
router.put('/:id/mortgagee-clauses', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { clauses } = req.body;

    if (!Array.isArray(clauses)) {
      return res.status(400).json({ error: 'clauses must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) return res.status(404).json({ error: 'Investor not found' });

    await db.query('DELETE FROM investor_mortgagee_clauses WHERE investor_id = ?', [investorId]);

    for (const c of clauses) {
      if (!c.name) continue;
      await db.query(
        'INSERT INTO investor_mortgagee_clauses (investor_id, label, name, isaoa, address) VALUES (?, ?, ?, ?, ?)',
        [investorId, c.label || null, c.name, c.isaoa || null, c.address || null]
      );
    }

    const [rows] = await db.query('SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?', [investorId]);
    res.json(rows);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/links
router.put('/:id/links', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { links } = req.body;

    if (!Array.isArray(links)) {
      return res.status(400).json({ error: 'links must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) return res.status(404).json({ error: 'Investor not found' });

    await db.query('DELETE FROM investor_links WHERE investor_id = ?', [investorId]);

    for (const l of links) {
      if (!l.url) continue;
      await db.query(
        'INSERT INTO investor_links (investor_id, link_type, url, label) VALUES (?, ?, ?, ?)',
        [investorId, l.link_type || 'other', l.url, l.label || null]
      );
    }

    const [rows] = await db.query('SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type', [investorId]);
    res.json(rows);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/turn-times
router.put('/:id/turn-times', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { turnTimes } = req.body;

    if (!Array.isArray(turnTimes)) {
      return res.status(400).json({ error: 'turnTimes must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) return res.status(404).json({ error: 'Investor not found' });

    await db.query('DELETE FROM investor_turn_times WHERE investor_id = ?', [investorId]);

    for (let i = 0; i < turnTimes.length; i++) {
      const t = turnTimes[i];
      if (!t.label || t.value == null) continue;
      const unit = t.unit === 'hours' ? 'hours' : 'days';
      await db.query(
        'INSERT INTO investor_turn_times (investor_id, label, value, unit, sort_order) VALUES (?, ?, ?, ?, ?)',
        [investorId, t.label, t.value, unit, t.sort_order ?? i]
      );
    }

    const [rows] = await db.query('SELECT * FROM investor_turn_times WHERE investor_id = ? ORDER BY sort_order', [investorId]);
    res.json(rows);
  } catch (error) { next(error); }
});

// GET /api/investors/:id/custom-toggles
router.get('/:id/custom-toggles', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM investor_custom_toggles WHERE investor_id = ? ORDER BY sort_order, id',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

// POST /api/investors/:id/custom-toggles
router.post('/:id/custom-toggles', requireAdmin, async (req, res, next) => {
  try {
    const { label, enabled, sort_order } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'label is required' });
    }
    const [result] = await db.query(
      'INSERT INTO investor_custom_toggles (investor_id, label, enabled, sort_order) VALUES (?, ?, ?, ?)',
      [req.params.id, label.trim().slice(0, 100), enabled ? 1 : 0, sort_order || 0]
    );
    const [rows] = await db.query('SELECT * FROM investor_custom_toggles WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/custom-toggles/:toggleId
router.put('/:id/custom-toggles/:toggleId', requireAdmin, async (req, res, next) => {
  try {
    const { label, enabled, sort_order } = req.body;
    const sets = [];
    const vals = [];
    if (label !== undefined) { sets.push('label = ?'); vals.push(String(label).trim().slice(0, 100)); }
    if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0); }
    if (sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(sort_order); }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    vals.push(req.params.toggleId, req.params.id);
    await db.query(`UPDATE investor_custom_toggles SET ${sets.join(', ')} WHERE id = ? AND investor_id = ?`, vals);

    const [rows] = await db.query('SELECT * FROM investor_custom_toggles WHERE id = ?', [req.params.toggleId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Toggle not found' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/custom-toggles/:toggleId
router.delete('/:id/custom-toggles/:toggleId', requireAdmin, async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM investor_custom_toggles WHERE id = ? AND investor_id = ?',
      [req.params.toggleId, req.params.id]
    );
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
