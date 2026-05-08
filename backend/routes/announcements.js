// Announcements API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, hasRole, requireDbUser } = require('../middleware/userContext');
const { getCredential } = require('./integrations');
const { announcement, validate } = require('../validation/schemas');
const { deleted } = require('../utils/response');
const { sanitizeHtml } = require('../utils/sanitizeHtml');
const { parseId } = require('../middleware/parseId');
const { BUCKETS, getDownloadUrl } = require('../services/s3');
const {
  buildAnnouncementImagePrompt,
  extractGeneratedImageBase64,
  normalizeAnnouncementAttachments,
  normalizeAnnouncementLinks,
  parseJsonArray,
} = require('../utils/announcementMedia');

const MAX_ACTIVE = 8;
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

router.use(requireDbUser);

function isDashboardUploadKey(key) {
  return typeof key === 'string' && key.startsWith('uploads/') && !key.includes('..') && !key.startsWith('/');
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function mergeLegacyAttachment(attachments, legacy) {
  const merged = [...attachments];
  if (legacy.file_s3_key && legacy.file_name) {
    merged.unshift({
      file_s3_key: legacy.file_s3_key,
      file_name: legacy.file_name,
      file_size: legacy.file_size || null,
      file_type: legacy.file_type || null,
    });
  }

  const seen = new Set();
  return merged.filter((attachment) => {
    const key = attachment.file_s3_key;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

async function signedDashboardUrl(key) {
  if (!isDashboardUploadKey(key)) return null;
  try {
    return await getDownloadUrl(BUCKETS.dashboard, key);
  } catch {
    return null;
  }
}

async function hydrateContentImages(content) {
  if (!content) return content;

  const keys = [...content.matchAll(/data-ann-s3-key=(["'])(.*?)\1/g)]
    .map((match) => match[2])
    .filter(isDashboardUploadKey);

  if (keys.length === 0) return content;

  const uniqueKeys = [...new Set(keys)];
  const urlByKey = {};
  await Promise.all(uniqueKeys.map(async (key) => {
    const url = await signedDashboardUrl(key);
    if (url) urlByKey[key] = url;
  }));

  return content.replace(/<img\b[^>]*data-ann-s3-key=(["'])(.*?)\1[^>]*>/gi, (tag, quote, key) => {
    const url = urlByKey[key];
    if (!url) return tag;
    if (/\ssrc=(["']).*?\1/i.test(tag)) {
      return tag.replace(/\ssrc=(["']).*?\1/i, ` src="${escapeAttr(url)}"`);
    }
    return tag.replace(/<img\b/i, `<img src="${escapeAttr(url)}"`);
  });
}

async function hydrateAnnouncement(row) {
  const links = normalizeAnnouncementLinks(parseJsonArray(row.links_json));
  if (links.length === 0 && row.link) {
    links.push({ label: 'Link 1', url: row.link });
  }

  const attachments = mergeLegacyAttachment(
    normalizeAnnouncementAttachments(parseJsonArray(row.attachments_json)),
    {
      file_s3_key: row.file_s3_key,
      file_name: row.file_name,
      file_size: row.file_size,
      file_type: row.file_type,
    }
  );

  await Promise.all(attachments.map(async (attachment) => {
    attachment.url = await signedDashboardUrl(attachment.file_s3_key);
    return attachment;
  }));

  const image_url = await signedDashboardUrl(row.image_s3_key);

  return {
    ...row,
    content: await hydrateContentImages(row.content),
    links,
    attachments,
    image_url,
  };
}

// GET /api/announcements - Get announcements by status (default: active)
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status === 'archived' ? 'archived' : 'active';
    const [announcements] = await db.query(
      `SELECT a.*, u.name AS author_name
       FROM announcements a
       LEFT JOIN users u ON a.author_id = u.id
       WHERE a.status = ?
       ORDER BY a.created_at DESC`,
      [status]
    );
    res.json(await Promise.all(announcements.map(hydrateAnnouncement)));
  } catch (error) {
    next(error);
  }
});

// POST /api/announcements/generate-image - Create a PNG from announcement content
router.post('/generate-image', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const apiKey = await getCredential(userId, 'openai');
    if (!apiKey) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Add a ChatGPT (OpenAI) API key on your profile AI Keys tab.',
      });
    }

    const imagePrompt = buildAnnouncementImagePrompt({
      title: req.body.title,
      content: req.body.content,
    });

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt: imagePrompt,
        size: '1536x1024',
        quality: 'medium',
        output_format: 'png',
        n: 1,
      }),
      signal: AbortSignal.timeout(120000),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload.error?.message || `OpenAI image generation failed with HTTP ${response.status}`,
      });
    }

    const imageBase64 = extractGeneratedImageBase64(payload);
    if (!imageBase64) {
      return res.status(502).json({ error: 'OpenAI did not return image data' });
    }

    res.json({
      imageBase64,
      mimeType: 'image/png',
      fileName: `announcement-${Date.now()}.png`,
      model: OPENAI_IMAGE_MODEL,
      prompt: imagePrompt,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/announcements - Create announcement (any authenticated user)
router.post('/', validate(announcement), async (req, res, next) => {
  try {

    const {
      title, content, link, links, icon,
      file_s3_key, file_name, file_size, file_type, attachments,
      image_s3_key, image_name, image_size, image_type,
    } = req.body;
    const sanitizedContent = sanitizeHtml(content);
    const authorId = getUserId(req);
    const normalizedLinks = normalizeAnnouncementLinks(links);
    const normalizedAttachments = mergeLegacyAttachment(normalizeAnnouncementAttachments(attachments), {
      file_s3_key,
      file_name,
      file_size,
      file_type,
    });
    const firstAttachment = normalizedAttachments[0] || {};
    const primaryLink = normalizedLinks[0]?.url || link || null;

    const [result] = await db.query(
      `INSERT INTO announcements
       (title, content, link, links_json, icon,
        file_s3_key, file_name, file_size, file_type, attachments_json,
        image_s3_key, image_name, image_size, image_type,
        author_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        title, sanitizedContent, primaryLink, JSON.stringify(normalizedLinks), icon || null,
        firstAttachment.file_s3_key || null, firstAttachment.file_name || null, firstAttachment.file_size || null, firstAttachment.file_type || null, JSON.stringify(normalizedAttachments),
        image_s3_key || null, image_name || null, image_size || null, image_type || null,
        authorId || null,
      ]
    );

    // Auto-archive oldest active announcements if we exceed the limit
    let archivedIds = [];
    const [[{ activeCount }]] = await db.query(
      `SELECT COUNT(*) AS activeCount FROM announcements WHERE status = 'active'`
    );

    if (activeCount > MAX_ACTIVE) {
      const overflow = activeCount - MAX_ACTIVE;
      const [oldest] = await db.query(
        `SELECT id FROM announcements WHERE status = 'active' ORDER BY created_at ASC LIMIT ?`,
        [overflow]
      );
      archivedIds = oldest.map(r => r.id);

      if (archivedIds.length > 0) {
        await db.query(
          `UPDATE announcements SET status = 'archived', archived_at = NOW() WHERE id IN (?)`,
          [archivedIds]
        );
      }
    }

    const [announcements] = await db.query(
      `SELECT a.*, u.name AS author_name
       FROM announcements a LEFT JOIN users u ON a.author_id = u.id
       WHERE a.id = ?`, [result.insertId]
    );

    const hydrated = await hydrateAnnouncement(announcements[0]);
    res.status(201).json({ ...hydrated, archivedIds });
  } catch (error) {
    next(error);
  }
});

// PUT /api/announcements/:id - Update announcement (admin or author only)
router.put('/:id', parseId(), validate(announcement), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Announcement not found' });

    // Admin can edit any; others can only edit their own
    if (!hasRole(req, 'admin') && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'You can only edit your own announcements' });
    }

    const {
      title, content, link, links, icon,
      file_s3_key, file_name, file_size, file_type, attachments,
      image_s3_key, image_name, image_size, image_type,
    } = req.body;
    const sanitizedContent = sanitizeHtml(content);
    const normalizedLinks = normalizeAnnouncementLinks(links);
    const normalizedAttachments = mergeLegacyAttachment(normalizeAnnouncementAttachments(attachments), {
      file_s3_key,
      file_name,
      file_size,
      file_type,
    });
    const firstAttachment = normalizedAttachments[0] || {};
    const primaryLink = normalizedLinks[0]?.url || link || null;

    await db.query(
      `UPDATE announcements SET title = ?, content = ?, link = ?, links_json = ?, icon = ?,
       file_s3_key = ?, file_name = ?, file_size = ?, file_type = ?, attachments_json = ?,
       image_s3_key = ?, image_name = ?, image_size = ?, image_type = ?
       WHERE id = ?`,
      [title, sanitizedContent, primaryLink, JSON.stringify(normalizedLinks), icon || null,
       firstAttachment.file_s3_key || null, firstAttachment.file_name || null, firstAttachment.file_size || null, firstAttachment.file_type || null, JSON.stringify(normalizedAttachments),
       image_s3_key || null, image_name || null, image_size || null, image_type || null,
       req.params.id]
    );

    const [updated] = await db.query(
      `SELECT a.*, u.name AS author_name FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id WHERE a.id = ?`,
      [req.params.id]
    );
    res.json(await hydrateAnnouncement(updated[0]));
  } catch (error) {
    next(error);
  }
});

// DELETE /api/announcements/:id - Delete announcement (admin or author only)
router.delete('/:id', parseId(), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Announcement not found' });

    // Admin can delete any; others can only delete their own
    if (!hasRole(req, 'admin') && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'You can only delete your own announcements' });
    }

    await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    deleted(res, 'Announcement deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
