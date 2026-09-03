import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { Readable } from 'stream';

// The sync service is CommonJS and pulls in the DB pool, the logger and the
// S3 helper at require time. Swap those in the require cache (same approach
// as tests/services/userFiles.test.js) and inject a fake Plaud client.
//
// What these tests pin down: the dedupe rules (synced/failed rows are never
// re-uploaded), the S3 key shape, dry-run touching nothing, "audio not ready"
// staying pending without burning an attempt, and real failures counting
// attempts until the row is marked failed.

const require = createRequire(import.meta.url);

const dbPath = require.resolve('../../db/connection');
const loggerPath = require.resolve('../../lib/logger');
const s3Path = require.resolve('../../services/s3');
const syncPath = require.resolve('../../services/plaud/sync');

const originals = {
  [dbPath]: require.cache[dbPath],
  [loggerPath]: require.cache[loggerPath],
  [s3Path]: require.cache[s3Path],
};

const queryMock = vi.fn();
const uploadMock = vi.fn();

const dbModule = { query: (...args) => queryMock(...args) };
const loggerModule = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const s3Module = {
  BUCKETS: { plaud: 'test-plaud-bucket' },
  uploadStream: (...args) => uploadMock(...args),
};

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

/** Drain a stream so the byte counter sees every chunk, like the real Upload would. */
async function drain(stream) {
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  return bytes;
}

const REC = {
  id: 'f1',
  name: '09-02 Meeting: Audio Processing Workflow',
  createdAt: '2026-09-03T03:04:53',
  startAt: '2026-09-03T03:04:10',
  durationMs: 29000,
  deviceSerial: '888',
};

function fakeClient({ files = [REC], detail = { presigned_url: 'https://signed/f1.mp3' }, audio = 'abcdef' } = {}) {
  return {
    listFiles: vi.fn(async () => files),
    getFile: vi.fn(async () => detail),
    openAudioStream: vi.fn(async () => ({ stream: Readable.from([Buffer.from(audio)]), contentLength: audio.length })),
  };
}

/** Make the SELECT for known rows return these rows; every other query resolves empty. */
function knownRows(rows) {
  queryMock.mockImplementation(async (sql) => {
    if (/SELECT plaud_file_id/.test(sql)) return [rows];
    return [{ affectedRows: 1 }];
  });
}

/** The SQL text of every non-SELECT query, in order. */
function writes() {
  return queryMock.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0]).filter((v) => v !== 'SELECT');
}

let sync;

beforeEach(() => {
  queryMock.mockReset();
  uploadMock.mockReset();
  uploadMock.mockImplementation(async (bucket, key, body) => {
    await drain(body);
    return { bucket, key, etag: '"x"' };
  });
  stub(dbPath, dbModule);
  stub(loggerPath, loggerModule);
  stub(s3Path, s3Module);
  delete require.cache[syncPath];
  sync = require(syncPath);
});

afterEach(() => {
  for (const [p, entry] of Object.entries(originals)) {
    if (entry) require.cache[p] = entry; else delete require.cache[p];
  }
  delete require.cache[syncPath];
});

describe('buildS3Key', () => {
  it('files by year/month with a sortable timestamp and the Plaud id', () => {
    expect(sync.buildS3Key(REC, 'recordings')).toBe('recordings/2026/09/20260903-030410_f1.mp3');
  });

  it('falls back to created_at when start_at is missing', () => {
    expect(sync.buildS3Key({ ...REC, startAt: null }, 'r')).toBe('r/2026/09/20260903-030453_f1.mp3');
  });
});

describe('runPlaudSync', () => {
  it('uploads a new recording and records it', async () => {
    knownRows([]);
    const client = fakeClient();

    const summary = await sync.runPlaudSync({ client, prefix: 'recordings' });

    expect(summary).toMatchObject({ seen: 1, uploaded: 1, skipped: 0, notReady: 0, failed: 0, dryRun: false });
    expect(client.getFile).toHaveBeenCalledWith('f1');
    expect(client.openAudioStream).toHaveBeenCalledWith('https://signed/f1.mp3');

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [bucket, key, , opts] = uploadMock.mock.calls[0];
    expect(bucket).toBe('test-plaud-bucket');
    expect(key).toBe('recordings/2026/09/20260903-030410_f1.mp3');
    expect(opts.contentType).toBe('audio/mpeg');
    expect(opts.metadata['plaud-file-id']).toBe('f1');

    // INSERT (upsert) then UPDATE (mark synced) with the byte count.
    expect(writes()).toEqual(['INSERT', 'UPDATE']);
    const [updateSql, updateParams] = queryMock.mock.calls.at(-1);
    expect(updateSql).toMatch(/status = \?, s3_bucket/);
    expect(updateParams).toEqual(['synced', 'test-plaud-bucket', key, 6, 'f1']);
    expect(summary.items[0]).toMatchObject({ action: 'uploaded', bytes: 6 });
  });

  it('skips recordings already synced or permanently failed', async () => {
    knownRows([
      { plaud_file_id: 'f1', status: 'synced', attempts: 0 },
      { plaud_file_id: 'f2', status: 'failed', attempts: 5 },
    ]);
    const client = fakeClient({ files: [REC, { ...REC, id: 'f2' }, { ...REC, id: 'f3' }] });

    const summary = await sync.runPlaudSync({ client });

    expect(summary).toMatchObject({ seen: 3, uploaded: 1, skipped: 2 });
    expect(client.getFile).toHaveBeenCalledTimes(1);
    expect(client.getFile).toHaveBeenCalledWith('f3');
  });

  it('retries a pending row from an earlier run', async () => {
    knownRows([{ plaud_file_id: 'f1', status: 'pending', attempts: 1 }]);
    const client = fakeClient();

    const summary = await sync.runPlaudSync({ client });

    expect(summary.uploaded).toBe(1);
  });

  it('dry run lists what would upload and writes nothing', async () => {
    knownRows([]);
    const client = fakeClient();

    const summary = await sync.runPlaudSync({ client, dryRun: true });

    expect(summary).toMatchObject({ seen: 1, uploaded: 0, dryRun: true });
    expect(summary.items[0]).toMatchObject({ id: 'f1', action: 'would-upload' });
    expect(client.getFile).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('leaves a recording pending, without an attempt, when Plaud has no audio link yet', async () => {
    knownRows([]);
    const client = fakeClient({ detail: { id: 'f1' } });

    const summary = await sync.runPlaudSync({ client });

    expect(summary).toMatchObject({ uploaded: 0, notReady: 1, failed: 0 });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(writes()).toEqual(['INSERT']); // no failure UPDATE
  });

  it('counts a real failure as an attempt and reports it', async () => {
    knownRows([]);
    uploadMock.mockRejectedValueOnce(new Error('AccessDenied'));
    const client = fakeClient();

    const summary = await sync.runPlaudSync({ client, maxAttempts: 5 });

    expect(summary).toMatchObject({ uploaded: 0, failed: 1 });
    expect(summary.items[0]).toMatchObject({ action: 'failed', error: 'AccessDenied' });
    const [sql, params] = queryMock.mock.calls.at(-1);
    expect(sql).toMatch(/attempts = attempts \+ 1/);
    expect(params).toEqual(['AccessDenied', 5, 'failed', 'pending', 'f1']);
  });

  it('honours --limit and stops paging when a page comes back short', async () => {
    knownRows([]);
    const client = fakeClient({ files: [REC, { ...REC, id: 'f2' }] });

    const summary = await sync.runPlaudSync({ client, pages: 3, pageSize: 50, limit: 1 });

    expect(client.listFiles).toHaveBeenCalledTimes(1); // 2 < 50 → last page
    expect(summary.uploaded).toBe(1);
  });

  it('refuses to run when no bucket is configured at all', async () => {
    const saved = s3Module.BUCKETS.plaud;
    s3Module.BUCKETS.plaud = '';
    try {
      await expect(sync.runPlaudSync({ client: fakeClient() })).rejects.toThrow(/PLAUD_S3_BUCKET/);
    } finally {
      s3Module.BUCKETS.plaud = saved;
    }
  });
});
