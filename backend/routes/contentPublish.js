/**
 * /api/content/publish — Dispatch content to social media via Zapier or n8n
 *
 * POST /:id — publish a single content item
 *
 * The route:
 *   1. Looks up the content item
 *   2. Resolves the user's automation webhook (Zapier or n8n)
 *   3. Sends the post payload (text, hashtags, platform, image URL)
 *   4. Updates the content item status to "posted" or "failed"
 *   5. Logs everything to the audit trail
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { getCredential } = require('./integrations');

router.use(requireDbUser);

// ── POST /batch — publish multiple items at once ────────────────
// IMPORTANT: must be registered BEFORE /:id to avoid Express matching "batch" as an id
router.post('/batch', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { item_ids, method } = req.body;

    if (!item_ids || !Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ error: 'item_ids[] is required' });
    }

    if (item_ids.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 items per batch' });
    }

    // Publish each sequentially (to avoid flooding webhooks)
    const results = [];
    for (const id of item_ids) {
      try {
        const [items] = await db.query('SELECT * FROM content_items WHERE id = ? AND (user_id = ? OR ?)',
          [id, userId, isAdmin(req) ? 1 : 0]);

        if (items.length === 0) {
          results.push({ content_id: id, success: false, error: 'Not found or access denied' });
          continue;
        }

        const item = items[0];
        let webhookUrl = await getCredential(userId, method || 'n8n') || await getCredential(userId, 'zapier');
        if (!webhookUrl) {
          results.push({ content_id: id, success: false, error: 'No webhook configured' });
          continue;
        }

        const hashtags = item.hashtags
          ? (typeof item.hashtags === 'string' ? JSON.parse(item.hashtags) : item.hashtags)
          : [];

        const payload = {
          platform: item.platform,
          text: item.text_content,
          hashtags,
          fullText: hashtags.length > 0 ? `${item.text_content}\n\n${hashtags.join(' ')}` : item.text_content,
          content_id: item.id,
          source: 'msfg-content-engine',
          timestamp: new Date().toISOString(),
        };

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });

        const success = response.ok;
        await db.query(
          `UPDATE content_items SET status = ?, posted_at = ${success ? 'NOW()' : 'posted_at'}, updated_at = NOW() WHERE id = ?`,
          [success ? 'posted' : 'failed', id]
        );

        results.push({ content_id: id, success, platform: item.platform });
      } catch (err) {
        results.push({ content_id: id, success: false, error: err.message });
      }
    }

    res.json({
      total: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /:id — publish content item ────────────────────────────
router.post('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const itemId = req.params.id;
    const { method } = req.body; // 'zapier' | 'n8n' — optional override

    // ── Load content item ──
    const [items] = await db.query('SELECT * FROM content_items WHERE id = ?', [itemId]);
    if (items.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    const item = items[0];

    // Ownership check
    if (!isAdmin(req) && item.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only approved or scheduled items can be published (or admins can force)
    if (!['approved', 'scheduled', 'draft'].includes(item.status) && !isAdmin(req)) {
      return res.status(400).json({
        error: `Content must be approved before publishing. Current status: ${item.status}`,
      });
    }

    // ── Resolve automation webhook ──
    // Priority: explicit method param → user's n8n → user's zapier → error
    let webhookUrl = null;
    let automationMethod = method || null;

    if (method === 'n8n' || !method) {
      webhookUrl = await getCredential(userId, 'n8n');
      if (webhookUrl) automationMethod = 'n8n';
    }

    if (!webhookUrl && (method === 'zapier' || !method)) {
      webhookUrl = await getCredential(userId, 'zapier');
      if (webhookUrl) automationMethod = 'zapier';
    }

    if (!webhookUrl) {
      return res.status(400).json({
        error: 'No automation webhook configured. Go to Settings → Integrations and add your Zapier or n8n webhook URL.',
      });
    }

    // ── Build payload ──
    const hashtags = item.hashtags
      ? (typeof item.hashtags === 'string' ? JSON.parse(item.hashtags) : item.hashtags)
      : [];

    const payload = {
      // Core content
      platform: item.platform,
      text: item.text_content,
      hashtags,
      fullText: hashtags.length > 0
        ? `${item.text_content}\n\n${hashtags.join(' ')}`
        : item.text_content,

      // Metadata
      content_id: item.id,
      keyword: item.keyword,
      suggestion: item.suggestion,

      // Media (S3 URLs if available)
      image_url: item.image_s3_key
        ? `https://${process.env.S3_BUCKET_NAME || 'msfg-dashboard-files'}.s3.amazonaws.com/${item.image_s3_key}`
        : null,
      video_url: item.video_s3_key
        ? `https://${process.env.S3_BUCKET_NAME || 'msfg-dashboard-files'}.s3.amazonaws.com/${item.video_s3_key}`
        : null,

      // Scheduling
      scheduled_at: item.scheduled_at || null,

      // Source
      source: 'msfg-content-engine',
      automation_method: automationMethod,
      timestamp: new Date().toISOString(),
    };

    // ── Send to webhook ──
    let postSuccess = false;
    let errorMessage = null;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        postSuccess = true;
      } else {
        const errText = await response.text().catch(() => 'Unknown error');
        errorMessage = `Webhook returned ${response.status}: ${errText}`;
      }
    } catch (error) {
      errorMessage = error.message || 'Webhook request failed';
    }

    // ── Update content item ──
    if (postSuccess) {
      await db.query(
        `UPDATE content_items
         SET status = 'posted', posted_at = NOW(), automation_method = ?, error_message = NULL, updated_at = NOW()
         WHERE id = ?`,
        [automationMethod, itemId]
      );
    } else {
      await db.query(
        `UPDATE content_items
         SET status = 'failed', automation_method = ?, error_message = ?, updated_at = NOW()
         WHERE id = ?`,
        [automationMethod, errorMessage, itemId]
      );
    }

    // ── Audit log ──
    await db.query(
      'INSERT INTO content_audit_log (content_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [
        itemId,
        userId,
        postSuccess ? 'posted' : 'failed',
        JSON.stringify({
          automation_method: automationMethod,
          platform: item.platform,
          error: errorMessage || undefined,
        }),
      ]
    );

    // ── Log to webhook_logs (reuse existing table) ──
    try {
      await db.query(
        `INSERT INTO webhook_logs (endpoint, method, payload, response_code, ip_address, user_agent)
         VALUES (?, 'POST', ?, ?, ?, ?)`,
        [
          webhookUrl.substring(0, 255),
          JSON.stringify(payload),
          postSuccess ? 200 : 502,
          req.ip,
          'msfg-content-engine',
        ]
      );
    } catch {
      // Non-fatal
    }

    if (postSuccess) {
      res.json({
        success: true,
        platform: item.platform,
        automation_method: automationMethod,
        content_id: itemId,
      });
    } else {
      res.status(502).json({
        success: false,
        error: errorMessage,
        platform: item.platform,
        automation_method: automationMethod,
        content_id: itemId,
      });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
