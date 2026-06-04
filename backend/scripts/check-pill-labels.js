// Read-only: print exactly what GET /status-labels would return for given fields,
// per pipeline board — to verify a field's labels before enabling its pill.
//   node backend/scripts/check-pill-labels.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { getStatusLabelsBySection } = require('../services/monday/statusLabels');

const FIELDS = ['prelims_status', 'mini_set_status', 'appraisal_status'];

(async () => {
  try {
    const out = await getStatusLabelsBySection('pipeline');
    const [boards] = await db.query(
      "SELECT board_id, board_name FROM monday_boards WHERE is_active=1 AND target_section='pipeline'");
    for (const b of boards) {
      console.log(`\n=== ${b.board_name} (${b.board_id}) ===`);
      const bl = out[String(b.board_id)] || {};
      for (const f of FIELDS) {
        const v = bl[f];
        if (!Array.isArray(v)) { console.log(`  ${f}: (none)`); continue; }
        const sample = v.slice(0, 6).map(x => `${x.name}:${x.color}`).join(', ');
        console.log(`  ${f}: ${v.length} labels — ${sample}${v.length > 6 ? ' …' : ''}`);
      }
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
