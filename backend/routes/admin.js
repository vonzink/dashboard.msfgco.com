// Admin API Routes — User management, file uploads, system settings
// All endpoints require admin role

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isAdmin } = require('../middleware/userContext');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

// S3 client for forms library uploads (us-east-1)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

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
