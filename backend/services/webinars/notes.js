const db = require('../../db/connection');

const MAX_BODY_BYTES = 10000;

class WebinarNoteError extends Error {
  constructor(code, message = 'Webinar note operation failed', extra = {}) {
    super(message);
    this.name = 'WebinarNoteError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function normalizeBody(body) {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) {
    throw new WebinarNoteError('NOTE_BODY_EMPTY', 'Note body is required', { status: 400 });
  }
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_BODY_BYTES) {
    throw new WebinarNoteError('NOTE_BODY_TOO_LONG', 'Note body exceeds 10,000 bytes', { status: 400 });
  }
  return trimmed;
}

function mapNote(row) {
  return {
    id: Number(row.id),
    slideId: row.slide_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertSlideInWebinar(slideId, webinarId) {
  const [rows] = await db.query(
    `SELECT id FROM webinar_slides
     WHERE id = ? AND webinar_id = ? AND archived_at IS NULL`,
    [slideId, webinarId],
  );
  if (!rows[0]) {
    throw new WebinarNoteError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 });
  }
}

async function listNotes({ userId, webinarId }) {
  const [rows] = await db.query(
    `SELECT id, slide_id, body, created_at, updated_at
     FROM webinar_presenter_notes
     WHERE user_id = ? AND webinar_id = ?
     ORDER BY created_at ASC, id ASC`,
    [userId, webinarId],
  );
  return rows.map(mapNote);
}

async function addNote({ userId, webinarId, slideId, body }) {
  const trimmed = normalizeBody(body);
  await assertSlideInWebinar(slideId, webinarId);
  const [result] = await db.query(
    `INSERT INTO webinar_presenter_notes
       (user_id, webinar_id, slide_id, body, source_system, source_record_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, webinarId, slideId, trimmed, null, null],
  );
  return { id: Number(result.insertId), slideId, body: trimmed };
}

async function updateNote({ userId, webinarId, noteId, body }) {
  const trimmed = normalizeBody(body);
  const [result] = await db.query(
    `UPDATE webinar_presenter_notes
     SET body = ?
     WHERE id = ? AND user_id = ? AND webinar_id = ?`,
    [trimmed, noteId, userId, webinarId],
  );
  if (!result.affectedRows) {
    throw new WebinarNoteError('NOTE_NOT_FOUND', 'Note not found', { status: 404 });
  }
  return { id: Number(noteId), body: trimmed };
}

async function deleteNote({ userId, webinarId, noteId }) {
  const [result] = await db.query(
    `DELETE FROM webinar_presenter_notes
     WHERE id = ? AND user_id = ? AND webinar_id = ?`,
    [noteId, userId, webinarId],
  );
  if (!result.affectedRows) {
    throw new WebinarNoteError('NOTE_NOT_FOUND', 'Note not found', { status: 404 });
  }
  return { id: Number(noteId) };
}

module.exports = {
  WebinarNoteError,
  listNotes,
  addNote,
  updateNote,
  deleteNote,
};
