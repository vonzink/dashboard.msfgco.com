/**
 * /api/monday — Read-only Monday.com board sync
 *
 * ⚠️  SAFETY: This integration is STRICTLY READ-ONLY.
 *     We only use GraphQL `query` operations — never `mutation`.
 *     Monday.com remains the single source of truth.
 *     Data flows: Monday.com → dashboard DB (one-way).
 *
 * Supports MULTIPLE boards — each board is assigned to a target section
 * (pipeline, pre_approvals, or funded_loans). Items sync to the correct table.
 *
 * Business logic lives in services/mondaySync.js — this file
 * contains only route handlers (HTTP request / response).
 *
 * Endpoints:
 *   GET    /boards              — list all registered boards (from DB)
 *   POST   /boards              — add a new board (admin)
 *   PUT    /boards/:boardId     — update board config (admin)
 *   DELETE /boards/:boardId     — remove a board (admin)
 *   GET    /columns?board=ID    — fetch board columns from Monday.com (for mapping UI)
 *   GET    /mappings?board=ID   — get saved column mappings for a board
 *   POST   /mappings            — save column mappings (admin only)
 *   GET    /view-config         — column display config for the pipeline table
 *   POST   /sync                — trigger a sync from ALL active boards (admin only)
 *   GET    /sync/status         — get last sync status
 *   GET    /sync/log            — get sync history
 */

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser, requireAdmin } = require('../middleware/userContext');
const { mondayBoardUpdate, validate } = require('../validation/schemas');

const {
  VALID_FIELDS_BY_SECTION,
  VALID_PIPELINE_FIELDS,
  FIELD_LABELS,
  FIELD_LABELS_BY_SECTION,
  DEFAULT_TITLE_MAP,
  getActiveBoards,
  getMondayToken,
  getBoardSection,
  mondayQuery,
  syncAllBoards,
} = require('../services/monday');

router.use(requireDbUser);

// ── GET /boards — list all registered boards (with assigned users) ──
router.get('/boards', async (req, res, next) => {
  try {
    const [boards] = await db.query(
      'SELECT * FROM monday_boards ORDER BY display_order, board_name'
    );

    // Fetch assigned users for all boards
    const [accessRows] = await db.query(
      `SELECT ba.board_id, u.id as user_id, u.name, u.email
       FROM monday_board_access ba
       JOIN users u ON ba.user_id = u.id
       ORDER BY u.name`
    );

    // Group by board_id
    const accessByBoard = {};
    for (const row of accessRows) {
      if (!accessByBoard[row.board_id]) accessByBoard[row.board_id] = [];
      accessByBoard[row.board_id].push({ id: row.user_id, name: row.name, email: row.email });
    }

    // Attach to each board
    for (const board of boards) {
      board.assignedUsers = accessByBoard[board.board_id] || [];
    }

    const boardIds = boards.filter(b => b.is_active).map(b => b.board_id);
    res.json({ boards, boardIds });
  } catch (error) {
    next(error);
  }
});

// ── GET /boards/my-boards — boards accessible to current user ─────
router.get('/boards/my-boards', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    let boards;

    if (isAdmin(req)) {
      // Admins see all active boards
      [boards] = await db.query(
        'SELECT board_id, board_name, target_section FROM monday_boards WHERE is_active = 1 ORDER BY display_order, board_name'
      );
    } else {
      // Non-admins see only boards they have access to
      [boards] = await db.query(
        `SELECT mb.board_id, mb.board_name, mb.target_section
         FROM monday_boards mb
         JOIN monday_board_access ba ON mb.board_id = ba.board_id
         WHERE mb.is_active = 1 AND ba.user_id = ?
         ORDER BY mb.display_order, mb.board_name`,
        [userId]
      );
    }

    // Get available groups for each section from the actual data
    const boardIds = boards.map(b => b.board_id);
    let groups = [];

    if (boardIds.length > 0) {
      // Collect groups from both pre_approvals and funded_loans
      const [paGroups] = await db.query(
        `SELECT DISTINCT group_name FROM pre_approvals
         WHERE source_board_id IN (?) AND group_name IS NOT NULL AND group_name != ''
         ORDER BY group_name`,
        [boardIds]
      );
      const [flGroups] = await db.query(
        `SELECT DISTINCT group_name FROM funded_loans
         WHERE source_board_id IN (?) AND group_name IS NOT NULL AND group_name != ''
         ORDER BY group_name`,
        [boardIds]
      );
      const groupSet = new Set([...paGroups.map(r => r.group_name), ...flGroups.map(r => r.group_name)]);
      groups = [...groupSet].sort();
    }

    res.json({ boards, groups });
  } catch (error) {
    next(error);
  }
});

// ── POST /boards — add a new board (admin) ──────────────────────
router.post('/boards', requireAdmin, async (req, res, next) => {
  try {
    const { boardId, boardName, targetSection, assignedUsers } = req.body;
    if (!boardId) {
      return res.status(400).json({ error: 'boardId is required' });
    }

    const validSections = ['pipeline', 'pre_approvals', 'funded_loans'];
    const section = validSections.includes(targetSection) ? targetSection : 'pipeline';

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO monday_boards (board_id, board_name, target_section) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE board_name = VALUES(board_name), target_section = VALUES(target_section), is_active = 1`,
        [boardId, boardName || '', section]
      );

      // Save user access assignments
      if (Array.isArray(assignedUsers) && assignedUsers.length > 0) {
        for (const userId of assignedUsers) {
          await connection.query(
            'INSERT IGNORE INTO monday_board_access (board_id, user_id) VALUES (?, ?)',
            [boardId, userId]
          );
        }
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [boards] = await db.query('SELECT * FROM monday_boards ORDER BY display_order, board_name');
    res.status(201).json({ success: true, boards });
  } catch (error) {
    next(error);
  }
});

// ── PUT /boards/:boardId — update board config (admin) ──────────
router.put('/boards/:boardId', requireAdmin, validate(mondayBoardUpdate), async (req, res, next) => {
  try {
    const { boardName, targetSection, isActive, displayOrder, assignedUsers } = req.body;
    const updates = [];
    const values = [];

    if (boardName !== undefined) { updates.push('board_name = ?'); values.push(boardName); }
    if (targetSection !== undefined) {
      const validSections = ['pipeline', 'pre_approvals', 'funded_loans'];
      if (validSections.includes(targetSection)) {
        updates.push('target_section = ?'); values.push(targetSection);
      }
    }
    if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive ? 1 : 0); }
    if (displayOrder !== undefined) { updates.push('display_order = ?'); values.push(displayOrder); }

    const hasFieldUpdates = updates.length > 0;
    const hasUserUpdates = Array.isArray(assignedUsers);

    if (!hasFieldUpdates && !hasUserUpdates) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const boardId = req.params.boardId;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      if (hasFieldUpdates) {
        values.push(boardId);
        const [result] = await connection.query(
          `UPDATE monday_boards SET ${updates.join(', ')} WHERE board_id = ?`,
          values
        );
        if (result.affectedRows === 0) {
          await connection.rollback();
          return res.status(404).json({ error: 'Board not found' });
        }
      }

      // Replace user access assignments
      if (hasUserUpdates) {
        await connection.query('DELETE FROM monday_board_access WHERE board_id = ?', [boardId]);
        for (const userId of assignedUsers) {
          await connection.query(
            'INSERT INTO monday_board_access (board_id, user_id) VALUES (?, ?)',
            [boardId, userId]
          );
        }
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [boards] = await db.query('SELECT * FROM monday_boards ORDER BY display_order, board_name');
    res.json({ success: true, boards });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /boards/:boardId — remove a board (admin) ─────────────
router.delete('/boards/:boardId', requireAdmin, async (req, res, next) => {
  try {
    const boardId = req.params.boardId;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM monday_board_access WHERE board_id = ?', [boardId]);
      await connection.query('DELETE FROM monday_column_mappings WHERE board_id = ?', [boardId]);
      await connection.query('DELETE FROM monday_sync_log WHERE board_id = ?', [boardId]);
      await connection.query('DELETE FROM monday_boards WHERE board_id = ?', [boardId]);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [boards] = await db.query('SELECT * FROM monday_boards ORDER BY display_order, board_name');
    res.json({ success: true, boards });
  } catch (error) {
    next(error);
  }
});

// ── GET /view-config — column display config for any section ──
// Query params: ?section=pipeline|funded_loans|pre_approvals (default: pipeline)
router.get('/view-config', async (req, res, next) => {
  try {
    const validSections = ['pipeline', 'funded_loans', 'pre_approvals'];
    const section = validSections.includes(req.query.section) ? req.query.section : 'pipeline';
    const boards = await getActiveBoards(section);
    const boardIds = boards.map(b => b.board_id);

    const columns = [
      { field: 'client_name', label: 'Client Name', order: -1, visible: true, locked: true }
    ];

    if (boardIds.length === 0) {
      return res.json({ columns });
    }

    const [mappings] = await db.query(
      `SELECT DISTINCT pipeline_field, display_label, display_order, visible
       FROM monday_column_mappings
       WHERE board_id IN (?)
       ORDER BY display_order ASC, pipeline_field ASC`,
      [boardIds]
    );

    const seen = new Set();
    const unique = [];
    for (const m of mappings) {
      if (!seen.has(m.pipeline_field)) {
        seen.add(m.pipeline_field);
        unique.push(m);
      }
    }

    if (unique.length > 0) {
      for (const m of unique) {
        columns.push({
          field: m.pipeline_field,
          label: m.display_label || FIELD_LABELS[m.pipeline_field] || m.pipeline_field,
          order: m.display_order ?? 99,
          visible: m.visible !== 0,
        });
      }
    } else {
      // No saved mappings — return all valid fields for this section so the
      // dashboard shows every column the auto-mapper will populate on next sync
      const validFields = VALID_FIELDS_BY_SECTION[section] || [];
      let order = 0;
      for (const field of validFields) {
        columns.push({
          field,
          label: FIELD_LABELS[field] || field,
          order: order++,
          visible: true,
        });
      }
    }

    res.json({ columns });
  } catch (error) {
    next(error);
  }
});

// ── GET /columns — fetch board columns from Monday.com ──────────
router.get('/columns', requireAdmin, async (req, res, next) => {
  try {
    const boardId = req.query.board;
    if (!boardId) {
      return res.status(400).json({ error: 'board query parameter is required' });
    }

    const [boardRows] = await db.query('SELECT * FROM monday_boards WHERE board_id = ?', [boardId]);
    if (boardRows.length === 0) {
      return res.status(400).json({ error: `Board ${boardId} is not registered. Add it first.` });
    }

    const boardConfig = boardRows[0];
    const section = boardConfig.target_section || 'pipeline';

    const token = await getMondayToken(getUserId(req));
    if (!token) {
      return res.status(400).json({ error: 'Monday.com API token not configured. Add it via Settings → Integrations.' });
    }

    const data = await mondayQuery(token, `query {
      boards(ids: [${boardId}]) {
        name
        columns { id title type }
      }
    }`);

    const board = data.boards?.[0];
    if (!board) {
      return res.status(404).json({ error: 'Board not found on Monday.com. Check the board ID.' });
    }

    const sectionFields = VALID_FIELDS_BY_SECTION[section] || VALID_PIPELINE_FIELDS;
    const sectionLabels = FIELD_LABELS_BY_SECTION[section] || FIELD_LABELS;

    const columns = board.columns.map(col => {
      const normalizedTitle = col.title.toLowerCase().trim();
      let suggestedField = DEFAULT_TITLE_MAP[normalizedTitle] || null;
      if (suggestedField && !sectionFields.includes(suggestedField)) {
        suggestedField = null;
      }
      return { id: col.id, title: col.title, type: col.type, suggestedField };
    });

    res.json({
      boardName: board.name,
      boardId,
      targetSection: section,
      columns,
      validPipelineFields: sectionFields,
      fieldLabels: sectionLabels,
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /mappings — get saved column mappings ───────────────────
router.get('/mappings', requireAdmin, async (req, res, next) => {
  try {
    const boardId = req.query.board;
    if (!boardId) {
      return res.status(400).json({ error: 'board query parameter is required' });
    }

    const [mappings] = await db.query(
      'SELECT * FROM monday_column_mappings WHERE board_id = ? ORDER BY display_order ASC, pipeline_field',
      [boardId]
    );

    res.json(mappings);
  } catch (error) {
    next(error);
  }
});

// ── POST /mappings — save column mappings (admin) ───────────────
router.post('/mappings', requireAdmin, async (req, res, next) => {
  try {
    const { mappings, boardId } = req.body;
    if (!boardId) {
      return res.status(400).json({ error: 'boardId is required' });
    }

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings must be an array of { mondayColumnId, mondayColumnTitle, pipelineField }' });
    }

    const section = await getBoardSection(boardId);
    const validFields = VALID_FIELDS_BY_SECTION[section] || VALID_PIPELINE_FIELDS;

    for (const m of mappings) {
      if (!m.mondayColumnId || !m.pipelineField) {
        return res.status(400).json({ error: 'Each mapping must have mondayColumnId and pipelineField' });
      }
      if (!validFields.includes(m.pipelineField)) {
        return res.status(400).json({ error: `Invalid field for ${section}: ${m.pipelineField}` });
      }
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM monday_column_mappings WHERE board_id = ?', [boardId]);

      for (const m of mappings) {
        await connection.query(
          `INSERT INTO monday_column_mappings (board_id, monday_column_id, monday_column_title, pipeline_field, display_label, display_order, visible)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [boardId, m.mondayColumnId, m.mondayColumnTitle || null, m.pipelineField,
           m.displayLabel || null, m.displayOrder ?? 99, m.visible !== false ? 1 : 0]
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    res.json({ success: true, count: mappings.length, boardId });
  } catch (error) {
    next(error);
  }
});

// ── POST /sync — trigger a sync from ALL active Monday.com boards ──
// Runs asynchronously to avoid HTTP timeout — returns immediately,
// then the client polls GET /sync/status for completion.
router.post('/sync', requireDbUser, async (req, res, next) => {
  try {
    const userId = getUserId(req);

    // Create a sync log entry so the client knows a sync is in progress
    await db.query(
      "INSERT INTO monday_sync_log (board_id, triggered_by, target_section, status) VALUES ('0', ?, 'all', 'running')",
      [userId]
    );

    // Respond immediately — sync runs in background
    res.json({ success: true, message: 'Sync started. Check status for progress.', async: true });

    // Fire-and-forget — run sync in the background
    syncAllBoards(userId)
      .then(async (result) => {
        // Update the "running" log entry to "success"
        await db.query(
          `UPDATE monday_sync_log
           SET status = 'success', items_synced = ?, items_created = ?, items_updated = ?, finished_at = NOW()
           WHERE board_id = '0' AND triggered_by = ? AND status = 'running'
           ORDER BY started_at DESC LIMIT 1`,
          [result.itemsFetched, result.created, result.updated, userId]
        );
      })
      .catch(async (err) => {
        const logger = require('../lib/logger');
        logger.error({ err }, 'Background sync failed');
        await db.query(
          `UPDATE monday_sync_log
           SET status = 'error', error_message = ?, finished_at = NOW()
           WHERE board_id = '0' AND triggered_by = ? AND status = 'running'
           ORDER BY started_at DESC LIMIT 1`,
          [err.message, userId]
        ).catch(() => {});
      });
  } catch (error) {
    next(error);
  }
});

// ── GET /sync/status — last sync info ───────────────────────────
router.get('/sync/status', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM monday_sync_log ORDER BY started_at DESC LIMIT 1'
    );

    if (rows.length === 0) {
      return res.json({ lastSync: null, message: 'No syncs have been run yet.' });
    }

    res.json({ lastSync: rows[0] });
  } catch (error) {
    next(error);
  }
});

// ── GET /sync/log — sync history ────────────────────────────────
router.get('/sync/log', requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT sl.*, mb.board_name
       FROM monday_sync_log sl
       LEFT JOIN monday_boards mb ON sl.board_id = mb.board_id
       ORDER BY sl.started_at DESC LIMIT 50`
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
