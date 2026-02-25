/**
 * /api/content/publish — Dispatch content to social media
 *
 * Supports three publishing methods:
 *   - 'direct' — Native platform API (Facebook Graph, LinkedIn, X v2, etc.)
 *   - 'n8n'    — n8n webhook automation
 *   - 'zapier' — Zapier webhook automation
 *
 * POST /:id — publish a single content item
 * POST /batch — publish multiple items
 *
 * The route:
 *   1. Looks up the content item
 *   2. Resolves the publishing method (direct API or webhook)
 *   3. Sends the post via chosen method
 *   4. Updates the content item status to "posted" or "failed"
 *   5. Logs everything to the audit trail
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { getCredential } = require('./integrations');
const { publishDirect, supportsDirectPublish } = require('../utils/socialPublisher');

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
        const webhookUrl = await getCredential(userId, method || 'n8n') || await getCredential(userId, 'zapier');
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
    const { method } = req.body; // 'direct' | 'zapier' | 'n8n' — optional override

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

    // ── Parse content ──
    const hashtags = item.hashtags
      ? (typeof item.hashtags === 'string' ? JSON.parse(item.hashtags) : item.hashtags)
      : [];

    const imageUrl = item.image_s3_key
      ? `https://${process.env.S3_BUCKET_NAME || 'msfg-dashboard-files'}.s3.amazonaws.com/${item.image_s3_key}`
      : null;

    // ── Resolve publishing method ──
    // Priority: explicit method → direct (if platform credential exists) → n8n → zapier → error
    let automationMethod = null;
    let postSuccess = false;
    let errorMessage = null;
    let postExternalId = null;

    // Try direct publishing first (if requested or as default)
    if (method === 'direct' || !method) {
      // Map platform name: 'x' uses 'twitter' credential
      const credentialService = item.platform === 'x' ? 'twitter' : item.platform;
      const platformCredential = await getCredential(userId, credentialService);

      if (platformCredential && supportsDirectPublish(item.platform)) {
        automationMethod = 'direct';
        try {
          const result = await publishDirect(item.platform, platformCredential, {
            text: item.text_content,
            hashtags,
            imageUrl,
          });
          postSuccess = true;
          postExternalId = result.postId || null;
        } catch (err) {
          errorMessage = err.message || 'Direct publish failed';
          // If direct was explicitly requested, don't fall through to webhooks
          if (method === 'direct') {
            // Will be handled below in the update section
          }
        }
      }
    }

    // Fall through to webhook methods if direct didn't work and wasn't explicitly requested
    if (!postSuccess && method !== 'direct') {
      let webhookUrl = null;

      if (method === 'n8n' || !method) {
        webhookUrl = await getCredential(userId, 'n8n');
        if (webhookUrl) automationMethod = 'n8n';
      }

      if (!webhookUrl && (method === 'zapier' || !method)) {
        webhookUrl = await getCredential(userId, 'zapier');
        if (webhookUrl) automationMethod = 'zapier';
      }

      if (webhookUrl) {
        const payload = {
          platform: item.platform,
          text: item.text_content,
          hashtags,
          fullText: hashtags.length > 0
            ? `${item.text_content}\n\n${hashtags.join(' ')}`
            : item.text_content,
          content_id: item.id,
          keyword: item.keyword,
          suggestion: item.suggestion,
          image_url: imageUrl,
          video_url: item.video_s3_key
            ? `https://${process.env.S3_BUCKET_NAME || 'msfg-dashboard-files'}.s3.amazonaws.com/${item.video_s3_key}`
            : null,
          scheduled_at: item.scheduled_at || null,
          source: 'msfg-content-engine',
          automation_method: automationMethod,
          timestamp: new Date().toISOString(),
        };

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });

          if (response.ok) {
            postSuccess = true;
            errorMessage = null;
          } else {
            const errText = await response.text().catch(() => 'Unknown error');
            errorMessage = `Webhook returned ${response.status}: ${errText}`;
          }
        } catch (err) {
          errorMessage = err.message || 'Webhook request failed';
        }

        // Log webhook call
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
      }
    }

    // If nothing worked at all
    if (!automationMethod) {
      return res.status(400).json({
        error: 'No publishing method available. Add a platform API key or automation webhook in Settings → Integrations.',
      });
    }

    // ── Update content item ──
    if (postSuccess) {
      await db.query(
        `UPDATE content_items
         SET status = 'posted', posted_at = NOW(), automation_method = ?,
             post_external_id = ?, error_message = NULL, updated_at = NOW()
         WHERE id = ?`,
        [automationMethod, postExternalId, itemId]
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
          post_external_id: postExternalId || undefined,
          error: errorMessage || undefined,
        }),
      ]
    );

    if (postSuccess) {
      res.json({
        success: true,
        platform: item.platform,
        automation_method: automationMethod,
        post_external_id: postExternalId,
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
