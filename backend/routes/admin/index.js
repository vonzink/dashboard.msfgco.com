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

// ── Processor-LO Assignments (admin-only) ───────
router.get('/processor-assignments', requireAdmin, async (req, res, next) => {
  try {
    // Get all processors (by role)
    const [processors] = await db.query(
      `SELECT id, name, email, role FROM users
       WHERE LOWER(role) IN ('processor') AND is_active = 1
       ORDER BY name`
    );

    // Get ALL active employees as assignable options (not just LOs)
    const [los] = await db.query(
      `SELECT id, name, email, role FROM users
       WHERE is_active = 1
       ORDER BY name`
    );

    // Get current assignments
    const [assignments] = await db.query(
      `SELECT pla.id, pla.processor_user_id, pla.lo_user_id,
              p.name as processor_name, lo.name as lo_name
       FROM processor_lo_assignments pla
       JOIN users p ON pla.processor_user_id = p.id
       JOIN users lo ON pla.lo_user_id = lo.id
       ORDER BY p.name, lo.name`
    );

    res.json({ processors, los, assignments });
  } catch (error) {
    next(error);
  }
});

router.put('/processor-assignments/:processorId', requireAdmin, async (req, res, next) => {
  try {
    const { processorId } = req.params;
    const { lo_ids } = req.body;

    if (!Array.isArray(lo_ids)) {
      return res.status(400).json({ error: 'lo_ids must be an array' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Remove existing assignments for this processor
      await connection.query(
        'DELETE FROM processor_lo_assignments WHERE processor_user_id = ?',
        [processorId]
      );

      // Insert new assignments
      for (const loId of lo_ids) {
        await connection.query(
          'INSERT INTO processor_lo_assignments (processor_user_id, lo_user_id) VALUES (?, ?)',
          [processorId, loId]
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    res.json({ success: true, message: `Updated ${lo_ids.length} LO assignments` });
  } catch (error) {
    next(error);
  }
});

// ── Manager → LO assignments (mirrors processor-assignments) ──────
router.get('/manager-assignments', requireAdmin, async (req, res, next) => {
  try {
    // Get all managers (by role)
    const [managers] = await db.query(
      `SELECT id, name, email, role FROM users
       WHERE LOWER(role) IN ('manager') AND is_active = 1
       ORDER BY name`
    );

    // Get ALL active employees as assignable options (not just LOs)
    const [los] = await db.query(
      `SELECT id, name, email, role FROM users
       WHERE is_active = 1
       ORDER BY name`
    );

    // Get current assignments
    const [assignments] = await db.query(
      `SELECT mla.id, mla.manager_user_id, mla.lo_user_id,
              m.name as manager_name, lo.name as lo_name
       FROM manager_lo_assignments mla
       JOIN users m ON mla.manager_user_id = m.id
       JOIN users lo ON mla.lo_user_id = lo.id
       ORDER BY m.name, lo.name`
    );

    res.json({ managers, los, assignments });
  } catch (error) {
    next(error);
  }
});

router.put('/manager-assignments/:managerId', requireAdmin, async (req, res, next) => {
  try {
    const { managerId } = req.params;
    const { lo_ids } = req.body;

    if (!Array.isArray(lo_ids)) {
      return res.status(400).json({ error: 'lo_ids must be an array' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Remove existing assignments for this manager
      await connection.query(
        'DELETE FROM manager_lo_assignments WHERE manager_user_id = ?',
        [managerId]
      );

      // Insert new assignments
      for (const loId of lo_ids) {
        await connection.query(
          'INSERT INTO manager_lo_assignments (manager_user_id, lo_user_id) VALUES (?, ?)',
          [managerId, loId]
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    res.json({ success: true, message: `Updated ${lo_ids.length} LO assignments` });
  } catch (error) {
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
