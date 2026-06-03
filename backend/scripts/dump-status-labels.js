// Read-only: dump live Monday status-column labels per active pipeline board,
// matched to dashboard fields by column TITLE via DEFAULT_TITLE_MAP (independent of
// the monday_column_mappings table, which can be wiped by the admin save endpoint).
// Used to align js/pipeline.js STATUS_OPTIONS to Monday. Writes nothing.
//   node backend/scripts/dump-status-labels.js

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');
const { DEFAULT_TITLE_MAP } = require('../services/monday/mapper');

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
    const unmapped = {};      // boardName -> ["Title [id]", ...]  (status cols with no field)

    for (const b of boards) {
      const data = await mondayQuery(token,
        `query { boards(ids: [${b.board_id}]) { columns { id title type settings_str } } }`);
      const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];

      for (const c of cols) {
        if (c.type !== 'status') continue;
        const field = DEFAULT_TITLE_MAP[String(c.title).toLowerCase().trim()];
        if (!field) {
          (unmapped[b.board_name] = unmapped[b.board_name] || []).push(`"${c.title}" [${c.id}]`);
          continue;
        }
        (fieldLabels[field] = fieldLabels[field] || {})[b.board_name] = parseLabels(c.settings_str);
        fieldCol[field] = `${c.title} [${c.id}]`;
      }
    }

    console.log(`Boards: ${boards.map(b => b.board_name).join(', ')}\n`);
    for (const field of Object.keys(fieldLabels).sort()) {
      const byBoard = fieldLabels[field];
      const sets = Object.values(byBoard);
      const same = sets.every(s => JSON.stringify(s) === JSON.stringify(sets[0]));
      if (same) {
        console.log(`${field}  (${fieldCol[field]})`);
        console.log('  ' + sets[0].map(l => `"${l}"`).join(', '));
      } else {
        console.log(`${field}  (${fieldCol[field]})  *** DIFFERS ACROSS BOARDS ***`);
        for (const [bn, labels] of Object.entries(byBoard)) {
          console.log(`  [${bn}] ` + labels.map(l => `"${l}"`).join(', '));
        }
      }
    }
    console.log('\n-- status columns with no DEFAULT_TITLE_MAP field (ignored) --');
    for (const [bn, list] of Object.entries(unmapped)) console.log(`  [${bn}] ${list.join(', ')}`);
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
