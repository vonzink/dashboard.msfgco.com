// Monday.com GraphQL client — read-only queries
// Uses shared base for retry, rate limiting, and error handling
const { MONDAY_API_URL, mondayRequest } = require('./api');

/**
 * Execute a READ-ONLY GraphQL query against Monday.com.
 * Rejects any string containing "mutation" as a safety net.
 */
async function mondayQuery(token, query, variables = {}) {
  if (/mutation/i.test(query)) {
    throw new Error('SAFETY: Mutations are not allowed — this integration is read-only');
  }

  return mondayRequest(token, query, variables);
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

module.exports = { MONDAY_API_URL, mondayQuery, fetchBoardItems };
