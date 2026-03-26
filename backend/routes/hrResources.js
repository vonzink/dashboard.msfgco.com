// HR Resources API routes — links + notes per HR category (mirrors Programs pattern)
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, getDbUser, isAdmin, requireDbUser, requireManagerOrAdmin } = require('../middleware/userContext');

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
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/hr-resources/:category — links + notes for one category
router.get('/:category', async (req, res, next) => {
  try {
    const cat = req.params.category;
    if (!VALID_CATEGORIES.includes(cat)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const [links] = await db.query('SELECT * FROM hr_links WHERE category = ? ORDER BY sort_order', [cat]);
    const [notes] = await db.query('SELECT * FROM hr_notes WHERE category = ? ORDER BY created_at DESC', [cat]);

    res.json({ links, notes });
  } catch (error) {
    next(error);
  }
});

// POST /api/hr-resources/links — add a link (admin/manager only)
router.post('/links', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const { category, url, label, description, sort_order } = req.body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (!url || !label) {
      return res.status(400).json({ error: 'url and label are required' });
    }

    const [result] = await db.query(
      'INSERT INTO hr_links (category, url, label, description, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [category, url, label, description || null, sort_order || 0, getUserId(req)]
    );

    const [rows] = await db.query('SELECT * FROM hr_links WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
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
      return res.status(400).json({ error: 'No fields to update' });
    }

    vals.push(req.params.id);
    await db.query(`UPDATE hr_links SET ${sets.join(', ')} WHERE id = ?`, vals);

    const [rows] = await db.query('SELECT * FROM hr_links WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Link not found' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/hr-resources/links/:id — delete a link (admin/manager only)
router.delete('/links/:id', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const [result] = await db.query('DELETE FROM hr_links WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Link not found' });
    res.json({ message: 'Link deleted' });
  } catch (error) {
    next(error);
  }
});

// POST /api/hr-resources/notes — add a note (any authenticated user)
router.post('/notes', async (req, res, next) => {
  try {
    const { category, content } = req.body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const userId = getUserId(req);
    const dbUser = getDbUser(req);
    const userName = dbUser?.name || 'Unknown';

    const [result] = await db.query(
      'INSERT INTO hr_notes (category, content, created_by, user_name) VALUES (?, ?, ?, ?)',
      [category, content.trim(), userId, userName]
    );

    const [rows] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/hr-resources/notes/:id — edit a note (own notes only, admins can edit any)
router.put('/notes/:id', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const [existing] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].created_by !== getUserId(req)) {
      return res.status(403).json({ error: 'You can only edit your own notes' });
    }

    await db.query('UPDATE hr_notes SET content = ? WHERE id = ?', [content.trim(), req.params.id]);
    const [rows] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/hr-resources/notes/:id — delete a note (own notes only, admins can delete any)
router.delete('/notes/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM hr_notes WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].created_by !== getUserId(req)) {
      return res.status(403).json({ error: 'You can only delete your own notes' });
    }

    await db.query('DELETE FROM hr_notes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Note deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
