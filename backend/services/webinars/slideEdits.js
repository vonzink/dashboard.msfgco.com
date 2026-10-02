const db = require('../../db/connection');

// Saved edits for the static webinar decks. A row holds one slide's HTML, its
// own CSS and its own JS, for everyone; removing it restores the deck's
// original. An empty html means "keep the deck's own markup". The row with
// slide id MASTER_ID carries the deck-wide Master CSS.

const MASTER_ID = '_master';
const MAX_HTML_BYTES = 200 * 1024;
const MAX_CSS_BYTES = 100 * 1024;
const MAX_JS_BYTES = 100 * 1024;
const COLUMNS = 'slide_id, html, css, js, updated_at';

class SlideEditError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SlideEditError';
    this.code = code;
    this.status = status;
  }
}

function boundedText(value, field, maxBytes) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new SlideEditError('VALIDATION_FAILED', `${field} must be text`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new SlideEditError('CONTENT_LIMIT_EXCEEDED', `${field} exceeds ${maxBytes / 1024} KB`, 413);
  }
  return value;
}

function toEdit(row) {
  return {
    slideId: row.slide_id,
    html: row.html,
    css: row.css,
    js: row.js,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function createSlideEditsService({ db: database = db } = {}) {
  async function listBySlug(slug) {
    const [rows] = await database.query(
      `SELECT ${COLUMNS} FROM webinar_slide_edits WHERE slug = ? ORDER BY slide_id`,
      [slug],
    );
    return rows.map(toEdit);
  }

  async function save(slug, slideId, { html, css, js } = {}) {
    const content = [
      boundedText(html, 'html', MAX_HTML_BYTES),
      boundedText(css, 'css', MAX_CSS_BYTES),
      boundedText(js, 'js', MAX_JS_BYTES),
    ];
    if (content.every(text => !text.trim())) {
      throw new SlideEditError('VALIDATION_FAILED', 'There is nothing to save');
    }
    await database.query(
      `INSERT INTO webinar_slide_edits (slug, slide_id, html, css, js) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE html = VALUES(html), css = VALUES(css), js = VALUES(js)`,
      [slug, slideId, ...content],
    );
    const [rows] = await database.query(
      `SELECT ${COLUMNS} FROM webinar_slide_edits WHERE slug = ? AND slide_id = ?`,
      [slug, slideId],
    );
    return toEdit(rows[0]);
  }

  async function remove(slug, slideId) {
    const [result] = await database.query(
      'DELETE FROM webinar_slide_edits WHERE slug = ? AND slide_id = ?',
      [slug, slideId],
    );
    return result.affectedRows > 0;
  }

  return { listBySlug, save, remove };
}

module.exports = {
  MASTER_ID,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_JS_BYTES,
  SlideEditError,
  createSlideEditsService,
};
