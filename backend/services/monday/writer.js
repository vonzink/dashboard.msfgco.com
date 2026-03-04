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

module.exports = { mondayMutate, createItem, updateItem, findItemByColumnValue };
