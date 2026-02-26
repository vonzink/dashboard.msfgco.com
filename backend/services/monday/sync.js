// Monday.com sync orchestration — upserts + full board sync
const db = require('../../db/connection');
const logger = require('../../lib/logger');
const { getCredential } = require('../../routes/integrations');
const { fetchBoardItems } = require('./client');
const { mapItemToRow, autoMapColumns } = require('./mapper');

// ── DB Helpers ──────────────────────────────────

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

// ── Per-Section Upserts ─────────────────────────

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
  if (!row.funded_date) {
    logger.info({ mondayItemId }, 'Monday sync: skipping funded loan item — no funded_date');
    return 'skipped';
  }

  const flRow = {
    monday_item_id: String(mondayItemId),
    client_name: row.client_name || 'Unnamed',
    loan_amount: row.loan_amount || 0,
    loan_type: row.loan_type || null,
    funded_date: row.funded_date,
    investor: row.investor || null,
    property_address: row.property_address || null,
    group_name: row.stage || null,
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

// ── Sync All Boards ─────────────────────────────

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
        logger.info({ boardId }, 'Monday sync: no mappings for board, skipping');
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
          logger.error({ err: rowErr, itemId: item.id, boardId, section }, 'Monday sync: failed to upsert item');
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
      logger.error({ err: fetchErr, boardId }, 'Monday sync: error fetching board');
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
      logger.error({ err: delErr, section }, 'Monday sync: error cleaning up removed items');
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
  getActiveBoards,
  getMondayToken,
  getBoardSection,
  getTableName,
  syncAllBoards,
};
