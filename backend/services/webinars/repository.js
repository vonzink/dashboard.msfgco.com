const db = require('../../db/connection');
const { getUserId, isAdmin } = require('../../middleware/userContext');
const { loadResourcePolicy } = require('./contentPolicy');

function numberValue(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapSummary(row) {
  return {
    id: numberValue(row.id),
    slug: row.slug,
    title: row.title,
    primaryOwnerUserId: numberValue(row.primary_owner_user_id),
    liveVersion: numberValue(row.live_version),
    audienceEnabled: Boolean(Number(row.audience_enabled)),
  };
}

function mapPrivateSlide(row) {
  return {
    id: row.id,
    anchor: row.anchor,
    title: row.title,
    targetSeconds: numberValue(row.target_seconds),
    speakerNotes: row.speaker_notes,
    html: row.html,
    css: row.css,
    javascript: row.javascript,
  };
}

function mapPublicSlide(row) {
  return {
    id: row.id,
    anchor: row.anchor,
    title: row.title,
    html: row.html,
    css: row.css,
    javascript: row.javascript,
  };
}

async function listForRequest(req) {
  const sql = [
    'SELECT id, slug, title, primary_owner_user_id, live_version, audience_enabled',
    'FROM webinar_presentations',
    'WHERE archived_at IS NULL',
  ];
  const params = [];

  if (!isAdmin(req)) {
    sql.push('AND primary_owner_user_id = ?');
    params.push(getUserId(req));
  }

  sql.push('ORDER BY updated_at DESC, id DESC');
  const [rows] = await db.query(sql.join('\n'), params);
  return rows.map(mapSummary);
}

async function getPrivateDocument(id) {
  const [webinars] = await db.query(
    `SELECT id, slug, title, primary_owner_user_id, master_html, master_css, live_version, audience_enabled
     FROM webinar_presentations
     WHERE id = ? AND archived_at IS NULL`,
    [id],
  );
  const webinar = webinars[0];
  if (!webinar) return null;

  const [slides] = await db.query(
    `SELECT id, anchor, title, target_seconds, speaker_notes, html, css, javascript
     FROM webinar_slides
     WHERE webinar_id = ? AND archived_at IS NULL
     ORDER BY position ASC`,
    [id],
  );

  return {
    id: numberValue(webinar.id),
    slug: webinar.slug,
    title: webinar.title,
    primaryOwnerUserId: numberValue(webinar.primary_owner_user_id),
    liveVersion: numberValue(webinar.live_version),
    audienceEnabled: Boolean(Number(webinar.audience_enabled)),
    masterHtml: webinar.master_html,
    masterCss: webinar.master_css,
    resourcePolicy: loadResourcePolicy(),
    slides: slides.map(mapPrivateSlide),
  };
}

async function getLiveSlides(webinarId) {
  const [slides] = await db.query(
    `SELECT s.id, s.anchor, s.title, s.html, s.css, s.javascript
     FROM webinar_slides s
     JOIN webinar_presentations p ON p.id = s.webinar_id
     WHERE s.webinar_id = ?
       AND s.archived_at IS NULL
       AND p.archived_at IS NULL
       AND p.audience_enabled = 1
     ORDER BY s.position ASC`,
    [webinarId],
  );
  return slides.map(mapPublicSlide);
}

module.exports = {
  listForRequest,
  getPrivateDocument,
  getLiveSlides,
};
