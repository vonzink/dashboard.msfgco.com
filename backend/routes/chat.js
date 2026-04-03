// Chat API routes — messages + tag system + editing + file attachments
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireDbUser, getUserId } = require('../middleware/userContext');
const { chatMessage, chatMessageEdit, chatMessageTags, validate } = require('../validation/schemas');
const websocket = require('../lib/websocket');
const { parseId } = require('../middleware/parseId');
const s3 = require('../services/s3');
const crypto = require('crypto');
const logger = require('../lib/logger');

router.use(requireDbUser);

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

    await db.query(
      'INSERT INTO chat_tags (name, color, created_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=id',
      [tagName, tagColor, userId]
    );

    // Return the tag (whether newly created or existing)
    const [tags] = await db.query('SELECT * FROM chat_tags WHERE name = ?', [tagName]);
    res.status(201).json(tags[0]);
  } catch (err) { next(err); }
});

// DELETE /api/chat/tags/:id — delete a tag
router.delete('/tags/:id', parseId(), async (req, res, next) => {
  try {
    await db.query('DELETE FROM chat_tags WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// MESSAGES
// ──────────────────────────────────────────────

// Shared subqueries
const TAG_SUBQUERY = `(
  SELECT JSON_ARRAYAGG(JSON_OBJECT('id', ct.id, 'name', ct.name, 'color', ct.color))
  FROM chat_message_tags mt
  JOIN chat_tags ct ON mt.tag_id = ct.id
  WHERE mt.message_id = m.id
) AS tags`;

const ATTACHMENT_SUBQUERY = `(
  SELECT JSON_ARRAYAGG(JSON_OBJECT('id', ca.id, 'file_name', ca.file_name, 'file_size', ca.file_size, 'file_type', ca.file_type, 's3_key', ca.s3_key))
  FROM chat_attachments ca
  WHERE ca.message_id = m.id
) AS attachments`;

function parseMessage(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    sender_name: row.sender_name,
    sender_initials: row.sender_initials,
    message: row.message,
    created_at: row.created_at,
    updated_at: row.updated_at || null,
    is_edited: row.is_edited === 1,
    tags: row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : [],
    attachments: row.attachments ? (typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments) : [],
  };
}

// GET /api/chat/messages — list messages (with optional tag filter)
router.get('/messages', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = parseInt(req.query.before) || null;
    const tagId = parseInt(req.query.tag) || null;

    let query, params;

    if (tagId) {
      query = `
        SELECT m.*, ${TAG_SUBQUERY}, ${ATTACHMENT_SUBQUERY}
        FROM chat_messages m
        INNER JOIN chat_message_tags mt_filter ON m.id = mt_filter.message_id
        WHERE mt_filter.tag_id = ?
        ${before ? 'AND m.id < ?' : ''}
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = before ? [tagId, before, limit] : [tagId, limit];
    } else {
      query = `
        SELECT m.*, ${TAG_SUBQUERY}, ${ATTACHMENT_SUBQUERY}
        FROM chat_messages m
        ${before ? 'WHERE m.id < ?' : ''}
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = before ? [before, limit] : [limit];
    }

    const [rows] = await db.query(query, params);
    const messages = rows.reverse().map(parseMessage);
    res.json(messages);
  } catch (err) { next(err); }
});

// POST /api/chat/messages — send a message
router.post('/messages', validate(chatMessage), async (req, res, next) => {
  try {
    const { message, tag_ids } = req.body;

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

    // Fetch the complete message
    const [rows] = await db.query(`
      SELECT m.*, ${TAG_SUBQUERY}, ${ATTACHMENT_SUBQUERY}
      FROM chat_messages m WHERE m.id = ?
    `, [msgId]);

    const msgPayload = parseMessage(rows[0]);
    websocket.broadcast('chat:message', msgPayload);
    res.status(201).json(msgPayload);
  } catch (err) { next(err); }
});

// PUT /api/chat/messages/:id — edit a message (owner only)
router.put('/messages/:id', parseId(), validate(chatMessageEdit), async (req, res, next) => {
  try {
    const msgId = parseInt(req.params.id);
    const userId = getUserId(req);

    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [msgId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    if (rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own messages' });
    }

    await db.query(
      'UPDATE chat_messages SET message = ?, updated_at = NOW(), is_edited = 1 WHERE id = ?',
      [req.body.message.trim(), msgId]
    );

    // Fetch updated message
    const [updated] = await db.query(`
      SELECT m.*, ${TAG_SUBQUERY}, ${ATTACHMENT_SUBQUERY}
      FROM chat_messages m WHERE m.id = ?
    `, [msgId]);

    const msgPayload = parseMessage(updated[0]);
    websocket.broadcast('chat:edit', msgPayload);
    res.json(msgPayload);
  } catch (err) { next(err); }
});

// PUT /api/chat/messages/:id/tags — update tags on a message
router.put('/messages/:id/tags', parseId(), validate(chatMessageTags), async (req, res, next) => {
  try {
    const msgId = parseInt(req.params.id);
    const { tag_ids } = req.body;

    await db.query('DELETE FROM chat_message_tags WHERE message_id = ?', [msgId]);

    if (tag_ids.length > 0) {
      const tagValues = tag_ids.map(tid => [msgId, parseInt(tid)]);
      await db.query(
        'INSERT IGNORE INTO chat_message_tags (message_id, tag_id) VALUES ?',
        [tagValues]
      );
    }

    websocket.broadcast('chat:tags', { id: msgId, tag_ids });
    res.json({ success: true, message_id: msgId, tag_ids });
  } catch (err) { next(err); }
});

// DELETE /api/chat/messages/:id — delete a message (owner or admin)
router.delete('/messages/:id', parseId(), async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const isAdminUser = String(req.user?.db?.role || '').toLowerCase() === 'admin';

    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    if (rows[0].user_id !== userId && !isAdminUser) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    // Clean up S3 attachments before deleting message
    const [attachments] = await db.query(
      'SELECT s3_key, s3_bucket FROM chat_attachments WHERE message_id = ?',
      [req.params.id]
    );
    for (const att of attachments) {
      await s3.deleteObject(att.s3_bucket, att.s3_key);
    }

    await db.query('DELETE FROM chat_messages WHERE id = ?', [req.params.id]);
    websocket.broadcast('chat:delete', { id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ──────────────────────────────────────────────
// ATTACHMENTS
// ──────────────────────────────────────────────

// POST /api/chat/messages/:id/attachments/upload-url — get presigned upload URL
router.post('/messages/:id/attachments/upload-url', parseId(), async (req, res, next) => {
  try {
    const msgId = parseInt(req.params.id);
    const userId = getUserId(req);

    // Verify message exists and belongs to user
    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [msgId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    if (rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only attach files to your own messages' });
    }

    const { fileName, fileType, fileSize } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (fileSize && fileSize > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }

    const s3Key = `chat-attachments/${userId}/${crypto.randomUUID()}-${s3.sanitizeFileName(fileName)}`;
    const bucket = s3.BUCKETS.media;

    const { uploadUrl } = await s3.getUploadUrl(bucket, s3Key, fileType || 'application/octet-stream');

    res.json({ uploadUrl, s3Key, bucket });
  } catch (err) { next(err); }
});

// POST /api/chat/messages/:id/attachments — save attachment record after upload
router.post('/messages/:id/attachments', parseId(), async (req, res, next) => {
  try {
    const msgId = parseInt(req.params.id);
    const userId = getUserId(req);

    const [rows] = await db.query('SELECT user_id FROM chat_messages WHERE id = ?', [msgId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    if (rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only attach files to your own messages' });
    }

    const { file_name, file_size, file_type, s3_key, s3_bucket } = req.body;
    if (!file_name || !s3_key) {
      return res.status(400).json({ error: 'file_name and s3_key are required' });
    }

    const [result] = await db.query(
      'INSERT INTO chat_attachments (message_id, user_id, file_name, file_size, file_type, s3_key, s3_bucket) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [msgId, userId, file_name, file_size || 0, file_type || 'application/octet-stream', s3_key, s3_bucket || s3.BUCKETS.media]
    );

    const attachment = {
      id: result.insertId,
      message_id: msgId,
      file_name,
      file_size: file_size || 0,
      file_type: file_type || 'application/octet-stream',
      s3_key,
    };

    // Broadcast attachment added
    websocket.broadcast('chat:attachment', { message_id: msgId, attachment });

    res.status(201).json(attachment);
  } catch (err) { next(err); }
});

// GET /api/chat/attachments/:id/download — get presigned download URL
router.get('/attachments/:id/download', parseId(), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT s3_key, s3_bucket, file_name FROM chat_attachments WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });

    const { s3_key, s3_bucket, file_name } = rows[0];
    const downloadUrl = await s3.getDownloadUrl(s3_bucket, s3_key, 900);
    res.json({ downloadUrl, fileName: file_name });
  } catch (err) { next(err); }
});

// DELETE /api/chat/attachments/:id — delete an attachment (owner or admin)
router.delete('/attachments/:id', parseId(), async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const isAdminUser = String(req.user?.db?.role || '').toLowerCase() === 'admin';

    const [rows] = await db.query(
      'SELECT ca.*, cm.user_id AS msg_user_id FROM chat_attachments ca JOIN chat_messages cm ON ca.message_id = cm.id WHERE ca.id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });

    if (rows[0].msg_user_id !== userId && !isAdminUser) {
      return res.status(403).json({ error: 'You can only delete attachments on your own messages' });
    }

    const { s3_key, s3_bucket, message_id } = rows[0];
    await s3.deleteObject(s3_bucket, s3_key);
    await db.query('DELETE FROM chat_attachments WHERE id = ?', [req.params.id]);

    websocket.broadcast('chat:attachment:delete', { message_id, attachment_id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
