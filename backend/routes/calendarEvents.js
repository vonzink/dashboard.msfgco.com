// Calendar Events API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// GET /api/calendar-events - Get all calendar events
router.get('/', async (req, res, next) => {
  try {
    const [events] = await db.query(
      'SELECT * FROM calendar_events ORDER BY start ASC'
    );
    res.json(events);
  } catch (error) {
    next(error);
  }
});

// POST /api/calendar-events - Create a calendar event
router.post('/', async (req, res, next) => {
  try {
    const { title, who, start, end, allDay, notes } = req.body;

    if (!title || !start) {
      return res.status(400).json({ error: 'title and start are required' });
    }

    const createdBy = getUserId(req);
    const [result] = await db.query(
      `INSERT INTO calendar_events (title, who, start, end, allDay, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, who || '', start, end || null, allDay ? 1 : 0, notes || '', createdBy]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    next(error);
  }
});

// PUT /api/calendar-events/:id - Update a calendar event
router.put('/:id', async (req, res, next) => {
  try {
    const { title, who, start, end, allDay, notes } = req.body;

    const [result] = await db.query(
      `UPDATE calendar_events
       SET title=?, who=?, start=?, end=?, allDay=?, notes=?
       WHERE id=?`,
      [title, who || '', start, end || null, allDay ? 1 : 0, notes || '', req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/calendar-events/:id - Delete a calendar event
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM calendar_events WHERE id=?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
