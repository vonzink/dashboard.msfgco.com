// Admin — Employee notes
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');

// GET /users/:id/notes
router.get('/:id/notes', async (req, res, next) => {
  try {
    const [notes] = await db.query(
      `SELECT en.*, u.name AS author_name
       FROM employee_notes en
       JOIN users u ON en.author_id = u.id
       WHERE en.user_id = ?
       ORDER BY en.created_at DESC`,
      [req.params.id]
    );
    res.json(notes);
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/notes
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const authorId = req.user?.db?.id;
    if (!authorId) return res.status(400).json({ error: 'Could not determine author' });

    const [result] = await db.query(
      'INSERT INTO employee_notes (user_id, author_id, note) VALUES (?, ?, ?)',
      [req.params.id, authorId, note.trim()]
    );

    const [notes] = await db.query(
      `SELECT en.*, u.name AS author_name
       FROM employee_notes en JOIN users u ON en.author_id = u.id
       WHERE en.id = ?`,
      [result.insertId]
    );

    res.status(201).json(notes[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM employee_notes WHERE id = ? AND user_id = ?',
      [req.params.noteId, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
