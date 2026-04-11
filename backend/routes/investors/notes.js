// Investor Notes — CRUD with tag support
const express = require('express');
const router = express.Router();
const { isAdmin, getDbUser, getUserId } = require('../../middleware/userContext');
const Investor = require('../../models/Investor');

// GET /api/investors/:id/notes
router.get('/:id/notes', async (req, res, next) => {
  try {
    const notes = await Investor.getNotes(req.params.id);
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

    const note = await Investor.createNote(req.params.id, {
      userId, authorName, content, tagIds: tag_ids,
    });
    res.status(201).json(note);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/notes/:noteId
router.put('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const { content, tag_ids } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    const existing = await Investor.findNote(req.params.id, req.params.noteId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing.author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can edit this note' });
    }

    const updated = await Investor.updateNote(req.params.noteId, {
      content, tagIds: tag_ids,
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const existing = await Investor.findNote(req.params.id, req.params.noteId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing.author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can delete this note' });
    }

    await Investor.deleteNote(req.params.noteId);
    res.json({ message: 'Note deleted' });
  } catch (error) { next(error); }
});

module.exports = router;
