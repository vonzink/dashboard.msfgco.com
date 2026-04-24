const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, hasRole, requireDbUser, requireProcessorOrAdmin, getUserRole } = require('../middleware/userContext');

/**
 * Middleware: allow processor, manager, admin, OR LO to add/edit (not delete).
 * Used on POST/PUT routes for lookup tables.
 */
function requireWriteAccess(req, res, next) {
  if (hasRole(req, 'admin', 'processor', 'manager', 'lo')) {
    return next();
  }
  return res.status(403).json({ error: 'Processor, LO, manager, or admin access required' });
}
const { buildUpdateClauses } = require('../utils/queryBuilder');

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
router.post('/title-companies', requireWriteAccess, async (req, res, next) => {
  try {
    const { companyName, contactName, email, workPhone, mobilePhone, street, city, state, zipCode, website, fax, tollFreePhone, licenseNumber, nmls, stateLicense, contactNmls, contactEmail, contactPhone } = req.body;

    if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Company name is required.' });

    const [result] = await db.query(
      `INSERT INTO title_companies (company_name, contact_name, email, work_phone, mobile_phone, street, city, state, zip_code, website, fax, toll_free_phone, license_number, nmls, state_license, contact_nmls, contact_email, contact_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        (tollFreePhone || '').trim() || null,
        (licenseNumber || '').trim() || null,
        (nmls || '').trim() || null,
        (stateLicense || '').trim() || null,
        (contactNmls || '').trim() || null,
        (contactEmail || '').trim() || null,
        (contactPhone || '').trim() || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM title_companies WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/title-companies/:id - Update a title company
router.put('/title-companies/:id', requireWriteAccess, async (req, res, next) => {
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
      tollFreePhone: 'toll_free_phone',
      licenseNumber: 'license_number',
      nmls: 'nmls',
      stateLicense: 'state_license',
      contactNmls: 'contact_nmls',
      contactEmail: 'contact_email',
      contactPhone: 'contact_phone'
    };

    const { setClauses, values } = buildUpdateClauses(fieldMap, req.body, {
      state: (val) => typeof val === 'string' ? val.toUpperCase() : val,
    });

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE title_companies SET ${setClauses.join(', ')} WHERE id = ?`, values);

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
   Realtors Lookup Table
   ======================================== */

// GET /api/processing/realtors - List all (with optional state filter + search)
router.get('/realtors', async (req, res, next) => {
  try {
    const { state, q } = req.query;
    const conditions = [];
    const params = [];

    if (state) {
      conditions.push('state = ?');
      params.push(state.toUpperCase());
    }

    if (q && q.trim()) {
      conditions.push('(company_name LIKE ? OR agent_name LIKE ? OR email LIKE ? OR city LIKE ? OR company_nmls_id LIKE ? OR contact_nmls_id LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await db.query(
      `SELECT * FROM realtors ${where} ORDER BY state, company_name, agent_name`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/realtors - Add a realtor
router.post('/realtors', requireWriteAccess, async (req, res, next) => {
  try {
    const { companyName, agentName, companyNmlsId, email, stateLicenseId, contactNmlsId, workPhone, fax, street, city, state, zipCode } = req.body;

    if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Company name is required.' });

    const [result] = await db.query(
      `INSERT INTO realtors (company_name, agent_name, company_nmls_id, email, state_license_id, contact_nmls_id, work_phone, fax, street, city, state, zip_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyName.trim(),
        (agentName || '').trim() || null,
        (companyNmlsId || '').trim() || null,
        (email || '').trim() || null,
        (stateLicenseId || '').trim() || null,
        (contactNmlsId || '').trim() || null,
        (workPhone || '').trim() || null,
        (fax || '').trim() || null,
        (street || '').trim() || null,
        (city || '').trim() || null,
        state ? state.trim().toUpperCase() : null,
        (zipCode || '').trim() || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM realtors WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/realtors/:id - Update a realtor
router.put('/realtors/:id', requireWriteAccess, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM realtors WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Realtor not found.' });

    const fieldMap = {
      companyName: 'company_name',
      agentName: 'agent_name',
      companyNmlsId: 'company_nmls_id',
      email: 'email',
      stateLicenseId: 'state_license_id',
      contactNmlsId: 'contact_nmls_id',
      workPhone: 'work_phone',
      fax: 'fax',
      street: 'street',
      city: 'city',
      state: 'state',
      zipCode: 'zip_code'
    };

    const { setClauses, values } = buildUpdateClauses(fieldMap, req.body, {
      state: (val) => typeof val === 'string' ? val.toUpperCase() : val,
    });

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE realtors SET ${setClauses.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM realtors WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/processing/realtors/:id - Delete a realtor
router.delete('/realtors/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM realtors WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Realtor not found.' });

    await db.query('DELETE FROM realtors WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/* ========================================
   Insurance Companies Lookup Table
   ======================================== */

// GET /api/processing/insurance-companies - List all (with optional state filter + search)
router.get('/insurance-companies', async (req, res, next) => {
  try {
    const { state, q } = req.query;
    const conditions = [];
    const params = [];

    if (state) {
      conditions.push('state = ?');
      params.push(state.toUpperCase());
    }

    if (q && q.trim()) {
      conditions.push('(company_name LIKE ? OR point_of_contact LIKE ? OR email LIKE ? OR city LIKE ? OR nmls LIKE ? OR contact_nmls LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await db.query(
      `SELECT * FROM insurance_companies ${where} ORDER BY state, company_name`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/insurance-companies - Add an insurance company
router.post('/insurance-companies', requireWriteAccess, async (req, res, next) => {
  try {
    const { companyName, pointOfContact, contactPhone, workPhone, fax, email, nmls, stateLicense, contactNmls, street, city, state, zipCode } = req.body;

    if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Company name is required.' });

    const [result] = await db.query(
      `INSERT INTO insurance_companies (company_name, point_of_contact, contact_phone, work_phone, fax, email, nmls, state_license, contact_nmls, street, city, state, zip_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyName.trim(),
        (pointOfContact || '').trim() || null,
        (contactPhone || '').trim() || null,
        (workPhone || '').trim() || null,
        (fax || '').trim() || null,
        (email || '').trim() || null,
        (nmls || '').trim() || null,
        (stateLicense || '').trim() || null,
        (contactNmls || '').trim() || null,
        (street || '').trim() || null,
        (city || '').trim() || null,
        state ? state.trim().toUpperCase() : null,
        (zipCode || '').trim() || null
      ]
    );

    const [rows] = await db.query('SELECT * FROM insurance_companies WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/insurance-companies/:id - Update an insurance company
router.put('/insurance-companies/:id', requireWriteAccess, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM insurance_companies WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Insurance company not found.' });

    const fieldMap = {
      companyName: 'company_name',
      pointOfContact: 'point_of_contact',
      contactPhone: 'contact_phone',
      workPhone: 'work_phone',
      fax: 'fax',
      email: 'email',
      nmls: 'nmls',
      stateLicense: 'state_license',
      contactNmls: 'contact_nmls',
      street: 'street',
      city: 'city',
      state: 'state',
      zipCode: 'zip_code'
    };

    const { setClauses, values } = buildUpdateClauses(fieldMap, req.body, {
      state: (val) => typeof val === 'string' ? val.toUpperCase() : val,
    });

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE insurance_companies SET ${setClauses.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM insurance_companies WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/processing/insurance-companies/:id - Delete an insurance company
router.delete('/insurance-companies/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM insurance_companies WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Insurance company not found.' });

    await db.query('DELETE FROM insurance_companies WHERE id = ?', [id]);
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
router.post('/tax-counties', requireWriteAccess, async (req, res, next) => {
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
router.put('/tax-counties/:id', requireWriteAccess, async (req, res, next) => {
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

    const { setClauses, values } = buildUpdateClauses(fieldMap, req.body, {
      state: (val) => typeof val === 'string' ? val.toUpperCase() : val,
      login_required: (val) => val ? 1 : 0,
      online_portal: (val) => val ? 1 : 0,
    });

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE tax_counties SET ${setClauses.join(', ')} WHERE id = ?`, values);

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

const VALID_LINK_TYPES = ['voe', 'amc', 'payoffs', 'insurance', 'quick_links', 'statewide'];

// GET /api/processing/links/:sectionType - List links for a section
router.get('/links/:sectionType', async (req, res, next) => {
  try {
    const { sectionType } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const { q } = req.query;
    const conditions = ['section_type = ?'];
    const params = [sectionType];

    if (q && q.trim()) {
      const pattern = '%' + q.trim() + '%';
      if (sectionType === 'statewide') {
        conditions.push('(name LIKE ? OR url LIKE ? OR group_label LIKE ? OR notes LIKE ?)');
      } else {
        conditions.push('(name LIKE ? OR url LIKE ? OR email LIKE ? OR phone LIKE ?)');
      }
      params.push(pattern, pattern, pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const orderBy = sectionType === 'statewide' ? 'group_label, sort_order, name' : 'sort_order, name';
    const [rows] = await db.query(
      `SELECT * FROM processing_links WHERE ${where} ORDER BY ${orderBy}`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/links/:sectionType - Add a link
router.post('/links/:sectionType', requireWriteAccess, async (req, res, next) => {
  try {
    const { sectionType } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const { name, url, email, phone, fax, agentName, agentEmail, icon, groupLabel, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!url || !url.trim()) return res.status(400).json({ error: 'URL is required.' });

    // Get next sort_order
    const [[{ maxSort }]] = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM processing_links WHERE section_type = ?',
      [sectionType]
    );

    const trimOrNull = (v) => (v && v.trim()) || null;
    const [result] = await db.query(
      `INSERT INTO processing_links (section_type, name, url, email, phone, fax, agent_name, agent_email, icon, group_label, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sectionType, name.trim(), url.trim(), trimOrNull(email), trimOrNull(phone), trimOrNull(fax), trimOrNull(agentName), trimOrNull(agentEmail), (icon || '').trim() || 'fa-link', trimOrNull(groupLabel), trimOrNull(notes), maxSort + 1]
    );

    const [rows] = await db.query('SELECT * FROM processing_links WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/processing/links/:sectionType/:id - Update a link
router.put('/links/:sectionType/:id', requireWriteAccess, async (req, res, next) => {
  try {
    const { sectionType, id } = req.params;
    if (!VALID_LINK_TYPES.includes(sectionType)) return res.status(400).json({ error: 'Invalid section type.' });

    const [existing] = await db.query('SELECT * FROM processing_links WHERE id = ? AND section_type = ?', [id, sectionType]);
    if (existing.length === 0) return res.status(404).json({ error: 'Link not found.' });

    const fieldMap = { name: 'name', url: 'url', email: 'email', phone: 'phone', fax: 'fax', agentName: 'agent_name', agentEmail: 'agent_email', icon: 'icon', groupLabel: 'group_label', notes: 'notes', sortOrder: 'sort_order' };

    const { setClauses, values } = buildUpdateClauses(fieldMap, req.body);

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE processing_links SET ${setClauses.join(', ')} WHERE id = ?`, values);

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
   PMI Companies Lookup Table
   ======================================== */

// GET /api/processing/pmi-companies - List all (with optional search)
router.get('/pmi-companies', async (req, res, next) => {
  try {
    const { q } = req.query;
    const conditions = [];
    const params = [];

    if (q && q.trim()) {
      conditions.push('(company_name LIKE ? OR notes LIKE ?)');
      const pattern = '%' + q.trim() + '%';
      params.push(pattern, pattern);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [rows] = await db.query(
      `SELECT * FROM pmi_companies ${where} ORDER BY sort_order, company_name`,
      params
    );

    res.json({ success: true, results: rows, total: rows.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/processing/pmi-companies - Add a PMI company
router.post('/pmi-companies', requireWriteAccess, async (req, res, next) => {
  try {
    const { companyName, primaryQuoteLink, backupRateLink, loginRequired, clientFriendly, notes } = req.body;

    if (!companyName || !companyName.trim()) return res.status(400).json({ error: 'Company name is required.' });

    const [[{ maxSort }]] = await db.query('SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM pmi_companies');

    const [result] = await db.query(
      `INSERT INTO pmi_companies (company_name, primary_quote_link, backup_rate_link, login_required, client_friendly, notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        companyName.trim(),
        (primaryQuoteLink || '').trim() || null,
        (backupRateLink || '').trim() || null,
        (loginRequired || '').trim() || null,
        (clientFriendly || '').trim() || null,
        (notes || '').trim() || null,
        maxSort + 1
      ]
    );

    const [rows] = await db.query('SELECT * FROM pmi_companies WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, record: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A PMI company with that name already exists.' });
    }
    next(error);
  }
});

// PUT /api/processing/pmi-companies/:id - Update a PMI company
router.put('/pmi-companies/:id', requireWriteAccess, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM pmi_companies WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'PMI company not found.' });

    const fieldMap = {
      companyName: 'company_name',
      primaryQuoteLink: 'primary_quote_link',
      backupRateLink: 'backup_rate_link',
      loginRequired: 'login_required',
      clientFriendly: 'client_friendly',
      notes: 'notes',
      sortOrder: 'sort_order'
    };

    const { setClauses, values } = buildUpdateClauses(fieldMap, req.body);

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    values.push(id);
    await db.query(`UPDATE pmi_companies SET ${setClauses.join(', ')} WHERE id = ?`, values);

    const [rows] = await db.query('SELECT * FROM pmi_companies WHERE id = ?', [id]);
    res.json({ success: true, record: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A PMI company with that name already exists.' });
    }
    next(error);
  }
});

// DELETE /api/processing/pmi-companies/:id - Delete a PMI company
router.delete('/pmi-companies/:id', requireProcessorOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query('SELECT * FROM pmi_companies WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'PMI company not found.' });

    await db.query('DELETE FROM pmi_companies WHERE id = ?', [id]);
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
