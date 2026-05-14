/**
 * routes/webhooks/monday.js
 *
 * Monday.com webhook receiver — real-time item sync.
 * Monday.com sends events when items are created, updated, or deleted.
 *
 * This route does NOT use the shared API key auth from webhooks/index.js.
 * Instead it uses a dedicated Monday.com webhook token (MONDAY_WEBHOOK_TOKEN env var).
 *
 * Events handled:
 *   - change_column_value: item column updated
 *   - create_item: new item added
 *   - change_name: item name changed
 *   - delete_item / archive_item: item removed
 */
const router = require('express').Router();
const db = require('../../db/connection');
const logger = require('../../lib/logger');
const websocket = require('../../lib/websocket');
const { mondayQuery, fetchBoardItems } = require('../../services/monday/client');
const { mapItemToRow } = require('../../services/monday/mapper');
const { getMondayToken, getBoardSection, getTableName } = require('../../services/monday/sync');

function verifyWebhookToken(req, res, next) {
  const webhookToken = process.env.MONDAY_WEBHOOK_TOKEN;
  if (!webhookToken) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const queryToken = req.query.token;
  const providedToken = authHeader?.replace('Bearer ', '') || queryToken;

  if (providedToken !== webhookToken) {
    logger.warn({ ip: req.ip }, 'Monday webhook: invalid token');
    return res.status(401).json({ error: 'Invalid webhook token' });
  }

  next();
}

router.use(verifyWebhookToken);

// Monday.com sends a challenge on webhook creation — echo it back
router.post('/', async (req, res) => {
  if (req.body.challenge) {
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  if (!event) {
    return res.status(400).json({ error: 'No event in payload' });
  }

  const { type, boardId, pulseId, pulseName, columnId, value } = event;

  logger.info({ type, boardId, pulseId, columnId }, 'Monday webhook: event received');

  // Respond immediately — process in background
  res.json({ ok: true });

  try {
    // Look up the board in our DB
    const [boards] = await db.query(
      'SELECT * FROM monday_boards WHERE board_id = ? AND is_active = 1',
      [String(boardId)]
    );

    if (boards.length === 0) {
      logger.info({ boardId }, 'Monday webhook: board not registered, ignoring');
      return;
    }

    const board = boards[0];
    const section = board.target_section || 'pipeline';
    const tableName = getTableName(section);

    if (type === 'delete_item' || type === 'archive_item') {
      await handleDeleteEvent(tableName, pulseId, section);
      return;
    }

    if (type === 'create_item' || type === 'change_column_value' || type === 'change_name') {
      await handleUpsertEvent(board, pulseId, section, tableName);
      return;
    }

    logger.info({ type }, 'Monday webhook: unhandled event type');
  } catch (err) {
    logger.error({ err, type, boardId, pulseId }, 'Monday webhook: error processing event');
  }
});

async function handleDeleteEvent(tableName, pulseId, section) {
  const mondayItemId = String(pulseId);
  const [result] = await db.query(
    `DELETE FROM ${tableName} WHERE monday_item_id = ? AND source_system = 'monday'`,
    [mondayItemId]
  );

  if (result.affectedRows > 0) {
    logger.info({ mondayItemId, section }, 'Monday webhook: item deleted from DB');
    websocket.broadcast('monday:item-deleted', { section, mondayItemId });
  }
}

async function handleUpsertEvent(board, pulseId, section, tableName) {
  const boardId = board.board_id;

  // Get a token to fetch the updated item from Monday.com
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    // Try to get a token from the first user with board access
    const [accessRows] = await db.query(
      'SELECT user_id FROM monday_board_access WHERE board_id = ? LIMIT 1',
      [boardId]
    );
    const userId = accessRows.length > 0 ? accessRows[0].user_id : null;
    const userToken = userId ? await getMondayToken(userId) : null;
    if (!userToken) {
      logger.warn({ boardId }, 'Monday webhook: no API token available to fetch item');
      return;
    }
    return await fetchAndUpsertItem(userToken, board, pulseId, section, tableName);
  }

  await fetchAndUpsertItem(token, board, pulseId, section, tableName);
}

async function fetchAndUpsertItem(token, board, pulseId, section, tableName) {
  const boardId = board.board_id;

  // Fetch the single updated item from Monday.com
  const data = await mondayQuery(token, `query ($itemId: [ID!]) {
    items(ids: $itemId) {
      id
      name
      group { title }
      column_values { id text value }
    }
  }`, { itemId: [String(pulseId)] });

  const item = data.items?.[0];
  if (!item) {
    logger.warn({ pulseId, boardId }, 'Monday webhook: item not found on Monday.com (may have been deleted)');
    return;
  }

  // Get column mappings for this board
  let [savedMappings] = await db.query(
    'SELECT monday_column_id, pipeline_field FROM monday_column_mappings WHERE board_id = ?',
    [boardId]
  );

  if (savedMappings.length === 0) {
    logger.info({ boardId }, 'Monday webhook: no column mappings for board, skipping upsert');
    return;
  }

  const columnMap = {};
  for (const m of savedMappings) {
    columnMap[m.monday_column_id] = m.pipeline_field;
  }

  // Build user name map for LO resolution
  const [users] = await db.query('SELECT id, name, email FROM users');
  const userNameMap = {};
  for (const u of users) {
    if (u.name) userNameMap[u.name.toLowerCase().trim()] = u.id;
    if (u.email) userNameMap['email:' + u.email.toLowerCase().trim()] = u.id;
  }

  const row = mapItemToRow(item, columnMap, userNameMap);
  const mondayItemId = String(item.id);

  // Check if item exists in our DB
  const [existing] = await db.query(
    `SELECT id FROM ${tableName} WHERE monday_item_id = ?`,
    [mondayItemId]
  );

  // Build the DB row with metadata
  const dbRow = { ...row };
  delete dbRow._board_group;
  if (row._board_group && (section === 'pre_approvals' || section === 'funded_loans')) {
    dbRow.group_name = row._board_group;
  }
  dbRow.source_board_id = boardId;
  dbRow.source_system = 'monday';
  dbRow.last_synced_at = new Date();

  if (existing.length > 0) {
    // UPDATE
    const sets = [];
    const vals = [];
    for (const [field, value] of Object.entries(dbRow)) {
      if (field === 'monday_item_id') continue;
      sets.push(`\`${field}\` = ?`);
      vals.push(value);
    }
    vals.push(existing[0].id);
    await db.query(`UPDATE ${tableName} SET ${sets.join(', ')} WHERE id = ?`, vals);
    logger.info({ mondayItemId, section, id: existing[0].id }, 'Monday webhook: item updated');
  } else {
    // INSERT
    dbRow.monday_item_id = mondayItemId;
    const fields = Object.keys(dbRow);
    const placeholders = fields.map(() => '?').join(', ');
    await db.query(
      `INSERT INTO ${tableName} (${fields.map(f => '`' + f + '`').join(', ')}) VALUES (${placeholders})`,
      fields.map(f => dbRow[f])
    );
    logger.info({ mondayItemId, section }, 'Monday webhook: item created');
  }

  websocket.broadcast('monday:item-updated', { section, mondayItemId });
}

module.exports = router;
