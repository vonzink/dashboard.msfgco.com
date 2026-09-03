const db = require('../../db/connection');
const { LIMITS } = require('../../validation/schemas/webinars');
const {
  assertCandidateWithinLimits, validateCss, validateJavascript, validateMasterHtml,
  validateSlideHtml,
} = require('./contentPolicy');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANCHOR = /^[a-z][a-z0-9-]{0,189}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WEBINAR_FIELDS = ['slug', 'title', 'masterHtml', 'masterCss'];
const SLIDE_FIELDS = ['id', 'position', 'anchor', 'title', 'targetSeconds', 'speakerNotes', 'html', 'css', 'javascript'];

class RevisionError extends Error {
  constructor(code, message = 'Invalid webinar revision') {
    super(message);
    this.name = 'RevisionError';
    this.code = code;
  }
}

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

function snapshotFromRows(webinar, slides) {
  return {
    schemaVersion: 1,
    webinar: {
      slug: webinar.slug,
      title: webinar.title,
      masterHtml: webinar.master_html,
      masterCss: webinar.master_css,
    },
    slides: slides.map(slide => ({
      id: slide.id,
      position: number(slide.position),
      anchor: slide.anchor,
      title: slide.title,
      targetSeconds: number(slide.target_seconds),
      speakerNotes: slide.speaker_notes,
      html: slide.html,
      css: slide.css,
      javascript: slide.javascript,
    })),
  };
}

async function buildCompleteSnapshot(connection, webinarId) {
  const [webinars] = await connection.query(
    `SELECT slug, title, master_html, master_css
     FROM webinar_presentations
     WHERE id = ? AND archived_at IS NULL`,
    [webinarId],
  );
  if (!webinars[0]) throw new RevisionError('WEBINAR_NOT_FOUND', 'Webinar not found');
  const [slides] = await connection.query(
    `SELECT id, position, anchor, title, target_seconds, speaker_notes, html, css, javascript
     FROM webinar_slides
     WHERE webinar_id = ? AND archived_at IS NULL
     ORDER BY position ASC`,
    [webinarId],
  );
  return snapshotFromRows(webinars[0], slides);
}

function assertCompleteSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || snapshot.schemaVersion !== 1 || !snapshot.webinar || Array.isArray(snapshot.webinar)
    || !Array.isArray(snapshot.slides)
    || Object.keys(snapshot).length !== 3
    || !Object.prototype.hasOwnProperty.call(snapshot, 'schemaVersion')
    || !Object.prototype.hasOwnProperty.call(snapshot, 'webinar')
    || !Object.prototype.hasOwnProperty.call(snapshot, 'slides')) {
    throw new RevisionError('REVISION_SNAPSHOT_INVALID');
  }
  if (Object.keys(snapshot.webinar).length !== WEBINAR_FIELDS.length
    || WEBINAR_FIELDS.some(field => typeof snapshot.webinar[field] !== 'string')
    || !SLUG.test(snapshot.webinar.slug) || snapshot.webinar.slug.length > 190
    || !snapshot.webinar.title.trim() || snapshot.webinar.title.length > 255) {
    throw new RevisionError('REVISION_SNAPSHOT_INVALID');
  }
  const ids = new Set();
  const anchors = new Set();
  for (const [position, slide] of snapshot.slides.entries()) {
    if (!slide || typeof slide !== 'object' || Array.isArray(slide)
      || Object.keys(slide).length !== SLIDE_FIELDS.length
      || SLIDE_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(slide, field))
      || !UUID.test(slide.id) || !ANCHOR.test(slide.anchor)
      || !Number.isInteger(slide.position) || slide.position !== position
      || !Number.isInteger(slide.targetSeconds) || slide.targetSeconds < 0 || slide.targetSeconds > 7200
      || ['title', 'speakerNotes', 'html', 'css', 'javascript'].some(field => typeof slide[field] !== 'string')
      || !slide.title.trim() || slide.title.length > 255
      || Buffer.byteLength(slide.speakerNotes, 'utf8') > LIMITS.speaker_notes) {
      throw new RevisionError('REVISION_SNAPSHOT_INVALID');
    }
    if (ids.has(slide.id) || anchors.has(slide.anchor)) throw new RevisionError('REVISION_SNAPSHOT_INVALID');
    ids.add(slide.id);
    anchors.add(slide.anchor);
  }
  assertSnapshotContentPolicy(snapshot);
  return snapshot;
}

function assertSnapshotContentPolicy(snapshot) {
  const candidate = {
    masterHtml: snapshot.webinar.masterHtml,
    masterCss: snapshot.webinar.masterCss,
    slides: snapshot.slides,
  };
  const issues = [
    ...validateMasterHtml(candidate.masterHtml).issues,
    ...validateCss(candidate.masterCss, 'master_css').issues,
  ];
  for (const slide of candidate.slides) {
    issues.push(
      ...validateSlideHtml(slide.html).issues,
      ...validateCss(slide.css, 'slide_css').issues,
      ...validateJavascript(slide.javascript).issues,
    );
  }
  try {
    assertCandidateWithinLimits(candidate);
  } catch (error) {
    issues.push(...(error.issues || [{ code: error.code || 'CONTENT_LIMIT_EXCEEDED' }]));
  }
  if (issues.length) throw new RevisionError('REVISION_SNAPSHOT_INVALID');
}

async function insertRevision(connection, { webinarId, liveVersion, snapshot, changeType, changeSummary, actorUserId }) {
  assertCompleteSnapshot(snapshot);
  const [result] = await connection.query(
    `INSERT INTO webinar_revisions
       (webinar_id, version, snapshot, change_type, change_summary, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [webinarId, liveVersion, JSON.stringify(snapshot), changeType, changeSummary, actorUserId],
  );
  return Number(result.insertId);
}

async function listHistory(webinarId) {
  const [rows] = await db.query(
    `SELECT r.id, r.version, r.change_type, r.change_summary, r.created_at, u.name AS creator_name
     FROM webinar_revisions r
     JOIN users u ON u.id = r.created_by_user_id
     WHERE r.webinar_id = ?
     ORDER BY r.version DESC`,
    [webinarId],
  );
  return rows.map(row => ({
    id: number(row.id),
    version: number(row.version),
    changeType: row.change_type,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
    createdBy: { name: row.creator_name },
  }));
}

async function getRevisionForRestore(webinarId, revisionId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id, webinar_id, version, snapshot
     FROM webinar_revisions
     WHERE webinar_id = ? AND id = ?`,
    [webinarId, revisionId],
  );
  const row = rows[0];
  if (!row) return null;
  let snapshot;
  try {
    snapshot = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
  } catch {
    throw new RevisionError('REVISION_SNAPSHOT_INVALID');
  }
  assertCompleteSnapshot(snapshot);
  return { id: number(row.id), webinarId: number(row.webinar_id), version: number(row.version), snapshot };
}

module.exports = {
  RevisionError,
  buildCompleteSnapshot,
  assertCompleteSnapshot,
  insertRevision,
  listHistory,
  getRevisionForRestore,
};
