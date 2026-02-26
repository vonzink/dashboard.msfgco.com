// Admin — Employee profiles + avatar upload
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { decrypt, mask } = require('../../utils/encryption');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject, buildMediaKey } = require('../../services/s3');
const logger = require('../../lib/logger');

// GET /users/:id/profile
router.get('/:id/profile', async (req, res, next) => {
  try {
    const userId = req.params.id;

    const [profiles] = await db.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    const profile = profiles[0] || {
      user_id: parseInt(userId),
      team: null, phone: null, display_email: null, website: null, online_app_url: null,
      facebook_url: null, instagram_url: null, twitter_url: null, linkedin_url: null, tiktok_url: null,
      avatar_s3_key: null, email_signature: null,
    };

    // Generate presigned avatar URL if exists
    let avatar_url = null;
    if (profile.avatar_s3_key) {
      try {
        avatar_url = await getDownloadUrl(BUCKETS.media, profile.avatar_s3_key);
      } catch (e) {
        logger.warn({ err: e }, 'Avatar URL generation failed');
      }
    }

    // Get AI integration status
    const [integrations] = await db.query(
      `SELECT id, service, credential_type, encrypted_value, iv, auth_tag, is_active
       FROM user_integrations
       WHERE user_id = ? AND service IN ('openai', 'anthropic')`,
      [userId]
    );

    const aiKeys = {};
    for (const row of integrations) {
      let maskedValue = '••••••••';
      try {
        const plaintext = decrypt(row.encrypted_value, row.iv, row.auth_tag);
        maskedValue = mask(plaintext);
      } catch { /* ignore */ }
      aiKeys[row.service] = { maskedValue, is_active: row.is_active };
    }

    res.json({ ...profile, avatar_url, ai_keys: aiKeys });
  } catch (error) {
    next(error);
  }
});

// PUT /users/:id/profile
router.put('/:id/profile', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const fields = [
      'team', 'phone', 'display_email', 'website', 'online_app_url',
      'facebook_url', 'instagram_url', 'twitter_url', 'linkedin_url', 'tiktok_url',
      'email_signature',
    ];

    const setClauses = [];
    const values = [];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        values.push(req.body[f] || null);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const insertCols = ['user_id', ...fields.filter(f => req.body[f] !== undefined)];
    const insertPlaceholders = insertCols.map(() => '?').join(', ');
    const insertValues = [userId, ...values];
    const updatePart = setClauses.join(', ');

    await db.query(
      `INSERT INTO user_profiles (${insertCols.join(', ')})
       VALUES (${insertPlaceholders})
       ON DUPLICATE KEY UPDATE ${updatePart}`,
      [...insertValues, ...values]
    );

    const [profiles] = await db.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    res.json(profiles[0] || {});
  } catch (error) {
    next(error);
  }
});

// ── Avatar Upload ───────────────────────────────

// POST /users/:id/avatar/upload-url
router.post('/:id/avatar/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) {
      return res.status(400).json({ error: 'File must be an image' });
    }

    const fileKey = buildMediaKey('employee-avatars', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// PUT /users/:id/avatar/confirm
router.put('/:id/avatar/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    const [old] = await db.query('SELECT avatar_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const oldKey = old[0]?.avatar_s3_key;

    await db.query(
      `INSERT INTO user_profiles (user_id, avatar_s3_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE avatar_s3_key = ?`,
      [userId, fileKey, fileKey]
    );

    if (oldKey && oldKey !== fileKey) {
      await deleteObject(BUCKETS.media, oldKey);
    }

    res.json({ success: true, fileKey });
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id/avatar
router.delete('/:id/avatar', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const [rows] = await db.query('SELECT avatar_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.avatar_s3_key;

    if (key) {
      await deleteObject(BUCKETS.media, key);
    }

    await db.query('UPDATE user_profiles SET avatar_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
