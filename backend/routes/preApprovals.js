// Pre-Approvals API routes
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getDbUser, getUserId, hasRole, isAdmin, requireDbUser } = require('../middleware/userContext');
const { preApproval, preApprovalUpdate, validate } = require('../validation/schemas');
const logger = require('../lib/logger');
const { getMondayToken } = require('../services/monday/sync');
const { createPreApproval, updatePreApproval, archivePreApproval } = require('../services/monday/writer');

const { getAccessibleBoardIds } = require('../utils/boardAccess');

router.use(requireDbUser);

// GET /api/pre-approvals - Get all pre-approvals (filtered by board access)
router.get('/', async (req, res, next) => {
  try {
    const { status, loan_type, board_id, group } = req.query;

    let query = `SELECT pa.*, mb.board_name as source_board_name
                 FROM pre_approvals pa
                 LEFT JOIN monday_boards mb ON pa.source_board_id = mb.board_id
                 WHERE 1=1`;
    const params = [];

    if (!isAdmin(req) && !hasRole(req, 'manager')) {
      // Non-admin/manager: only see pre-approvals from boards they have access to
      const boardIds = await getAccessibleBoardIds(getUserId(req));
      if (boardIds.length === 0) {
        return res.json({ data: [], boards: [], groups: [] });
      }
      query += ` AND pa.source_board_id IN (${boardIds.map(() => '?').join(',')})`;
      params.push(...boardIds);

      // LO: further restrict to only their own pre-approvals
      if (hasRole(req, 'lo')) {
        query += ' AND pa.assigned_lo_id = ?';
        params.push(getUserId(req));
      }
    }

    // Optional board filter
    if (board_id) {
      query += ' AND pa.source_board_id = ?';
      params.push(board_id);
    }

    // Optional group filter
    if (group) {
      query += ' AND pa.group_name = ?';
      params.push(group);
    }

    if (status) {
      query += ' AND pa.status = ?';
      params.push(status);
    }
    if (loan_type) {
      query += ' AND pa.loan_type = ?';
      params.push(loan_type);
    }

    query += ' ORDER BY pa.pre_approval_date DESC, pa.expiration_date';

    const [preApprovals] = await db.query(query, params);

    // Get available boards for filter dropdown
    let boardQuery, boardParams;
    if (isAdmin(req)) {
      boardQuery = `SELECT DISTINCT mb.board_id, mb.board_name
                    FROM monday_boards mb
                    WHERE mb.is_active = 1 AND mb.target_section = 'pre_approvals'
                    ORDER BY mb.board_name`;
      boardParams = [];
    } else {
      const boardIds = await getAccessibleBoardIds(getUserId(req));
      if (boardIds.length === 0) {
        return res.json({ data: preApprovals, boards: [], groups: [] });
      }
      boardQuery = `SELECT DISTINCT mb.board_id, mb.board_name
                    FROM monday_boards mb
                    JOIN monday_board_access ba ON mb.board_id = ba.board_id
                    WHERE mb.is_active = 1 AND mb.target_section = 'pre_approvals' AND ba.user_id = ?
                    ORDER BY mb.board_name`;
      boardParams = [getUserId(req)];
    }
    const [boards] = await db.query(boardQuery, boardParams);

    // Get available groups for filter dropdown — scoped to selected board
    let groupQuery = `SELECT DISTINCT group_name FROM pre_approvals
       WHERE group_name IS NOT NULL AND group_name != ''`;
    const groupParams = [];

    if (board_id) {
      // When a specific board is selected, only show groups from that board
      groupQuery += ' AND source_board_id = ?';
      groupParams.push(board_id);
    } else if (!isAdmin(req)) {
      // No board selected: scope to accessible boards for non-admins
      const accessibleIds = await getAccessibleBoardIds(getUserId(req));
      if (accessibleIds.length > 0) {
        groupQuery += ` AND source_board_id IN (${accessibleIds.map(() => '?').join(',')})`;
        groupParams.push(...accessibleIds);
      }
    }
    groupQuery += ' ORDER BY group_name';
    const [groupRows] = await db.query(groupQuery, groupParams);
    const groups = groupRows.map(r => r.group_name);

    res.json({ data: preApprovals, boards, groups });
  } catch (error) {
    next(error);
  }
});

// GET /api/pre-approvals/summary - Get summary stats (units + volume)
router.get('/summary', async (req, res, next) => {
  try {
    const { lo_id } = req.query;
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (hasRole(req, 'admin', 'manager')) {
      // Admin/Manager can filter by specific LO for goals view
      if (lo_id) {
        whereClause += ' AND assigned_lo_id = ?';
        params.push(lo_id);
      }
    } else if (!isAdmin(req)) {
      const boardIds = await getAccessibleBoardIds(getUserId(req));
      if (boardIds.length === 0) {
        return res.json({ units: 0, total_amount: 0, active_count: 0 });
      }
      whereClause += ` AND source_board_id IN (${boardIds.map(() => '?').join(',')})`;
      params.push(...boardIds);

      // LO: further restrict to only their own pre-approvals
      if (hasRole(req, 'lo')) {
        whereClause += ' AND assigned_lo_id = ?';
        params.push(getUserId(req));
      }
    }

    const [summary] = await db.query(
      `SELECT
        COUNT(*) as units,
        COALESCE(SUM(loan_amount), 0) as total_amount,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
       FROM pre_approvals
       ${whereClause}`,
      params
    );

    res.json({
      units: summary[0].units,
      total_amount: parseFloat(summary[0].total_amount) || 0,
      active_count: summary[0].active_count || 0,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/pre-approvals/:id - Get specific pre-approval
router.get('/:id', async (req, res, next) => {
  try {
    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);

    if (preApprovals.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }

    if (!isAdmin(req)) {
      const boardIds = await getAccessibleBoardIds(getUserId(req));
      if (!boardIds.includes(preApprovals[0].source_board_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(preApprovals[0]);
  } catch (error) {
    next(error);
  }
});

// POST /api/pre-approvals - Create new pre-approval (+ write-through to Monday.com)
router.post('/', validate(preApproval), async (req, res, next) => {
  try {
    const { client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes } = req.body;

    const dbUser = getDbUser(req);
    const currentUserId = getUserId(req);
    const finalAssignedLoId = isAdmin(req) ? (assigned_lo_id || currentUserId) : currentUserId;
    const finalAssignedLoName = isAdmin(req) ? (assigned_lo_name || dbUser?.name || null) : (dbUser?.name || null);
    const finalStatus = status || 'active';

    // Write-through to Monday.com (non-blocking — don't fail the request if Monday fails)
    let mondayItemId = null;
    let sourceBoardId = null;
    try {
      const token = await getMondayToken(currentUserId);
      if (token) {
        const mondayResult = await createPreApproval(token, finalAssignedLoId, {
          client_name,
          loan_amount,
          pre_approval_date,
          expiration_date,
          status: finalStatus,
          assigned_lo_name: finalAssignedLoName,
          property_address,
          loan_type,
          notes,
        });
        if (mondayResult) {
          mondayItemId = mondayResult.mondayItemId;
          sourceBoardId = mondayResult.boardId;
        }
      }
    } catch (mondayErr) {
      logger.warn({ err: mondayErr.message }, 'Monday.com write-through failed on create — saved to DB only');
    }

    const [result] = await db.query(
      `INSERT INTO pre_approvals
       (client_name, loan_amount, pre_approval_date, expiration_date, status, assigned_lo_id, assigned_lo_name, property_address, loan_type, notes, monday_item_id, source_board_id, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_name, loan_amount, pre_approval_date, expiration_date, finalStatus, finalAssignedLoId, finalAssignedLoName, property_address || null, loan_type || null, notes || null, mondayItemId, sourceBoardId, mondayItemId ? 'monday' : 'manual']
    );

    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [result.insertId]);
    res.status(201).json(preApprovals[0]);
  } catch (error) {
    next(error);
  }
});

// PUT /api/pre-approvals/:id - Update pre-approval (+ write-through to Monday.com)
router.put('/:id', validate(preApprovalUpdate), async (req, res, next) => {
  try {
    const updates = [];
    const values = [];

    if (req.body.assigned_lo_id !== undefined) {
      if (!isAdmin(req) && req.body.assigned_lo_id !== getUserId(req)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      updates.push('assigned_lo_id = ?');
      values.push(req.body.assigned_lo_id);
    }

    const updateableFields = [
      'client_name', 'loan_amount', 'pre_approval_date', 'expiration_date',
      'status', 'assigned_lo_name', 'property_address', 'loan_type', 'notes',
      'loan_number', 'lender', 'subject_property', 'loan_purpose', 'occupancy',
      'rate', 'credit_score', 'income', 'property_type', 'referring_agent',
      'referring_agent_email', 'referring_agent_phone', 'contact_date'
    ];

    for (const field of updateableFields) {
      if (req.body[field] !== undefined) {
        updates.push(`\`${field}\` = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Fetch current record before update (need monday_item_id + source_board_id)
    const [existing] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }

    values.push(req.params.id);

    await db.query(
      `UPDATE pre_approvals SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );

    // Write-through to Monday.com (non-blocking)
    try {
      const token = await getMondayToken(getUserId(req));
      if (token) {
        await updatePreApproval(token, existing[0], req.body);
      }
    } catch (mondayErr) {
      logger.warn({ err: mondayErr.message, id: req.params.id }, 'Monday.com write-through failed on update');
    }

    const [preApprovals] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);
    res.json(preApprovals[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/pre-approvals/:id - Delete pre-approval (+ archive on Monday.com)
router.delete('/:id', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM pre_approvals WHERE id = ?', [req.params.id]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }

    if (!isAdmin(req)) {
      const boardIds = await getAccessibleBoardIds(getUserId(req));
      if (!boardIds.includes(existing[0].source_board_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Archive on Monday.com before deleting from DB
    let mondayArchived = false;
    try {
      const token = await getMondayToken(getUserId(req));
      if (token && existing[0].monday_item_id) {
        await archivePreApproval(token, existing[0]);
        mondayArchived = true;
        logger.info({ id: req.params.id, mondayItemId: existing[0].monday_item_id }, 'Pre-approval archived on Monday.com');
      }
    } catch (mondayErr) {
      logger.warn({ err: mondayErr.message, id: req.params.id, mondayItemId: existing[0].monday_item_id }, 'Monday.com archive failed on delete');
    }

    const [result] = await db.query('DELETE FROM pre_approvals WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Pre-approval not found' });
    }

    res.json({ message: 'Pre-approval deleted successfully', mondayArchived });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/pre-approvals/:id/notes — Get notes for a pre-approval ──
router.get('/:id/notes', async (req, res, next) => {
  try {
    const [notes] = await db.query(
      'SELECT * FROM pre_approval_notes WHERE pre_approval_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(notes);
  } catch (error) {
    next(error);
  }
});

// ── POST /api/pre-approvals/:id/notes — Add a note ──
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
      'INSERT INTO pre_approval_notes (pre_approval_id, author_id, author_name, content) VALUES (?, ?, ?, ?)',
      [req.params.id, userId, authorName, content.trim()]
    );

    const [note] = await db.query('SELECT * FROM pre_approval_notes WHERE id = ?', [result.insertId]);
    res.status(201).json(note[0]);
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/pre-approvals/:id/notes/:noteId — Update a note ──
router.put('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    // Only author or admin can edit
    const [existing] = await db.query('SELECT * FROM pre_approval_notes WHERE id = ? AND pre_approval_id = ?', [req.params.noteId, req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can edit this note' });
    }

    await db.query('UPDATE pre_approval_notes SET content = ? WHERE id = ?', [content.trim(), req.params.noteId]);
    const [updated] = await db.query('SELECT * FROM pre_approval_notes WHERE id = ?', [req.params.noteId]);
    res.json(updated[0]);
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/pre-approvals/:id/notes/:noteId — Delete a note ──
router.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM pre_approval_notes WHERE id = ? AND pre_approval_id = ?', [req.params.noteId, req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Note not found' });

    if (!isAdmin(req) && existing[0].author_id !== getUserId(req)) {
      return res.status(403).json({ error: 'Only the author or admin can delete this note' });
    }

    await db.query('DELETE FROM pre_approval_notes WHERE id = ?', [req.params.noteId]);
    res.json({ message: 'Note deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
