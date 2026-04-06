// Investors API routes — full CRUD with admin guards
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/connection');
const { requireDbUser, isAdmin, hasRole, requireAdmin, requireManagerOrAdmin } = require('../middleware/userContext');
const { buildUpdate } = require('../utils/queryBuilder');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject } = require('../services/s3');
const { investor: investorSchema, investorUpdate, validate } = require('../validation/schemas');

router.use(requireDbUser);

/**
 * Detect whether logo_url is an S3 key (needs presigned URL) or an external URL.
 * S3 keys never start with http.
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

// ──────────────────────────────────────────────
// GET /api/investors — Get all investors (lightweight list)
// Returns only the core fields needed for dropdown + manage list.
// Use GET /api/investors/:key for full detail (team, links, etc.)
// ──────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    // ?all=true returns all investors (for admin manage screen)
    // Default: only active investors (for dashboard dropdown)
    const showAll = req.query.all === 'true' && hasRole(req, 'admin', 'manager');
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
              manufactured, condo_non_warrantable, heloc_second,
              scenario_desk, condo_review, exception_desk,
              website_url, logo_url, notes, is_active
       FROM investors ${whereClause} ORDER BY name`
    );

    // Resolve S3 keys → presigned download URLs
    await Promise.all(investors.map(async (inv) => {
      inv.logo_url = await resolveLogoUrl(inv.logo_url);
    }));

    // Attach custom toggles for each investor (single query)
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

    // Parallel queries — reduces 5 sequential DB round-trips to 1
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

    // Resolve document download URLs
    await Promise.all(investor.documents.map(async (doc) => {
      try { doc.download_url = await getDownloadUrl(BUCKETS.media, doc.file_key); } catch { doc.download_url = null; }
    }));

    // Resolve S3 keys → presigned download URLs
    investor.logo_url = await resolveLogoUrl(investor.logo_url);
    investor.account_executive_photo_url = await resolveLogoUrl(investor.account_executive_photo_url);

    // Resolve team member photo URLs (keep raw key for re-saving)
    await Promise.all(investor.team.map(async (m) => {
      if (m.photo_url) {
        m.photo_key = m.photo_url; // raw S3 key
        m.photo_url = await resolveLogoUrl(m.photo_url); // presigned URL for display
      }
    }));

    res.json(investor);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// POST /api/investors — Create investor (admin only)
// ──────────────────────────────────────────────
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
      manufactured, condo_non_warrantable, heloc_second,
      scenario_desk, condo_review, exception_desk,
      website_url, logo_url, login_url, notes
    } = req.body;

    // Auto-generate investor_key from name if not provided
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
         manufactured, condo_non_warrantable, heloc_second,
         scenario_desk, condo_review, exception_desk,
         website_url, logo_url, login_url, notes)
       VALUES (${Array(43).fill('?').join(', ')})
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
        manufactured ?? null, condo_non_warrantable ?? null, heloc_second ?? null,
        scenario_desk ?? null, condo_review ?? null, exception_desk ?? null,
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
      'manufactured', 'condo_non_warrantable', 'heloc_second',
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
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PATCH /api/investors/:id/toggle-active — Toggle is_active (admin or manager)
// ──────────────────────────────────────────────
router.patch('/:id/toggle-active', requireManagerOrAdmin, async (req, res, next) => {
  try {
    await db.query('UPDATE investors SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    const [rows] = await db.query('SELECT id, name, is_active FROM investors WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Investor not found' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// DELETE /api/investors/:idOrKey — Delete investor (admin only)
// ──────────────────────────────────────────────
router.delete('/:idOrKey', requireAdmin, async (req, res, next) => {
  try {
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

// ──────────────────────────────────────────────
// POST /api/investors/:id/logo/upload-url — Get presigned upload URL (admin only)
// Accepts PNG, JPG/JPEG, SVG only. Max 5 MB.
// ──────────────────────────────────────────────
const ALLOWED_LOGO_TYPES = {
  'image/png':      '.png',
  'image/jpeg':     '.jpg',
  'image/svg+xml':  '.svg',
};
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

router.post('/:id/logo/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });

    // Validate MIME type
    if (!fileType || !ALLOWED_LOGO_TYPES[fileType]) {
      return res.status(400).json({ error: 'Only PNG, JPG, and SVG images are allowed' });
    }

    // Validate file size (client-reported — enforced as a guard)
    if (fileSize && fileSize > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: 'Logo must be under 5 MB' });
    }

    // Verify investor exists
    const [rows] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    // Build S3 key: vendor/<investorId>/<uuid><ext>
    const ext = ALLOWED_LOGO_TYPES[fileType];
    const fileKey = `vendor/${investorId}/${crypto.randomUUID()}${ext}`;

    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/logo/confirm — Save S3 key after upload (admin only)
// ──────────────────────────────────────────────
router.put('/:id/logo/confirm', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    // Get old logo key for cleanup
    const [old] = await db.query('SELECT logo_url FROM investors WHERE id = ?', [investorId]);
    if (old.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }
    const oldKey = old[0].logo_url;

    // Save new S3 key
    await db.query('UPDATE investors SET logo_url = ?, updated_at = NOW() WHERE id = ?', [fileKey, investorId]);

    // Delete old logo from S3 (best effort) — only if it was an S3 key
    if (oldKey && isS3Key(oldKey) && oldKey !== fileKey) {
      await deleteObject(BUCKETS.media, oldKey);
    }

    // Return presigned URL for immediate display
    const logo_url = await resolveLogoUrl(fileKey);
    res.json({ success: true, fileKey, logo_url });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// DELETE /api/investors/:id/logo — Remove logo (admin only)
// ──────────────────────────────────────────────
router.delete('/:id/logo', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;

    const [rows] = await db.query('SELECT logo_url FROM investors WHERE id = ?', [investorId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    const key = rows[0].logo_url;

    // Delete from S3 if it's an S3 key
    if (key && isS3Key(key)) {
      await deleteObject(BUCKETS.media, key);
    }

    await db.query('UPDATE investors SET logo_url = NULL, updated_at = NOW() WHERE id = ?', [investorId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// POST /api/investors/:id/photo/upload-url — Generic photo upload for AE/team (admin only)
// ──────────────────────────────────────────────
router.post('/:id/photo/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileName, fileType, fileSize, purpose } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !ALLOWED_LOGO_TYPES[fileType]) {
      return res.status(400).json({ error: 'Only PNG, JPG, and SVG images are allowed' });
    }
    if (fileSize && fileSize > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: 'Photo must be under 5 MB' });
    }

    const [rows] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    const ext = ALLOWED_LOGO_TYPES[fileType];
    const prefix = purpose === 'ae' ? 'ae' : 'team';
    const fileKey = `vendor/${investorId}/${prefix}-${crypto.randomUUID()}${ext}`;

    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/photo/confirm — Save photo S3 key (admin only)
// ──────────────────────────────────────────────
router.put('/:id/photo/confirm', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileKey, purpose } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    if (purpose === 'ae') {
      // Save as AE photo — clean up old one
      const [old] = await db.query('SELECT account_executive_photo_url FROM investors WHERE id = ?', [investorId]);
      if (old.length === 0) return res.status(404).json({ error: 'Investor not found' });

      const oldKey = old[0].account_executive_photo_url;
      await db.query('UPDATE investors SET account_executive_photo_url = ?, updated_at = NOW() WHERE id = ?', [fileKey, investorId]);

      if (oldKey && isS3Key(oldKey) && oldKey !== fileKey) {
        await deleteObject(BUCKETS.media, oldKey).catch(() => {});
      }
    }

    const photo_url = await resolveLogoUrl(fileKey);
    res.json({ success: true, fileKey, photo_url });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// DELETE /api/investors/:id/ae-photo — Remove AE photo (admin only)
// ──────────────────────────────────────────────
router.delete('/:id/ae-photo', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const [rows] = await db.query('SELECT account_executive_photo_url FROM investors WHERE id = ?', [investorId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Investor not found' });

    const key = rows[0].account_executive_photo_url;
    if (key && isS3Key(key)) {
      await deleteObject(BUCKETS.media, key).catch(() => {});
    }
    await db.query('UPDATE investors SET account_executive_photo_url = NULL, updated_at = NOW() WHERE id = ?', [investorId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/team — Replace team members (admin only)
// ──────────────────────────────────────────────
router.put('/:id/team', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { team } = req.body; // [{role, name, phone, email, sort_order}]

    if (!Array.isArray(team)) {
      return res.status(400).json({ error: 'team must be an array' });
    }

    // Verify investor exists
    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    // Replace: delete all, then insert new
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
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/lender-ids — Upsert lender IDs (admin only)
// ──────────────────────────────────────────────
router.put('/:id/lender-ids', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fha_id, va_id, rd_id } = req.body;

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    await db.query(
      `INSERT INTO investor_lender_ids (investor_id, fha_id, va_id, rd_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE fha_id = ?, va_id = ?, rd_id = ?`,
      [investorId, fha_id || null, va_id || null, rd_id || null, fha_id || null, va_id || null, rd_id || null]
    );

    const [rows] = await db.query('SELECT * FROM investor_lender_ids WHERE investor_id = ?', [investorId]);
    res.json(rows[0] || {});
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/mortgagee-clauses — Replace mortgagee clauses (admin only)
// ──────────────────────────────────────────────
router.put('/:id/mortgagee-clauses', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { clauses } = req.body; // [{name, isaoa, address}]

    if (!Array.isArray(clauses)) {
      return res.status(400).json({ error: 'clauses must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

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
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/links — Replace investor links (admin only)
// ──────────────────────────────────────────────
router.put('/:id/links', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { links } = req.body; // [{link_type, url, label}]

    if (!Array.isArray(links)) {
      return res.status(400).json({ error: 'links must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

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
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// PUT /api/investors/:id/turn-times — Replace turn times (admin only)
// ──────────────────────────────────────────────
router.put('/:id/turn-times', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { turnTimes } = req.body; // [{label, value, unit}]

    if (!Array.isArray(turnTimes)) {
      return res.status(400).json({ error: 'turnTimes must be an array' });
    }

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

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
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// INVESTOR DOCUMENTS
// ──────────────────────────────────────────────

const ALLOWED_DOC_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'text/plain': '.txt',
  'text/csv': '.csv',
};
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

// GET /api/investors/:id/documents — List documents
router.get('/:id/documents', async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const [docs] = await db.query(
      'SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY created_at DESC',
      [investorId]
    );
    // Generate download URLs
    for (const doc of docs) {
      try {
        doc.download_url = await getDownloadUrl(BUCKETS.media, doc.file_key);
      } catch { doc.download_url = null; }
    }
    res.json(docs);
  } catch (error) {
    next(error);
  }
});

// POST /api/investors/:id/documents/upload-url — Presigned upload URL (admin)
router.post('/:id/documents/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (fileSize && fileSize > MAX_DOC_BYTES) {
      return res.status(400).json({ error: 'File must be under 25 MB' });
    }

    const [rows] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Investor not found' });

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `investor-documents/${investorId}/${crypto.randomUUID()}-${safeName}`;

    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType || 'application/octet-stream');
    res.json({ ...result, fileKey });
  } catch (error) {
    next(error);
  }
});

// POST /api/investors/:id/documents/confirm — Save doc record after upload (admin)
router.post('/:id/documents/confirm', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileKey, fileName, fileType, fileSize } = req.body;

    if (!fileKey || !fileName) {
      return res.status(400).json({ error: 'fileKey and fileName are required' });
    }

    const [result] = await db.query(
      `INSERT INTO investor_documents (investor_id, file_name, file_key, file_size, file_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [investorId, fileName, fileKey, fileSize || null, fileType || null, req.dbUser?.id || null]
    );

    const docId = result.insertId;
    let download_url = null;
    try { download_url = await getDownloadUrl(BUCKETS.media, fileKey); } catch {}

    res.status(201).json({ id: docId, investor_id: investorId, file_name: fileName, file_key: fileKey, file_size: fileSize, file_type: fileType, download_url });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/investors/:id/documents/:docId — Delete document (admin)
router.delete('/:id/documents/:docId', requireAdmin, async (req, res, next) => {
  try {
    const { id: investorId, docId } = req.params;
    const [rows] = await db.query(
      'SELECT * FROM investor_documents WHERE id = ? AND investor_id = ?',
      [docId, investorId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    // Delete from S3
    try { await deleteObject(BUCKETS.media, rows[0].file_key); } catch {}

    await db.query('DELETE FROM investor_documents WHERE id = ?', [docId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// CUSTOM TOGGLES — per-investor user-defined toggles
// ──────────────────────────────────────────────

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

// POST /api/investors/:id/custom-toggles — Add custom toggle (admin only)
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

// PUT /api/investors/:id/custom-toggles/:toggleId — Update (admin only)
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

// DELETE /api/investors/:id/custom-toggles/:toggleId (admin only)
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
