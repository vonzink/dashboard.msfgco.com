// Auto-map unmapped Monday.com columns to new DB fields
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { mondayQuery } = require('../services/monday/client');
const { getMondayToken } = require('../services/monday/sync');
const { VALID_FIELDS_BY_SECTION, DEFAULT_TITLE_MAP, FIELD_LABELS } = require('../services/monday/mapper');

(async () => {
  try {
    const token = await getMondayToken();
    if (!token) { console.log('No token'); process.exit(1); }

    const [boards] = await db.query(
      "SELECT board_id, board_name, target_section FROM monday_boards WHERE is_active = 1 ORDER BY target_section, board_name"
    );

    let totalAdded = 0;

    for (const b of boards) {
      const section = b.target_section;
      const validFields = VALID_FIELDS_BY_SECTION[section] || [];

      // Get existing mappings
      const [existing] = await db.query(
        'SELECT monday_column_id, pipeline_field FROM monday_column_mappings WHERE board_id = ?',
        [b.board_id]
      );
      const mappedColumnIds = new Set(existing.map(m => m.monday_column_id));
      const mappedFields = new Set(existing.map(m => m.pipeline_field));

      // Fetch Monday board columns
      const data = await mondayQuery(token, `query { boards(ids: [${b.board_id}]) { columns { id title type } } }`);
      const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];

      const newMappings = [];
      for (const col of cols) {
        if (mappedColumnIds.has(col.id)) continue; // already mapped
        const normalizedTitle = col.title.toLowerCase().trim();
        const field = DEFAULT_TITLE_MAP[normalizedTitle];
        if (!field) continue;
        if (!validFields.includes(field)) continue; // field not valid for this section
        if (mappedFields.has(field)) continue; // field already mapped from another column

        newMappings.push({ columnId: col.id, field, title: col.title });
        mappedFields.add(field);
      }

      if (newMappings.length > 0) {
        // Find max display_order for existing mappings
        const [maxOrder] = await db.query(
          'SELECT COALESCE(MAX(display_order), -1) as max_order FROM monday_column_mappings WHERE board_id = ?',
          [b.board_id]
        );
        let nextOrder = (maxOrder[0].max_order || 0) + 1;

        for (const m of newMappings) {
          await db.query(
            `INSERT INTO monday_column_mappings (board_id, monday_column_id, monday_column_title, pipeline_field, display_label, display_order, visible)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [b.board_id, m.columnId, m.title, m.field, FIELD_LABELS[m.field] || m.title, nextOrder++]
          );
        }
        totalAdded += newMappings.length;
        console.log(`${b.board_name} (${section}): added ${newMappings.length} mappings:`);
        newMappings.forEach(m => console.log(`  + ${m.field} ← "${m.title}" [${m.columnId}]`));
      } else {
        console.log(`${b.board_name} (${section}): no new mappings needed`);
      }
    }

    console.log(`\nDone! Added ${totalAdded} new column mappings.`);
  } catch (e) { console.error('ERROR:', e.message); }
  process.exit(0);
})();
