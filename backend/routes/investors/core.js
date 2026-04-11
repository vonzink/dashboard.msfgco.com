// Investor Core CRUD — list, get, create, update, toggle, delete
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { isAdmin, hasRole, requireAdmin, requireManagerOrAdmin } = require('../../middleware/userContext');
const { buildUpdate } = require('../../utils/queryBuilder');
const { BUCKETS, getDownloadUrl } = require('../../services/s3');
const { investor: investorSchema, investorUpdate, validate } = require('../../validation/schemas');

/**
 * Detect whether logo_url is an S3 key (needs presigned URL) or an external URL.
 */
function isS3Key(val) {
  return val && !val.startsWith('http://') && !val.startsWith('https://');
}

/** Resolve logo_url → presigned download URL if it's an S3 key. */
async function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  if (!isS3Key(logoUrl)) return logoUrl;
  try {
    return await getDownloadUrl(BUCKETS.media, logoUrl);
  } catch {
    return null;
  }
}

// GET /api/investors — lightweight list
router.get('/', async (req, res, next) => {
  try {
    const showAll = (req.query.all === 'true' && hasRole(req, 'admin', 'manager'))
                 || req.query.directory === 'true';
    const whereClause = showAll ? '' : 'WHERE is_active = 1';

    const [investors] = await db.query(
      `SELECT id, investor_key, name,
              account_executive_name, account_executive_email, account_executive_mobile,
              states, best_programs, minimum_fico, in_house_dpa,
              epo, max_comp, underwriting_fee, in_house_servicing,
              servicing, manual_underwriting, non_qm, jumbo,
              subordinate_financing, review_wire_release,
              usda, land_loans, va_loans, bridge_loans, dscr,
              conventional, fha, bank_statement, asset_depletion,
              interest_only, itin_foreign_national, construction, renovation,
              manufactured, doctor, condo_non_warrantable, heloc_second,
              scenario_desk, condo_review, exception_desk,
              website_url, logo_url, notes, is_active
       FROM investors ${whereClause} ORDER BY name`
    );

    await Promise.all(investors.map(async (inv) => {
      inv.logo_url = await resolveLogoUrl(inv.logo_url);
    }));

    if (investors.length > 0) {
      const ids = investors.map(i => i.id);
      const [toggles] = await db.query(
        `SELECT investor_id, id, label, enabled, sort_order
         FROM investor_custom_toggles
         WHERE investor_id IN (?)
         ORDER BY sort_order, id`,
        [ids]
      );
      const byInv = {};
      toggles.forEach(t => {
        (byInv[t.investor_id] = byInv[t.investor_id] || []).push(t);
      });
      investors.forEach(inv => { inv.customToggles = byInv[inv.id] || []; });
    }

    res.json(investors);
  } catch (error) { next(error); }
});

// GET /api/investors/:key — full detail
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

    const [teamResult, lenderIdsResult, clausesResult, linksResult, turnTimesResult, documentsResult, customTogglesResult] = await Promise.all([
      db.query('SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name', [investor.id]),
      db.query('SELECT * FROM investor_lender_ids WHERE investor_id = ?', [investor.id]),
      db.query('SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?', [investor.id]),
      db.query('SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type', [investor.id]),
      db.query('SELECT * FROM investor_turn_times WHERE investor_id = ? ORDER BY sort_order', [investor.id]),
      db.query('SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY created_at DESC', [investor.id]),
      db.query('SELECT * FROM investor_custom_toggles WHERE investor_id = ? ORDER BY sort_order, id', [investor.id]),
    ]);

    investor.team = teamResult[0];
    investor.lenderIds = lenderIdsResult[0]?.[0] || {};
    investor.mortgageeClauses = clausesResult[0];
    investor.links = linksResult[0];
    investor.turnTimes = turnTimesResult[0];
    investor.documents = documentsResult[0];
    investor.customToggles = customTogglesResult[0];

    await Promise.all(investor.documents.map(async (doc) => {
      try { doc.download_url = await getDownloadUrl(BUCKETS.media, doc.file_key); } catch { doc.download_url = null; }
    }));

    investor.logo_url = await resolveLogoUrl(investor.logo_url);
    investor.account_executive_photo_url = await resolveLogoUrl(investor.account_executive_photo_url);

    await Promise.all(investor.team.map(async (m) => {
      if (m.photo_url) {
        m.photo_key = m.photo_url;
        m.photo_url = await resolveLogoUrl(m.photo_url);
      }
    }));

    res.json(investor);
  } catch (error) { next(error); }
});

// POST /api/investors — create (admin only)
router.post('/', requireAdmin, validate(investorSchema), async (req, res, next) => {
  try {
    const {
      investor_key: rawKey, name,
      account_executive_name, account_executive_email, account_executive_mobile, account_executive_address,
      states, best_programs, minimum_fico, in_house_dpa,
      epo, max_comp, underwriting_fee, in_house_servicing,
      servicing, manual_underwriting, non_qm, jumbo,
      subordinate_financing, review_wire_release,
      usda, land_loans, va_loans, bridge_loans, dscr,
      conventional, fha, bank_statement, asset_depletion,
      interest_only, itin_foreign_national, construction, renovation,
      manufactured, doctor, condo_non_warrantable, heloc_second,
      scenario_desk, condo_review, exception_desk,
      website_url, logo_url, login_url, notes
    } = req.body;

    const investor_key = rawKey || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    await db.query(
      `INSERT INTO investors
        (investor_key, name, account_executive_name, account_executive_email,
         account_executive_mobile, account_executive_address,
         states, best_programs, minimum_fico, in_house_dpa,
         epo, max_comp, underwriting_fee, in_house_servicing,
         servicing, manual_underwriting, non_qm, jumbo,
         subordinate_financing, review_wire_release,
         usda, land_loans, va_loans, bridge_loans, dscr,
         conventional, fha, bank_statement, asset_depletion,
         interest_only, itin_foreign_national, construction, renovation,
         manufactured, doctor, condo_non_warrantable, heloc_second,
         scenario_desk, condo_review, exception_desk,
         website_url, logo_url, login_url, notes)
       VALUES (${Array(44).fill('?').join(', ')})
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
         underwriting_fee = VALUES(underwriting_fee),
         in_house_servicing = VALUES(in_house_servicing),
         servicing = VALUES(servicing),
         manual_underwriting = VALUES(manual_underwriting),
         non_qm = VALUES(non_qm),
         jumbo = VALUES(jumbo),
         subordinate_financing = VALUES(subordinate_financing),
         review_wire_release = VALUES(review_wire_release),
         usda = VALUES(usda),
         land_loans = VALUES(land_loans),
         va_loans = VALUES(va_loans),
         bridge_loans = VALUES(bridge_loans),
         dscr = VALUES(dscr),
         conventional = VALUES(conventional),
         fha = VALUES(fha),
         bank_statement = VALUES(bank_statement),
         asset_depletion = VALUES(asset_depletion),
         interest_only = VALUES(interest_only),
         itin_foreign_national = VALUES(itin_foreign_national),
         construction = VALUES(construction),
         renovation = VALUES(renovation),
         manufactured = VALUES(manufactured),
         doctor = VALUES(doctor),
         condo_non_warrantable = VALUES(condo_non_warrantable),
         heloc_second = VALUES(heloc_second),
         scenario_desk = VALUES(scenario_desk),
         condo_review = VALUES(condo_review),
         exception_desk = VALUES(exception_desk),
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
        epo || null, max_comp || null, underwriting_fee || null, in_house_servicing || null,
        servicing ?? null, manual_underwriting ?? null, non_qm ?? null, jumbo ?? null,
        subordinate_financing ?? null, review_wire_release ?? null,
        usda ?? null, land_loans ?? null, va_loans ?? null, bridge_loans ?? null, dscr ?? null,
        conventional ?? null, fha ?? null, bank_statement ?? null, asset_depletion ?? null,
        interest_only ?? null, itin_foreign_national ?? null, construction ?? null, renovation ?? null,
        manufactured ?? null, doctor ?? null, condo_non_warrantable ?? null, heloc_second ?? null,
        scenario_desk ?? null, condo_review ?? null, exception_desk ?? null,
        website_url || null, logo_url || null, login_url || null, notes || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM investors WHERE investor_key = ?', [investor_key]);
    res.status(201).json(rows[0]);
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

    const isNumeric = /^\d+$/.test(req.params.idOrKey);
    const whereCol = isNumeric ? 'id = ?' : 'investor_key = ?';

    const update = buildUpdate('investors', allowedFields, req.body, { clause: whereCol, values: [req.params.idOrKey] });

    if (!update) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await db.query(update.sql, update.values);

    const [investors] = await db.query(
      `SELECT * FROM investors WHERE ${whereCol}`,
      [req.params.idOrKey]
    );

    if (investors.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    res.json(investors[0]);
  } catch (error) { next(error); }
});

// PATCH /api/investors/:id/toggle-active
router.patch('/:id/toggle-active', requireManagerOrAdmin, async (req, res, next) => {
  try {
    await db.query('UPDATE investors SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    const [rows] = await db.query('SELECT id, name, is_active FROM investors WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Investor not found' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

// DELETE /api/investors/:idOrKey
router.delete('/:idOrKey', requireAdmin, async (req, res, next) => {
  try {
    const isNumeric = /^\d+$/.test(req.params.idOrKey);
    const whereClause = isNumeric ? 'WHERE id = ?' : 'WHERE investor_key = ?';

    const [existing] = await db.query(`SELECT id FROM investors ${whereClause}`, [req.params.idOrKey]);
    if (existing.length === 0) return res.status(404).json({ error: 'Investor not found' });

    await db.query(`DELETE FROM investors ${whereClause}`, [req.params.idOrKey]);
    res.json({ success: true, message: 'Investor deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
