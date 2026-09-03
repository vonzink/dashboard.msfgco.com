import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../../db/connection');
const notesPath = path.resolve(import.meta.dirname, '../../../services/webinars/notes.js');
const originalDb = require.cache[dbPath];
const db = { query: vi.fn(), getConnection: vi.fn() };
let lockedOwnerId;
const connection = {
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
  query: vi.fn(),
};

const slideId = '11111111-1111-4111-8111-111111111111';

function loadNotes() {
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  delete require.cache[notesPath];
  return require(notesPath);
}

beforeEach(() => {
  lockedOwnerId = 7;
  db.query.mockReset();
  db.getConnection.mockReset().mockResolvedValue(connection);
  connection.beginTransaction.mockReset().mockResolvedValue(undefined);
  connection.commit.mockReset().mockResolvedValue(undefined);
  connection.rollback.mockReset().mockResolvedValue(undefined);
  connection.release.mockReset();
  connection.destroy.mockReset();
  connection.query.mockReset().mockImplementation((sql, params) => {
    if (sql.includes('FROM webinar_presentations') && sql.includes('FOR UPDATE')) {
      return Promise.resolve([[{ id: params[0], primary_owner_user_id: lockedOwnerId }]]);
    }
    return db.query(sql, params);
  });
});

afterEach(() => {
  delete require.cache[notesPath];
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
});

describe('Webinar Studio presenter notes', () => {
  describe('listNotes', () => {
    it('queries with user_id and webinar_id filters', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, slide_id: slideId, body: 'Hello', created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z' },
      ]]);
      const { listNotes } = loadNotes();
      const result = await listNotes({ userId: 7, webinarId: 2 });
      expect(result).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), [7, 2]);
      expect(db.query.mock.calls[0][0]).toMatch(/user_id = \?/);
      expect(db.query.mock.calls[0][0]).toMatch(/webinar_id = \?/);
    });
  });

  describe('addNote', () => {
    it('rejects empty body before any DB call', async () => {
      const { addNote } = loadNotes();
      await expect(addNote({ userId: 7, webinarId: 2, slideId, body: '   ' }))
        .rejects.toMatchObject({ code: 'NOTE_BODY_EMPTY' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects body exceeding 10,000 UTF-8 bytes before any DB call', async () => {
      const { addNote } = loadNotes();
      await expect(addNote({ userId: 7, webinarId: 2, slideId, body: 'x'.repeat(10001) }))
        .rejects.toMatchObject({ code: 'NOTE_BODY_TOO_LONG' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('accepts exactly 10,000 UTF-8 bytes and rejects one byte over with multibyte text', async () => {
      const exact = `${'€'.repeat(3333)}x`;
      expect(Buffer.byteLength(exact, 'utf8')).toBe(10000);
      db.query
        .mockResolvedValueOnce([[{ id: slideId }]])
        .mockResolvedValueOnce([{ insertId: 7 }]);
      const { addNote } = loadNotes();
      await expect(addNote({ userId: 7, webinarId: 2, slideId, body: exact }))
        .resolves.toMatchObject({ id: 7, body: exact });
      await expect(addNote({ userId: 7, webinarId: 2, slideId, body: `${exact}x` }))
        .rejects.toMatchObject({ code: 'NOTE_BODY_TOO_LONG' });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('checks that slide belongs to the target webinar', async () => {
      db.query.mockResolvedValueOnce([[]]); // slide not found
      const { addNote } = loadNotes();
      await expect(addNote({ userId: 7, webinarId: 2, slideId, body: 'Hello' }))
        .rejects.toMatchObject({ code: 'SLIDE_NOT_FOUND', status: 404 });
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][1]).toEqual([slideId, 2]);
    });

    it('inserts with NULL source_system and source_record_id and returns id', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: slideId }]])
        .mockResolvedValueOnce([{ insertId: 5 }]);
      const { addNote } = loadNotes();
      const note = await addNote({ userId: 7, webinarId: 2, slideId, body: 'My note' });
      expect(note).toMatchObject({ id: 5, body: 'My note' });
      expect(db.query.mock.calls[1][1]).toEqual([7, 2, slideId, 'My note', null, null]);
    });

    it('trims body before inserting', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: slideId }]])
        .mockResolvedValueOnce([{ insertId: 6 }]);
      const { addNote } = loadNotes();
      const note = await addNote({ userId: 7, webinarId: 2, slideId, body: '  Trimmed  ' });
      expect(note.body).toBe('Trimmed');
      expect(db.query.mock.calls[1][1][3]).toBe('Trimmed');
    });

    it('accepts multiple notes for the same user and slide', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: slideId }]])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([[{ id: slideId }]])
        .mockResolvedValueOnce([{ insertId: 2 }]);
      const { addNote } = loadNotes();
      const first = await addNote({ userId: 7, webinarId: 2, slideId, body: 'First note' });
      const second = await addNote({ userId: 7, webinarId: 2, slideId, body: 'Second note' });
      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });
  });

  describe('locked webinar authorization', () => {
    it.each([
      ['add', notes => notes.addNote({ userId: 7, webinarId: 2, slideId, body: 'Mine' })],
      ['update', notes => notes.updateNote({ userId: 7, webinarId: 2, noteId: 11, body: 'Mine' })],
      ['delete', notes => notes.deleteNote({ userId: 7, webinarId: 2, noteId: 11 })],
    ])('denies a stale former owner before a %s note write', async (_name, run) => {
      lockedOwnerId = 8;
      const notes = loadNotes();

      await expect(run(notes)).rejects.toMatchObject({
        code: 'WEBINAR_ACCESS_DENIED',
        status: 403,
      });
      expect(connection.query).toHaveBeenCalledWith(
        expect.stringMatching(/webinar_presentations[\s\S]*FOR UPDATE/),
        [2],
      );
      expect(db.query).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
    });

    it('allows a server-asserted administrator to write their own note on another owner webinar', async () => {
      lockedOwnerId = 8;
      db.query
        .mockResolvedValueOnce([[{ id: slideId }]])
        .mockResolvedValueOnce([{ insertId: 5 }]);
      const { addNote } = loadNotes();

      await expect(addNote({
        userId: 1,
        actorIsAdmin: true,
        webinarId: 2,
        slideId,
        body: 'Admin note',
      })).resolves.toMatchObject({ id: 5, body: 'Admin note' });
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateNote', () => {
    it('scopes UPDATE with WHERE id = ? AND user_id = ? AND webinar_id = ? and params [body, noteId, userId, webinarId]', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { updateNote } = loadNotes();
      await updateNote({ userId: 7, webinarId: 2, noteId: 11, body: 'Mine' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE id = \? AND user_id = \? AND webinar_id = \?/),
        ['Mine', 11, 7, 2],
      );
    });

    it('returns 404 indistinguishably when note not found or belongs to another user', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      const { updateNote } = loadNotes();
      await expect(updateNote({ userId: 7, webinarId: 2, noteId: 11, body: 'Mine' }))
        .rejects.toMatchObject({ code: 'NOTE_NOT_FOUND', status: 404 });
    });

    it('rejects empty body', async () => {
      const { updateNote } = loadNotes();
      await expect(updateNote({ userId: 7, webinarId: 2, noteId: 11, body: '' }))
        .rejects.toMatchObject({ code: 'NOTE_BODY_EMPTY' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects body exceeding 10,000 UTF-8 bytes', async () => {
      const { updateNote } = loadNotes();
      await expect(updateNote({ userId: 7, webinarId: 2, noteId: 11, body: 'A'.repeat(10001) }))
        .rejects.toMatchObject({ code: 'NOTE_BODY_TOO_LONG' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('enforces the multibyte UTF-8 boundary while updating', async () => {
      const exact = `${'€'.repeat(3333)}x`;
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { updateNote } = loadNotes();
      await expect(updateNote({ userId: 7, webinarId: 2, noteId: 11, body: exact }))
        .resolves.toMatchObject({ id: 11, body: exact });
      await expect(updateNote({ userId: 7, webinarId: 2, noteId: 11, body: `${exact}x` }))
        .rejects.toMatchObject({ code: 'NOTE_BODY_TOO_LONG' });
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('trims body before updating', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { updateNote } = loadNotes();
      const result = await updateNote({ userId: 7, webinarId: 2, noteId: 11, body: '  Padded  ' });
      expect(result.body).toBe('Padded');
      expect(db.query.mock.calls[0][1][0]).toBe('Padded');
    });
  });

  describe('deleteNote', () => {
    it('scopes DELETE with WHERE id = ? AND user_id = ? AND webinar_id = ?', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { deleteNote } = loadNotes();
      await deleteNote({ userId: 7, webinarId: 2, noteId: 11 });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE id = \? AND user_id = \? AND webinar_id = \?/),
        [11, 7, 2],
      );
    });

    it('returns 404 indistinguishably when note not found or belongs to another user', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      const { deleteNote } = loadNotes();
      await expect(deleteNote({ userId: 7, webinarId: 2, noteId: 99 }))
        .rejects.toMatchObject({ code: 'NOTE_NOT_FOUND', status: 404 });
    });
  });
});
