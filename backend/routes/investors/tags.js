// Investor Tags — managed tag system for notes
const express = require('express');
const router = express.Router();
const { getUserId } = require('../../middleware/userContext');
const Investor = require('../../models/Investor');

// GET /api/investors/tags
router.get('/tags', async (req, res, next) => {
  try {
    const tags = await Investor.getTags();
    res.json(tags);
  } catch (error) { next(error); }
});

// POST /api/investors/tags
router.post('/tags', async (req, res, next) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name is required' });
    const userId = getUserId(req);
    const tag = await Investor.createTag(name, color, userId);
    res.status(201).json(tag);
  } catch (error) { next(error); }
});

// DELETE /api/investors/tags/:tagId — blocks if tag is in use on notes
router.delete('/tags/:tagId', async (req, res, next) => {
  try {
    const result = await Investor.deleteTag(req.params.tagId);
    if (!result.success) {
      return res.status(409).json({
        error: 'This tag is in use on ' + result.inUseCount + ' note(s). Remove it from those notes first.',
      });
    }
    res.json({ success: true });
  } catch (error) { next(error); }
});

// GET /api/investors/note-tags — tag names grouped by investor_id (for search)
router.get('/note-tags', async (req, res, next) => {
  try {
    const map = await Investor.getNoteTagsMap();
    res.json(map);
  } catch (error) { next(error); }
});

module.exports = router;
