const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, hasRole, requireDbUser, requireProcessorOrAdmin } = require('../middleware/userContext');

router.use(requireDbUser);

const VALID_TYPES = ['title', 'insurance', 'voe', 'taxes', 'amc', 'payoffs', 'other'];
const VALID_STATUSES = ['ordered', 'received', 'pending', 'in-review', 'complete', 'issue'];

function isValidType(type) {
  return VALID_TYPES.includes(type);
}

/* ========================================
   Title Companies Lookup Table
   ======================================== */

// GET /api/processing/title-companies - List all (with optional state filter + search)
router.get('/title-companies', async (req, res, next) => {
  try {
    const { state, q } = req.query;
    const conditions = [];
    const params = [];

    if (state) {
      conditions.push('state = ?');
      params.push(state.toUpperCase());
    }

    if (q && q.trim()) {
      conditions.push('(company_name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR city LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern, pattern, pattern);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await db.query(
      `SELECT * FROM title_companies ${where} ORDER BY state, company_name`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/title-companies - Add a title company
router.post('/title-companies', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { companyName, contactName, email, workPhone, mobilePhone, street, city, state, zipCode, website, fax, tollFreePhone } = req.body;

    if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Company name is required.' });

    const [result] = await db.query(
      `INSERT INTO title_companies (company_name, contact_name, email, work_phone, mobile_phone, street, city, state, zip_code, website, fax, toll_free_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyName.trim(),
        (contactName || '').trim() || null,
        (email || '').trim() || null,
        (workPhone || '').trim() || null,
        (mobilePhone || '').trim() || null,
        (street || '').trim() || null,
        (city || '').trim() || null,
        state ? state.trim().toUpperCase() : null,
        (zipCode || '').trim() || null,
        (website || '').trim() || null,
        (fax || '').trim() || null,
        (tollFreePhone || '').trim() || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM title_companies WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/title-companies/:id - Update a title company
router.put('/title-companies/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM title_companies WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Title company not found.' });

    const fieldMap = {
      companyName: 'company_name',
      contactName: 'contact_name',
      email: 'email',
      workPhone: 'work_phone',
      mobilePhone: 'mobile_phone',
      street: 'street',
      city: 'city',
      state: 'state',
      zipCode: 'zip_code',
      website: 'website',
      fax: 'fax',
      tollFreePhone: 'toll_free_phone'
    };

    const updates = [];
    const values = [];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (dbCol === 'state' && typeof val === 'string') val = val.toUpperCase();
        else if (typeof val === 'string') val = val.trim() || null;
        updates.push(`${dbCol} = ?`);
        values.push(val);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE title_companies SET ${updates.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM title_companies WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/processing/title-companies/:id - Delete a title company
router.delete('/title-companies/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM title_companies WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Title company not found.' });

    await db.query('DELETE FROM title_companies WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/* ========================================
   Tax Counties Lookup Table
   ======================================== */

// GET /api/processing/tax-counties - List all counties (with optional state filter + search)
router.get('/tax-counties', async (req, res, next) => {
  try {
    const { state, q } = req.query;
    const conditions = [];
    const params = [];

    if (state) {
      conditions.push('state = ?');
      params.push(state.toUpperCase());
    }

    if (q && q.trim()) {
      conditions.push('(county LIKE ? OR state LIKE ? OR known_costs_fees LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern, pattern);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await db.query(
      `SELECT * FROM tax_counties ${where} ORDER BY state, county`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/tax-counties - Add a county
router.post('/tax-counties', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { county, state, assessorUrl, treasurerUrl, loginRequired, knownCostsFees, onlinePortal, notes } = req.body;

    if (!county || !county.trim()) return res.status(400).json({ error: 'County is required.' });
    if (!state || !state.trim()) return res.status(400).json({ error: 'State is required.' });

    const [result] = await db.query(
      `INSERT INTO tax_counties (county, state, assessor_url, treasurer_url, login_required, known_costs_fees, online_portal, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        county.trim(),
        state.trim().toUpperCase(),
        (assessorUrl || '').trim() || null,
        (treasurerUrl || '').trim() || null,
        loginRequired ? 1 : 0,
        (knownCostsFees || '').trim() || null,
        onlinePortal ? 1 : 0,
        (notes || '').trim() || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM tax_counties WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This county/state combination already exists.' });
    }
    next(error);
  }
});

// PUT /api/processing/tax-counties/:id - Update a county
router.put('/tax-counties/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM tax_counties WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'County not found.' });

    const fieldMap = {
      county: 'county',
      state: 'state',
      assessorUrl: 'assessor_url',
      treasurerUrl: 'treasurer_url',
      loginRequired: 'login_required',
      knownCostsFees: 'known_costs_fees',
      onlinePortal: 'online_portal',
      notes: 'notes'
    };

    const updates = [];
    const values = [];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (dbCol === 'state' && typeof val === 'string') val = val.toUpperCase();
        if (dbCol === 'login_required' || dbCol === 'online_portal') val = val ? 1 : 0;
        else if (typeof val === 'string') val = val.trim() || null;
        updates.push(`${dbCol} = ?`);
        values.push(val);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE tax_counties SET ${updates.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM tax_counties WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This county/state combination already exists.' });
    }
    next(error);
  }
});

// DELETE /api/processing/tax-counties/:id - Delete a county
router.delete('/tax-counties/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM tax_counties WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'County not found.' });

    await db.query('DELETE FROM tax_counties WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/* ========================================
   Processing Links (VOE, AMC, Payoffs, Insurance)
   ======================================== */

const VALID_LINK_TYPES = ['voe', 'amc', 'payoffs', 'insurance'];

// GET /api/processing/links/:sectionType - List links for a section
router.get('/links/:sectionType', async (req, res, next) => {
  try {
    const { sectionType } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const { q } = req.query;
    const conditions = ['section_type = ?'];
    const params = [sectionType];

    if (q && q.trim()) {
      conditions.push('(name LIKE ? OR url LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM processing_links WHERE ${where} ORDER BY sort_order, name`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/links/:sectionType - Add a link
router.post('/links/:sectionType', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { sectionType } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const { name, url, icon } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!url || !url.trim()) return res.status(400).json({ error: 'URL is required.' });

    // Get next sort_order
    const [[{ maxSort }]] = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM processing_links WHERE section_type = ?',
      [sectionType]
    );

    const [result] = await db.query(
      `INSERT INTO processing_links (section_type, name, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [sectionType, name.trim(), url.trim(), (icon || '').trim() || 'fa-link', maxSort + 1]
    );

    const [rows] = await db.query('SELECT * FROM processing_links WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/links/:sectionType/:id - Update a link
router.put('/links/:sectionType/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { sectionType, id } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const [existing] = await db.query('SELECT * FROM processing_links WHERE id = ? AND section_type = ?', [id, sectionType]);
    if (existing.length === 0) return res.status(404).json({ error: 'Link not found.' });

    const fieldMap = { name: 'name', url: 'url', icon: 'icon', sortOrder: 'sort_order' };
    const updates = [];
    const values = [];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (typeof val === 'string') val = val.trim() || null;
        updates.push(`${dbCol} = ?`);
        values.push(val);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE processing_links SET ${updates.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM processing_links WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/processing/links/:sectionType/:id - Delete a link
router.delete('/links/:sectionType/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { sectionType, id } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const [existing] = await db.query('SELECT * FROM processing_links WHERE id = ? AND section_type = ?', [id, sectionType]);
    if (existing.length === 0) return res.status(404).json({ error: 'Link not found.' });

    await db.query('DELETE FROM processing_links WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/* ========================================
   Processing Records (generic order tracking)
   ======================================== */

// GET /api/processing/:type - Search records
router.get('/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!isValidType(type)) return res.status(400).json({ error: 'Invalid processing type.' });

    const { q, status, sort, page, limit } = req.query;
    const conditions = ['type = ?'];
    const params = [type];

    // Only admins and processors see all records; others see only their own
    if (!isAdmin(req) && !hasRole(req, 'processor', 'manager')) {
      conditions.push('user_id = ?');
      params.push(getUserId(req));
    }

    if (q && q.trim()) {
      conditions.push('(borrower LIKE ? OR loan_number LIKE ? OR address LIKE ? OR vendor LIKE ? OR reference LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    if (status && VALID_STATUSES.includes(status)) {
      conditions.push('status = ?');
      params.push(status);
    }

    const where = conditions.join(' AND ');

    let orderBy;
    switch (sort) {
      case 'oldest':   orderBy = 'created_at ASC'; break;
      case 'borrower': orderBy = 'borrower ASC'; break;
      case 'status':   orderBy = 'status ASC, created_at DESC'; break;
      default:         orderBy = 'created_at DESC';
    }

    const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pageNum - 1) * perPage;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM processing_records WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT * FROM processing_records WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    res.json({
      success: true,
      results: rows,
      total,
      page: pageNum,
      perPage,
      totalPages: Math.ceil(total / perPage)
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/processing/:type/:id - Get single record
router.get('/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    if (!isValidType(type)) return res.status(400).json({ error: 'Invalid processing type.' });

    const [rows] = await db.query('SELECT * FROM processing_records WHERE id = ? AND type = ?', [id, type]);

    if (rows.length === 0) return res.status(404).json({ error: 'Record not found.' });

    const record = rows[0];
    if (!isAdmin(req) && !hasRole(req, 'processor', 'manager') && record.user_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    res.json(record);
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/:type - Create record
router.post('/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!isValidType(type)) return res.status(400).json({ error: 'Invalid processing type.' });

    const { borrower, loanNumber, address, vendor, status, orderedDate, reference, notes } = req.body;

    if (!borrower || !borrower.trim()) {
      return res.status(400).json({ error: 'Borrower name is required.' });
    }

    const recStatus = (status && VALID_STATUSES.includes(status)) ? status : 'ordered';

    const [result] = await db.query(
      `INSERT INTO processing_records (user_id, type, borrower, loan_number, address, vendor, status, ordered_date, reference, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        getUserId(req),
        type,
        borrower.trim(),
        (loanNumber || '').trim() || null,
        (address || '').trim() || null,
        (vendor || '').trim() || null,
        recStatus,
        orderedDate || null,
        (reference || '').trim() || null,
        (notes || '').trim() || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM processing_records WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/:type/:id - Update record
router.put('/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    if (!isValidType(type)) return res.status(400).json({ error: 'Invalid processing type.' });

    const [existing] = await db.query('SELECT * FROM processing_records WHERE id = ? AND type = ?', [id, type]);
    if (existing.length === 0) return res.status(404).json({ error: 'Record not found.' });

    if (!isAdmin(req) && !hasRole(req, 'processor', 'manager') && existing[0].user_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const fieldMap = {
      borrower: 'borrower',
      loanNumber: 'loan_number',
      address: 'address',
      vendor: 'vendor',
      status: 'status',
      orderedDate: 'ordered_date',
      reference: 'reference',
      notes: 'notes'
    };

    const updates = [];
    const values = [];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        const val = typeof req.body[bodyKey] === 'string' ? req.body[bodyKey].trim() : req.body[bodyKey];
        if (dbCol === 'status' && !VALID_STATUSES.includes(val)) continue;
        updates.push(`${dbCol} = ?`);
        values.push(val || null);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE processing_records SET ${updates.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM processing_records WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/processing/:type/:id - Delete record
router.delete('/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    if (!isValidType(type)) return res.status(400).json({ error: 'Invalid processing type.' });

    const [existing] = await db.query('SELECT * FROM processing_records WHERE id = ? AND type = ?', [id, type]);
    if (existing.length === 0) return res.status(404).json({ error: 'Record not found.' });

    if (!isAdmin(req) && !hasRole(req, 'processor', 'manager') && existing[0].user_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    await db.query('DELETE FROM processing_records WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
