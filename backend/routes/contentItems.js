/**
 * /api/content/items — Content queue CRUD
 *
 * GET    /              — list content items (filterable by status, platform, keyword)
 * GET    /stats         — summary counts by status
 * GET    /:id           — single item
 * PUT    /:id           — update item (edit text, change status)
 * POST   /:id/approve   — approve for publishing
 * POST   /:id/reject    — reject with notes
 * POST   /:id/schedule  — schedule for a specific date/time
 * DELETE /:id           — archive (soft-delete)
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// ── GET / — list content items ──────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { status, platform, keyword, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = `
      SELECT ci.*,
             u.name as author_name,
             pt.name as template_name,
             au.name as approver_name
      FROM content_items ci
      LEFT JOIN users u ON ci.user_id = u.id
      LEFT JOIN prompt_templates pt ON ci.prompt_template_id = pt.id
      LEFT JOIN users au ON ci.approved_by = au.id
      WHERE 1=1`;
    const params = [];

    // Non-admins only see their own content
    if (!isAdmin(req)) {
      query += ' AND ci.user_id = ?';
      params.push(userId);
    }

    if (status) {
      query += ' AND ci.status = ?';
      params.push(status);
    }
    if (platform) {
      query += ' AND ci.platform = ?';
      params.push(platform);
    }
    if (keyword) {
      query += ' AND (ci.keyword LIKE ? OR ci.suggestion LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // Count total before pagination
    const countQuery = query.replace(/SELECT ci\.\*[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const [countRows] = await db.query(countQuery, params);
    const total = countRows[0]?.total || 0;

    query += ' ORDER BY ci.updated_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [rows] = await db.query(query, params);

    res.json({
      items: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /stats — summary counts ─────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    let query = 'SELECT status, COUNT(*) as count FROM content_items';
    const params = [];

    if (!isAdmin(req)) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }

    query += ' GROUP BY status';
    const [rows] = await db.query(query, params);

    const stats = {};
    for (const row of rows) {
      stats[row.status] = row.count;
    }

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// ── GET /:id — single item ──────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [rows] = await db.query(
      `SELECT ci.*,
              u.name as author_name,
              pt.name as template_name,
              au.name as approver_name
       FROM content_items ci
       LEFT JOIN users u ON ci.user_id = u.id
       LEFT JOIN prompt_templates pt ON ci.prompt_template_id = pt.id
       LEFT JOIN users au ON ci.approved_by = au.id
       WHERE ci.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    if (!isAdmin(req) && rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Include audit log
    const [auditRows] = await db.query(
      `SELECT cal.*, u.name as user_name
       FROM content_audit_log cal
       LEFT JOIN users u ON cal.user_id = u.id
       WHERE cal.content_id = ?
       ORDER BY cal.created_at ASC`,
      [req.params.id]
    );

    res.json({ ...rows[0], audit_log: auditRows });
  } catch (error) {
    next(error);
  }
});

// ── PUT /:id — update item ──────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;

    const [existing] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    if (!isAdmin(req) && existing[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const {
      text_content, hashtags, platform, status,
      image_s3_key, image_source, video_s3_key, video_source,
      review_notes, scheduled_at,
    } = req.body;

    const updates = [];
    const values = [];

    if (text_content !== undefined) { updates.push('text_content = ?'); values.push(text_content); }
    if (hashtags !== undefined)     { updates.push('hashtags = ?');     values.push(JSON.stringify(hashtags)); }
    if (platform !== undefined)     { updates.push('platform = ?');     values.push(platform); }
    if (status !== undefined)       { updates.push('status = ?');       values.push(status); }
    if (image_s3_key !== undefined) { updates.push('image_s3_key = ?'); values.push(image_s3_key); }
    if (image_source !== undefined) { updates.push('image_source = ?'); values.push(image_source); }
    if (video_s3_key !== undefined) { updates.push('video_s3_key = ?'); values.push(video_s3_key); }
    if (video_source !== undefined) { updates.push('video_source = ?'); values.push(video_source); }
    if (review_notes !== undefined) { updates.push('review_notes = ?'); values.push(review_notes); }
    if (scheduled_at !== undefined) { updates.push('scheduled_at = ?'); values.push(scheduled_at); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(itemId);
    await db.query(
      `UPDATE content_items SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    // Audit log
    await db.query(
      'INSERT INTO content_audit_log (content_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [itemId, userId, 'edited', JSON.stringify({ fields: Object.keys(req.body) })]
    );

    const [rows] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── POST /:id/approve — approve content ─────────────────────────
router.post('/:id/approve', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;

    const [existing] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    await db.query(
      `UPDATE content_items
       SET status = 'approved', approved_by = ?, approved_at = NOW(), review_notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [userId, req.body.notes || null, itemId]
    );

    await db.query(
      'INSERT INTO content_audit_log (content_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [itemId, userId, 'approved', JSON.stringify({ notes: req.body.notes || null })]
    );

    const [rows] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── POST /:id/reject — reject content ───────────────────────────
router.post('/:id/reject', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;

    const [existing] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    await db.query(
      `UPDATE content_items
       SET status = 'draft', review_notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [req.body.notes || 'Rejected — please revise', itemId]
    );

    await db.query(
      'INSERT INTO content_audit_log (content_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [itemId, userId, 'rejected', JSON.stringify({ notes: req.body.notes || null })]
    );

    const [rows] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── POST /:id/schedule — schedule content ───────────────────────
router.post('/:id/schedule', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;
    const { scheduled_at } = req.body;

    if (!scheduled_at) {
      return res.status(400).json({ error: 'scheduled_at is required (ISO 8601 datetime)' });
    }

    const [existing] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    if (!isAdmin(req) && existing[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.query(
      `UPDATE content_items
       SET status = 'scheduled', scheduled_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [scheduled_at, itemId]
    );

    await db.query(
      'INSERT INTO content_audit_log (content_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [itemId, userId, 'scheduled', JSON.stringify({ scheduled_at })]
    );

    const [rows] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── DELETE /:id — archive (soft-delete) ─────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;

    const [existing] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    if (!isAdmin(req) && existing[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.query(
      "UPDATE content_items SET status = 'archived', updated_at = NOW() WHERE id = ?",
      [itemId]
    );

    await db.query(
      'INSERT INTO content_audit_log (content_id, user_id, action) VALUES (?, ?, ?)',
      [itemId, userId, 'archived']
    );

    res.json({ success: true, message: 'Content archived' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
