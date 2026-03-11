// Admin — Employee profiles + avatar/business-card/QR-code upload + custom links
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
      youtube_url: null,
      avatar_s3_key: null, business_card_s3_key: null,
      qr_code_1_s3_key: null, qr_code_1_label: null,
      qr_code_2_s3_key: null, qr_code_2_label: null,
      nmls_number: null,
      insurance_provider: null, insurance_policy_number: null, insurance_expiration: null,
      bond_company: null, bond_number: null, bond_expiration: null,
      email_signature: null,
    };

    // Generate presigned URLs for images
    let avatar_url = null;
    if (profile.avatar_s3_key) {
      try { avatar_url = await getDownloadUrl(BUCKETS.media, profile.avatar_s3_key); }
      catch (e) { logger.warn({ err: e }, 'Avatar URL generation failed'); }
    }

    let business_card_url = null;
    if (profile.business_card_s3_key) {
      try { business_card_url = await getDownloadUrl(BUCKETS.media, profile.business_card_s3_key); }
      catch (e) { logger.warn({ err: e }, 'Business card URL generation failed'); }
    }

    let qr_code_1_url = null;
    if (profile.qr_code_1_s3_key) {
      try { qr_code_1_url = await getDownloadUrl(BUCKETS.media, profile.qr_code_1_s3_key); }
      catch (e) { logger.warn({ err: e }, 'QR code 1 URL generation failed'); }
    }

    let qr_code_2_url = null;
    if (profile.qr_code_2_s3_key) {
      try { qr_code_2_url = await getDownloadUrl(BUCKETS.media, profile.qr_code_2_s3_key); }
      catch (e) { logger.warn({ err: e }, 'QR code 2 URL generation failed'); }
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

    // Get custom links
    const [customLinks] = await db.query(
      'SELECT id, label, url, icon, sort_order FROM employee_custom_links WHERE user_id = ? ORDER BY sort_order, id',
      [userId]
    );

    res.json({
      ...profile,
      avatar_url, business_card_url,
      qr_code_1_url, qr_code_2_url,
      ai_keys: aiKeys,
      custom_links: customLinks,
    });
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
      'youtube_url',
      'qr_code_1_label', 'qr_code_2_label',
      'nmls_number',
      'insurance_provider', 'insurance_policy_number', 'insurance_expiration',
      'bond_company', 'bond_number', 'bond_expiration',
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

router.post('/:id/avatar/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) return res.status(400).json({ error: 'File must be an image' });
    const fileKey = buildMediaKey('employee-avatars', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

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
    if (oldKey && oldKey !== fileKey) await deleteObject(BUCKETS.media, oldKey);
    res.json({ success: true, fileKey });
  } catch (error) { next(error); }
});

router.delete('/:id/avatar', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const [rows] = await db.query('SELECT avatar_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.avatar_s3_key;
    if (key) await deleteObject(BUCKETS.media, key);
    await db.query('UPDATE user_profiles SET avatar_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── Business Card Upload ────────────────────────

router.post('/:id/business-card/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) return res.status(400).json({ error: 'File must be an image' });
    const fileKey = buildMediaKey('employee-business-cards', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

router.put('/:id/business-card/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });
    const [old] = await db.query('SELECT business_card_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const oldKey = old[0]?.business_card_s3_key;
    await db.query(
      `INSERT INTO user_profiles (user_id, business_card_s3_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE business_card_s3_key = ?`,
      [userId, fileKey, fileKey]
    );
    if (oldKey && oldKey !== fileKey) await deleteObject(BUCKETS.media, oldKey);
    res.json({ success: true, fileKey });
  } catch (error) { next(error); }
});

router.delete('/:id/business-card', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const [rows] = await db.query('SELECT business_card_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.business_card_s3_key;
    if (key) await deleteObject(BUCKETS.media, key);
    await db.query('UPDATE user_profiles SET business_card_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── QR Code 1 Upload ────────────────────────────

router.post('/:id/qr-code-1/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) return res.status(400).json({ error: 'File must be an image' });
    const fileKey = buildMediaKey('employee-qr-codes', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

router.put('/:id/qr-code-1/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });
    const [old] = await db.query('SELECT qr_code_1_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const oldKey = old[0]?.qr_code_1_s3_key;
    await db.query(
      `INSERT INTO user_profiles (user_id, qr_code_1_s3_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE qr_code_1_s3_key = ?`,
      [userId, fileKey, fileKey]
    );
    if (oldKey && oldKey !== fileKey) await deleteObject(BUCKETS.media, oldKey);
    res.json({ success: true, fileKey });
  } catch (error) { next(error); }
});

router.delete('/:id/qr-code-1', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const [rows] = await db.query('SELECT qr_code_1_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.qr_code_1_s3_key;
    if (key) await deleteObject(BUCKETS.media, key);
    await db.query('UPDATE user_profiles SET qr_code_1_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── QR Code 2 Upload ────────────────────────────

router.post('/:id/qr-code-2/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) return res.status(400).json({ error: 'File must be an image' });
    const fileKey = buildMediaKey('employee-qr-codes', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

router.put('/:id/qr-code-2/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });
    const [old] = await db.query('SELECT qr_code_2_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const oldKey = old[0]?.qr_code_2_s3_key;
    await db.query(
      `INSERT INTO user_profiles (user_id, qr_code_2_s3_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE qr_code_2_s3_key = ?`,
      [userId, fileKey, fileKey]
    );
    if (oldKey && oldKey !== fileKey) await deleteObject(BUCKETS.media, oldKey);
    res.json({ success: true, fileKey });
  } catch (error) { next(error); }
});

router.delete('/:id/qr-code-2', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const [rows] = await db.query('SELECT qr_code_2_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.qr_code_2_s3_key;
    if (key) await deleteObject(BUCKETS.media, key);
    await db.query('UPDATE user_profiles SET qr_code_2_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── Custom Links CRUD ───────────────────────────

router.get('/:id/custom-links', async (req, res, next) => {
  try {
    const [links] = await db.query(
      'SELECT id, label, url, icon, sort_order FROM employee_custom_links WHERE user_id = ? ORDER BY sort_order, id',
      [req.params.id]
    );
    res.json(links);
  } catch (error) { next(error); }
});

router.post('/:id/custom-links', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { label, url, icon, sort_order } = req.body;
    if (!label || !url) return res.status(400).json({ error: 'label and url are required' });

    const [result] = await db.query(
      'INSERT INTO employee_custom_links (user_id, label, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
      [userId, label, url, icon || null, sort_order || 0]
    );
    res.json({ id: result.insertId, label, url, icon: icon || null, sort_order: sort_order || 0 });
  } catch (error) { next(error); }
});

router.put('/:id/custom-links/:linkId', async (req, res, next) => {
  try {
    const { label, url, icon, sort_order } = req.body;
    if (!label || !url) return res.status(400).json({ error: 'label and url are required' });

    await db.query(
      'UPDATE employee_custom_links SET label = ?, url = ?, icon = ?, sort_order = ? WHERE id = ? AND user_id = ?',
      [label, url, icon || null, sort_order || 0, req.params.linkId, req.params.id]
    );
    res.json({ id: parseInt(req.params.linkId), label, url, icon: icon || null, sort_order: sort_order || 0 });
  } catch (error) { next(error); }
});

router.delete('/:id/custom-links/:linkId', async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM employee_custom_links WHERE id = ? AND user_id = ?',
      [req.params.linkId, req.params.id]
    );
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
