// Read-only: dump the raw settings_str of the stage/status2 column on the first
// active pipeline board, to inspect how Monday encodes per-label COLORS.
//   node backend/scripts/diagnose-label-colors.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');

(async () => {
  try {
    const token = await getMondayToken();
    const [boards] = await db.query(
      "SELECT board_id, board_name FROM monday_boards WHERE is_active = 1 AND target_section = 'pipeline' ORDER BY board_name LIMIT 1");
    const b = boards[0];
    console.log(`Board: ${b.board_name} (${b.board_id})`);
    const data = await mondayQuery(token, `query { boards(ids: [${b.board_id}]) { columns { id title type settings_str } } }`);
    const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];
    const c = cols.find(x => x.id === 'status2') || cols.find(x => x.type === 'status');
    console.log(`Column: ${c.id} "${c.title}" (${c.type})`);
    console.log('--- raw settings_str ---');
    console.log(c.settings_str);
    console.log('--- parsed keys ---');
    try { console.log(Object.keys(JSON.parse(c.settings_str))); } catch (e) { console.log('parse error', e.message); }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
