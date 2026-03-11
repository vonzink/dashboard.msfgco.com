// Investors API routes — full CRUD with admin guards
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/connection');
const { requireDbUser, isAdmin, requireAdmin } = require('../middleware/userContext');
const { buildUpdate } = require('../utils/queryBuilder');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject } = require('../services/s3');

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
    const showAll = req.query.all === 'true' && isAdmin(req);
    const whereClause = showAll ? '' : 'WHERE is_active = 1';

    const [investors] = await db.query(
      `SELECT id, investor_key, name,
              account_executive_name, account_executive_email, account_executive_mobile,
              states, best_programs, minimum_fico, in_house_dpa,
              epo, max_comp, doc_review_wire, remote_closing_review,
              website_url, logo_url, notes, is_active
       FROM investors ${whereClause} ORDER BY name`
    );

    // Resolve S3 keys → presigned download URLs
    await Promise.all(investors.map(async (inv) => {
      inv.logo_url = await resolveLogoUrl(inv.logo_url);
    }));

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

    // Parallel queries — reduces 4 sequential DB round-trips to 1
    const [teamResult, lenderIdsResult, clausesResult, linksResult] = await Promise.all([
      db.query('SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name', [investor.id]),
      db.query('SELECT * FROM investor_lender_ids WHERE investor_id = ?', [investor.id]),
      db.query('SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?', [investor.id]),
      db.query('SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type', [investor.id]),
    ]);

    investor.team = teamResult[0];
    investor.lenderIds = lenderIdsResult[0]?.[0] || {};
    investor.mortgageeClauses = clausesResult[0];
    investor.links = linksResult[0];

    // Resolve S3 key → presigned download URL
    investor.logo_url = await resolveLogoUrl(investor.logo_url);

    res.json(investor);
  } catch (error) {
    next(error);
  }
});

// ──────────────────────────────────────────────
// POST /api/investors — Create investor (admin only)
// ──────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const {
      investor_key: rawKey, name,
      account_executive_name, account_executive_email, account_executive_mobile, account_executive_address,
      states, best_programs, minimum_fico, in_house_dpa,
      epo, max_comp, doc_review_wire, remote_closing_review,
      website_url, logo_url, login_url, notes
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Auto-generate investor_key from name if not provided
    const investor_key = rawKey || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    await db.query(
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
    const ADMIN_FIELDS = [
      'name', 'account_executive_name', 'account_executive_mobile',
      'account_executive_email', 'account_executive_address',
      'states', 'best_programs', 'minimum_fico', 'in_house_dpa',
      'epo', 'max_comp', 'doc_review_wire', 'remote_closing_review',
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
// PATCH /api/investors/:id/toggle-active — Toggle is_active (admin only)
// ──────────────────────────────────────────────
router.patch('/:id/toggle-active', requireAdmin, async (req, res, next) => {
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
        'INSERT INTO investor_team (investor_id, role, name, phone, email, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [investorId, m.role || null, m.name || null, m.phone || null, m.email || null, m.sort_order ?? i]
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
    const { fha_id, va_id } = req.body;

    const [existing] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    await db.query(
      `INSERT INTO investor_lender_ids (investor_id, fha_id, va_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fha_id = ?, va_id = ?`,
      [investorId, fha_id || null, va_id || null, fha_id || null, va_id || null]
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
        'INSERT INTO investor_mortgagee_clauses (investor_id, name, isaoa, address) VALUES (?, ?, ?, ?)',
        [investorId, c.name, c.isaoa || null, c.address || null]
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
        [investorId, l.link_type || 'website', l.url, l.label || null]
      );
    }

    const [rows] = await db.query('SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type', [investorId]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
