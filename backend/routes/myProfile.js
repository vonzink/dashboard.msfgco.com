// Self-serve profile routes — any authenticated user can read/update their OWN profile
// No admin/manager role required. All operations are scoped to req.user.db.id.
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject, buildMediaKey } = require('../services/s3');
const logger = require('../lib/logger');

router.use(requireDbUser);

// Fields a user can edit on their own profile
const EDITABLE_FIELDS = [
  'phone', 'display_email', 'website', 'online_app_url',
  'facebook_url', 'instagram_url', 'twitter_url', 'linkedin_url', 'tiktok_url', 'youtube_url',
  'facebook_business_url', 'facebook_url_2', 'linkedin_url_2', 'nextdoor_url', 'google_my_business_url',
  'qr_code_1_label', 'qr_code_2_label',
  'nmls_number',
  'email_signature',
];

// ── GET /api/me/profile — read own profile ──────
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);

    // Get user basic info
    const [users] = await db.query('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
    const user = users[0] || {};

    // Get profile
    const [profiles] = await db.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    const profile = profiles[0] || {};

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

    // Get custom links
    const [customLinks] = await db.query(
      'SELECT id, label, url, icon, sort_order FROM employee_custom_links WHERE user_id = ? ORDER BY sort_order, id',
      [userId]
    );

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      ...profile,
      avatar_url,
      business_card_url,
      qr_code_1_url,
      qr_code_2_url,
      custom_links: customLinks,
    });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/me/profile — update own profile ────
router.put('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const setClauses = [];
    const values = [];

    for (const f of EDITABLE_FIELDS) {
      if (req.body[f] !== undefined) {
        setClauses.push(`${f} = ?`);
        values.push(req.body[f] || null);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const insertCols = ['user_id', ...EDITABLE_FIELDS.filter(f => req.body[f] !== undefined)];
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

// ── Avatar Upload (self) ────────────────────────
router.post('/avatar/upload-url', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { fileName, fileType } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) return res.status(400).json({ error: 'File must be an image' });
    const fileKey = buildMediaKey('employee-avatars', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

router.put('/avatar/confirm', async (req, res, next) => {
  try {
    const userId = getUserId(req);
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

router.delete('/avatar', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [rows] = await db.query('SELECT avatar_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.avatar_s3_key;
    if (key) await deleteObject(BUCKETS.media, key);
    await db.query('UPDATE user_profiles SET avatar_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── Media Upload (business card, QR codes) ──────
const MEDIA_PURPOSES = {
  business_card: { folder: 'business-cards', s3Col: 'business_card_s3_key' },
  qr_code_1:    { folder: 'qr-codes',       s3Col: 'qr_code_1_s3_key' },
  qr_code_2:    { folder: 'qr-codes',       s3Col: 'qr_code_2_s3_key' },
};

router.post('/media/upload-url', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { fileName, fileType, purpose } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) return res.status(400).json({ error: 'File must be an image' });
    const mp = MEDIA_PURPOSES[purpose];
    if (!mp) return res.status(400).json({ error: 'Invalid purpose. Must be: business_card, qr_code_1, qr_code_2' });
    const fileKey = buildMediaKey(mp.folder, userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

router.put('/media/confirm', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { fileKey, purpose } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });
    const mp = MEDIA_PURPOSES[purpose];
    if (!mp) return res.status(400).json({ error: 'Invalid purpose' });
    const col = mp.s3Col;
    const [old] = await db.query(`SELECT ${col} FROM user_profiles WHERE user_id = ?`, [userId]);
    const oldKey = old[0]?.[col];
    await db.query(
      `INSERT INTO user_profiles (user_id, ${col}) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE ${col} = ?`,
      [userId, fileKey, fileKey]
    );
    if (oldKey && oldKey !== fileKey) await deleteObject(BUCKETS.media, oldKey);
    res.json({ success: true, fileKey });
  } catch (error) { next(error); }
});

router.delete('/media/:purpose', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const mp = MEDIA_PURPOSES[req.params.purpose];
    if (!mp) return res.status(400).json({ error: 'Invalid purpose' });
    const col = mp.s3Col;
    const [rows] = await db.query(`SELECT ${col} FROM user_profiles WHERE user_id = ?`, [userId]);
    const key = rows[0]?.[col];
    if (key) await deleteObject(BUCKETS.media, key);
    await db.query(`UPDATE user_profiles SET ${col} = NULL WHERE user_id = ?`, [userId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── Custom Links (self) ─────────────────────────
router.get('/custom-links', async (req, res, next) => {
  try {
    const [links] = await db.query(
      'SELECT id, label, url, icon, sort_order FROM employee_custom_links WHERE user_id = ? ORDER BY sort_order, id',
      [getUserId(req)]
    );
    res.json(links);
  } catch (error) { next(error); }
});

router.post('/custom-links', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { label, url, icon, sort_order } = req.body;
    if (!label || !url) return res.status(400).json({ error: 'label and url are required' });
    const [result] = await db.query(
      'INSERT INTO employee_custom_links (user_id, label, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
      [userId, label, url, icon || null, sort_order || 0]
    );
    res.json({ id: result.insertId, label, url, icon: icon || null, sort_order: sort_order || 0 });
  } catch (error) { next(error); }
});

router.put('/custom-links/:linkId', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { label, url, icon, sort_order } = req.body;
    if (!label || !url) return res.status(400).json({ error: 'label and url are required' });
    await db.query(
      'UPDATE employee_custom_links SET label = ?, url = ?, icon = ?, sort_order = ? WHERE id = ? AND user_id = ?',
      [label, url, icon || null, sort_order || 0, req.params.linkId, userId]
    );
    res.json({ id: parseInt(req.params.linkId), label, url, icon: icon || null, sort_order: sort_order || 0 });
  } catch (error) { next(error); }
});

router.delete('/custom-links/:linkId', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await db.query(
      'DELETE FROM employee_custom_links WHERE id = ? AND user_id = ?',
      [req.params.linkId, userId]
    );
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── Documents (read-only — admin uploads, user can view & download) ──

router.get('/documents', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [docs] = await db.query(
      `SELECT ed.*, u.name AS uploader_name
       FROM employee_documents ed
       JOIN users u ON ed.uploaded_by = u.id
       WHERE ed.user_id = ?
       ORDER BY ed.created_at DESC`,
      [userId]
    );
    res.json(docs);
  } catch (error) { next(error); }
});

router.get('/documents/:docId/download-url', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [docs] = await db.query(
      'SELECT file_s3_key, file_name FROM employee_documents WHERE id = ? AND user_id = ?',
      [req.params.docId, userId]
    );
    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });
    const downloadUrl = await getDownloadUrl(BUCKETS.media, docs[0].file_s3_key);
    res.json({ downloadUrl, fileName: docs[0].file_name, expiresIn: 900 });
  } catch (error) { next(error); }
});

// ── Column Display Preferences ──────────────────
// Users can choose which columns to show/hide per section (pipeline, pre_approvals, funded_loans).
// Stored as a JSON object in user_preferences table keyed by user_id + preference_key.

router.get('/display-preferences', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [rows] = await db.query(
      "SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ? AND preference_key LIKE 'display_columns_%'",
      [userId]
    );
    const prefs = {};
    for (const row of rows) {
      try { prefs[row.preference_key] = JSON.parse(row.preference_value); }
      catch { prefs[row.preference_key] = row.preference_value; }
    }
    res.json(prefs);
  } catch (error) { next(error); }
});

router.put('/display-preferences', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { section, columns } = req.body;

    const validSections = ['pipeline', 'pre_approvals', 'funded_loans'];
    if (!validSections.includes(section)) {
      return res.status(400).json({ error: 'Invalid section. Must be: pipeline, pre_approvals, or funded_loans' });
    }
    if (!Array.isArray(columns)) {
      return res.status(400).json({ error: 'columns must be an array of { field, visible, order }' });
    }

    const prefKey = `display_columns_${section}`;
    const prefValue = JSON.stringify(columns);

    await db.query(
      `INSERT INTO user_preferences (user_id, preference_key, preference_value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE preference_value = ?, updated_at = NOW()`,
      [userId, prefKey, prefValue, prefValue]
    );

    res.json({ success: true, section, columns });
  } catch (error) { next(error); }
});

module.exports = router;
