// Investor Core CRUD — list, get, create, update, toggle, delete
const express = require('express');
const router = express.Router();
const { isAdmin, hasRole, requireAdmin, requireManagerOrAdmin } = require('../../middleware/userContext');
const { investor: investorSchema, investorUpdate, validate } = require('../../validation/schemas');
const { BUCKETS, resolveUrl } = require('../../services/s3');
const Investor = require('../../models/Investor');

// GET /api/investors — lightweight list
router.get('/', async (req, res, next) => {
  try {
    const showAll = (req.query.all === 'true' && hasRole(req, 'admin', 'manager'))
                 || req.query.directory === 'true';

    const investors = await Investor.findAll({ showAll });

    await Promise.all(investors.map(async (inv) => {
      inv.logo_url = await resolveUrl(BUCKETS.media,inv.logo_url);
    }));

    res.json(investors);
  } catch (error) { next(error); }
});

// GET /api/investors/:key — full detail
router.get('/:key', async (req, res, next) => {
  try {
    const investor = await Investor.findByKey(req.params.key);
    if (!investor) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    await Promise.all(investor.documents.map(async (doc) => {
      doc.download_url = await resolveUrl(BUCKETS.media, doc.file_key);
    }));

    investor.logo_url = await resolveUrl(BUCKETS.media, investor.logo_url);
    investor.account_executive_photo_url = await resolveUrl(BUCKETS.media, investor.account_executive_photo_url);

    await Promise.all(investor.team.map(async (m) => {
      if (m.photo_url) {
        m.photo_key = m.photo_url;
        m.photo_url = await resolveUrl(BUCKETS.media, m.photo_url);
      }
    }));

    res.json(investor);
  } catch (error) { next(error); }
});

// POST /api/investors — create (admin only)
router.post('/', requireAdmin, validate(investorSchema), async (req, res, next) => {
  try {
    const investor = await Investor.create(req.body);
    res.status(201).json(investor);
  } catch (error) { next(error); }
});

// PUT /api/investors/:idOrKey — update
router.put('/:idOrKey', validate(investorUpdate), async (req, res, next) => {
  try {
    const admin = isAdmin(req);
    const ADMIN_FIELDS = [
      'name', 'account_executive_name', 'account_executive_mobile',
      'account_executive_email', 'account_executive_address',
      'account_executive_photo_url',
      'states', 'best_programs', 'minimum_fico', 'in_house_dpa',
      'epo', 'max_comp', 'underwriting_fee', 'in_house_servicing',
      'servicing', 'manual_underwriting', 'non_qm', 'jumbo',
      'subordinate_financing', 'review_wire_release',
      'usda', 'land_loans', 'va_loans', 'bridge_loans', 'dscr',
      'conventional', 'fha', 'bank_statement', 'asset_depletion',
      'interest_only', 'itin_foreign_national', 'construction', 'renovation',
      'manufactured', 'doctor', 'condo_non_warrantable', 'heloc_second',
      'scenario_desk', 'condo_review', 'exception_desk',
      'website_url', 'logo_url', 'login_url', 'is_active',
    ];
    const allowedFields = admin ? ['notes', ...ADMIN_FIELDS] : ['notes'];

    const result = await Investor.update(req.params.idOrKey, allowedFields, req.body);

    if (result?.error === 'no_fields') {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    if (!result) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    res.json(result);
  } catch (error) { next(error); }
});

// PATCH /api/investors/:id/toggle-active
router.patch('/:id/toggle-active', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const result = await Investor.toggleActive(req.params.id);
    if (!result) return res.status(404).json({ error: 'Investor not found' });
    res.json(result);
  } catch (error) { next(error); }
});

// DELETE /api/investors/:idOrKey
router.delete('/:idOrKey', requireAdmin, async (req, res, next) => {
  try {
    const deleted = await Investor.remove(req.params.idOrKey);
    if (!deleted) return res.status(404).json({ error: 'Investor not found' });
    res.json({ success: true, message: 'Investor deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
