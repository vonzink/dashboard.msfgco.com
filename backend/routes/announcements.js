// Announcements API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// GET /api/announcements - Get all announcements
router.get('/', async (req, res, next) => {
  try {
    const [announcements] = await db.query(
      'SELECT * FROM announcements ORDER BY created_at DESC'
    );
    res.json(announcements);
  } catch (error) {
    next(error);
  }
});

// POST /api/announcements - Create announcement
router.post('/', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { title, content, link, icon, file_s3_key, file_name, file_size, file_type } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    
    const authorId = getUserId(req);
    const [result] = await db.query(
      `INSERT INTO announcements 
       (title, content, link, icon, file_s3_key, file_name, file_size, file_type, author_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, content, link || null, icon || null, file_s3_key || null, file_name || null, file_size || null, file_type || null, authorId || null]
    );
    
    const [announcements] = await db.query('SELECT * FROM announcements WHERE id = ?', [result.insertId]);
    res.status(201).json(announcements[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/announcements/:id - Delete announcement
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const [existing] = await db.query('SELECT author_id FROM announcements WHERE id = ?', [req.params.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
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

