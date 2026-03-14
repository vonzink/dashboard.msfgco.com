// Monday.com GraphQL mutation client — for LendingPad → Monday.com sync
// Separate from the read-only client to maintain safety boundaries
const logger = require('../../lib/logger');

const MONDAY_API_URL = 'https://api.monday.com/v2';

/**
 * Execute a GraphQL mutation against Monday.com.
 */
async function mondayMutate(token, query, variables = {}) {
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
 * Create a new item on a Monday.com board.
 * @returns {string} The new item ID
 */
async function createItem(token, boardId, itemName, columnValues) {
  const colValuesStr = JSON.stringify(columnValues);
  logger.info({ boardId, itemName }, 'Creating Monday.com item');

  const data = await mondayMutate(token, `mutation ($boardId: ID!, $itemName: String!, $colValues: JSON!) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $colValues) {
      id
    }
  }`, {
    boardId: String(boardId),
    itemName,
    colValues: colValuesStr,
  });

  return data.create_item?.id;
}

/**
 * Update an existing item on a Monday.com board.
 */
async function updateItem(token, boardId, itemId, columnValues) {
  const colValuesStr = JSON.stringify(columnValues);
  logger.info({ boardId, itemId }, 'Updating Monday.com item');

  const data = await mondayMutate(token, `mutation ($boardId: ID!, $itemId: ID!, $colValues: JSON!) {
    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $colValues) {
      id
    }
  }`, {
    boardId: String(boardId),
    itemId: String(itemId),
    colValues: colValuesStr,
  });

  return data.change_multiple_column_values?.id;
}

/**
 * Search for an item on a board by a column value (e.g., LP Loan Number).
 * @returns {string|null} The item ID if found
 */
async function findItemByColumnValue(token, boardId, columnId, value) {
  const data = await mondayMutate(token, `query ($boardId: ID!, $columnId: String!, $value: CompareValue!) {
    items_page_by_column_values(board_id: $boardId, limit: 1, columns: [{column_id: $columnId, column_values: [$value]}]) {
      items {
        id
        name
      }
    }
  }`, {
    boardId: String(boardId),
    columnId,
    value: String(value),
  });

  const items = data.items_page_by_column_values?.items;
  return items && items.length > 0 ? items[0].id : null;
}

/**
 * Archive (soft-delete) an item on Monday.com.
 */
async function archiveItem(token, itemId) {
  logger.info({ itemId }, 'Archiving Monday.com item');

  const data = await mondayMutate(token, `mutation ($itemId: ID!) {
    archive_item(item_id: $itemId) {
      id
    }
  }`, {
    itemId: String(itemId),
  });

  return data.archive_item?.id;
}

// ── Pre-Approval write-through helpers ─────────────────────────────

const db = require('../../db/connection');

/**
 * Get the reverse column map for a board: { pipeline_field → { monday_column_id, type } }
 */
async function getReverseColumnMap(token, boardId) {
  const [mappings] = await db.query(
    'SELECT monday_column_id, pipeline_field FROM monday_column_mappings WHERE board_id = ?',
    [boardId]
  );
  if (mappings.length === 0) return {};

  // Fetch column types from Monday.com
  const { mondayQuery } = require('./client');
  const data = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      columns { id type }
    }
  }`);

  const colTypes = {};
  for (const col of (data.boards?.[0]?.columns || [])) {
    colTypes[col.id] = col.type;
  }

  const reverseMap = {};
  for (const m of mappings) {
    reverseMap[m.pipeline_field] = {
      monday_column_id: m.monday_column_id,
      type: colTypes[m.monday_column_id] || 'text',
    };
  }
  return reverseMap;
}

/**
 * Format a dashboard field value for Monday.com's column_values JSON.
 */
function formatColumnValue(field, value, columnType) {
  if (value === null || value === undefined || value === '') return undefined;

  switch (columnType) {
    case 'numbers':
      return typeof value === 'number' ? String(value) : String(parseFloat(value) || 0);
    case 'date':
      return { date: String(value).substring(0, 10) };
    case 'status':
      return { label: String(value) };
    case 'text':
    case 'long_text':
    default:
      return String(value);
  }
}

/**
 * Build column_values object from dashboard fields using the reverse column map.
 * client_name is excluded (it's the item name, not a column value).
 */
function buildColumnValues(fields, reverseMap) {
  const columnValues = {};

  for (const [field, value] of Object.entries(fields)) {
    if (field === 'client_name') continue;
    const mapping = reverseMap[field];
    if (!mapping) continue;

    const formatted = formatColumnValue(field, value, mapping.type);
    if (formatted !== undefined) {
      columnValues[mapping.monday_column_id] = formatted;
    }
  }

  return columnValues;
}

/**
 * Find a user's pre-approval board via monday_board_access.
 */
async function getUserPreApprovalBoardId(userId) {
  const [rows] = await db.query(
    `SELECT ba.board_id
     FROM monday_board_access ba
     JOIN monday_boards mb ON ba.board_id = mb.board_id
     WHERE ba.user_id = ? AND mb.target_section = 'pre_approvals' AND mb.is_active = 1
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0 ? rows[0].board_id : null;
}

/**
 * Get the default group ID for a board (prefer "Active" group).
 */
async function getDefaultGroupId(token, boardId) {
  const { mondayQuery } = require('./client');
  const data = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      groups { id title }
    }
  }`);

  const groups = data.boards?.[0]?.groups || [];
  const activeGroup = groups.find(g => /active/i.test(g.title));
  return activeGroup?.id || groups[0]?.id || null;
}

/**
 * Create a pre-approval item on the user's Monday.com board.
 * Translates dashboard fields → Monday column values using stored mappings.
 * @returns {{ mondayItemId: string, boardId: string } | null}
 */
async function createPreApproval(token, userId, fields) {
  const boardId = await getUserPreApprovalBoardId(userId);
  if (!boardId) {
    logger.warn({ userId }, 'No pre-approval board found for user — skipping Monday write');
    return null;
  }

  const reverseMap = await getReverseColumnMap(token, boardId);
  const columnValues = buildColumnValues(fields, reverseMap);
  const groupId = await getDefaultGroupId(token, boardId);

  const itemName = fields.client_name || 'New Pre-Approval';

  logger.info({ boardId, itemName, groupId }, 'Creating pre-approval on Monday.com');

  const data = await mondayMutate(token, `mutation ($boardId: ID!, $itemName: String!, $colValues: JSON!${groupId ? ', $groupId: String!' : ''}) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $colValues${groupId ? ', group_id: $groupId' : ''}) {
      id
    }
  }`, {
    boardId: String(boardId),
    itemName,
    colValues: JSON.stringify(columnValues),
    ...(groupId ? { groupId } : {}),
  });

  const mondayItemId = data.create_item?.id;
  return mondayItemId ? { mondayItemId, boardId } : null;
}

/**
 * Update an existing pre-approval item on Monday.com.
 * Looks up the board from the stored source_board_id on the pre-approval record.
 */
async function updatePreApproval(token, preApprovalRecord, updatedFields) {
  const { monday_item_id, source_board_id } = preApprovalRecord;

  if (!monday_item_id || !source_board_id) {
    logger.info({ id: preApprovalRecord.id }, 'Pre-approval has no Monday link — skipping Monday write');
    return;
  }

  const reverseMap = await getReverseColumnMap(token, source_board_id);
  const columnValues = buildColumnValues(updatedFields, reverseMap);

  // If client_name changed, update the item name too
  if (updatedFields.client_name) {
    // Monday API: change item name via change_simple_column_value on the "name" column
    await mondayMutate(token, `mutation ($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) {
        id
      }
    }`, {
      boardId: String(source_board_id),
      itemId: String(monday_item_id),
      value: updatedFields.client_name,
    });
  }

  // Update column values if any mapped fields changed
  if (Object.keys(columnValues).length > 0) {
    logger.info({ boardId: source_board_id, itemId: monday_item_id }, 'Updating pre-approval on Monday.com');
    await updateItem(token, source_board_id, monday_item_id, columnValues);
  }
}

/**
 * Archive a pre-approval item on Monday.com (soft delete).
 */
async function archivePreApproval(token, preApprovalRecord) {
  const { monday_item_id } = preApprovalRecord;

  if (!monday_item_id) {
    logger.info({ id: preApprovalRecord.id }, 'Pre-approval has no Monday link — skipping archive');
    return;
  }

  await archiveItem(token, monday_item_id);
}

module.exports = {
  mondayMutate,
  createItem,
  updateItem,
  findItemByColumnValue,
  archiveItem,
  getReverseColumnMap,
  formatColumnValue,
  buildColumnValues,
  getUserPreApprovalBoardId,
  getDefaultGroupId,
  createPreApproval,
  updatePreApproval,
  archivePreApproval,
};
