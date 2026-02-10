/**
 * /api/monday — Read-only Monday.com board sync
 *
 * ⚠️  SAFETY: This integration is STRICTLY READ-ONLY.
 *     We only use GraphQL `query` operations — never `mutation`.
 *     Monday.com remains the single source of truth.
 *     Data flows: Monday.com → dashboard DB (one-way).
 *
 * Supports MULTIPLE boards — items from all boards merge into the pipeline table.
 *
 * Endpoints:
 *   GET  /boards              — list configured boards
 *   GET  /columns?board=ID    — fetch board columns from Monday.com (for mapping UI)
 *   GET  /mappings?board=ID   — get saved column mappings for a board
 *   POST /mappings            — save column mappings (admin only)
 *   GET  /view-config         — column display config for the pipeline table
 *   POST /sync                — trigger a sync from ALL boards → pipeline table (admin only)
 *   GET  /sync/status         — get last sync status
 *   GET  /sync/log            — get sync history
 */

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, isAdmin, requireDbUser } = require('../middleware/userContext');
const { getCredential } = require('./integrations');

router.use(requireDbUser);

// ── Constants ───────────────────────────────────────────────────
const BOARD_IDS = ['3946783498', '8225994434'];
const MONDAY_API_URL = 'https://api.monday.com/v2';

// Fields we can map from Monday.com into the pipeline table
const VALID_PIPELINE_FIELDS = [
  'loan_number', 'lender', 'subject_property',
  'loan_amount', 'rate', 'appraisal_status', 'loan_purpose',
  'loan_type', 'occupancy', 'title_status', 'hoi_status',
  'loan_estimate', 'application_date', 'lock_expiration_date',
  'closing_date', 'funding_date', 'stage', 'notes',
  // These are matched specially:
  'assigned_lo_name',
];

// Human-readable default labels for pipeline fields
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
};

// ── Helpers ─────────────────────────────────────────────────────

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

// ── GET /boards — list configured boards ─────────────────────────
router.get('/boards', (req, res) => {
  res.json({ boardIds: BOARD_IDS });
});

// ── GET /view-config — column display config for the pipeline table ──
router.get('/view-config', async (req, res, next) => {
  try {
    // Get unique display config across all boards (use first board's settings as canonical)
    const [mappings] = await db.query(
      `SELECT DISTINCT pipeline_field, display_label, display_order, visible
       FROM monday_column_mappings 
       WHERE board_id IN (?)
       ORDER BY display_order ASC, pipeline_field ASC`,
      [BOARD_IDS]
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

    const boardId = req.query.board || BOARD_IDS[0];
    if (!BOARD_IDS.includes(boardId)) {
      return res.status(400).json({ error: `Board ${boardId} is not configured.` });
    }

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
      return res.status(404).json({ error: 'Board not found. Check the board ID.' });
    }

    // Auto-suggest mappings based on column titles
    const columns = board.columns.map(col => {
      const normalizedTitle = col.title.toLowerCase().trim();
      const suggestedField = DEFAULT_TITLE_MAP[normalizedTitle] || null;
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
      columns,
      validPipelineFields: VALID_PIPELINE_FIELDS,
      fieldLabels: FIELD_LABELS,
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

    const boardId = req.query.board || BOARD_IDS[0];
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
    const targetBoard = boardId || BOARD_IDS[0];

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings must be an array of { mondayColumnId, mondayColumnTitle, pipelineField }' });
    }

    // Validate all fields
    for (const m of mappings) {
      if (!m.mondayColumnId || !m.pipelineField) {
        return res.status(400).json({ error: 'Each mapping must have mondayColumnId and pipelineField' });
      }
      if (!VALID_PIPELINE_FIELDS.includes(m.pipelineField)) {
        return res.status(400).json({ error: `Invalid pipeline field: ${m.pipelineField}` });
      }
    }

    // Clear existing mappings for this board and insert new ones
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query('DELETE FROM monday_column_mappings WHERE board_id = ?', [targetBoard]);

      for (const m of mappings) {
        await connection.query(
          `INSERT INTO monday_column_mappings (board_id, monday_column_id, monday_column_title, pipeline_field, display_label, display_order, visible)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [targetBoard, m.mondayColumnId, m.mondayColumnTitle || null, m.pipelineField,
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

    res.json({ success: true, count: mappings.length, boardId: targetBoard });
  } catch (error) {
    next(error);
  }
});

// ── POST /sync — trigger a read-only sync from ALL Monday.com boards ──
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

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalFetched = 0;
    const allSyncedMondayIds = new Set();

    // Sync each board
    for (const boardId of BOARD_IDS) {
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

      // Build a map: monday_column_id → pipeline_field
      const columnMap = {};
      for (const m of mappings) {
        columnMap[m.monday_column_id] = m.pipeline_field;
      }

      // Create sync log entry
      const [logResult] = await db.query(
        'INSERT INTO monday_sync_log (board_id, triggered_by) VALUES (?, ?)',
        [boardId, userId]
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
          if (!row.client_name) continue;

          allSyncedMondayIds.add(String(item.id));

          try {
            const [existing] = await db.query(
              'SELECT id FROM pipeline WHERE monday_item_id = ?',
              [item.id]
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
              updated++;
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
              created++;
            }
          } catch (rowErr) {
            console.error(`Monday sync: failed to upsert item ${item.id} (board ${boardId}):`, rowErr.message);
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

    // Delete pipeline rows that came from Monday.com but are no longer on ANY board
    try {
      const [mondayRows] = await db.query(
        "SELECT id, monday_item_id FROM pipeline WHERE source_system = 'monday' AND monday_item_id IS NOT NULL"
      );

      const toDelete = mondayRows.filter(r => !allSyncedMondayIds.has(String(r.monday_item_id)));
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map(r => r.id);
        await db.query('DELETE FROM pipeline WHERE id IN (?)', [deleteIds]);
        totalDeleted = toDelete.length;
      }
    } catch (delErr) {
      console.error('Monday sync: error cleaning up removed items:', delErr.message);
    }

    res.json({
      success: true,
      boards: BOARD_IDS.length,
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
      `SELECT * FROM monday_sync_log WHERE board_id IN (?) ORDER BY started_at DESC LIMIT 1`,
      [BOARD_IDS]
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
      `SELECT * FROM monday_sync_log WHERE board_id IN (?) ORDER BY started_at DESC LIMIT 50`,
      [BOARD_IDS]
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// ── Item → pipeline row mapping ─────────────────────────────────

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
    } else if (['application_date', 'lock_expiration_date', 'closing_date', 'funding_date', 'target_close_date'].includes(field)) {
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
