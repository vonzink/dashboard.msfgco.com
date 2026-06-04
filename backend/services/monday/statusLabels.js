// Cache + read per-board Monday status labels (column settings_str -> labels_json).
const db = require('../../db/connection');
const { mondayQuery } = require('./client');

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

// Pull a board's live status-column labels and cache into labels_json.
async function refreshStatusLabels(token, boardId) {
  const data = await mondayQuery(token,
    `query { boards(ids: [${boardId}]) { columns { id type settings_str } } }`);
  const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];
  let updated = 0;
  for (const c of cols) {
    if (c.type !== 'status') continue;
    const labels = parseLabels(c.settings_str);
    const [res] = await db.query(
      'UPDATE monday_column_mappings SET labels_json = ? WHERE board_id = ? AND monday_column_id = ?',
      [JSON.stringify(labels), String(boardId), c.id]
    );
    if (res && res.affectedRows) updated++;
  }
  return updated;
}

// { board_id: { pipeline_field: [labels] } } for active boards in a section.
async function getStatusLabelsBySection(section) {
  const [rows] = await db.query(
    `SELECT m.board_id, m.pipeline_field, m.labels_json
       FROM monday_column_mappings m
       JOIN monday_boards b ON b.board_id = m.board_id
      WHERE b.is_active = 1 AND b.target_section = ? AND m.labels_json IS NOT NULL`,
    [section]
  );
  const out = {};
  for (const r of rows) {
    let labels;
    try { labels = JSON.parse(r.labels_json); } catch { labels = []; }
    if (!Array.isArray(labels) || labels.length === 0) continue;
    (out[r.board_id] = out[r.board_id] || {})[r.pipeline_field] = labels;
  }
  return out;
}

module.exports = { refreshStatusLabels, getStatusLabelsBySection, parseLabels };
