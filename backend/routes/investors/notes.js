// Investor Notes — CRUD with tag support
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { isAdmin, getDbUser, getUserId } = require('../../middleware/userContext');

/** Helper: attach tags (as objects) to an array of notes */
async function attachNoteTags(notes) {
  if (!notes.length) return notes;
  const noteIds = notes.map(n => n.id);
  const [rows] = await db.query(
    `SELECT nt.note_id, t.id, t.name, t.color
     FROM investor_note_tags nt
     JOIN investor_tags t ON nt.tag_id = t.id
     WHERE nt.note_id IN (?)`,
    [noteIds]
  );
  const byNote = {};
  rows.forEach(r => {
    (byNote[r.note_id] = byNote[r.note_id] || []).push({ id: r.id, name: r.name, color: r.color });
  });
  notes.forEach(n => { n.tags = byNote[n.id] || []; });
  return notes;
}

/** Helper: sync tag_ids for a note */
async function syncNoteTags(noteId, tagIds) {
  await db.query('DELETE FROM investor_note_tags WHERE note_id = ?', [noteId]);
  if (tagIds && tagIds.length > 0) {
    const values = tagIds.map(tid => [noteId, parseInt(tid)]);
    await db.query('INSERT IGNORE INTO investor_note_tags (note_id, tag_id) VALUES ?', [values]);
  }
}

// GET /api/investors/:id/notes
router.get('/:id/notes', async (req, res, next) => {
  try {
    const [notes] = await db.query(
      'SELECT * FROM investor_notes WHERE investor_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    await attachNoteTags(notes);
    res.json(notes);
  } catch (error) { next(error); }
});

// POST /api/investors/:id/notes
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { content, tag_ids } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    const userId = getUserId(req);
    const dbUser = getDbUser(req);
    const authorName = dbUser?.name || 'Unknown';

    const [result] = await db.query(
      'INSERT INTO investor_notes (investor_id, author_id, author_name, content) VALUES (?, ?, ?, ?)',
      [req.params.id, userId, authorName, content.trim()]
    );

    if (Array.isArray(tag_ids) && tag_ids.length > 0) {
      await syncNoteTags(result.insertId, tag_ids);
    }

    const [note] = await db.query('SELECT * FROM investor_notes WHERE id = ?', [result.insertId]);
    await attachNoteTags(note);
    res.status(201).json(note[0]);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/notes/:noteId
router.put('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const { content, tag_ids } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    const [existing] = await db.query('SELECT * FROM investor_notes WHERE id = ? AND investor_id = ?', [req.params.noteId, req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can edit this note' });
    }

    await db.query('UPDATE investor_notes SET content = ? WHERE id = ?', [content.trim(), req.params.noteId]);

    if (Array.isArray(tag_ids)) {
      await syncNoteTags(parseInt(req.params.noteId), tag_ids);
    }

    const [updated] = await db.query('SELECT * FROM investor_notes WHERE id = ?', [req.params.noteId]);
    await attachNoteTags(updated);
    res.json(updated[0]);
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM investor_notes WHERE id = ? AND investor_id = ?', [req.params.noteId, req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can delete this note' });
    }

    await db.query('DELETE FROM investor_notes WHERE id = ?', [req.params.noteId]);
    res.json({ message: 'Note deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
