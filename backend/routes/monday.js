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
const { getUserId, requireDbUser, requireAdmin } = require('../middleware/userContext');

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

// ── GET /boards — list all registered boards ──────────────────────
router.get('/boards', async (req, res, next) => {
  try {
    const [boards] = await db.query(
      'SELECT * FROM monday_boards ORDER BY display_order, board_name'
    );
    const boardIds = boards.filter(b => b.is_active).map(b => b.board_id);
    res.json({ boards, boardIds });
  } catch (error) {
    next(error);
  }
});

// ── POST /boards — add a new board (admin) ──────────────────────
router.post('/boards', requireAdmin, async (req, res, next) => {
  try {
    const { boardId, boardName, targetSection } = req.body;
    if (!boardId) {
      return res.status(400).json({ error: 'boardId is required' });
    }

    const validSections = ['pipeline', 'pre_approvals', 'funded_loans'];
    const section = validSections.includes(targetSection) ? targetSection : 'pipeline';

    await db.query(
      `INSERT INTO monday_boards (board_id, board_name, target_section) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE board_name = VALUES(board_name), target_section = VALUES(target_section), is_active = 1`,
      [boardId, boardName || '', section]
    );

    const [boards] = await db.query('SELECT * FROM monday_boards ORDER BY display_order, board_name');
    res.status(201).json({ success: true, boards });
  } catch (error) {
    next(error);
  }
});

// ── PUT /boards/:boardId — update board config (admin) ──────────
router.put('/boards/:boardId', requireAdmin, async (req, res, next) => {
  try {
    const { boardName, targetSection, isActive, displayOrder } = req.body;
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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.boardId);
    const [result] = await db.query(
      `UPDATE monday_boards SET ${updates.join(', ')} WHERE board_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Board not found' });
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

// ── GET /view-config — column display config for the pipeline table ──
router.get('/view-config', async (req, res, next) => {
  try {
    const boards = await getActiveBoards('pipeline');
    const boardIds = boards.map(b => b.board_id);

    if (boardIds.length === 0) {
      return res.json({ columns: [{ field: 'client_name', label: 'Client Name', order: -1, visible: true, locked: true }] });
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

    const columns = [
      { field: 'client_name', label: 'Client Name', order: -1, visible: true, locked: true }
    ];

    for (const m of unique) {
      columns.push({
        field: m.pipeline_field,
        label: m.display_label || FIELD_LABELS[m.pipeline_field] || m.pipeline_field,
        order: m.display_order ?? 99,
        visible: m.visible !== 0,
      });
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
router.post('/sync', requireAdmin, async (req, res, next) => {
  try {
    const result = await syncAllBoards(getUserId(req));
    res.json({ success: true, ...result });
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
