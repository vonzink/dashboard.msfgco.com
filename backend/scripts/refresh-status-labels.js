// Refresh cached Monday status labels (labels_json) for every active board.
//   node backend/scripts/refresh-status-labels.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { getMondayToken } = require('../services/monday/sync');
const { refreshStatusLabels } = require('../services/monday/statusLabels');

(async () => {
  try {
    const token = await getMondayToken();
    if (!token) { console.log('No Monday token.'); process.exit(1); }
    const [boards] = await db.query('SELECT board_id, board_name FROM monday_boards WHERE is_active = 1');
    for (const b of boards) {
      const n = await refreshStatusLabels(token, b.board_id);
      console.log(`${b.board_name} (${b.board_id}): refreshed ${n} status columns`);
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
