const db = require('../../db/connection');

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
  if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.webinar || !Array.isArray(snapshot.slides)) {
    throw new RevisionError('REVISION_SNAPSHOT_INVALID');
  }
  const webinarFields = ['slug', 'title', 'masterHtml', 'masterCss'];
  const slideFields = ['id', 'position', 'anchor', 'title', 'targetSeconds', 'speakerNotes', 'html', 'css', 'javascript'];
  if (webinarFields.some(field => typeof snapshot.webinar[field] !== 'string')) throw new RevisionError('REVISION_SNAPSHOT_INVALID');
  for (const slide of snapshot.slides) {
    if (!slide || slideFields.some(field => !(field in slide)) || typeof slide.id !== 'string' || !Number.isInteger(slide.position)) {
      throw new RevisionError('REVISION_SNAPSHOT_INVALID');
    }
  }
  return snapshot;
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
