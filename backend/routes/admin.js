// Admin API Routes — User management, file uploads, system settings
// All endpoints require admin role

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isAdmin } = require('../middleware/userContext');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { encrypt, decrypt, mask } = require('../utils/encryption');

// S3 client for forms library uploads (us-east-1)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

// S3 client for msfg-media bucket (us-west-2) — avatars, employee documents
const s3West = new S3Client({ region: 'us-west-2' });
const MEDIA_BUCKET = 'msfg-media';

const FORMS_BUCKET = 'msfg-mortgage-documents-prod';

// ========================================
// ADMIN GUARD — applied to all routes
// ========================================
router.use((req, res, next) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// ========================================
// GET /api/admin/users — List all users
// ========================================
router.get('/users', async (req, res, next) => {
  try {
    const [users] = await db.query(
      `SELECT id, cognito_sub, email, name, initials, role,
              is_active, created_at, updated_at
       FROM users
       ORDER BY name`
    );
    res.json(users);
  } catch (error) {
    next(error);
  }
});

// ========================================
// GET /api/admin/users/:id — Get single user
// ========================================
router.get('/users/:id', async (req, res, next) => {
  try {
    const [users] = await db.query(
      'SELECT * FROM users WHERE id = ?',
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(users[0]);
  } catch (error) {
    next(error);
  }
});

// ========================================
// POST /api/admin/users — Create user
// ========================================
router.post('/users', async (req, res, next) => {
  try {
    const { email, name, initials, role } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'email and name are required' });
    }

    // Check for duplicate email
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const userInitials = initials || name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const userRole = role || 'user';

    const [result] = await db.query(
      `INSERT INTO users (email, name, initials, role, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [email, name, userInitials, userRole]
    );

    res.status(201).json({
      id: result.insertId,
      email,
      name,
      initials: userInitials,
      role: userRole,
      is_active: 1,
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// PUT /api/admin/users/:id — Update user
// ========================================
router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, initials, role, is_active } = req.body;
    const userId = req.params.id;

    // Build dynamic SET clause
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (initials !== undefined) { updates.push('initials = ?'); params.push(initials); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(userId);

    await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    // Return updated user
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    res.json(users[0]);
  } catch (error) {
    next(error);
  }
});

// ========================================
// DELETE /api/admin/users/:id — Deactivate user
// (soft delete — sets is_active = 0)
// ========================================
router.delete('/users/:id', async (req, res, next) => {
  try {
    const userId = req.params.id;

    // Prevent admin from deactivating themselves
    const currentUserId = req.user?.db?.id;
    if (String(userId) === String(currentUserId)) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    await db.query(
      'UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?',
      [userId]
    );

    res.json({ success: true, message: 'User deactivated' });
  } catch (error) {
    next(error);
  }
});

// ========================================
// POST /api/admin/files/upload-url
// Generate presigned PUT URL for forms library
// ========================================
router.post('/files/upload-url', async (req, res, next) => {
  try {
    const { fileName, fileType, folder } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    // Sanitize folder path
    const safeFolderRaw = (folder || '').replace(/\.\./g, '').replace(/^\//, '');
    const safeFolder = safeFolderRaw ? safeFolderRaw.replace(/\/?$/, '/') : '';
    const fileKey = safeFolder + fileName;

    const command = new PutObjectCommand({
      Bucket: FORMS_BUCKET,
      Key: fileKey,
      ContentType: fileType || 'application/octet-stream',
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({
      uploadUrl: url,
      fileKey,
      bucket: FORMS_BUCKET,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Error generating admin upload URL:', error);
    next(error);
  }
});

// ========================================
// EMPLOYEE PROFILE
// ========================================

// GET /api/admin/users/:id/profile — Full profile with avatar URL + AI key status
router.get('/users/:id/profile', async (req, res, next) => {
  try {
    const userId = req.params.id;

    // Get profile (may not exist yet)
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
        const cmd = new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: profile.avatar_s3_key });
        avatar_url = await getSignedUrl(s3West, cmd, { expiresIn: 900 });
      } catch (e) {
        console.warn('Avatar URL generation failed:', e.message);
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

// PUT /api/admin/users/:id/profile — Upsert profile fields
router.put('/users/:id/profile', async (req, res, next) => {
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

    // Upsert: insert if not exists, update if exists
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

    // Return updated profile
    const [profiles] = await db.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
    res.json(profiles[0] || {});
  } catch (error) {
    next(error);
  }
});

// ========================================
// AVATAR UPLOAD
// ========================================

// POST /api/admin/users/:id/avatar/upload-url
router.post('/users/:id/avatar/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !fileType.startsWith('image/')) {
      return res.status(400).json({ error: 'File must be an image' });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `employee-avatars/${userId}/${Date.now()}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: fileKey,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3West, command, { expiresIn: 3600 });

    res.json({ uploadUrl, fileKey, bucket: MEDIA_BUCKET, expiresIn: 3600 });
  } catch (error) {
    next(error);
  }
});

// PUT /api/admin/users/:id/avatar/confirm — Save S3 key after upload
router.put('/users/:id/avatar/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    // Get old avatar key for cleanup
    const [old] = await db.query('SELECT avatar_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const oldKey = old[0]?.avatar_s3_key;

    // Upsert avatar key
    await db.query(
      `INSERT INTO user_profiles (user_id, avatar_s3_key) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE avatar_s3_key = ?`,
      [userId, fileKey, fileKey]
    );

    // Delete old avatar from S3 (best effort)
    if (oldKey && oldKey !== fileKey) {
      try {
        await s3West.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: oldKey }));
      } catch (e) { console.warn('Old avatar cleanup failed:', e.message); }
    }

    res.json({ success: true, fileKey });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/users/:id/avatar
router.delete('/users/:id/avatar', async (req, res, next) => {
  try {
    const userId = req.params.id;

    const [rows] = await db.query('SELECT avatar_s3_key FROM user_profiles WHERE user_id = ?', [userId]);
    const key = rows[0]?.avatar_s3_key;

    if (key) {
      try {
        await s3West.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
      } catch (e) { console.warn('Avatar delete failed:', e.message); }
    }

    await db.query('UPDATE user_profiles SET avatar_s3_key = NULL WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// EMPLOYEE NOTES
// ========================================

// GET /api/admin/users/:id/notes
router.get('/users/:id/notes', async (req, res, next) => {
  try {
    const [notes] = await db.query(
      `SELECT en.*, u.name AS author_name
       FROM employee_notes en
       JOIN users u ON en.author_id = u.id
       WHERE en.user_id = ?
       ORDER BY en.created_at DESC`,
      [req.params.id]
    );
    res.json(notes);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:id/notes
router.post('/users/:id/notes', async (req, res, next) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const authorId = req.user?.db?.id;
    if (!authorId) return res.status(400).json({ error: 'Could not determine author' });

    const [result] = await db.query(
      'INSERT INTO employee_notes (user_id, author_id, note) VALUES (?, ?, ?)',
      [req.params.id, authorId, note.trim()]
    );

    // Return the created note with author name
    const [notes] = await db.query(
      `SELECT en.*, u.name AS author_name
       FROM employee_notes en JOIN users u ON en.author_id = u.id
       WHERE en.id = ?`,
      [result.insertId]
    );

    res.status(201).json(notes[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/users/:id/notes/:noteId
router.delete('/users/:id/notes/:noteId', async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM employee_notes WHERE id = ? AND user_id = ?',
      [req.params.noteId, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// EMPLOYEE DOCUMENTS
// ========================================

// GET /api/admin/users/:id/documents
router.get('/users/:id/documents', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      `SELECT ed.*, u.name AS uploader_name
       FROM employee_documents ed
       JOIN users u ON ed.uploaded_by = u.id
       WHERE ed.user_id = ?
       ORDER BY ed.created_at DESC`,
      [req.params.id]
    );
    res.json(docs);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:id/documents/upload-url
router.post('/users/:id/documents/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `employee-documents/${userId}/${Date.now()}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: fileKey,
      ContentType: fileType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(s3West, command, { expiresIn: 3600 });

    res.json({ uploadUrl, fileKey, bucket: MEDIA_BUCKET, expiresIn: 3600 });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:id/documents/confirm
router.post('/users/:id/documents/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey, fileName, fileType, fileSize, category, description } = req.body;
    const uploadedBy = req.user?.db?.id;

    if (!fileKey || !fileName) {
      return res.status(400).json({ error: 'fileKey and fileName are required' });
    }

    const [result] = await db.query(
      `INSERT INTO employee_documents (user_id, file_name, file_s3_key, file_size, file_type, category, description, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, fileName, fileKey, fileSize || null, fileType || null, category || null, description || null, uploadedBy]
    );

    // Return created record
    const [docs] = await db.query(
      `SELECT ed.*, u.name AS uploader_name
       FROM employee_documents ed JOIN users u ON ed.uploaded_by = u.id
       WHERE ed.id = ?`,
      [result.insertId]
    );

    res.status(201).json(docs[0]);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/users/:id/documents/:docId/download-url
router.get('/users/:id/documents/:docId/download-url', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      'SELECT file_s3_key, file_name FROM employee_documents WHERE id = ? AND user_id = ?',
      [req.params.docId, req.params.id]
    );

    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });

    const cmd = new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: docs[0].file_s3_key });
    const downloadUrl = await getSignedUrl(s3West, cmd, { expiresIn: 900 });

    res.json({ downloadUrl, fileName: docs[0].file_name, expiresIn: 900 });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/users/:id/documents/:docId
router.delete('/users/:id/documents/:docId', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      'SELECT file_s3_key FROM employee_documents WHERE id = ? AND user_id = ?',
      [req.params.docId, req.params.id]
    );

    if (docs.length > 0 && docs[0].file_s3_key) {
      try {
        await s3West.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: docs[0].file_s3_key }));
      } catch (e) { console.warn('Doc delete from S3 failed:', e.message); }
    }

    await db.query('DELETE FROM employee_documents WHERE id = ? AND user_id = ?', [req.params.docId, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// AI API KEY MANAGEMENT (admin-managed, per-user)
// ========================================

// GET /api/admin/users/:id/integrations — AI key status
router.get('/users/:id/integrations', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, service, credential_type, encrypted_value, iv, auth_tag, is_active
       FROM user_integrations
       WHERE user_id = ? AND service IN ('openai', 'anthropic')`,
      [req.params.id]
    );

    const integrations = [];
    for (const row of rows) {
      let maskedValue = '••••••••';
      try {
        const plaintext = decrypt(row.encrypted_value, row.iv, row.auth_tag);
        maskedValue = mask(plaintext);
      } catch { /* ignore decryption failures */ }
      integrations.push({ service: row.service, maskedValue, is_active: row.is_active });
    }

    res.json(integrations);
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/users/:id/integrations — Save AI key
router.post('/users/:id/integrations', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { service, value } = req.body;

    if (!service || !['openai', 'anthropic'].includes(service)) {
      return res.status(400).json({ error: 'service must be openai or anthropic' });
    }
    if (!value || !value.trim()) {
      return res.status(400).json({ error: 'value is required' });
    }

    const { encrypted, iv, authTag } = encrypt(value.trim());

    await db.query(
      `INSERT INTO user_integrations (user_id, service, credential_type, encrypted_value, iv, auth_tag)
       VALUES (?, ?, 'api_key', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         encrypted_value = VALUES(encrypted_value),
         iv = VALUES(iv),
         auth_tag = VALUES(auth_tag),
         is_active = TRUE,
         updated_at = NOW()`,
      [userId, service, encrypted, iv, authTag]
    );

    res.json({ success: true, service, maskedValue: mask(value.trim()) });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/users/:id/integrations/:service — Clear AI key
router.delete('/users/:id/integrations/:service', async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM user_integrations WHERE user_id = ? AND service = ?',
      [req.params.id, req.params.service]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// GET /api/admin/system — System info
// ========================================
router.get('/system', async (req, res, next) => {
  try {
    // Check DB connection
    const [dbCheck] = await db.query('SELECT 1 as ok');
    const dbOk = dbCheck && dbCheck[0]?.ok === 1;

    // Get user count
    const [userCount] = await db.query('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
    const [investorCount] = await db.query('SELECT COUNT(*) as count FROM investors');

    res.json({
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: dbOk ? 'connected' : 'error',
      activeUsers: userCount[0]?.count || 0,
      totalInvestors: investorCount[0]?.count || 0,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
