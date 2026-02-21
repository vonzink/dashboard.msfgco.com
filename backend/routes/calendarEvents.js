// Calendar Events API routes
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// ── Helpers ──

function generateOccurrences(start, end, rule, until) {
  const dates = [];
  const s = new Date(start);
  const duration = end ? new Date(end).getTime() - s.getTime() : 0;
  const limit = new Date(until);

  // Cap at 365 occurrences to prevent runaway loops
  const MAX = 365;
  let cur = new Date(s);

  while (cur <= limit && dates.length < MAX) {
    const occStart = new Date(cur);
    const occEnd = duration ? new Date(cur.getTime() + duration) : null;
    dates.push({ start: occStart, end: occEnd });

    switch (rule) {
      case 'daily':    cur.setDate(cur.getDate() + 1); break;
      case 'weekly':   cur.setDate(cur.getDate() + 7); break;
      case 'biweekly': cur.setDate(cur.getDate() + 14); break;
      case 'monthly':  cur.setMonth(cur.getMonth() + 1); break;
      case 'yearly':   cur.setFullYear(cur.getFullYear() + 1); break;
      default:         return dates; // shouldn't happen
    }
  }

  return dates;
}

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

// POST /api/calendar-events - Create a calendar event (with optional recurrence)
router.post('/', async (req, res, next) => {
  try {
    const { title, who, start, end, allDay, notes, color, recurrence_rule, recurrence_end } = req.body;

    if (!title || !start) {
      return res.status(400).json({ error: 'title and start are required' });
    }

    const createdBy = getUserId(req);
    const rule = recurrence_rule || 'none';
    const rColor = color || '#104547';

    // Non-recurring: single insert (original behavior)
    if (rule === 'none' || !recurrence_end) {
      const [result] = await db.query(
        `INSERT INTO calendar_events (title, who, start, end, allDay, notes, color, recurrence_rule, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?)`,
        [title, who || '', start, end || null, allDay ? 1 : 0, notes || '', rColor, createdBy]
      );
      return res.status(201).json({ id: result.insertId, count: 1 });
    }

    // Recurring: generate all occurrences
    const groupId = crypto.randomUUID();
    const occurrences = generateOccurrences(start, end, rule, recurrence_end);

    if (occurrences.length === 0) {
      return res.status(400).json({ error: 'No occurrences generated — check your dates' });
    }

    const values = occurrences.map(occ => [
      title, who || '',
      occ.start.toISOString(), occ.end ? occ.end.toISOString() : null,
      allDay ? 1 : 0, notes || '', rColor,
      rule, recurrence_end, groupId, createdBy
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flat = values.flat();

    const [result] = await db.query(
      `INSERT INTO calendar_events
        (title, who, start, end, allDay, notes, color, recurrence_rule, recurrence_end, recurrence_group_id, created_by)
       VALUES ${placeholders}`,
      flat
    );

    res.status(201).json({ id: result.insertId, count: occurrences.length, recurrence_group_id: groupId });
  } catch (error) {
    next(error);
  }
});

// PUT /api/calendar-events/:id - Update a calendar event
// Query param: ?scope=single|all (default: single)
router.put('/:id', async (req, res, next) => {
  try {
    const { title, who, start, end, allDay, notes, color } = req.body;
    const scope = req.query.scope || 'single';

    if (scope === 'all') {
      // Get the recurrence_group_id of this event
      const [[event]] = await db.query('SELECT recurrence_group_id FROM calendar_events WHERE id=?', [req.params.id]);
      if (!event || !event.recurrence_group_id) {
        // No group — fall through to single update
      } else {
        // Update all in group (title, who, color, notes — not dates)
        const [result] = await db.query(
          `UPDATE calendar_events
           SET title=?, who=?, notes=?, color=?
           WHERE recurrence_group_id=?`,
          [title, who || '', notes || '', color || '#104547', event.recurrence_group_id]
        );
        return res.json({ success: true, updated: result.affectedRows });
      }
    }

    // Single update (original behavior)
    const [result] = await db.query(
      `UPDATE calendar_events
       SET title=?, who=?, start=?, end=?, allDay=?, notes=?, color=?
       WHERE id=?`,
      [title, who || '', start, end || null, allDay ? 1 : 0, notes || '', color || '#104547', req.params.id]
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
// Query param: ?scope=single|all (default: single)
router.delete('/:id', async (req, res, next) => {
  try {
    const scope = req.query.scope || 'single';

    if (scope === 'all') {
      const [[event]] = await db.query('SELECT recurrence_group_id FROM calendar_events WHERE id=?', [req.params.id]);
      if (event && event.recurrence_group_id) {
        const [result] = await db.query(
          'DELETE FROM calendar_events WHERE recurrence_group_id=?',
          [event.recurrence_group_id]
        );
        return res.json({ success: true, deleted: result.affectedRows });
      }
    }

    // Single delete
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
