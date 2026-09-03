const db = require('../../db/connection');
const { runTransaction } = require('./transaction');

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

async function assertSlideInWebinar(connection, slideId, webinarId) {
  const [rows] = await connection.query(
    `SELECT id FROM webinar_slides
     WHERE id = ? AND webinar_id = ? AND archived_at IS NULL`,
    [slideId, webinarId],
  );
  if (!rows[0]) {
    throw new WebinarNoteError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 });
  }
}

async function assertLockedWebinarAccess(connection, { userId, actorIsAdmin, webinarId }) {
  const [rows] = await connection.query(
    `SELECT id, primary_owner_user_id
     FROM webinar_presentations
     WHERE id = ? AND archived_at IS NULL
     FOR UPDATE`,
    [webinarId],
  );
  const webinar = rows[0];
  if (!webinar) {
    throw new WebinarNoteError('WEBINAR_NOT_FOUND', 'Webinar not found', { status: 404 });
  }
  if (!Number.isSafeInteger(userId)
    || userId <= 0
    || (actorIsAdmin !== true && Number(webinar.primary_owner_user_id) !== userId)) {
    throw new WebinarNoteError(
      'WEBINAR_ACCESS_DENIED',
      'Webinar owner or administrator access required',
      { status: 403 },
    );
  }
}

function createNoteService({ db: connectionPool = db } = {}) {
  async function listNotes({ userId, webinarId }) {
    const [rows] = await connectionPool.query(
      `SELECT id, slide_id, body, created_at, updated_at
       FROM webinar_presenter_notes
       WHERE user_id = ? AND webinar_id = ?
       ORDER BY created_at ASC, id ASC`,
      [userId, webinarId],
    );
    return rows.map(mapNote);
  }

  async function addNote(input) {
    const trimmed = normalizeBody(input.body);
    return runTransaction(connectionPool, async connection => {
      await assertLockedWebinarAccess(connection, input);
      await assertSlideInWebinar(connection, input.slideId, input.webinarId);
      const [result] = await connection.query(
        `INSERT INTO webinar_presenter_notes
           (user_id, webinar_id, slide_id, body, source_system, source_record_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.userId, input.webinarId, input.slideId, trimmed, null, null],
      );
      return { id: Number(result.insertId), slideId: input.slideId, body: trimmed };
    });
  }

  async function updateNote(input) {
    const trimmed = normalizeBody(input.body);
    return runTransaction(connectionPool, async connection => {
      await assertLockedWebinarAccess(connection, input);
      const [result] = await connection.query(
        `UPDATE webinar_presenter_notes
         SET body = ?
         WHERE id = ? AND user_id = ? AND webinar_id = ?`,
        [trimmed, input.noteId, input.userId, input.webinarId],
      );
      if (!result.affectedRows) {
        throw new WebinarNoteError('NOTE_NOT_FOUND', 'Note not found', { status: 404 });
      }
      return { id: Number(input.noteId), body: trimmed };
    });
  }

  async function deleteNote(input) {
    return runTransaction(connectionPool, async connection => {
      await assertLockedWebinarAccess(connection, input);
      const [result] = await connection.query(
        `DELETE FROM webinar_presenter_notes
         WHERE id = ? AND user_id = ? AND webinar_id = ?`,
        [input.noteId, input.userId, input.webinarId],
      );
      if (!result.affectedRows) {
        throw new WebinarNoteError('NOTE_NOT_FOUND', 'Note not found', { status: 404 });
      }
      return { id: Number(input.noteId) };
    });
  }

  return { listNotes, addNote, updateNote, deleteNote };
}

const service = createNoteService();

module.exports = {
  WebinarNoteError,
  assertLockedWebinarAccess,
  createNoteService,
  ...service,
};
