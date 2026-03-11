// Admin API — aggregated sub-routers
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { requireDbUser, requireAdmin, requireManagerOrAdmin } = require('../../middleware/userContext');
const { BUCKETS, getUploadUrl, buildFormsKey } = require('../../services/s3');
const logger = require('../../lib/logger');

// ── Guards — applied to all admin routes ────────
router.use(requireDbUser);

// ── Sub-routers ─────────────────────────────────
// Users CRUD — admin only
router.use('/users', requireAdmin, require('./users'));
// Profiles, notes, documents — managers + admins
router.use('/users', requireManagerOrAdmin, require('./profiles'));
router.use('/users', requireManagerOrAdmin, require('./notes'));
router.use('/users', requireManagerOrAdmin, require('./documents'));

// ── Forms library upload (admin-only) ───────────
router.post('/files/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const { fileName, fileType, folder } = req.body;
    if (!fileName) return res.status(400).json({ error: 'fileName is required' });

    const fileKey = buildFormsKey(fileName, folder);
    const result = await getUploadUrl(BUCKETS.forms, fileKey, fileType || 'application/octet-stream');
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Error generating admin upload URL');
    next(error);
  }
});

// ── System info ─────────────────────────────────
router.get('/system', requireAdmin, async (req, res, next) => {
  try {
    const [dbCheck] = await db.query('SELECT 1 as ok');
    const dbOk = dbCheck && dbCheck[0]?.ok === 1;

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
