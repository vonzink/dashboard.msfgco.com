import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../../db/connection');
const servicePath = path.resolve(import.meta.dirname, '../../../services/webinars/revisions.js');
const originalDb = require.cache[dbPath];
const db = { query: vi.fn() };

function load() {
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  delete require.cache[servicePath];
  return require(servicePath);
}

beforeEach(() => db.query.mockReset());
afterEach(() => {
  delete require.cache[servicePath];
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
});

describe('Webinar Studio revisions', () => {
  it('lists only safe revision summaries, never snapshots or source', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 9, version: 4, change_type: 'slide_saved', change_summary: 'Updated welcome', created_at: '2026-09-03T12:00:00.000Z', creator_name: 'Editor', snapshot: '{"html":"secret"}' },
    ]]);

    const { listHistory } = load();
    await expect(listHistory(2)).resolves.toEqual([{
      id: 9, version: 4, changeType: 'slide_saved', changeSummary: 'Updated welcome', createdAt: '2026-09-03T12:00:00.000Z', createdBy: { name: 'Editor' },
    }]);
    expect(db.query).toHaveBeenCalledWith(expect.not.stringContaining('snapshot'), [2]);
  });

  it('loads a restore snapshot only when both webinar and revision match', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 9, webinar_id: 2, version: 4, snapshot: JSON.stringify({ schemaVersion: 1, webinar: { slug: 'intro', title: 'Intro', masterHtml: '<main>{{SLIDE_CONTENT}}</main>', masterCss: '' }, slides: [] }) },
    ]]);
    const { getRevisionForRestore } = load();
    await expect(getRevisionForRestore(2, 9)).resolves.toMatchObject({ id: 9, webinarId: 2, version: 4, snapshot: { schemaVersion: 1 } });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('webinar_id = ?'), [2, 9]);
  });

  it('builds exactly the complete normalized revision snapshot', async () => {
    const { buildCompleteSnapshot } = load();
    const connection = { query: vi.fn()
      .mockResolvedValueOnce([[{ slug: 'intro', title: 'Intro', master_html: '<main>{{SLIDE_CONTENT}}</main>', master_css: '' }]])
      .mockResolvedValueOnce([[{ id: '11111111-1111-4111-8111-111111111111', position: 0, anchor: 'opening', title: 'Opening', target_seconds: 0, speaker_notes: '', html: '', css: '', javascript: '' }]]) };
    await expect(buildCompleteSnapshot(connection, 2)).resolves.toEqual({
      schemaVersion: 1,
      webinar: { slug: 'intro', title: 'Intro', masterHtml: '<main>{{SLIDE_CONTENT}}</main>', masterCss: '' },
      slides: [{ id: '11111111-1111-4111-8111-111111111111', position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' }],
    });
  });
});
