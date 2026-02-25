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
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { getCredential } = require('./integrations');

router.use(requireDbUser);

// ── Constants ───────────────────────────────────────────────────
const MONDAY_API_URL = 'https://api.monday.com/v2';

// Fields we can map from Monday.com into each section's table
const VALID_PIPELINE_FIELDS = [
  'loan_number', 'lender', 'subject_property',
  'loan_amount', 'rate', 'appraisal_status', 'loan_purpose',
  'loan_type', 'occupancy', 'title_status', 'hoi_status',
  'loan_estimate', 'application_date', 'lock_expiration_date',
  'closing_date', 'funding_date', 'stage', 'notes',
  'prelims_status', 'mini_set_status', 'cd_status',
  // These are matched specially:
  'assigned_lo_name',
];

const VALID_PRE_APPROVAL_FIELDS = [
  'client_name', 'loan_amount', 'pre_approval_date', 'expiration_date',
  'status', 'assigned_lo_name', 'property_address', 'loan_type', 'notes',
];

const VALID_FUNDED_LOAN_FIELDS = [
  'assigned_lo_name', 'loan_amount', 'funded_date',
];

const VALID_FIELDS_BY_SECTION = {
  pipeline: VALID_PIPELINE_FIELDS,
  pre_approvals: VALID_PRE_APPROVAL_FIELDS,
  funded_loans: VALID_FUNDED_LOAN_FIELDS,
};

// Human-readable default labels for all fields
const FIELD_LABELS = {
  client_name: 'Client Name',
  loan_number: 'Loan #',
  lender: 'Lender',
  subject_property: 'Subject Property',
  assigned_lo_name: 'Loan Officer',
  loan_amount: 'Loan Amount',
  rate: 'Rate',
  appraisal_status: 'Appraisal',
  loan_purpose: 'Loan Purpose',
  loan_type: 'Loan Type',
  occupancy: 'Occupancy',
  title_status: 'Title',
  hoi_status: 'HOI',
  loan_estimate: 'Loan Estimate',
  application_date: 'App Date',
  lock_expiration_date: 'Lock Exp',
  closing_date: 'Closing Date',
  funding_date: 'Funding Date',
  stage: 'Stage',
  notes: 'Notes',
  prelims_status: 'Prelims',
  mini_set_status: 'Mini Set',
  cd_status: 'CD',
  pre_approval_date: 'Pre-Approval Date',
  expiration_date: 'Expiration Date',
  status: 'Status',
  property_address: 'Property Address',
  funded_date: 'Funded Date',
};

const FIELD_LABELS_BY_SECTION = {
  pipeline: Object.fromEntries(VALID_PIPELINE_FIELDS.map(f => [f, FIELD_LABELS[f] || f])),
  pre_approvals: Object.fromEntries(VALID_PRE_APPROVAL_FIELDS.map(f => [f, FIELD_LABELS[f] || f])),
  funded_loans: Object.fromEntries(VALID_FUNDED_LOAN_FIELDS.map(f => [f, FIELD_LABELS[f] || f])),
};

// Default column-title → pipeline-field mapping (best-guess based on common names).
// The admin can override these via POST /mappings.
const DEFAULT_TITLE_MAP = {
  'lender':               'lender',
  'loan number':          'loan_number',
  'subject property':     'subject_property',
  'loan officer':         'assigned_lo_name',
  'loan amount':          'loan_amount',
  'rate':                 'rate',
  'appraisal status':     'appraisal_status',
  'loan purpose':         'loan_purpose',
  'loan type':            'loan_type',
  'occupancy':            'occupancy',
  'title':                'title_status',
  'hoi':                  'hoi_status',
  'loan estimate':        'loan_estimate',
  'application date':     'application_date',
  'lock expiration date': 'lock_expiration_date',
  'lock expiration':      'lock_expiration_date',
  'closing date':         'closing_date',
  'closing data':         'closing_date',
  'funding date':         'funding_date',
  'prelims':              'prelims_status',
  'prelims status':       'prelims_status',
  'mini set':             'mini_set_status',
  'mini set status':      'mini_set_status',
  'cd':                   'cd_status',
  'cd status':            'cd_status',
  'pre approval date':    'pre_approval_date',
  'expiration date':      'expiration_date',
  'property address':     'property_address',
  'funded date':          'funded_date',
  'status':               'status',
};

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Get active boards from the DB (replaces hardcoded BOARD_IDS).
 */
async function getActiveBoards(section = null) {
  let sql = 'SELECT * FROM monday_boards WHERE is_active = 1';
  const params = [];
  if (section) { sql += ' AND target_section = ?'; params.push(section); }
  sql += ' ORDER BY display_order';
  const [rows] = await db.query(sql, params);
  return rows;
}

/**
 * Get the Monday.com API token. Checks:
 *  1. Admin-level integration credential in DB
 *  2. Environment variable fallback
 */
async function getMondayToken(userId) {
  const token = await getCredential(userId, 'monday');
  if (token) return token;
  if (process.env.MONDAY_API_TOKEN) return process.env.MONDAY_API_TOKEN;
  return null;
}

/**
 * Execute a READ-ONLY GraphQL query against Monday.com.
 * Rejects any string containing "mutation" as a safety net.
 */
async function mondayQuery(token, query, variables = {}) {
  if (/mutation/i.test(query)) {
    throw new Error('SAFETY: Mutations are not allowed — this integration is read-only');
  }

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Monday.com API error: HTTP ${response.status} — ${text.substring(0, 200)}`);
  }

  const data = await response.json();

  if (data.errors && data.errors.length > 0) {
    throw new Error(`Monday.com GraphQL error: ${data.errors[0].message}`);
  }

  return data.data;
}

/**
 * Fetch all items from a single board (paginated).
 */
async function fetchBoardItems(token, boardId) {
  let allItems = [];
  let cursor = null;

  // First page
  const firstPage = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      items_page(limit: 500) {
        cursor
        items {
          id
          name
          group { title }
          column_values {
            id
            text
            value
          }
        }
      }
    }
  }`);

  const page = firstPage.boards?.[0]?.items_page;
  if (page?.items) {
    allItems = page.items;
    cursor = page.cursor;
  }

  // Subsequent pages
  while (cursor) {
    const nextPage = await mondayQuery(token, `query ($cursor: String!) {
      next_items_page(limit: 500, cursor: $cursor) {
        cursor
        items {
          id
          name
          group { title }
          column_values {
            id
            text
            value
          }
        }
      }
    }`, { cursor });

    const np = nextPage.next_items_page;
    if (np?.items?.length > 0) {
      allItems = allItems.concat(np.items);
      cursor = np.cursor;
    } else {
      cursor = null;
    }
  }

  return allItems;
}

/**
 * Look up a board's target section from monday_boards table.
 */
async function getBoardSection(boardId) {
  const [rows] = await db.query(
    'SELECT target_section FROM monday_boards WHERE board_id = ?',
    [boardId]
  );
  return rows.length > 0 ? rows[0].target_section : 'pipeline';
}

// ── GET /boards — list all registered boards ──────────────────────
router.get('/boards', async (req, res, next) => {
  try {
    const [boards] = await db.query(
      'SELECT * FROM monday_boards ORDER BY display_order, board_name'
    );
    // Also return boardIds for backward compatibility
    const boardIds = boards.filter(b => b.is_active).map(b => b.board_id);
    res.json({ boards, boardIds });
  } catch (error) {
    next(error);
  }
});

// ── POST /boards — add a new board (admin) ──────────────────────
router.post('/boards', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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
router.put('/boards/:boardId', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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
router.delete('/boards/:boardId', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const boardId = req.params.boardId;

    // Delete mappings and sync logs for this board, then the board itself
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

    // Get unique display config across all pipeline boards
    const [mappings] = await db.query(
      `SELECT DISTINCT pipeline_field, display_label, display_order, visible
       FROM monday_column_mappings
       WHERE board_id IN (?)
       ORDER BY display_order ASC, pipeline_field ASC`,
      [boardIds]
    );

    // De-dupe by pipeline_field (keep first occurrence = lowest display_order)
    const seen = new Set();
    const unique = [];
    for (const m of mappings) {
      if (!seen.has(m.pipeline_field)) {
        seen.add(m.pipeline_field);
        unique.push(m);
      }
    }

    // Build column list: always start with client_name
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

// ── GET /columns — fetch board columns ──────────────────────────
router.get('/columns', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const boardId = req.query.board;
    if (!boardId) {
      return res.status(400).json({ error: 'board query parameter is required' });
    }

    // Verify the board is registered
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
        columns {
          id
          title
          type
        }
      }
    }`);

    const board = data.boards?.[0];
    if (!board) {
      return res.status(404).json({ error: 'Board not found on Monday.com. Check the board ID.' });
    }

    // Use section-appropriate valid fields for suggestions
    const sectionFields = VALID_FIELDS_BY_SECTION[section] || VALID_PIPELINE_FIELDS;
    const sectionLabels = FIELD_LABELS_BY_SECTION[section] || FIELD_LABELS;

    // Auto-suggest mappings based on column titles
    const columns = board.columns.map(col => {
      const normalizedTitle = col.title.toLowerCase().trim();
      let suggestedField = DEFAULT_TITLE_MAP[normalizedTitle] || null;
      // Only suggest if the field is valid for this section
      if (suggestedField && !sectionFields.includes(suggestedField)) {
        suggestedField = null;
      }
      return {
        id: col.id,
        title: col.title,
        type: col.type,
        suggestedField,
      };
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
router.get('/mappings', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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
router.post('/mappings', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { mappings, boardId } = req.body;
    if (!boardId) {
      return res.status(400).json({ error: 'boardId is required' });
    }

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings must be an array of { mondayColumnId, mondayColumnTitle, pipelineField }' });
    }

    // Look up board's section to validate fields
    const section = await getBoardSection(boardId);
    const validFields = VALID_FIELDS_BY_SECTION[section] || VALID_PIPELINE_FIELDS;

    // Validate all fields
    for (const m of mappings) {
      if (!m.mondayColumnId || !m.pipelineField) {
        return res.status(400).json({ error: 'Each mapping must have mondayColumnId and pipelineField' });
      }
      if (!validFields.includes(m.pipelineField)) {
        return res.status(400).json({ error: `Invalid field for ${section}: ${m.pipelineField}` });
      }
    }

    // Clear existing mappings for this board and insert new ones
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

// ── POST /sync — trigger a read-only sync from ALL active Monday.com boards ──
router.post('/sync', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const userId = getUserId(req);
    const token = await getMondayToken(userId);
    if (!token) {
      return res.status(400).json({ error: 'Monday.com API token not configured.' });
    }

    // Load all users (for LO name → user ID matching)
    const [users] = await db.query('SELECT id, name, email FROM users');
    const userNameMap = {};
    for (const u of users) {
      if (u.name) userNameMap[u.name.toLowerCase().trim()] = u.id;
    }

    // Get all active boards from DB
    const activeBoards = await getActiveBoards();

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalFetched = 0;

    // Track synced IDs per section for cleanup
    const syncedIdsBySection = {
      pipeline: new Set(),
      pre_approvals: new Set(),
      funded_loans: new Set(),
    };

    // Sync each board
    for (const board of activeBoards) {
      const boardId = board.board_id;
      const section = board.target_section || 'pipeline';

      // Load column mappings for this board
      let [mappings] = await db.query(
        'SELECT monday_column_id, pipeline_field FROM monday_column_mappings WHERE board_id = ?',
        [boardId]
      );

      if (mappings.length === 0) {
        // Try auto-mapping from column titles
        const autoMappings = await autoMapColumns(token, boardId);
        if (autoMappings.length === 0) {
          console.log(`Monday sync: No mappings for board ${boardId}, skipping.`);
          continue;
        }
        mappings = autoMappings;
      }

      // Build a map: monday_column_id → field
      const columnMap = {};
      for (const m of mappings) {
        columnMap[m.monday_column_id] = m.pipeline_field;
      }

      // Create sync log entry
      const [logResult] = await db.query(
        'INSERT INTO monday_sync_log (board_id, triggered_by, target_section) VALUES (?, ?, ?)',
        [boardId, userId, section]
      );
      const syncLogId = logResult.insertId;

      let boardItems = [];
      let created = 0;
      let updated = 0;

      try {
        boardItems = await fetchBoardItems(token, boardId);
        totalFetched += boardItems.length;

        for (const item of boardItems) {
          const row = mapItemToRow(item, columnMap, userNameMap);
          if (!row.client_name && section === 'pipeline') continue;

          syncedIdsBySection[section]?.add(String(item.id));

          try {
            if (section === 'pipeline') {
              await upsertPipelineRow(item.id, row);
            } else if (section === 'pre_approvals') {
              await upsertPreApprovalRow(item.id, row, userNameMap);
            } else if (section === 'funded_loans') {
              await upsertFundedLoanRow(item.id, row, userNameMap);
            }

            // Determine if create or update by checking result
            const [check] = await db.query(
              `SELECT id FROM ${getTableName(section)} WHERE monday_item_id = ?`,
              [item.id]
            );
            // We count based on whether we had existing rows before
            // (simplified: just count total per board, not new vs updated)
          } catch (rowErr) {
            console.error(`Monday sync: failed to upsert item ${item.id} (board ${boardId}, section ${section}):`, rowErr.message);
          }
        }

        // Update sync log for this board
        await db.query(
          `UPDATE monday_sync_log
           SET status = 'success', items_synced = ?, items_created = ?, items_updated = ?, finished_at = NOW()
           WHERE id = ?`,
          [boardItems.length, created, updated, syncLogId]
        );

        totalCreated += created;
        totalUpdated += updated;
      } catch (fetchErr) {
        await db.query(
          'UPDATE monday_sync_log SET status = ?, error_message = ?, finished_at = NOW() WHERE id = ?',
          ['error', fetchErr.message, syncLogId]
        );
        console.error(`Monday sync: error fetching board ${boardId}:`, fetchErr.message);
        // Continue with other boards
      }
    }

    // Delete rows that came from Monday.com but are no longer on ANY active board (per section)
    for (const [section, syncedIds] of Object.entries(syncedIdsBySection)) {
      if (syncedIds.size === 0) continue;
      try {
        const tableName = getTableName(section);
        const [mondayRows] = await db.query(
          `SELECT id, monday_item_id FROM ${tableName} WHERE source_system = 'monday' AND monday_item_id IS NOT NULL`
        );

        const toDelete = mondayRows.filter(r => !syncedIds.has(String(r.monday_item_id)));
        if (toDelete.length > 0) {
          const deleteIds = toDelete.map(r => r.id);
          await db.query(`DELETE FROM ${tableName} WHERE id IN (?)`, [deleteIds]);
          totalDeleted += toDelete.length;
        }
      } catch (delErr) {
        console.error(`Monday sync: error cleaning up removed ${section} items:`, delErr.message);
      }
    }

    res.json({
      success: true,
      boards: activeBoards.length,
      itemsFetched: totalFetched,
      created: totalCreated,
      updated: totalUpdated,
      deleted: totalDeleted,
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /sync/status — last sync info ───────────────────────────
router.get('/sync/status', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM monday_sync_log ORDER BY started_at DESC LIMIT 1`
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
router.get('/sync/log', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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

// ── Per-section upsert helpers ──────────────────────────────────

function getTableName(section) {
  const map = { pipeline: 'pipeline', pre_approvals: 'pre_approvals', funded_loans: 'funded_loans' };
  return map[section] || 'pipeline';
}

async function upsertPipelineRow(mondayItemId, row) {
  const [existing] = await db.query(
    'SELECT id FROM pipeline WHERE monday_item_id = ?',
    [mondayItemId]
  );

  if (existing.length > 0) {
    const sets = [];
    const vals = [];
    for (const [field, value] of Object.entries(row)) {
      if (field === 'monday_item_id') continue;
      sets.push(`${field} = ?`);
      vals.push(value);
    }
    sets.push('last_synced_at = NOW()');
    sets.push('source_system = ?');
    vals.push('monday');
    vals.push(existing[0].id);

    await db.query(`UPDATE pipeline SET ${sets.join(', ')} WHERE id = ?`, vals);
    return 'updated';
  } else {
    row.source_system = 'monday';
    row.last_synced_at = new Date();
    const fields = Object.keys(row);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => row[f]);

    await db.query(
      `INSERT INTO pipeline (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return 'created';
  }
}

async function upsertPreApprovalRow(mondayItemId, row, userNameMap) {
  // Map row fields to pre_approvals columns
  const paRow = {
    monday_item_id: String(mondayItemId),
    client_name: row.client_name || 'Unnamed',
    loan_amount: row.loan_amount || 0,
    pre_approval_date: row.pre_approval_date || null,
    expiration_date: row.expiration_date || null,
    status: row.status || 'active',
    property_address: row.property_address || null,
    loan_type: row.loan_type || null,
    notes: row.notes || null,
    source_system: 'monday',
    last_synced_at: new Date(),
  };

  // Handle LO assignment
  if (row.assigned_lo_name) {
    paRow.assigned_lo_name = row.assigned_lo_name;
    const loId = userNameMap[row.assigned_lo_name.toLowerCase().trim()];
    if (loId) paRow.assigned_lo_id = loId;
  }

  const [existing] = await db.query(
    'SELECT id FROM pre_approvals WHERE monday_item_id = ?',
    [mondayItemId]
  );

  if (existing.length > 0) {
    const sets = [];
    const vals = [];
    for (const [field, value] of Object.entries(paRow)) {
      if (field === 'monday_item_id') continue;
      sets.push(`${field} = ?`);
      vals.push(value);
    }
    vals.push(existing[0].id);
    await db.query(`UPDATE pre_approvals SET ${sets.join(', ')} WHERE id = ?`, vals);
    return 'updated';
  } else {
    const fields = Object.keys(paRow);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => paRow[f]);
    await db.query(
      `INSERT INTO pre_approvals (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return 'created';
  }
}

async function upsertFundedLoanRow(mondayItemId, row, userNameMap) {
  // Map row fields to funded_loans columns
  const flRow = {
    monday_item_id: String(mondayItemId),
    loan_amount: row.loan_amount || 0,
    funded_date: row.funded_date || null,
    source_system: 'monday',
    last_synced_at: new Date(),
  };

  // Handle LO assignment
  if (row.assigned_lo_name) {
    flRow.assigned_lo_name = row.assigned_lo_name;
    const loId = userNameMap[row.assigned_lo_name.toLowerCase().trim()];
    if (loId) flRow.assigned_lo_id = loId;
  }

  const [existing] = await db.query(
    'SELECT id FROM funded_loans WHERE monday_item_id = ?',
    [mondayItemId]
  );

  if (existing.length > 0) {
    const sets = [];
    const vals = [];
    for (const [field, value] of Object.entries(flRow)) {
      if (field === 'monday_item_id') continue;
      sets.push(`${field} = ?`);
      vals.push(value);
    }
    vals.push(existing[0].id);
    await db.query(`UPDATE funded_loans SET ${sets.join(', ')} WHERE id = ?`, vals);
    return 'updated';
  } else {
    const fields = Object.keys(flRow);
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map(f => flRow[f]);
    await db.query(
      `INSERT INTO funded_loans (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return 'created';
  }
}

// ── Item → row mapping ──────────────────────────────────────────

function mapItemToRow(item, columnMap, userNameMap) {
  const row = {
    client_name: item.name || 'Unnamed',
    monday_item_id: String(item.id),
  };

  // Use the Monday.com group as the pipeline stage if no explicit mapping
  if (item.group?.title) {
    row.stage = item.group.title;
  }

  // Map each column value
  for (const cv of (item.column_values || [])) {
    const field = columnMap[cv.id];
    if (!field) continue;

    const text = (cv.text || '').trim();
    if (!text) continue;

    // Handle special field types
    if (field === 'loan_amount') {
      const num = parseFloat(text.replace(/[$,\s]/g, ''));
      row.loan_amount = isNaN(num) ? null : num;
    } else if (field === 'assigned_lo_name') {
      row.assigned_lo_name = text;
      const loId = userNameMap[text.toLowerCase().trim()];
      if (loId) {
        row.assigned_lo_id = loId;
      }
    } else if (['application_date', 'lock_expiration_date', 'closing_date', 'funding_date',
                 'target_close_date', 'pre_approval_date', 'expiration_date', 'funded_date'].includes(field)) {
      let dateVal = null;
      try {
        if (cv.value) {
          const parsed = JSON.parse(cv.value);
          dateVal = parsed.date || parsed;
        }
      } catch {
        dateVal = text;
      }
      if (dateVal && typeof dateVal === 'string') {
        const d = new Date(dateVal);
        row[field] = isNaN(d.getTime()) ? null : dateVal;
      }
    } else {
      row[field] = text;
    }
  }

  // Ensure loan_amount has a default if not mapped
  if (row.loan_amount === undefined) {
    row.loan_amount = 0;
  }

  // Ensure stage has a default
  if (!row.stage) {
    row.stage = 'Unknown';
  }

  return row;
}

// ── Auto-map columns by title ───────────────────────────────────

async function autoMapColumns(token, boardId) {
  const data = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      columns {
        id
        title
        type
      }
    }
  }`);

  const columns = data.boards?.[0]?.columns || [];
  const mappings = [];

  for (const col of columns) {
    const normalizedTitle = col.title.toLowerCase().trim();
    const field = DEFAULT_TITLE_MAP[normalizedTitle];
    if (field) {
      mappings.push({
        monday_column_id: col.id,
        pipeline_field: field,
      });
    }
  }

  return mappings;
}

module.exports = router;
