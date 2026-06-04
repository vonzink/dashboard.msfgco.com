// Read-only: diagnose the "Current Stage" two-way sync for pipeline boards.
// Prints, per active pipeline board:
//   - total mappings + whether `stage` is mapped to a column (the conflict)
//   - the live Monday GROUP titles (the real stage values)
//   - the labels of whatever column `stage` is mapped to (what the dropdown shows)
//   - the distinct pipeline.stage values currently stored
// Writes nothing.
//   node backend/scripts/diagnose-stage.js

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');

function parseLabels(s) {
  try { const o = JSON.parse(s || '{}'); if (!o.labels) return [];
    const a = Array.isArray(o.labels) ? o.labels.map(l => l && l.name != null ? l.name : String(l)) : Object.values(o.labels);
    return a.filter(x => x && String(x).trim()); } catch { return []; }
}

(async () => {
  try {
    const token = await getMondayToken();
    const [boards] = await db.query(
      "SELECT board_id, board_name FROM monday_boards WHERE is_active = 1 AND target_section = 'pipeline' ORDER BY board_name");
    for (const b of boards) {
      console.log(`\n===== ${b.board_name} (${b.board_id}) =====`);

      const [allMaps] = await db.query('SELECT COUNT(*) c FROM monday_column_mappings WHERE board_id = ?', [b.board_id]);
      const [stageMap] = await db.query(
        "SELECT monday_column_id, labels_json FROM monday_column_mappings WHERE board_id = ? AND pipeline_field = 'stage'", [b.board_id]);
      console.log(`total mappings: ${allMaps[0].c}`);
      if (stageMap.length) {
        console.log(`stage IS mapped to column: ${stageMap[0].monday_column_id}`);
        console.log(`  dropdown would show (status column labels): ${parseLabels(stageMap[0].labels_json).map(l => `"${l}"`).join(', ') || '(labels_json empty)'}`);
      } else {
        console.log('stage is NOT mapped to a column (group-only — correct).');
      }

      const data = await mondayQuery(token, `query { boards(ids: [${b.board_id}]) { groups { title } } }`);
      const groups = ((data.boards && data.boards[0] && data.boards[0].groups) || []).map(g => g.title);
      console.log(`live Monday GROUPS (the real stages): ${groups.map(g => `"${g}"`).join(', ')}`);

      const [stages] = await db.query(
        'SELECT stage, COUNT(*) c FROM pipeline WHERE source_board_id = ? GROUP BY stage ORDER BY c DESC LIMIT 15', [b.board_id]);
      console.log(`dashboard pipeline.stage values stored: ${stages.map(s => `"${s.stage}"(${s.c})`).join(', ')}`);
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
