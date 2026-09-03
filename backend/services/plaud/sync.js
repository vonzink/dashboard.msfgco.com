/**
 * services/plaud/sync.js
 *
 * Copies new Plaud recordings into our own S3 bucket.
 *
 * Flow, per run:
 *   1. Ask Plaud for the newest recordings (one page by default).
 *   2. Skip anything plaud_recordings already marks as synced, or that has
 *      failed too many times.
 *   3. Fetch the recording's 24h signed audio link and stream the MP3
 *      straight into S3 — no temp file, nothing held in memory.
 *   4. Record the S3 location, size and timing on the row.
 *
 * Recordings whose audio has not reached Plaud's cloud yet (device not synced)
 * come back without a signed link. Those stay `pending` and do not count as an
 * attempt, so a recorder left in a drawer for a week still gets picked up.
 *
 * Runs sequentially on purpose: one download at a time is plenty for a
 * half-hourly cron and keeps the job easy to reason about.
 */

const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const db = require('../../db/connection');
const logger = require('../../lib/logger');
const s3 = require('../s3');
const { PlaudClient } = require('./client');

const DEFAULTS = {
  pages: Number(process.env.PLAUD_SYNC_PAGES) || 1,
  pageSize: Number(process.env.PLAUD_SYNC_PAGE_SIZE) || 50,
  maxAttempts: Number(process.env.PLAUD_SYNC_MAX_ATTEMPTS) || 5,
  prefix: (process.env.PLAUD_S3_PREFIX || 'recordings').replace(/^\/+|\/+$/g, ''),
};

const STATUS = {
  PENDING: 'pending',
  SYNCED: 'synced',
  FAILED: 'failed',
};

class AudioNotReadyError extends Error {
  constructor(fileId) {
    super(`Plaud has no audio link yet for recording ${fileId}`);
    this.name = 'AudioNotReadyError';
  }
}

// ── Key building ─────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

/** Parse Plaud's timestamps (ISO-ish, no zone) into a Date, or null. */
function parseWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `<prefix>/<YYYY>/<MM>/<YYYYMMDD-HHMMSS>_<plaudFileId>.mp3`
 * Sorted by folder and by name, and the Plaud id keeps it unique even if two
 * recorders start in the same second.
 */
function buildS3Key(recording, prefix = DEFAULTS.prefix) {
  const when = parseWhen(recording.startAt) || parseWhen(recording.createdAt) || new Date();
  const yyyy = when.getUTCFullYear();
  const mm = pad(when.getUTCMonth() + 1);
  const dd = pad(when.getUTCDate());
  const stamp = `${yyyy}${mm}${dd}-${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}`;
  return `${prefix}/${yyyy}/${mm}/${stamp}_${recording.id}.mp3`;
}

/** MySQL DATETIME (UTC) from a Plaud timestamp, or null. */
function toSqlDateTime(value) {
  const d = parseWhen(value);
  return d ? d.toISOString().slice(0, 19).replace('T', ' ') : null;
}

// ── Database ─────────────────────────────────────────────────────

/** Rows for the given Plaud ids, keyed by id. */
async function loadKnown(fileIds) {
  if (fileIds.length === 0) return new Map();
  const [rows] = await db.query(
    `SELECT plaud_file_id, status, attempts, s3_key
       FROM plaud_recordings
      WHERE plaud_file_id IN (?)`,
    [fileIds]
  );
  return new Map(rows.map((r) => [r.plaud_file_id, r]));
}

/** Insert the row on first sight. Metadata is refreshed on later runs. */
async function upsertRow(recording) {
  await db.query(
    `INSERT INTO plaud_recordings
       (plaud_file_id, name, device_serial, recorded_at, duration_ms, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       device_serial = VALUES(device_serial),
       recorded_at = VALUES(recorded_at),
       duration_ms = VALUES(duration_ms)`,
    [
      recording.id,
      recording.name,
      recording.deviceSerial,
      toSqlDateTime(recording.startAt),
      recording.durationMs,
      STATUS.PENDING,
    ]
  );
}

async function markSynced(fileId, { bucket, key, bytes }) {
  await db.query(
    `UPDATE plaud_recordings
        SET status = ?, s3_bucket = ?, s3_key = ?, bytes = ?, last_error = NULL, synced_at = NOW()
      WHERE plaud_file_id = ?`,
    [STATUS.SYNCED, bucket, key, bytes, fileId]
  );
}

async function markFailed(fileId, err, maxAttempts) {
  const message = String(err?.message || err).slice(0, 2000);
  // attempts + 1 >= max → failed (stop retrying), otherwise stays pending.
  await db.query(
    `UPDATE plaud_recordings
        SET attempts = attempts + 1,
            last_error = ?,
            status = IF(attempts + 1 >= ?, ?, ?)
      WHERE plaud_file_id = ?`,
    [message, maxAttempts, STATUS.FAILED, STATUS.PENDING, fileId]
  );
}

// ── Copy ─────────────────────────────────────────────────────────

/** Pass-through that counts bytes so we can store the file size. */
function byteCounter() {
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      counter.bytes += chunk.length;
      cb(null, chunk);
    },
  });
  counter.bytes = 0;
  return counter;
}

/**
 * Stream one recording from Plaud into S3.
 * @returns {Promise<{bucket:string,key:string,bytes:number}>}
 */
async function copyToS3(client, recording, { bucket, prefix }) {
  const detail = await client.getFile(recording.id);
  const url = detail?.presigned_url;
  if (!url) throw new AudioNotReadyError(recording.id);

  const key = buildS3Key(recording, prefix);
  const { stream } = await client.openAudioStream(url);
  const counter = byteCounter();

  // Upload consumes `counter`; pipeline drives source → counter and surfaces
  // download errors. Both must finish for the copy to count.
  const upload = s3.uploadStream(bucket, key, counter, {
    contentType: 'audio/mpeg',
    metadata: {
      'plaud-file-id': recording.id,
      'plaud-name': asciiOnly(recording.name || ''),
      'plaud-recorded-at': recording.startAt || '',
    },
  });
  try {
    await Promise.all([pipeline(stream, counter), upload]);
  } catch (err) {
    // Whichever side failed, make sure the other stops too — otherwise a
    // failed upload leaves the download parked on backpressure forever.
    stream.destroy?.(err);
    counter.destroy?.(err);
    throw err;
  }

  return { bucket, key, bytes: counter.bytes };
}

/** S3 user metadata must be ASCII. Strip anything else and cap the length. */
function asciiOnly(value) {
  return String(value).replace(/[^\x20-\x7E]/g, '').slice(0, 256);
}

// ── Orchestration ────────────────────────────────────────────────

/**
 * Run one sync pass.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]   List and report, upload nothing, write nothing
 * @param {number}  [options.pages]          How many pages of recent recordings to scan
 * @param {number}  [options.pageSize]
 * @param {number}  [options.limit]          Stop after this many uploads (handy for a first run)
 * @param {number}  [options.maxAttempts]
 * @param {string}  [options.bucket]         Defaults to BUCKETS.plaud (PLAUD_S3_BUCKET)
 * @param {string}  [options.prefix]
 * @param {PlaudClient} [options.client]     Injected for tests
 * @returns {Promise<{seen:number,uploaded:number,skipped:number,notReady:number,failed:number,dryRun:boolean,items:object[]}>}
 */
async function runPlaudSync(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const pages = options.pages || DEFAULTS.pages;
  const pageSize = options.pageSize || DEFAULTS.pageSize;
  const maxAttempts = options.maxAttempts || DEFAULTS.maxAttempts;
  const prefix = options.prefix || DEFAULTS.prefix;
  const bucket = options.bucket || s3.BUCKETS.plaud;
  const limit = options.limit || Infinity;
  const client = options.client || new PlaudClient({ logger });

  if (!bucket) throw new Error('PLAUD_S3_BUCKET is not set');

  const summary = { seen: 0, uploaded: 0, skipped: 0, notReady: 0, failed: 0, dryRun, items: [] };

  // 1. Gather recent recordings.
  const recordings = [];
  for (let page = 1; page <= pages; page += 1) {
    const batch = await client.listFiles({ page, pageSize });
    recordings.push(...batch);
    if (batch.length < pageSize) break; // last page
  }
  summary.seen = recordings.length;

  // 2. Decide what needs doing.
  const known = await loadKnown(recordings.map((r) => r.id));
  const todo = recordings.filter((r) => {
    const row = known.get(r.id);
    if (!row) return true;
    if (row.status === STATUS.SYNCED) return false;
    if (row.status === STATUS.FAILED) return false;
    return true;
  });
  summary.skipped = recordings.length - todo.length;

  logger.info({ seen: summary.seen, todo: todo.length, dryRun, bucket }, 'Plaud sync: scan complete');

  // 3./4. Copy and record, one at a time.
  for (const recording of todo) {
    if (summary.uploaded >= limit) break;
    const key = buildS3Key(recording, prefix);

    if (dryRun) {
      summary.items.push({ id: recording.id, name: recording.name, key, action: 'would-upload' });
      continue;
    }

    await upsertRow(recording);
    try {
      const result = await copyToS3(client, recording, { bucket, prefix });
      await markSynced(recording.id, result);
      summary.uploaded += 1;
      summary.items.push({ id: recording.id, name: recording.name, key: result.key, bytes: result.bytes, action: 'uploaded' });
      logger.info({ fileId: recording.id, key: result.key, bytes: result.bytes }, 'Plaud sync: uploaded');
    } catch (err) {
      if (err instanceof AudioNotReadyError) {
        summary.notReady += 1;
        summary.items.push({ id: recording.id, name: recording.name, action: 'not-ready' });
        logger.info({ fileId: recording.id }, 'Plaud sync: audio not available yet, will retry');
        continue;
      }
      summary.failed += 1;
      summary.items.push({ id: recording.id, name: recording.name, action: 'failed', error: err.message });
      logger.warn({ err, fileId: recording.id }, 'Plaud sync: upload failed');
      await markFailed(recording.id, err, maxAttempts);
    }
  }

  logger.info(
    { uploaded: summary.uploaded, skipped: summary.skipped, notReady: summary.notReady, failed: summary.failed, dryRun },
    'Plaud sync: done'
  );
  return summary;
}

module.exports = {
  DEFAULTS,
  STATUS,
  AudioNotReadyError,
  buildS3Key,
  toSqlDateTime,
  copyToS3,
  runPlaudSync,
};
