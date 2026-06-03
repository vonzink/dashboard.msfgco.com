// Read-only: dump live Monday status-column labels for every mapped status field,
// per active pipeline board. Used to align js/pipeline.js STATUS_OPTIONS to Monday.
// Flags fields whose labels differ across boards. Writes nothing.
//   node backend/scripts/dump-status-labels.js

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');

function parseLabels(settingsStr) {
  try {
    const s = JSON.parse(settingsStr || '{}');
    if (!s.labels) return [];
    const arr = Array.isArray(s.labels)
      ? s.labels.map(l => (l && l.name != null ? l.name : String(l)))
      : Object.values(s.labels);
    return arr.filter(l => l && String(l).trim());
  } catch { return []; }
}

(async () => {
  try {
    const token = await getMondayToken();
    if (!token) { console.log('No Monday token.'); process.exit(1); }

    const [boards] = await db.query(
      "SELECT board_id, board_name FROM monday_boards WHERE is_active = 1 AND target_section = 'pipeline' ORDER BY board_name"
    );
    if (!boards.length) { console.log('No active pipeline boards.'); process.exit(0); }

    const fieldLabels = {};   // field -> { boardName -> labels[] }
    const fieldCol = {};      // field -> "title [colId]"

    for (const b of boards) {
      const [maps] = await db.query(
        'SELECT monday_column_id, pipeline_field FROM monday_column_mappings WHERE board_id = ?', [b.board_id]
      );
      const fieldByCol = {};
      maps.forEach(m => { fieldByCol[m.monday_column_id] = m.pipeline_field; });

      const data = await mondayQuery(token,
        `query { boards(ids: [${b.board_id}]) { columns { id title type settings_str } } }`);
      const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];

      for (const c of cols) {
        if (c.type !== 'status') continue;
        const field = fieldByCol[c.id];
        if (!field) continue;
        (fieldLabels[field] = fieldLabels[field] || {})[b.board_name] = parseLabels(c.settings_str);
        fieldCol[field] = `${c.title} [${c.id}]`;
      }
    }

    const fields = Object.keys(fieldLabels).sort();
    console.log(`Boards: ${boards.map(b => b.board_name).join(', ')}`);
    for (const field of fields) {
      const byBoard = fieldLabels[field];
      const sets = Object.values(byBoard);
      const same = sets.every(s => JSON.stringify(s) === JSON.stringify(sets[0]));
      if (same) {
        console.log(`\n${field}  (${fieldCol[field]})`);
        console.log('  ' + sets[0].map(l => `"${l}"`).join(', '));
      } else {
        console.log(`\n${field}  (${fieldCol[field]})  *** DIFFERS ACROSS BOARDS ***`);
        for (const [bn, labels] of Object.entries(byBoard)) {
          console.log(`  [${bn}] ` + labels.map(l => `"${l}"`).join(', '));
        }
      }
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
