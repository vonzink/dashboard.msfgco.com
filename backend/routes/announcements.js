// Announcements API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, hasRole, requireDbUser } = require('../middleware/userContext');
const { announcement, validate } = require('../validation/schemas');

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
    const authorId = getUserId(req);

    const [result] = await db.query(
      `INSERT INTO announcements
       (title, content, link, icon, file_s3_key, file_name, file_size, file_type, author_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [title, content, link || null, icon || null, file_s3_key || null, file_name || null, file_size || null, file_type || null, authorId || null]
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

// DELETE /api/announcements/:id - Delete announcement (admin only)
router.delete('/:id', async (req, res, next) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Only admins can delete announcements' });
    }

    const [result] = await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
