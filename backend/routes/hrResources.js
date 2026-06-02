// HR Resources API routes — links + notes per HR category (mirrors Programs pattern).
//
// Response convention (per backend/utils/response.js):
//   ok(res, data)          — 200 + JSON
//   created(res, data)     — 201 + JSON
//   deleted(res, msg?)     — 200 + { success: true, message }
//   fail(res, msg, status) — error envelope { error: msg }
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, getDbUser, isAdmin, requireDbUser, requireManagerOrAdmin } = require('../middleware/userContext');
const { ok, created, deleted, fail } = require('../utils/response');

const VALID_CATEGORIES = ['famli', 'general'];

router.use(requireDbUser);

// GET /api/hr-resources — all links + notes grouped by category
router.get('/', async (req, res, next) => {
  try {
    const [links] = await db.query('SELECT * FROM hr_links ORDER BY category, sort_order');
    const [notes] = await db.query('SELECT * FROM hr_notes ORDER BY category, created_at DESC');

    const result = {};
    for (const cat of VALID_CATEGORIES) {
      result[cat] = {
        links: links.filter(l => l.category === cat),
        notes: notes.filter(n => n.category === cat),
      };
    }
    ok(res, result);
  } catch (error) {
    next(error);
  }
});

// GET /api/hr-resources/:category — links + notes for one category
router.get('/:category', async (req, res, next) => {
  try {
    const cat = req.params.category;
    if (!VALID_CATEGORIES.includes(cat)) {
      return fail(res, 'Invalid category', 400);
    }

    const [links] = await db.query('SELECT * FROM hr_links WHERE category = ? ORDER BY sort_order', [cat]);
    const [notes] = await db.query('SELECT * FROM hr_notes WHERE category = ? ORDER BY created_at DESC', [cat]);

    ok(res, { links, notes });
  } catch (error) {
    next(error);
  }
});

// POST /api/hr-resources/links — add a link (admin/manager only)
router.post('/links', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const { category, url, label, description, sort_order } = req.body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return fail(res, 'Invalid category', 400);
    }
    if (!url || !label) {
      return fail(res, 'url and label are required', 400);
    }

    const [result] = await db.query(
      'INSERT INTO hr_links (category, url, label, description, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [category, url, label, description || null, sort_order || 0, getUserId(req)]
    );

    const [rows] = await db.query('SELECT * FROM hr_links WHERE id = ?', [result.insertId]);
    created(res, rows[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/hr-resources/links/:id — update a link (admin/manager only)
router.put('/links/:id', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const { url, label, description, sort_order } = req.body;
    const sets = [];
    const vals = [];

    if (url !== undefined) { sets.push('url = ?'); vals.push(url); }
    if (label !== undefined) { sets.push('label = ?'); vals.push(label); }
    if (description !== undefined) { sets.push('description = ?'); vals.push(description || null); }
    if (sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(sort_order); }

    if (sets.length === 0) {
      return fail(res, 'No fields to update', 400);
    }

    vals.push(req.params.id);
    await db.query(`UPDATE hr_links SET ${sets.join(', ')} WHERE id = ?`, vals);

    const [rows] = await db.query('SELECT * FROM hr_links WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return fail(res, 'Link not found', 404);
    ok(res, rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/hr-resources/links/:id — delete a link (admin/manager only)
router.delete('/links/:id', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const [result] = await db.query('DELETE FROM hr_links WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return fail(res, 'Link not found', 404);
    deleted(res, 'Link deleted');
  } catch (error) {
    next(error);
  }
});

// POST /api/hr-resources/notes — add a note (any authenticated user)
router.post('/notes', async (req, res, next) => {
  try {
    const { category, content } = req.body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return fail(res, 'Invalid category', 400);
    }
    if (!content || !content.trim()) {
      return fail(res, 'content is required', 400);
    }

    const userId = getUserId(req);
    const dbUser = getDbUser(req);
    const userName = dbUser?.name || 'Unknown';

    const [result] = await db.query(
      'INSERT INTO hr_notes (category, content, created_by, user_name) VALUES (?, ?, ?, ?)',
      [category, content.trim(), userId, userName]
    );

    const [rows] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [result.insertId]);
    created(res, rows[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/hr-resources/notes/:id — edit a note (own notes only, admins can edit any)
router.put('/notes/:id', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return fail(res, 'content is required', 400);
    }

    const [existing] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return fail(res, 'Note not found', 404);

    if (!isAdmin(req) && existing[0].created_by !== getUserId(req)) {
      return fail(res, 'You can only edit your own notes', 403);
    }

    await db.query('UPDATE hr_notes SET content = ? WHERE id = ?', [content.trim(), req.params.id]);
    const [rows] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [req.params.id]);
    ok(res, rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/hr-resources/notes/:id — delete a note (own notes only, admins can delete any)
router.delete('/notes/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return fail(res, 'Note not found', 404);

    if (!isAdmin(req) && existing[0].created_by !== getUserId(req)) {
      return fail(res, 'You can only delete your own notes', 403);
    }

    await db.query('DELETE FROM hr_notes WHERE id = ?', [req.params.id]);
    deleted(res, 'Note deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
