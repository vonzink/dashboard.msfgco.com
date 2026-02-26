// Announcements API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { announcement, validate } = require('../validation/schemas');

router.use(requireDbUser);

// GET /api/announcements - Get all announcements (with author name)
router.get('/', async (req, res, next) => {
  try {
    const [announcements] = await db.query(
      `SELECT a.*, u.name AS author_name
       FROM announcements a
       LEFT JOIN users u ON a.author_id = u.id
       ORDER BY a.created_at DESC`
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
       (title, content, link, icon, file_s3_key, file_name, file_size, file_type, author_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, content, link || null, icon || null, file_s3_key || null, file_name || null, file_size || null, file_type || null, authorId || null]
    );
    
    const [announcements] = await db.query(
      `SELECT a.*, u.name AS author_name
       FROM announcements a LEFT JOIN users u ON a.author_id = u.id
       WHERE a.id = ?`, [result.insertId]
    );
    res.status(201).json(announcements[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/announcements/:id - Delete announcement (author or admin)
router.delete('/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT author_id FROM announcements WHERE id = ?', [req.params.id]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // Allow admin or the original author to delete
    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or an admin can delete this announcement' });
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

