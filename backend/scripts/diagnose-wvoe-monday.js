// Read-only diagnostic: verify the WVOE (and VVOE) dashboard <-> Monday.com connection.
//
// Prints, per active pipeline board:
//   1. The LIVE Monday column (by id, default status69, and any column whose title contains "voe"):
//      its id, title, type, and exact status labels.
//   2. The DB monday_column_mappings rows for wvoes/vvoes (is the field actually wired up?).
//   3. A verdict comparing the live Monday labels against the hardcoded dashboard dropdown options.
//
// Nothing is written. Safe to run on prod.
//   node backend/scripts/diagnose-wvoe-monday.js [columnId]   (columnId defaults to status69)

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');

const TARGET_COLUMN_ID = process.argv[2] || 'status69';

// Mirror of js/pipeline.js STATUS_OPTIONS.wvoes — keep in sync.
const DASHBOARD_WVOE_OPTIONS = [
  'Please Order', 'Requested', 'Partially Complete', 'Need Info',
  'Pending LO Approval', 'LO Approved', 'Done', 'NA',
];

function parseLabels(settingsStr) {
  // Monday status columns store labels in settings_str. Handle both the classic
  // {labels:{"0":"Done"}} shape and the newer array-of-objects shape.
  try {
    const s = JSON.parse(settingsStr || '{}');
    if (!s.labels) return [];
    if (Array.isArray(s.labels)) return s.labels.map(l => (l && l.name != null ? l.name : String(l)));
    return Object.values(s.labels);
  } catch {
    return [];
  }
}

(async () => {
  try {
    const token = await getMondayToken();
    if (!token) {
      console.log('No Monday token (getMondayToken() returned null). Set MONDAY_API_TOKEN or connect an account.');
      process.exit(1);
    }

    const [boards] = await db.query(
      "SELECT board_id, board_name FROM monday_boards WHERE is_active = 1 AND target_section = 'pipeline' ORDER BY board_name"
    );
    if (!boards.length) { console.log('No active pipeline boards.'); process.exit(0); }

    for (const b of boards) {
      console.log(`\n===== Board: ${b.board_name} (${b.board_id}) =====`);

      const data = await mondayQuery(token,
        `query { boards(ids: [${b.board_id}]) { columns { id title type settings_str } } }`);
      const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];

      const byId = cols.find(c => c.id === TARGET_COLUMN_ID);
      const voeCols = cols.filter(c => /voe/i.test(c.title));
      const seen = new Set();
      const describe = (c, tag) => {
        if (!c || seen.has(c.id)) return;
        seen.add(c.id);
        const labels = parseLabels(c.settings_str);
        console.log(`  [${tag}] id=${c.id}  title="${c.title}"  type=${c.type}`);
        console.log(`        labels: ${labels.length ? labels.map(l => `"${l}"`).join(', ') : '(none / not a status column)'}`);
        return labels;
      };

      console.log(`-- Live Monday column id="${TARGET_COLUMN_ID}":`);
      const idLabels = describe(byId, 'by-id');
      if (!byId) console.log(`   (no column with id "${TARGET_COLUMN_ID}" on this board)`);
      console.log(`-- Live Monday columns whose title contains "voe":`);
      if (!voeCols.length) console.log('   (none)');
      const titleLabelsList = voeCols.map(c => describe(c, 'by-title')).filter(Boolean);

      const [maps] = await db.query(
        "SELECT monday_column_id, monday_column_title, pipeline_field FROM monday_column_mappings " +
        "WHERE board_id = ? AND pipeline_field IN ('wvoes','vvoes')",
        [b.board_id]
      );
      console.log(`-- DB monday_column_mappings (wvoes/vvoes):`);
      if (!maps.length) {
        console.log('   (NONE) -> write-back SKIPS these fields. The Monday column title never matched');
        console.log('           DEFAULT_TITLE_MAP, so no mapping row exists. Re-run auto-map-new-columns.js');
        console.log('           after deploying the singular "wvoe"/"vvoe" aliases.');
      } else {
        maps.forEach(m => console.log(`   ${m.pipeline_field} <- "${m.monday_column_title}" [${m.monday_column_id}]`));
      }

      // Verdict: compare dashboard options to the live WVOE labels we found.
      const liveWvoeLabels = idLabels && idLabels.length ? idLabels
        : (titleLabelsList[0] || []);
      if (liveWvoeLabels.length) {
        const live = new Set(liveWvoeLabels);
        const missingInMonday = DASHBOARD_WVOE_OPTIONS.filter(o => !live.has(o));
        const extraInMonday = liveWvoeLabels.filter(l => l && !DASHBOARD_WVOE_OPTIONS.includes(l));
        console.log(`-- Verdict (dashboard wvoes options vs live Monday labels):`);
        console.log(`   dashboard options not present in Monday (writes would FAIL): ${missingInMonday.length ? missingInMonday.map(x => `"${x}"`).join(', ') : 'none ✓'}`);
        console.log(`   Monday labels missing from dashboard dropdown (can't be set from UI): ${extraInMonday.length ? extraInMonday.map(x => `"${x}"`).join(', ') : 'none ✓'}`);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
