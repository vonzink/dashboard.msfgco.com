const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

const VALID_TYPES = ['title', 'insurance', 'voe', 'taxes', 'amc', 'payoffs', 'other'];
const VALID_STATUSES = ['ordered', 'received', 'pending', 'in-review', 'complete', 'issue'];

function isValidType(type) {
  return VALID_TYPES.includes(type);
}

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

// POST /api/processing/tax-counties - Add a county (admin only)
router.post('/tax-counties', async (req, res, next) => {
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
router.put('/tax-counties/:id', async (req, res, next) => {
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
router.delete('/tax-counties/:id', async (req, res, next) => {
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

    // Non-admins only see their own records
    if (!isAdmin(req)) {
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
    if (!isAdmin(req) && record.user_id !== getUserId(req)) {
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

    if (!isAdmin(req) && existing[0].user_id !== getUserId(req)) {
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

    if (!isAdmin(req) && existing[0].user_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    await db.query('DELETE FROM processing_records WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
