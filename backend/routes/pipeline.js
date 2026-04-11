// Pipeline API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const logger = require('../lib/logger');
const { getDbUser, getUserId, getUserRole, hasRole, isAdmin, requireDbUser } = require('../middleware/userContext');
const { pipelineUpdate, validate } = require('../validation/schemas');
const { buildUpdate } = require('../utils/queryBuilder');
const { deleted } = require('../utils/response');
const { getAccessibleBoardIds, getProcessorLOIds } = require('../utils/boardAccess');

router.use(requireDbUser);

// GET /api/pipeline - Get all pipeline items (optionally filtered)
router.get('/', async (req, res, next) => {
  try {
    const { stage, status, investor_id, investor } = req.query;
    const role = getUserRole(req);
    const userId = getUserId(req);
    const dbUser = getDbUser(req);

    let query = 'SELECT p.* FROM pipeline p WHERE 1=1';
    const params = [];

    if (hasRole(req, 'admin', 'manager')) {
      // Admin/Manager: see all pipeline items
    } else if (role === 'processor') {
      // Processor: see loans from assigned LOs + accessible boards
      const loIds = await getProcessorLOIds(userId);
      const boardIds = await getAccessibleBoardIds(userId);
      const conditions = [];
      if (loIds.length > 0) {
        conditions.push(`p.assigned_lo_id IN (${loIds.map(() => '?').join(',')})`);
        params.push(...loIds);
      }
      if (boardIds.length > 0) {
        conditions.push(`p.source_board_id IN (${boardIds.map(() => '?').join(',')})`);
        params.push(...boardIds);
      }
      if (conditions.length === 0) {
        return res.json([]);
      }
      query += ` AND (${conditions.join(' OR ')})`;
    } else {
      // LO (or any non-admin/non-manager/non-processor):
      //   1. See ALL items on boards they have explicit access to
      //   2. See items assigned to them (by ID) from any board
      //   3. See items assigned to them (by name fallback) from any board
      const boardIds = await getAccessibleBoardIds(userId);
      const loConditions = [];

      if (boardIds.length > 0) {
        loConditions.push(`p.source_board_id IN (${boardIds.map(() => '?').join(',')})`);
        params.push(...boardIds);
      }
      loConditions.push('p.assigned_lo_id = ?');
      params.push(userId);
      if (dbUser?.name) {
        loConditions.push('(p.assigned_lo_id IS NULL AND LOWER(TRIM(p.assigned_lo_name)) = LOWER(TRIM(?)))');
        params.push(dbUser.name);
      }
      query += ` AND (${loConditions.join(' OR ')})`;

      logger.debug({
        userId,
        userName: dbUser?.name,
        role,
        boardIds,
      }, 'Pipeline: LO filtering applied');
    }

    if (stage) {
      query += ' AND p.stage = ?';
      params.push(stage);
    }
    if (status) {
      query += ' AND p.status = ?';
      params.push(status);
    }
    if (investor_id) {
      query += ' AND p.investor_id = ?';
      params.push(investor_id);
    }
    if (investor) {
      query += ' AND p.investor = ?';
      params.push(investor);
    }

    query += ' ORDER BY p.target_close_date, p.created_at DESC';

    const [pipeline] = await db.query(query, params);
    res.json(pipeline);
  } catch (error) {
    next(error);
  }
});

// GET /api/pipeline/summary - Get summary stats (units + volume)
router.get('/summary', async (req, res, next) => {
  try {
    const { lo_id } = req.query;
    const role = getUserRole(req);
    const userId = getUserId(req);
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (hasRole(req, 'admin', 'manager')) {
      // Admin/Manager can filter by specific LO for goals view
      if (lo_id) {
        whereClause += ' AND assigned_lo_id = ?';
        params.push(lo_id);
      }
    } else if (role === 'processor') {
      const loIds = await getProcessorLOIds(userId);
      const boardIds = await getAccessibleBoardIds(userId);
      const conditions = [];
      if (loIds.length > 0) {
        conditions.push(`assigned_lo_id IN (${loIds.map(() => '?').join(',')})`);
        params.push(...loIds);
      }
      if (boardIds.length > 0) {
        conditions.push(`source_board_id IN (${boardIds.map(() => '?').join(',')})`);
        params.push(...boardIds);
      }
      if (conditions.length === 0) {
        return res.json({ units: 0, total_amount: 0 });
      }
      whereClause += ` AND (${conditions.join(' OR ')})`;
    } else {
      const dbUser = getDbUser(req);
      const boardIds = await getAccessibleBoardIds(userId);
      const loConditions = [];
      if (boardIds.length > 0) {
        loConditions.push(`source_board_id IN (${boardIds.map(() => '?').join(',')})`);
        params.push(...boardIds);
      }
      loConditions.push('assigned_lo_id = ?');
      params.push(userId);
      if (dbUser?.name) {
        loConditions.push('(assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?)))');
        params.push(dbUser.name);
      }
      whereClause += ` AND (${loConditions.join(' OR ')})`;
    }

    const [summary] = await db.query(
      `SELECT
        COUNT(*) as units,
        COALESCE(SUM(loan_amount), 0) as total_amount
       FROM pipeline
       ${whereClause}`,
      params
    );

    res.json({
      units: summary[0].units,
      total_amount: parseFloat(summary[0].total_amount) || 0,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/pipeline/debug/lo-identity — Admin diagnostic: show how a user is resolved for LO filtering
router.get('/debug/lo-identity', async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });

    const targetUserId = req.query.user_id ? parseInt(req.query.user_id) : getUserId(req);
    const [users] = await db.query('SELECT id, name, email, role FROM users WHERE id = ?', [targetUserId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    const role = req.query.user_id ? user.role : getUserRole(req);

    // Count items matching by ID
    const [byId] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE assigned_lo_id = ?', [user.id]);
    const [byNameExact] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE assigned_lo_id IS NULL AND assigned_lo_name = ?', [user.name]);
    const [byNameLower] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?))', [user.name]);
    const [nullLoId] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE assigned_lo_id IS NULL');
    const [totalItems] = await db.query('SELECT COUNT(*) as cnt FROM pipeline');

    // Same for pre-approvals
    const [paById] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals WHERE assigned_lo_id = ?', [user.id]);
    const [paByName] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals WHERE assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?))', [user.name]);
    const [paTotal] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals');

    // Same for funded-loans
    const [flById] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans WHERE assigned_lo_id = ?', [user.id]);
    const [flByName] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans WHERE assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?))', [user.name]);
    const [flTotal] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans');

    // Board access
    const [boardAccess] = await db.query(
      `SELECT ba.board_id, mb.board_name, mb.target_section
       FROM monday_board_access ba
       LEFT JOIN monday_boards mb ON ba.board_id = mb.board_id
       WHERE ba.user_id = ?`,
      [user.id]
    );

    // Sample unresolved names (items with assigned_lo_name but NULL assigned_lo_id)
    const [unresolvedPipeline] = await db.query(
      'SELECT DISTINCT assigned_lo_name FROM pipeline WHERE assigned_lo_id IS NULL AND assigned_lo_name IS NOT NULL LIMIT 20'
    );
    const [unresolvedPA] = await db.query(
      'SELECT DISTINCT assigned_lo_name FROM pre_approvals WHERE assigned_lo_id IS NULL AND assigned_lo_name IS NOT NULL LIMIT 20'
    );
    const [unresolvedFL] = await db.query(
      'SELECT DISTINCT assigned_lo_name FROM funded_loans WHERE assigned_lo_id IS NULL AND assigned_lo_name IS NOT NULL LIMIT 20'
    );

    res.json({
      user: { id: user.id, name: user.name, email: user.email, dbRole: user.role, activeRole: role },
      pipeline: {
        matchedById: byId[0].cnt,
        matchedByNameExact: byNameExact[0].cnt,
        matchedByNameLower: byNameLower[0].cnt,
        nullLoIdItems: nullLoId[0].cnt,
        totalItems: totalItems[0].cnt,
        wouldSee: byId[0].cnt + byNameLower[0].cnt,
      },
      preApprovals: {
        matchedById: paById[0].cnt,
        matchedByNameLower: paByName[0].cnt,
        totalItems: paTotal[0].cnt,
        wouldSee: paById[0].cnt + paByName[0].cnt,
      },
      fundedLoans: {
        matchedById: flById[0].cnt,
        matchedByNameLower: flByName[0].cnt,
        totalItems: flTotal[0].cnt,
        wouldSee: flById[0].cnt + flByName[0].cnt,
      },
      boardAccess,
      unresolvedNames: {
        pipeline: unresolvedPipeline.map(r => r.assigned_lo_name),
        preApprovals: unresolvedPA.map(r => r.assigned_lo_name),
        fundedLoans: unresolvedFL.map(r => r.assigned_lo_name),
      },
    });
  } catch (error) { next(error); }
});

// GET /api/pipeline/:id - Get specific pipeline item
router.get('/:id', async (req, res, next) => {
  try {
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [req.params.id]);

    if (pipeline.length === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }

    const currentUserId = getUserId(req);
    if (!hasRole(req, 'admin', 'manager') && pipeline[0].assigned_lo_id !== currentUserId) {
      // Processors can also access if the LO is assigned to them
      if (getUserRole(req) === 'processor') {
        const loIds = await getProcessorLOIds(currentUserId);
        if (!loIds.includes(pipeline[0].assigned_lo_id)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(pipeline[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/pipeline - Create new pipeline item
router.post('/', async (req, res, next) => {
  try {
    const { client_name, loan_amount, loan_type, stage, target_close_date, assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes } = req.body;
    
    if (!client_name || !loan_amount || !stage) {
      return res.status(400).json({ error: 'client_name, loan_amount, and stage are required' });
    }
    
    const dbUser = getDbUser(req);
    const currentUserId = getUserId(req);
    const finalAssignedLoId = isAdmin(req) ? (assigned_lo_id || currentUserId) : currentUserId;
    const finalAssignedLoName = isAdmin(req) ? (assigned_lo_name || dbUser?.name || null) : (dbUser?.name || null);
    
    const [result] = await db.query(
      `INSERT INTO pipeline 
       (client_name, loan_amount, loan_type, stage, target_close_date, assigned_lo_id, assigned_lo_name, investor, investor_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_name, loan_amount, loan_type || null, stage, target_close_date || null, finalAssignedLoId, finalAssignedLoName, investor || null, investor_id || null, status || 'On Track', notes || null]
    );
    
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [result.insertId]);
    res.status(201).json(pipeline[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/pipeline/:id - Update pipeline item
router.put('/:id', validate(pipelineUpdate), async (req, res, next) => {
  try {
    const { assigned_lo_id } = req.body;

    // Access control for assigned_lo_id
    if (assigned_lo_id !== undefined) {
      if (!isAdmin(req) && assigned_lo_id !== getUserId(req)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const PIPELINE_FIELDS = [
      'client_name', 'loan_amount', 'loan_type', 'stage', 'target_close_date',
      'assigned_lo_id', 'assigned_lo_name', 'lo_display', 'investor', 'investor_id', 'status', 'notes',
      'loan_number', 'loan_status', 'lender', 'subject_property', 'rate',
      'appraisal_status', 'loan_purpose', 'occupancy', 'title_status', 'hoi_status',
      'loan_estimate', 'application_date', 'lock_expiration_date', 'closing_date', 'funding_date',
      'prelims_status', 'mini_set_status', 'cd_status',
    ];

    const update = buildUpdate('pipeline', PIPELINE_FIELDS, req.body, { clause: 'id = ?', values: [req.params.id] });

    if (!update) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await db.query(update.sql, update.values);
    
    const [pipeline] = await db.query('SELECT * FROM pipeline WHERE id = ?', [req.params.id]);
    res.json(pipeline[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pipeline/:id - Delete pipeline item
router.delete('/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT assigned_lo_id FROM pipeline WHERE id = ?', [req.params.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }
    
    if (!hasRole(req, 'admin', 'manager') && existing[0].assigned_lo_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const [result] = await db.query('DELETE FROM pipeline WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Pipeline item not found' });
    }
    
    deleted(res, 'Pipeline item deleted');
  } catch (error) {
    next(error);
  }
});

// ========================================
// PIPELINE NOTES
// ========================================

// GET /api/pipeline/:id/notes
router.get('/:id/notes', async (req, res, next) => {
  try {
    const [notes] = await db.query(
      'SELECT * FROM pipeline_notes WHERE pipeline_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(notes);
  } catch (error) {
    next(error);
  }
});

// POST /api/pipeline/:id/notes
router.post('/:id/notes', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    const userId = getUserId(req);
    const dbUser = getDbUser(req);
    const authorName = dbUser?.name || 'Unknown';

    const [result] = await db.query(
      'INSERT INTO pipeline_notes (pipeline_id, author_id, author_name, content) VALUES (?, ?, ?, ?)',
      [req.params.id, userId, authorName, content.trim()]
    );
    const [note] = await db.query('SELECT * FROM pipeline_notes WHERE id = ?', [result.insertId]);
    res.status(201).json(note[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/pipeline/:id/notes/:noteId
router.put('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    const [existing] = await db.query('SELECT * FROM pipeline_notes WHERE id = ? AND pipeline_id = ?', [req.params.noteId, req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can edit this note' });
    }

    await db.query('UPDATE pipeline_notes SET content = ? WHERE id = ?', [content.trim(), req.params.noteId]);
    const [updated] = await db.query('SELECT * FROM pipeline_notes WHERE id = ?', [req.params.noteId]);
    res.json(updated[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pipeline/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM pipeline_notes WHERE id = ? AND pipeline_id = ?', [req.params.noteId, req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can delete this note' });
    }

    await db.query('DELETE FROM pipeline_notes WHERE id = ?', [req.params.noteId]);
    res.json({ message: 'Note deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

