import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const clientPath = require.resolve('../../services/monday/client');
const servicePath = require.resolve('../../services/monday/statusLabels');
const originalDb = require.cache[dbPath];
const originalClient = require.cache[clientPath];

const db = { query: vi.fn() };
const client = { mondayQuery: vi.fn() };

function loadService() {
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: client };
  delete require.cache[servicePath];
  return require('../../services/monday/statusLabels');
}

describe('statusLabels service', () => {
  beforeEach(() => { db.query.mockReset(); client.mondayQuery.mockReset(); });
  afterEach(() => {
    delete require.cache[servicePath];
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
    if (originalClient) require.cache[clientPath] = originalClient; else delete require.cache[clientPath];
  });

  it('parseLabels handles object and array shapes and drops empties', () => {
    const { parseLabels } = loadService();
    expect(parseLabels('{"labels":{"0":"","1":"Done","2":"NA"}}')).toEqual(['Done', 'NA']);
    expect(parseLabels('{"labels":[{"name":"A"},{"name":"B"}]}')).toEqual(['A', 'B']);
    expect(parseLabels('not json')).toEqual([]);
  });

  it('getStatusLabelsBySection groups labels by board then field', async () => {
    const { getStatusLabelsBySection } = loadService();
    db.query.mockResolvedValueOnce([[
      { board_id: '1', pipeline_field: 'wvoes', labels_json: '["Please Order","Done"]' },
      { board_id: '1', pipeline_field: 'vvoes', labels_json: '["Needed","Done","NA"]' },
      { board_id: '2', pipeline_field: 'wvoes', labels_json: '["Requested"]' },
      { board_id: '2', pipeline_field: 'stage', labels_json: '[]' },
    ]]);
    const out = await getStatusLabelsBySection('pipeline');
    expect(out).toEqual({
      '1': { wvoes: ['Please Order', 'Done'], vvoes: ['Needed', 'Done', 'NA'] },
      '2': { wvoes: ['Requested'] },
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('labels_json IS NOT NULL'), ['pipeline']);
  });

  it('parseLabelsWithColors returns {name,color} ordered by position, grey default, drops empties', () => {
    const { parseLabelsWithColors } = loadService();
    const s = JSON.stringify({
      labels: { '0': 'A', '1': 'B', '2': '' },
      labels_colors: { '1': { color: '#5559df' } },   // A has no color -> grey
      labels_positions_v2: { '0': 2, '1': 0 },         // B(pos0) before A(pos2)
    });
    expect(parseLabelsWithColors(s)).toEqual([
      { name: 'B', color: '#5559df' },
      { name: 'A', color: '#c4c4c4' },
    ]);
    expect(parseLabelsWithColors('bad')).toEqual([]);
  });

  it('refreshStatusLabels writes [{name,color}] ordered by position, status cols only', async () => {
    const { refreshStatusLabels } = loadService();
    client.mondayQuery.mockResolvedValueOnce({ boards: [{ columns: [
      { id: 'status69', type: 'status', settings_str: JSON.stringify({
          labels: { '0': 'Please Order', '1': 'Done' },
          labels_colors: { '0': { color: '#fdab3d' } },     // Done has no color -> grey
          labels_positions_v2: { '0': 5, '1': 1 },          // Done(pos1) before Please Order(pos5)
        }) },
      { id: 'text9', type: 'text', settings_str: '{}' },
    ] }] });
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const n = await refreshStatusLabels('tok', '1');
    expect(n).toBe(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE monday_column_mappings SET labels_json'),
      [JSON.stringify([{ name: 'Done', color: '#c4c4c4' }, { name: 'Please Order', color: '#fdab3d' }]), '1', 'status69']
    );
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
