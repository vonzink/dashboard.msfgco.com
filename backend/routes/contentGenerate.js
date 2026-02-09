/**
 * /api/content/generate — AI content generation with prompt templates
 *
 * POST / — generate content for one or more platforms
 *
 * Body:
 *   suggestion: string             — the topic / keyword suggestion
 *   platforms: string[]            — ["facebook", "instagram", "x", "linkedin", "tiktok"]
 *   keyword?: string               — original search keyword (for tracking)
 *   template_id?: number           — force a specific template (otherwise auto-resolve)
 *   additional_instructions?: string — one-off extra instructions
 *   save_drafts?: boolean          — if true, save generated content as draft content_items
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const { getCredential } = require('./integrations');
const { buildPrompt, PLATFORM_CONSTRAINTS } = require('../utils/promptBuilder');

router.use(requireDbUser);

const VALID_PLATFORMS = Object.keys(PLATFORM_CONSTRAINTS);

// ── POST / — generate content ───────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const {
      suggestion,
      platforms,
      keyword,
      template_id,
      additional_instructions,
      save_drafts,
    } = req.body;

    if (!suggestion) {
      return res.status(400).json({ error: 'suggestion is required' });
    }
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms[] is required' });
    }

    const validPlatforms = platforms.filter(p => VALID_PLATFORMS.includes(p));
    if (validPlatforms.length === 0) {
      return res.status(400).json({ error: `Invalid platforms. Must be: ${VALID_PLATFORMS.join(', ')}` });
    }

    // ── Get user's OpenAI key ──
    const apiKey = await getCredential(userId, 'openai');
    if (!apiKey) {
      return res.status(400).json({
        error: 'OpenAI API key not configured. Go to Settings → Integrations to add your key.',
      });
    }

    // ── Resolve templates per platform ──
    const templatesByPlatform = {};
    for (const platform of validPlatforms) {
      if (template_id) {
        // User explicitly chose a template
        const [rows] = await db.query(
          'SELECT * FROM prompt_templates WHERE id = ? AND is_active = TRUE',
          [template_id]
        );
        templatesByPlatform[platform] = rows[0] || null;
      } else {
        // Auto-resolve: user's platform-specific → user's "all" → company platform → company "all"
        const [rows] = await db.query(
          `SELECT * FROM prompt_templates
           WHERE ((user_id = ? AND platform = ?)
               OR (user_id = ? AND platform = 'all')
               OR (user_id IS NULL AND platform = ?)
               OR (user_id IS NULL AND platform = 'all'))
             AND is_default = TRUE AND is_active = TRUE
           ORDER BY
             (user_id IS NOT NULL) DESC,
             (platform = ?) DESC,
             updated_at DESC
           LIMIT 1`,
          [userId, platform, userId, platform, platform]
        );
        templatesByPlatform[platform] = rows[0] || null;
      }
    }

    // ── Generate content for each platform in parallel ──
    const results = await Promise.all(
      validPlatforms.map(platform =>
        generateForPlatform(apiKey, suggestion, platform, templatesByPlatform[platform], additional_instructions)
      )
    );

    // ── Optionally save as drafts ──
    const savedItems = [];
    if (save_drafts) {
      for (const content of results) {
        if (content.text && !content.error) {
          try {
            const [insertResult] = await db.query(
              `INSERT INTO content_items
                 (user_id, keyword, suggestion, platform, prompt_template_id, status, text_content, hashtags)
               VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
              [
                userId,
                keyword || suggestion,
                suggestion,
                content.platform,
                templatesByPlatform[content.platform]?.id || null,
                content.text,
                JSON.stringify(content.hashtags || []),
              ]
            );

            // Audit log
            await db.query(
              `INSERT INTO content_audit_log (content_id, user_id, action, details)
               VALUES (?, ?, 'created', ?)`,
              [insertResult.insertId, userId, JSON.stringify({ source: 'ai_generate', suggestion })]
            );

            savedItems.push({ platform: content.platform, content_id: insertResult.insertId });
          } catch (err) {
            console.error(`Failed to save draft for ${content.platform}:`, err.message);
          }
        }
      }
    }

    res.json({
      suggestion,
      platforms: results,
      saved: savedItems.length > 0 ? savedItems : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// ── Generate content for a single platform ──────────────────────

async function generateForPlatform(apiKey, suggestion, platform, template, additionalInstructions) {
  const constraints = PLATFORM_CONSTRAINTS[platform] || PLATFORM_CONSTRAINTS.facebook;

  try {
    const { messages, model, temperature } = buildPrompt({
      suggestion,
      platform,
      template,
      additionalInstructions,
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // Parse JSON response, handle markdown wrapping
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const text = (parsed.text || '').slice(0, constraints.maxLength);
    const hashtags = (parsed.hashtags || []).map(h =>
      h.startsWith('#') ? h : `#${h}`
    );

    return {
      platform,
      text,
      hashtags,
      characterCount: text.length,
      model,
      template_id: template?.id || null,
      template_name: template?.name || null,
    };
  } catch (error) {
    console.error(`Generation failed for ${platform}:`, error.message);
    return {
      platform,
      text: '',
      hashtags: [],
      characterCount: 0,
      error: error.message || 'Generation failed',
    };
  }
}

module.exports = router;
