// Temporary script to check Monday.com columns vs DB mappings
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');

(async () => {
  try {
    const token = await getMondayToken();
    if (!token) { console.log('No token'); process.exit(1); }

    // Get all active boards
    const [boards] = await db.query(
      "SELECT board_id, board_name, target_section FROM monday_boards WHERE is_active = 1 ORDER BY target_section, board_name"
    );

    for (const b of boards) {
      const data = await mondayQuery(token, `query { boards(ids: [${b.board_id}]) { columns { id title type } } }`);
      const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];

      // Get existing mappings
      const [mapped] = await db.query('SELECT monday_column_id FROM monday_column_mappings WHERE board_id = ?', [b.board_id]);
      const mappedIds = new Set(mapped.map(m => m.monday_column_id));

      const unmapped = cols.filter(c => !mappedIds.has(c.id) && c.type !== 'name' && c.type !== 'subtasks' && c.type !== 'board_relation');

      console.log('\n=== ' + b.board_name + ' (' + b.target_section + ') === ' + mapped.length + ' mapped, ' + unmapped.length + ' unmapped');
      if (unmapped.length > 0) {
        unmapped.forEach(c => {
          console.log('  UNMAPPED: ' + c.id + ' | "' + c.title + '" (' + c.type + ')');
        });
      }
    }
  } catch (e) { console.error(e.message); }
  process.exit(0);
})();
