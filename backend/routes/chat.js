// Chat API routes — messages + tag system
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId } = require('../middleware/userContext');

// ──────────────────────────────────────────────
// TAGS
// ──────────────────────────────────────────────

// GET /api/chat/tags — list all tags
router.get('/tags', async (req, res, next) => {
  try {
    const [tags] = await db.query(
      'SELECT t.*, u.name AS creator_name FROM chat_tags t LEFT JOIN users u ON t.created_by = u.id ORDER BY t.name'
    );
    res.json(tags);
  } catch (err) { next(err); }
});

// POST /api/chat/tags — create a tag (any user)
router.post('/tags', async (req, res, next) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const userId = getUserId(req);
    const tagColor = color || '#8cc63e';
    const tagName = name.trim();

    const [result] = await db.query(
      'INSERT INTO chat_tags (name, color, created_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=id',
      [tagName, tagColor, userId]
    );

    // Return the tag (whether newly created or existing)
    const [tags] = await db.query('SELECT * FROM chat_tags WHERE name = ?', [tagName]);
    res.status(201).json(tags[0]);
  } catch (err) { next(err); }
});

// DELETE /api/chat/tags/:id — delete a tag
router.delete('/tags/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM chat_tags WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// MESSAGES
// ──────────────────────────────────────────────

// GET /api/chat/messages — list messages (with optional tag filter)
// Query params: ?limit=50&before=<id>&tag=<tagId>
router.get('/messages', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = parseInt(req.query.before) || null;
    const tagId = parseInt(req.query.tag) || null;

    let query, params;

    if (tagId) {
      // Filter by tag
      query = `
        SELECT m.*, GROUP_CONCAT(DISTINCT ct.id ORDER BY ct.name SEPARATOR ',') AS tag_ids,
               GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ',') AS tag_names,
               GROUP_CONCAT(DISTINCT ct.color ORDER BY ct.name SEPARATOR ',') AS tag_colors
        FROM chat_messages m
        INNER JOIN chat_message_tags mt ON m.id = mt.message_id
        INNER JOIN chat_tags ct2 ON mt.tag_id = ct2.id
        LEFT JOIN chat_message_tags mt_all ON m.id = mt_all.message_id
        LEFT JOIN chat_tags ct ON mt_all.tag_id = ct.id
        WHERE ct2.id = ?
        ${before ? 'AND m.id < ?' : ''}
        GROUP BY m.id
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = before ? [tagId, before, limit] : [tagId, limit];
    } else {
      // All messages
      query = `
        SELECT m.*, GROUP_CONCAT(DISTINCT ct.id ORDER BY ct.name SEPARATOR ',') AS tag_ids,
               GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ',') AS tag_names,
               GROUP_CONCAT(DISTINCT ct.color ORDER BY ct.name SEPARATOR ',') AS tag_colors
        FROM chat_messages m
        LEFT JOIN chat_message_tags mt ON m.id = mt.message_id
        LEFT JOIN chat_tags ct ON mt.tag_id = ct.id
        ${before ? 'WHERE m.id < ?' : ''}
        GROUP BY m.id
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = before ? [before, limit] : [limit];
    }

    const [rows] = await db.query(query, params);

    // Parse tag fields into arrays and reverse to chronological order
    const messages = rows.reverse().map(row => ({
      id: row.id,
      user_id: row.user_id,
      sender_name: row.sender_name,
      sender_initials: row.sender_initials,
      message: row.message,
      created_at: row.created_at,
      tags: row.tag_ids
        ? row.tag_ids.split(',').map((id, i) => ({
            id: parseInt(id),
            name: row.tag_names.split(',')[i],
            color: row.tag_colors.split(',')[i]
          }))
        : []
    }));

    res.json(messages);
  } catch (err) { next(err); }
});

// POST /api/chat/messages — send a message
router.post('/messages', async (req, res, next) => {
  try {
    const { message, tag_ids } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = getUserId(req);
    const user = req.user?.db || {};
    const senderName = user.name || 'Unknown';
    const senderInitials = user.initials || senderName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const [result] = await db.query(
      'INSERT INTO chat_messages (user_id, sender_name, sender_initials, message) VALUES (?, ?, ?, ?)',
      [userId, senderName, senderInitials, message.trim()]
    );

    const msgId = result.insertId;

    // Attach tags if provided
    if (Array.isArray(tag_ids) && tag_ids.length > 0) {
      const tagValues = tag_ids.map(tid => [msgId, parseInt(tid)]);
      await db.query(
        'INSERT IGNORE INTO chat_message_tags (message_id, tag_id) VALUES ?',
        [tagValues]
      );
    }

    // Fetch the complete message with tags
    const [rows] = await db.query(`
      SELECT m.*, GROUP_CONCAT(DISTINCT ct.id ORDER BY ct.name SEPARATOR ',') AS tag_ids,
             GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ',') AS tag_names,
             GROUP_CONCAT(DISTINCT ct.color ORDER BY ct.name SEPARATOR ',') AS tag_colors
      FROM chat_messages m
      LEFT JOIN chat_message_tags mt ON m.id = mt.message_id
      LEFT JOIN chat_tags ct ON mt.tag_id = ct.id
      WHERE m.id = ?
      GROUP BY m.id
    `, [msgId]);

    const row = rows[0];
    res.status(201).json({
      id: row.id,
      user_id: row.user_id,
      sender_name: row.sender_name,
      sender_initials: row.sender_initials,
      message: row.message,
      created_at: row.created_at,
      tags: row.tag_ids
        ? row.tag_ids.split(',').map((id, i) => ({
            id: parseInt(id),
            name: row.tag_names.split(',')[i],
            color: row.tag_colors.split(',')[i]
          }))
        : []
    });
  } catch (err) { next(err); }
});

// PUT /api/chat/messages/:id/tags — update tags on a message
router.put('/messages/:id/tags', async (req, res, next) => {
  try {
    const msgId = parseInt(req.params.id);
    const { tag_ids } = req.body;

    if (!Array.isArray(tag_ids)) {
      return res.status(400).json({ error: 'tag_ids array is required' });
    }

    // Replace all tags
    await db.query('DELETE FROM chat_message_tags WHERE message_id = ?', [msgId]);

    if (tag_ids.length > 0) {
      const tagValues = tag_ids.map(tid => [msgId, parseInt(tid)]);
      await db.query(
        'INSERT IGNORE INTO chat_message_tags (message_id, tag_id) VALUES ?',
        [tagValues]
      );
    }

    res.json({ success: true, message_id: msgId, tag_ids });
  } catch (err) { next(err); }
});

// DELETE /api/chat/messages/:id — delete a message (owner or admin)
router.delete('/messages/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const isAdminUser = String(req.user?.db?.role || '').toLowerCase() === 'admin';

    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    if (rows[0].user_id !== userId && !isAdminUser) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    await db.query('DELETE FROM chat_messages WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
