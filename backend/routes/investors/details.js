// Investor Details — team, lender IDs, mortgagee clauses, links, turn times, custom toggles
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/userContext');
const Investor = require('../../models/Investor');

// PUT /api/investors/:id/team
router.put('/:id/team', requireAdmin, async (req, res, next) => {
  try {
    const { team } = req.body;
    if (!Array.isArray(team)) {
      return res.status(400).json({ error: 'team must be an array' });
    }
    if (!await Investor.exists(req.params.id)) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const rows = await Investor.saveTeam(req.params.id, team);
    res.json(rows);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/lender-ids
router.put('/:id/lender-ids', requireAdmin, async (req, res, next) => {
  try {
    if (!await Investor.exists(req.params.id)) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const result = await Investor.saveLenderIds(req.params.id, req.body);
    res.json(result);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/mortgagee-clauses
router.put('/:id/mortgagee-clauses', requireAdmin, async (req, res, next) => {
  try {
    const { clauses } = req.body;
    if (!Array.isArray(clauses)) {
      return res.status(400).json({ error: 'clauses must be an array' });
    }
    if (!await Investor.exists(req.params.id)) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const rows = await Investor.saveMortgageeClauses(req.params.id, clauses);
    res.json(rows);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/links
router.put('/:id/links', requireAdmin, async (req, res, next) => {
  try {
    const { links } = req.body;
    if (!Array.isArray(links)) {
      return res.status(400).json({ error: 'links must be an array' });
    }
    if (!await Investor.exists(req.params.id)) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const rows = await Investor.saveLinks(req.params.id, links);
    res.json(rows);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/turn-times
router.put('/:id/turn-times', requireAdmin, async (req, res, next) => {
  try {
    const { turnTimes } = req.body;
    if (!Array.isArray(turnTimes)) {
      return res.status(400).json({ error: 'turnTimes must be an array' });
    }
    if (!await Investor.exists(req.params.id)) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const rows = await Investor.saveTurnTimes(req.params.id, turnTimes);
    res.json(rows);
  } catch (error) { next(error); }
});

// GET /api/investors/:id/custom-toggles
router.get('/:id/custom-toggles', async (req, res, next) => {
  try {
    const rows = await Investor.getCustomToggles(req.params.id);
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
    const toggle = await Investor.createCustomToggle(req.params.id, { label, enabled, sort_order });
    res.status(201).json(toggle);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/custom-toggles/:toggleId
router.put('/:id/custom-toggles/:toggleId', requireAdmin, async (req, res, next) => {
  try {
    const result = await Investor.updateCustomToggle(req.params.id, req.params.toggleId, req.body);
    if (!result) return res.status(result === null ? 400 : 404).json({ error: result === null ? 'No fields to update' : 'Toggle not found' });
    res.json(result);
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/custom-toggles/:toggleId
router.delete('/:id/custom-toggles/:toggleId', requireAdmin, async (req, res, next) => {
  try {
    await Investor.deleteCustomToggle(req.params.id, req.params.toggleId);
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
