import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MASTER_ID,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_JS_BYTES,
  SlideEditError,
  createSlideEditsService,
} = require('../../../services/webinars/slideEdits');

const row = { slide_id: 'opening', html: '<h1>Hi</h1>', css: '', js: '', updated_at: new Date('2026-10-01T12:00:00.000Z') };
let db;
let edits;

beforeEach(() => {
  db = { query: vi.fn() };
  edits = createSlideEditsService({ db });
});

describe('slide edits service', () => {
  it('lists a deck\'s saved edits', async () => {
    db.query.mockResolvedValueOnce([[row]]);
    await expect(edits.listBySlug('reverse-mortgages')).resolves.toEqual([
      { slideId: 'opening', html: '<h1>Hi</h1>', css: '', js: '', updatedAt: '2026-10-01T12:00:00.000Z' },
    ]);
    expect(db.query.mock.calls[0][1]).toEqual(['reverse-mortgages']);
  });

  it('saves one row per slide, replacing an earlier edit', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 2 }]).mockResolvedValueOnce([[row]]);
    const result = await edits.save('reverse-mortgages', 'opening', { html: '<h1>Hi</h1>', js: 'slide.dataset.ready = "1";' });
    expect(result.slideId).toBe('opening');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(params).toEqual(['reverse-mortgages', 'opening', '<h1>Hi</h1>', '', 'slide.dataset.ready = "1";']);
  });

  it('saves the Master CSS, and CSS-only or JS-only slide edits, with no html', async () => {
    db.query.mockResolvedValue([[{ ...row, slide_id: MASTER_ID, html: '', css: '.source-title { color: red; }' }]]);
    await edits.save('reverse-mortgages', MASTER_ID, { css: '.source-title { color: red; }' });
    expect(db.query.mock.calls[0][1]).toEqual(['reverse-mortgages', MASTER_ID, '', '.source-title { color: red; }', '']);
  });

  it('rejects empty, non-text and oversized content before writing', async () => {
    const cases = [
      [{ html: '   ', css: '', js: '\n' }, 'VALIDATION_FAILED', 400],
      [{}, 'VALIDATION_FAILED', 400],
      [{ html: '<p>x</p>', css: 7 }, 'VALIDATION_FAILED', 400],
      [{ html: '<p>x</p>', js: {} }, 'VALIDATION_FAILED', 400],
      [{ html: 'x'.repeat(MAX_HTML_BYTES + 1) }, 'CONTENT_LIMIT_EXCEEDED', 413],
      [{ html: '<p>x</p>', css: 'x'.repeat(MAX_CSS_BYTES + 1) }, 'CONTENT_LIMIT_EXCEEDED', 413],
      [{ html: '<p>x</p>', js: 'x'.repeat(MAX_JS_BYTES + 1) }, 'CONTENT_LIMIT_EXCEEDED', 413],
    ];
    for (const [body, code, status] of cases) {
      const error = await edits.save('reverse-mortgages', 'opening', body).catch(e => e);
      expect(error).toBeInstanceOf(SlideEditError);
      expect(error).toMatchObject({ code, status });
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it('lists created webinars with their titles, falling back to the slug', async () => {
    const at = new Date('2026-10-01T12:00:00.000Z');
    db.query.mockResolvedValueOnce([[
      { slug: 'first-time-buyers', html: '{"title":"  First-time buyers "}', created_at: at, updated_at: at },
      { slug: 'no-title', html: 'not json', created_at: at, updated_at: at },
      { slug: 'odd-title', html: '{"title":7}', created_at: at, updated_at: at },
    ]]);
    const webinars = await edits.listWebinars();
    expect(webinars.map(w => [w.slug, w.title])).toEqual([
      ['first-time-buyers', 'First-time buyers'], ['no-title', 'no-title'], ['odd-title', 'odd-title'],
    ]);
    expect(webinars[0].createdAt).toBe('2026-10-01T12:00:00.000Z');
    expect(db.query.mock.calls[0][1]).toEqual(['_webinar']);
  });

  it('removes an edit and reports whether one existed', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(edits.remove('reverse-mortgages', 'opening')).resolves.toBe(true);
    await expect(edits.remove('reverse-mortgages', 'opening')).resolves.toBe(false);
  });
});
