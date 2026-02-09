/**
 * /api/content/templates — Prompt template management
 *
 * GET    /            — list templates (user's own + company defaults)
 * GET    /:id         — get a single template
 * POST   /            — create a new template
 * PUT    /:id         — update a template
 * DELETE /:id         — delete a template (only own, not company defaults unless admin)
 * GET    /resolve/:platform — get the effective template for a platform (user override → company default)
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');

router.use(requireDbUser);

// ── GET / — list all templates visible to the user ──────────────
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { platform } = req.query;

    let query = `
      SELECT pt.*, u.name as author_name
      FROM prompt_templates pt
      LEFT JOIN users u ON pt.user_id = u.id
      WHERE (pt.user_id = ? OR pt.user_id IS NULL)
        AND pt.is_active = TRUE`;
    const params = [userId];

    if (platform) {
      query += ' AND (pt.platform = ? OR pt.platform = ?)';
      params.push(platform, 'all');
    }

    query += ' ORDER BY pt.user_id IS NULL ASC, pt.platform, pt.name';

    const [rows] = await db.query(query, params);

    // Label each as "company" or "personal"
    const templates = rows.map(row => ({
      ...row,
      scope: row.user_id ? 'personal' : 'company',
    }));

    res.json(templates);
  } catch (error) {
    next(error);
  }
});

// ── GET /resolve/:platform — effective template for a platform ──
router.get('/resolve/:platform', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { platform } = req.params;

    // Priority: user's platform-specific → user's "all" → company platform-specific → company "all"
    const [rows] = await db.query(
      `SELECT pt.*, u.name as author_name
       FROM prompt_templates pt
       LEFT JOIN users u ON pt.user_id = u.id
       WHERE ((pt.user_id = ? AND pt.platform = ?)
           OR (pt.user_id = ? AND pt.platform = 'all')
           OR (pt.user_id IS NULL AND pt.platform = ?)
           OR (pt.user_id IS NULL AND pt.platform = 'all'))
         AND pt.is_default = TRUE
         AND pt.is_active = TRUE
       ORDER BY
         (pt.user_id IS NOT NULL) DESC,
         (pt.platform = ?) DESC,
         pt.updated_at DESC
       LIMIT 1`,
      [userId, platform, userId, platform, platform]
    );

    if (rows.length === 0) {
      return res.json(null);
    }

    res.json({ ...rows[0], scope: rows[0].user_id ? 'personal' : 'company' });
  } catch (error) {
    next(error);
  }
});

// ── GET /:id — single template ──────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [rows] = await db.query(
      `SELECT pt.*, u.name as author_name
       FROM prompt_templates pt
       LEFT JOIN users u ON pt.user_id = u.id
       WHERE pt.id = ? AND (pt.user_id = ? OR pt.user_id IS NULL)`,
      [req.params.id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ ...rows[0], scope: rows[0].user_id ? 'personal' : 'company' });
  } catch (error) {
    next(error);
  }
});

// ── POST / — create template ────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const {
      platform, name, system_prompt, tone, audience,
      rules, example_post, model, temperature, is_default,
      is_company_wide,
    } = req.body;

    if (!platform || !name || !system_prompt) {
      return res.status(400).json({ error: 'platform, name, and system_prompt are required' });
    }

    // Only admins can create company-wide templates
    const ownerUserId = (is_company_wide && isAdmin(req)) ? null : userId;

    const [result] = await db.query(
      `INSERT INTO prompt_templates
         (user_id, platform, name, system_prompt, tone, audience, rules, example_post, model, temperature, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerUserId, platform, name, system_prompt,
        tone || null, audience || null, rules || null,
        example_post || null, model || 'gpt-4o-mini',
        temperature != null ? temperature : 0.8,
        is_default ? 1 : 0,
      ]
    );

    // If setting as default, un-default others for same user + platform
    if (is_default) {
      await db.query(
        `UPDATE prompt_templates SET is_default = FALSE
         WHERE id != ? AND user_id <=> ? AND (platform = ? OR platform = 'all')`,
        [result.insertId, ownerUserId, platform]
      );
    }

    const [rows] = await db.query('SELECT * FROM prompt_templates WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── PUT /:id — update template ──────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const templateId = req.params.id;

    // Verify ownership
    const [existing] = await db.query('SELECT * FROM prompt_templates WHERE id = ?', [templateId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = existing[0];
    // Only the owner or an admin can edit
    if (template.user_id && template.user_id !== userId && !isAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // Company-wide templates require admin
    if (!template.user_id && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only admins can edit company-wide templates' });
    }

    const {
      platform, name, system_prompt, tone, audience,
      rules, example_post, model, temperature, is_default,
    } = req.body;

    const updates = [];
    const values = [];

    if (platform !== undefined)       { updates.push('platform = ?');       values.push(platform); }
    if (name !== undefined)           { updates.push('name = ?');           values.push(name); }
    if (system_prompt !== undefined)   { updates.push('system_prompt = ?'); values.push(system_prompt); }
    if (tone !== undefined)           { updates.push('tone = ?');           values.push(tone); }
    if (audience !== undefined)       { updates.push('audience = ?');       values.push(audience); }
    if (rules !== undefined)          { updates.push('rules = ?');          values.push(rules); }
    if (example_post !== undefined)   { updates.push('example_post = ?');   values.push(example_post); }
    if (model !== undefined)          { updates.push('model = ?');          values.push(model); }
    if (temperature !== undefined)    { updates.push('temperature = ?');    values.push(temperature); }
    if (is_default !== undefined)     { updates.push('is_default = ?');     values.push(is_default ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(templateId);
    await db.query(
      `UPDATE prompt_templates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    // If marking as default, un-default others
    if (is_default) {
      await db.query(
        `UPDATE prompt_templates SET is_default = FALSE
         WHERE id != ? AND user_id <=> ? AND (platform = ? OR platform = 'all')`,
        [templateId, template.user_id, platform || template.platform]
      );
    }

    const [rows] = await db.query('SELECT * FROM prompt_templates WHERE id = ?', [templateId]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── DELETE /:id — delete template ───────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const templateId = req.params.id;

    const [existing] = await db.query('SELECT * FROM prompt_templates WHERE id = ?', [templateId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = existing[0];
    if (template.user_id && template.user_id !== userId && !isAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!template.user_id && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only admins can delete company-wide templates' });
    }

    // Soft-delete by deactivating (preserves audit trail)
    await db.query('UPDATE prompt_templates SET is_active = FALSE WHERE id = ?', [templateId]);

    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
