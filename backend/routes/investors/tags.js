// Investor Tags — managed tag system for notes
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { getUserId } = require('../../middleware/userContext');

// GET /api/investors/tags
router.get('/tags', async (req, res, next) => {
  try {
    const [tags] = await db.query(
      `SELECT t.*, (SELECT COUNT(*) FROM investor_note_tags nt WHERE nt.tag_id = t.id) AS usage_count
       FROM investor_tags t ORDER BY t.name`
    );
    res.json(tags);
  } catch (error) { next(error); }
});

// POST /api/investors/tags
router.post('/tags', async (req, res, next) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const userId = getUserId(req);
    const tagColor = color || '#8cc63e';
    await db.query(
      'INSERT INTO investor_tags (name, color, created_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=id',
      [name.trim(), tagColor, userId]
    );
    const [tags] = await db.query('SELECT * FROM investor_tags WHERE name = ?', [name.trim()]);
    res.status(201).json(tags[0]);
  } catch (error) { next(error); }
});

// DELETE /api/investors/tags/:tagId — blocks if tag is in use on notes
router.delete('/tags/:tagId', async (req, res, next) => {
  try {
    const [usage] = await db.query('SELECT COUNT(*) AS cnt FROM investor_note_tags WHERE tag_id = ?', [req.params.tagId]);
    if (usage[0].cnt > 0) {
      return res.status(409).json({ error: 'This tag is in use on ' + usage[0].cnt + ' note(s). Remove it from those notes first.' });
    }
    await db.query('DELETE FROM investor_tags WHERE id = ?', [req.params.tagId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// GET /api/investors/note-tags — tag names grouped by investor_id (for search)
router.get('/note-tags', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT n.investor_id, t.name
       FROM investor_note_tags nt
       JOIN investor_notes n ON nt.note_id = n.id
       JOIN investor_tags t ON nt.tag_id = t.id
       GROUP BY n.investor_id, t.name
       ORDER BY n.investor_id`
    );
    const map = {};
    rows.forEach(r => {
      if (!map[r.investor_id]) map[r.investor_id] = [];
      map[r.investor_id].push(r.name);
    });
    res.json(map);
  } catch (error) { next(error); }
});

module.exports = router;
