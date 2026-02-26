// Monday.com GraphQL client — read-only queries
const MONDAY_API_URL = 'https://api.monday.com/v2';

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

module.exports = { MONDAY_API_URL, mondayQuery, fetchBoardItems };
