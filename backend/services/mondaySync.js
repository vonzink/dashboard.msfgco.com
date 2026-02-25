/**
 * services/mondaySync.js
 *
 * Monday.com sync engine — all business logic for board sync,
 * column mapping, item-to-row conversion, and per-section upserts.
 *
 * Extracted from routes/monday.js to keep routes thin.
 */

const db = require('../db/connection');
const { getCredential } = require('../routes/integrations');

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

// Default column-title → field mapping (best-guess based on common Monday.com column names)
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

// ── DB Helpers ───────────────────────────────────────────────────

async function getActiveBoards(section = null) {
  let sql = 'SELECT * FROM monday_boards WHERE is_active = 1';
  const params = [];
  if (section) { sql += ' AND target_section = ?'; params.push(section); }
  sql += ' ORDER BY display_order';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function getMondayToken(userId) {
  const token = await getCredential(userId, 'monday');
  if (token) return token;
  if (process.env.MONDAY_API_TOKEN) return process.env.MONDAY_API_TOKEN;
  return null;
}

async function getBoardSection(boardId) {
  const [rows] = await db.query(
    'SELECT target_section FROM monday_boards WHERE board_id = ?',
    [boardId]
  );
  return rows.length > 0 ? rows[0].target_section : 'pipeline';
}

function getTableName(section) {
  const map = { pipeline: 'pipeline', pre_approvals: 'pre_approvals', funded_loans: 'funded_loans' };
  return map[section] || 'pipeline';
}

// ── Monday.com API ──────────────────────────────────────────────

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

/** Fetch all items from a single board (paginated). */
async function fetchBoardItems(token, boardId) {
  let allItems = [];
  let cursor = null;

  const firstPage = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      items_page(limit: 500) {
        cursor
        items {
          id
          name
          group { title }
          column_values { id text value }
        }
      }
    }
  }`);

  const page = firstPage.boards?.[0]?.items_page;
  if (page?.items) {
    allItems = page.items;
    cursor = page.cursor;
  }

  while (cursor) {
    const nextPage = await mondayQuery(token, `query ($cursor: String!) {
      next_items_page(limit: 500, cursor: $cursor) {
        cursor
        items {
          id
          name
          group { title }
          column_values { id text value }
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

// ── Item → Row Mapping ──────────────────────────────────────────

const DATE_FIELDS = [
  'application_date', 'lock_expiration_date', 'closing_date', 'funding_date',
  'target_close_date', 'pre_approval_date', 'expiration_date', 'funded_date',
];

function mapItemToRow(item, columnMap, userNameMap) {
  const row = {
    client_name: item.name || 'Unnamed',
    monday_item_id: String(item.id),
  };

  if (item.group?.title) {
    row.stage = item.group.title;
  }

  for (const cv of (item.column_values || [])) {
    const field = columnMap[cv.id];
    if (!field) continue;

    const text = (cv.text || '').trim();
    if (!text) continue;

    if (field === 'loan_amount') {
      const num = parseFloat(text.replace(/[$,\s]/g, ''));
      row.loan_amount = isNaN(num) ? null : num;
    } else if (field === 'assigned_lo_name') {
      row.assigned_lo_name = text;
      const loId = userNameMap[text.toLowerCase().trim()];
      if (loId) row.assigned_lo_id = loId;
    } else if (DATE_FIELDS.includes(field)) {
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

  if (row.loan_amount === undefined) row.loan_amount = 0;
  if (!row.stage) row.stage = 'Unknown';

  return row;
}

// ── Per-Section Upserts ─────────────────────────────────────────

async function upsertPipelineRow(mondayItemId, row) {
  const [existing] = await db.query('SELECT id FROM pipeline WHERE monday_item_id = ?', [mondayItemId]);

  if (existing.length > 0) {
    const sets = [];
    const vals = [];
    for (const [field, value] of Object.entries(row)) {
      if (field === 'monday_item_id') continue;
      sets.push(`${field} = ?`);
      vals.push(value);
    }
    sets.push('last_synced_at = NOW()', 'source_system = ?');
    vals.push('monday', existing[0].id);
    await db.query(`UPDATE pipeline SET ${sets.join(', ')} WHERE id = ?`, vals);
    return 'updated';
  } else {
    row.source_system = 'monday';
    row.last_synced_at = new Date();
    const fields = Object.keys(row);
    const placeholders = fields.map(() => '?').join(', ');
    await db.query(`INSERT INTO pipeline (${fields.join(', ')}) VALUES (${placeholders})`, fields.map(f => row[f]));
    return 'created';
  }
}

async function upsertPreApprovalRow(mondayItemId, row, userNameMap) {
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

  if (row.assigned_lo_name) {
    paRow.assigned_lo_name = row.assigned_lo_name;
    const loId = userNameMap[row.assigned_lo_name.toLowerCase().trim()];
    if (loId) paRow.assigned_lo_id = loId;
  }

  const [existing] = await db.query('SELECT id FROM pre_approvals WHERE monday_item_id = ?', [mondayItemId]);

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
    await db.query(`INSERT INTO pre_approvals (${fields.join(', ')}) VALUES (${placeholders})`, fields.map(f => paRow[f]));
    return 'created';
  }
}

async function upsertFundedLoanRow(mondayItemId, row, userNameMap) {
  const flRow = {
    monday_item_id: String(mondayItemId),
    loan_amount: row.loan_amount || 0,
    funded_date: row.funded_date || null,
    source_system: 'monday',
    last_synced_at: new Date(),
  };

  if (row.assigned_lo_name) {
    flRow.assigned_lo_name = row.assigned_lo_name;
    const loId = userNameMap[row.assigned_lo_name.toLowerCase().trim()];
    if (loId) flRow.assigned_lo_id = loId;
  }

  const [existing] = await db.query('SELECT id FROM funded_loans WHERE monday_item_id = ?', [mondayItemId]);

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
    await db.query(`INSERT INTO funded_loans (${fields.join(', ')}) VALUES (${placeholders})`, fields.map(f => flRow[f]));
    return 'created';
  }
}

// ── Auto-Map Columns ────────────────────────────────────────────

async function autoMapColumns(token, boardId) {
  const data = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      columns { id title type }
    }
  }`);

  const columns = data.boards?.[0]?.columns || [];
  const mappings = [];

  for (const col of columns) {
    const normalizedTitle = col.title.toLowerCase().trim();
    const field = DEFAULT_TITLE_MAP[normalizedTitle];
    if (field) {
      mappings.push({ monday_column_id: col.id, pipeline_field: field });
    }
  }

  return mappings;
}

// ── Sync All Boards ─────────────────────────────────────────────

async function syncAllBoards(userId) {
  const token = await getMondayToken(userId);
  if (!token) throw new Error('Monday.com API token not configured.');

  const [users] = await db.query('SELECT id, name, email FROM users');
  const userNameMap = {};
  for (const u of users) {
    if (u.name) userNameMap[u.name.toLowerCase().trim()] = u.id;
  }

  const activeBoards = await getActiveBoards();

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalFetched = 0;

  const syncedIdsBySection = {
    pipeline: new Set(),
    pre_approvals: new Set(),
    funded_loans: new Set(),
  };

  for (const board of activeBoards) {
    const boardId = board.board_id;
    const section = board.target_section || 'pipeline';

    let [mappings] = await db.query(
      'SELECT monday_column_id, pipeline_field FROM monday_column_mappings WHERE board_id = ?',
      [boardId]
    );

    if (mappings.length === 0) {
      const autoMappings = await autoMapColumns(token, boardId);
      if (autoMappings.length === 0) {
        console.log(`Monday sync: No mappings for board ${boardId}, skipping.`);
        continue;
      }
      mappings = autoMappings;
    }

    const columnMap = {};
    for (const m of mappings) {
      columnMap[m.monday_column_id] = m.pipeline_field;
    }

    const [logResult] = await db.query(
      'INSERT INTO monday_sync_log (board_id, triggered_by, target_section) VALUES (?, ?, ?)',
      [boardId, userId, section]
    );
    const syncLogId = logResult.insertId;

    let boardItems;
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
          let result;
          if (section === 'pipeline') {
            result = await upsertPipelineRow(item.id, row);
          } else if (section === 'pre_approvals') {
            result = await upsertPreApprovalRow(item.id, row, userNameMap);
          } else if (section === 'funded_loans') {
            result = await upsertFundedLoanRow(item.id, row, userNameMap);
          }
          if (result === 'created') created++;
          else if (result === 'updated') updated++;
        } catch (rowErr) {
          console.error(`Monday sync: failed to upsert item ${item.id} (board ${boardId}, section ${section}):`, rowErr.message);
        }
      }

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
    }
  }

  // Cleanup: delete rows from Monday.com that no longer exist on any active board
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

  return {
    boards: activeBoards.length,
    itemsFetched: totalFetched,
    created: totalCreated,
    updated: totalUpdated,
    deleted: totalDeleted,
  };
}

module.exports = {
  // Constants
  VALID_FIELDS_BY_SECTION,
  VALID_PIPELINE_FIELDS,
  FIELD_LABELS,
  FIELD_LABELS_BY_SECTION,
  DEFAULT_TITLE_MAP,
  // DB helpers
  getActiveBoards,
  getMondayToken,
  getBoardSection,
  getTableName,
  // Monday.com API
  mondayQuery,
  fetchBoardItems,
  autoMapColumns,
  // Sync
  syncAllBoards,
};
