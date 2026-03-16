// Announcements API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, hasRole, requireDbUser } = require('../middleware/userContext');
const { announcement, validate } = require('../validation/schemas');
const { deleted } = require('../utils/response');
const { sanitizeHtml } = require('../utils/sanitizeHtml');
const { parseId } = require('../middleware/parseId');

const MAX_ACTIVE = 8;

router.use(requireDbUser);

// GET /api/announcements - Get announcements by status (default: active)
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status === 'archived' ? 'archived' : 'active';
    const [announcements] = await db.query(
      `SELECT a.*, u.name AS author_name
       FROM announcements a
       LEFT JOIN users u ON a.author_id = u.id
       WHERE a.status = ?
       ORDER BY a.created_at DESC`,
      [status]
    );
    res.json(announcements);
  } catch (error) {
    next(error);
  }
});

// POST /api/announcements - Create announcement (any authenticated user)
router.post('/', validate(announcement), async (req, res, next) => {
  try {

    const { title, content, link, icon, file_s3_key, file_name, file_size, file_type } = req.body;
    const sanitizedContent = sanitizeHtml(content);
    const authorId = getUserId(req);

    const [result] = await db.query(
      `INSERT INTO announcements
       (title, content, link, icon, file_s3_key, file_name, file_size, file_type, author_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [title, sanitizedContent, link || null, icon || null, file_s3_key || null, file_name || null, file_size || null, file_type || null, authorId || null]
    );

    // Auto-archive oldest active announcements if we exceed the limit
    let archivedIds = [];
    const [[{ activeCount }]] = await db.query(
      `SELECT COUNT(*) AS activeCount FROM announcements WHERE status = 'active'`
    );

    if (activeCount > MAX_ACTIVE) {
      const overflow = activeCount - MAX_ACTIVE;
      const [oldest] = await db.query(
        `SELECT id FROM announcements WHERE status = 'active' ORDER BY created_at ASC LIMIT ?`,
        [overflow]
      );
      archivedIds = oldest.map(r => r.id);

      if (archivedIds.length > 0) {
        await db.query(
          `UPDATE announcements SET status = 'archived', archived_at = NOW() WHERE id IN (?)`,
          [archivedIds]
        );
      }
    }

    const [announcements] = await db.query(
      `SELECT a.*, u.name AS author_name
       FROM announcements a LEFT JOIN users u ON a.author_id = u.id
       WHERE a.id = ?`, [result.insertId]
    );

    res.status(201).json({ ...announcements[0], archivedIds });
  } catch (error) {
    next(error);
  }
});

// PUT /api/announcements/:id - Update announcement (admin or author only)
router.put('/:id', parseId(), validate(announcement), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Announcement not found' });

    // Admin can edit any; others can only edit their own
    if (!hasRole(req, 'admin') && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'You can only edit your own announcements' });
    }

    const { title, content, link, icon, file_s3_key, file_name, file_size, file_type } = req.body;
    const sanitizedContent = sanitizeHtml(content);

    await db.query(
      `UPDATE announcements SET title = ?, content = ?, link = ?, icon = ?,
       file_s3_key = ?, file_name = ?, file_size = ?, file_type = ?
       WHERE id = ?`,
      [title, sanitizedContent, link || null, icon || null,
       file_s3_key || null, file_name || null, file_size || null, file_type || null,
       req.params.id]
    );

    const [updated] = await db.query(
      `SELECT a.*, u.name AS author_name FROM announcements a
       LEFT JOIN users u ON a.author_id = u.id WHERE a.id = ?`,
      [req.params.id]
    );
    res.json(updated[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/announcements/:id - Delete announcement (admin or author only)
router.delete('/:id', parseId(), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Announcement not found' });

    // Admin can delete any; others can only delete their own
    if (!hasRole(req, 'admin') && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'You can only delete your own announcements' });
    }

    await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    deleted(res, 'Announcement deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
