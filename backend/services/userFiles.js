/**
 * services/userFiles.js
 *
 * S3 and bookkeeping helpers for My Files (bucket: msfg-user-folders).
 *
 * Kept separate from services/s3.js because this bucket has its own KMS key,
 * lifecycle rules, and audit requirements, and because every key here must
 * come from utils/userFileKeys — mixing it with the general helpers invites a
 * caller passing a raw key.
 *
 * S3 is the source of truth for the file tree. MySQL holds only audit rows,
 * quota counters, and job state.
 */

const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectTaggingCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const db = require('../db/connection');
const logger = require('../lib/logger');
const {
  resolveUserKey,
  resolveTrashKey,
  userRootPrefix,
  userTrashPrefix,
  UserFilePathError,
  TRASH_SEGMENT,
} = require('../utils/userFileKeys');

const BUCKET = process.env.USER_FILES_BUCKET || 'msfg-user-folders';
const REGION = process.env.USER_FILES_REGION || 'us-east-1';

/**
 * Default per-user allowance. Overridable per user via
 * user_file_quota.quota_bytes, and globally via this env var.
 *
 * Set to 10 GB rather than the 100 GB in the original design: a single
 * presigned PUT tops out at 5 GB, so anything at or below this ceiling avoids
 * the multipart upload machinery entirely.
 */
const DEFAULT_QUOTA_BYTES = Number(process.env.USER_FILES_QUOTA_BYTES || 10 * 1024 * 1024 * 1024);

/** Presigned URL lifetime. Short — these are bearer capabilities. */
const SIGNED_URL_TTL_SECONDS = Number(process.env.USER_FILES_URL_TTL || 900);

const s3 = new S3Client({ region: REGION });

/**
 * List one level of the user's tree.
 *
 * Uses Delimiter so S3 returns immediate children only, rather than every
 * object beneath the prefix.
 *
 * @param {number} userId
 * @param {string} clientPath
 * @param {{ continuationToken?: string, limit?: number }} [options]
 * @returns {Promise<{folders: object[], files: object[], nextToken: string|null}>}
 */
async function listPath(userId, clientPath, options = {}) {
  const prefix = resolveUserKey(userId, clientPath, { trailingSlash: true });
  const trashPrefix = userTrashPrefix(userId);

  const result = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    Delimiter: '/',
    MaxKeys: Math.min(options.limit || 1000, 1000),
    ContinuationToken: options.continuationToken || undefined,
  }));

  const folders = (result.CommonPrefixes || [])
    // At the user's root the trash folder appears as an ordinary child. It is
    // reachable only through the trash endpoints, so hide it here.
    .filter((entry) => entry.Prefix !== trashPrefix)
    .map((entry) => {
      const name = entry.Prefix.slice(prefix.length).replace(/\/$/, '');
      return { type: 'folder', name, path: joinClientPath(clientPath, name) };
    });

  const files = (result.Contents || [])
    // The zero-byte marker that keeps an empty folder alive is the prefix
    // itself, and is not a file the user put there.
    .filter((object) => object.Key !== prefix)
    .map((object) => {
      const name = object.Key.slice(prefix.length);
      return {
        type: 'file',
        name,
        path: joinClientPath(clientPath, name),
        size: object.Size,
        lastModified: object.LastModified,
        etag: object.ETag ? object.ETag.replace(/"/g, '') : null,
      };
    });

  return {
    folders,
    files,
    nextToken: result.IsTruncated ? result.NextContinuationToken : null,
  };
}

/** Join a client-relative path with a child name, without a leading slash. */
function joinClientPath(clientPath, name) {
  const base = (clientPath || '').replace(/\/+$/, '');
  return base ? `${base}/${name}` : name;
}

/**
 * Presign a GET for one of the user's files.
 *
 * @param {number} userId
 * @param {string} clientPath
 * @param {{ inline?: boolean }} [options]  inline for preview, attachment otherwise
 * @returns {Promise<{url: string, size: number, contentType: string, expiresIn: number}>}
 */
async function getFileUrl(userId, clientPath, options = {}) {
  const key = resolveUserKey(userId, clientPath);

  // HeadObject first so a missing file is a clean 404 rather than a signed URL
  // that fails opaquely in the browser once the user clicks it.
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

  const fileName = key.split('/').pop();
  const disposition = options.inline
    ? `inline; filename="${encodeURIComponent(fileName)}"`
    : `attachment; filename="${encodeURIComponent(fileName)}"`;

  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: disposition,
  }), { expiresIn: SIGNED_URL_TTL_SECONDS });

  return {
    url,
    size: head.ContentLength,
    contentType: head.ContentType || 'application/octet-stream',
    expiresIn: SIGNED_URL_TTL_SECONDS,
  };
}

/**
 * Read a user's quota row, creating it on first access.
 *
 * @param {number} userId
 * @returns {Promise<{bytesUsed: number, fileCount: number, quotaBytes: number, reconciledAt: Date|null}>}
 */
async function getUsage(userId) {
  const [rows] = await db.query(
    'SELECT bytes_used, file_count, quota_bytes, reconciled_at FROM user_file_quota WHERE user_id = ?',
    [userId]
  );

  if (rows.length === 0) {
    await db.query(
      'INSERT IGNORE INTO user_file_quota (user_id, bytes_used, file_count) VALUES (?, 0, 0)',
      [userId]
    );
    return { bytesUsed: 0, fileCount: 0, quotaBytes: DEFAULT_QUOTA_BYTES, reconciledAt: null };
  }

  return {
    bytesUsed: Number(rows[0].bytes_used),
    fileCount: Number(rows[0].file_count),
    quotaBytes: rows[0].quota_bytes === null ? DEFAULT_QUOTA_BYTES : Number(rows[0].quota_bytes),
    reconciledAt: rows[0].reconciled_at,
  };
}

/**
 * Recompute true usage from S3 and correct the stored counters.
 *
 * Walks every object under the user's root, including trash, since trash still
 * occupies paid storage until the lifecycle rule expires it. Intended for the
 * nightly job, not the request path.
 *
 * @param {number} userId
 * @returns {Promise<{bytesUsed: number, fileCount: number}>}
 */
async function reconcileUsage(userId) {
  const prefix = userRootPrefix(userId);
  let bytesUsed = 0;
  let fileCount = 0;
  let continuationToken;

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const object of page.Contents || []) {
      // Zero-byte folder markers are structure, not content.
      if (object.Key.endsWith('/')) continue;
      bytesUsed += object.Size;
      fileCount += 1;
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  await db.query(
    `INSERT INTO user_file_quota (user_id, bytes_used, file_count, reconciled_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE bytes_used = VALUES(bytes_used),
                             file_count = VALUES(file_count),
                             reconciled_at = NOW()`,
    [userId, bytesUsed, fileCount]
  );

  return { bytesUsed, fileCount };
}

// ── Write path ───────────────────────────────────────────────────

/**
 * Largest folder operation performed inline. Beyond this the copy-and-delete
 * loop takes long enough to hit a gateway timeout, so it belongs in a job.
 */
const SYNC_OBJECT_LIMIT = 200;

/** Concurrent S3 calls during folder operations. */
const COPY_CONCURRENCY = 8;

/** S3 caps a single DeleteObjects call at 1,000 keys. */
const DELETE_BATCH_SIZE = 1000;

/** Run an async mapper over items, at most `limit` in flight. */
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Every object under a prefix, following pagination. */
async function listAllUnderPrefix(prefix) {
  const objects = [];
  let continuationToken;

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Whether a single object exists at an exact key. */
async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Delete keys in S3's maximum batch size. */
async function deleteKeys(keys) {
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

/**
 * Apply a signed delta to the stored counters.
 *
 * GREATEST(0, ...) keeps a counter from going negative if a delete is recorded
 * twice; the nightly reconcile is what restores the true figure.
 */
async function adjustQuota(userId, deltaBytes, deltaFiles) {
  await db.query(
    `INSERT INTO user_file_quota (user_id, bytes_used, file_count)
     VALUES (?, GREATEST(0, ?), GREATEST(0, ?))
     ON DUPLICATE KEY UPDATE bytes_used = GREATEST(0, CAST(bytes_used AS SIGNED) + ?),
                             file_count = GREATEST(0, CAST(file_count AS SIGNED) + ?)`,
    [userId, deltaBytes, deltaFiles, deltaBytes, deltaFiles]
  );
}

/**
 * Create an empty folder as a zero-byte marker.
 *
 * S3 has no directories. Without this marker an empty folder would vanish the
 * moment the page reloaded, because nothing would carry its prefix.
 */
async function createFolder(userId, clientPath) {
  const key = resolveUserKey(userId, clientPath, { trailingSlash: true });

  if (key === userRootPrefix(userId)) {
    throw new UserFilePathError('Folder name is required');
  }

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: '' }));
  return { path: clientPath, key };
}

/**
 * Check quota, then presign a single PUT.
 *
 * The size is checked before signing rather than after upload, because once
 * the browser holds a presigned URL the bytes go straight to S3 and the
 * backend has no further say.
 */
async function prepareUpload(userId, clientPath, declaredSize, contentType) {
  const key = resolveUserKey(userId, clientPath);
  const size = Number(declaredSize);

  if (!Number.isFinite(size) || size < 0) {
    throw new UserFilePathError('A valid file size is required');
  }

  const usage = await getUsage(userId);
  if (usage.bytesUsed + size > usage.quotaBytes) {
    const error = new Error('Storage quota exceeded');
    error.statusCode = 409;
    error.details = {
      bytesUsed: usage.bytesUsed,
      quotaBytes: usage.quotaBytes,
      bytesRemaining: Math.max(0, usage.quotaBytes - usage.bytesUsed),
      fileSize: size,
    };
    throw error;
  }

  // No ServerSideEncryption here on purpose. Adding it would force the browser
  // to send a matching x-amz-server-side-encryption header or S3 rejects the
  // signature. The bucket's default encryption applies the CMK regardless.
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  }), { expiresIn: SIGNED_URL_TTL_SECONDS });

  return { uploadUrl: url, path: clientPath, expiresIn: SIGNED_URL_TTL_SECONDS };
}

/**
 * Confirm an upload landed and bill it against the quota.
 *
 * Counters move from the object S3 actually holds, not from the size the
 * client declared earlier. A client that never calls this leaves the counter
 * low until the nightly reconcile corrects it.
 */
async function confirmUpload(userId, clientPath) {
  const key = resolveUserKey(userId, clientPath);
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

  await adjustQuota(userId, head.ContentLength || 0, 1);

  return { path: clientPath, size: head.ContentLength, contentType: head.ContentType };
}

/**
 * Move a file or folder into the user's trash.
 *
 * Objects are copied under `.trash/{deletedAtMs}/` preserving their original
 * relative path, which is what makes restore a pure path calculation with no
 * metadata to keep in step. The copy carries `msfg-state=trash`, and that tag
 * — not the key prefix — is what the 30-day lifecycle rule matches, because
 * S3 lifecycle prefixes cannot contain a wildcard for the user ID.
 *
 * Quota is deliberately not decremented: trashed objects still occupy paid
 * storage until the lifecycle rule expires them.
 */
async function softDelete(userId, clientPath) {
  const filePrefix = resolveUserKey(userId, clientPath);
  const folderPrefix = resolveUserKey(userId, clientPath, { trailingSlash: true });

  if (folderPrefix === userRootPrefix(userId)) {
    throw new UserFilePathError('Cannot delete the root folder');
  }

  const objects = await listAllUnderPrefix(folderPrefix);
  const isFolder = objects.length > 0;

  if (!isFolder) {
    // Confirms existence and gives a clean 404 for a bad path.
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: filePrefix }));
    objects.push({ Key: filePrefix });
  }

  if (objects.length > SYNC_OBJECT_LIMIT) {
    const error = new Error('Folder is too large to delete in one request');
    error.statusCode = 409;
    error.details = { objectCount: objects.length, limit: SYNC_OBJECT_LIMIT };
    throw error;
  }

  const deletedAt = Date.now();
  const sourceRoot = isFolder ? folderPrefix : filePrefix;
  const rootPrefix = userRootPrefix(userId);

  await mapWithConcurrency(objects, COPY_CONCURRENCY, async (object) => {
    const relative = object.Key.slice(rootPrefix.length);
    const destination = resolveTrashKey(userId, `${deletedAt}/${relative}`);

    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: destination,
      CopySource: `${BUCKET}/${encodeURIComponent(object.Key).replace(/%2F/g, '/')}`,
      Tagging: 'msfg-state=trash',
      TaggingDirective: 'REPLACE',
    }));
  });

  await deleteKeys(objects.map((object) => object.Key));

  return {
    path: clientPath,
    trashPath: `${deletedAt}/${sourceRoot.slice(rootPrefix.length)}`.replace(/\/$/, ''),
    objectCount: objects.length,
    deletedAt,
  };
}

/**
 * Move or rename a file or folder.
 *
 * S3 has no move, so this is copy-then-delete over every object beneath the
 * source. Byte count is unchanged, so quota is untouched.
 */
async function move(userId, fromPath, toPath) {
  const fromKey = resolveUserKey(userId, fromPath);
  const fromPrefix = resolveUserKey(userId, fromPath, { trailingSlash: true });
  const toKey = resolveUserKey(userId, toPath);
  const toPrefix = resolveUserKey(userId, toPath, { trailingSlash: true });
  const rootPrefix = userRootPrefix(userId);

  if (fromPrefix === rootPrefix) {
    throw new UserFilePathError('Cannot move the root folder');
  }
  if (fromKey === toKey) {
    return { moved: 0, unchanged: true };
  }

  const objects = await listAllUnderPrefix(fromPrefix);
  const isFolder = objects.length > 0;

  if (isFolder) {
    // Copying a folder into its own subtree would keep generating new source
    // objects as it walked, so the listing is taken once above and this guard
    // rejects the case outright rather than relying on that ordering.
    if (toPrefix.startsWith(fromPrefix)) {
      const error = new Error('Cannot move a folder into itself');
      error.statusCode = 409;
      throw error;
    }
  } else {
    if (!(await objectExists(fromKey))) {
      const error = new Error('That file no longer exists');
      error.statusCode = 404;
      throw error;
    }
    objects.push({ Key: fromKey });
  }

  // S3 overwrites silently, so an unchecked move would destroy whatever sat at
  // the destination with no way back. Both shapes have to be checked: a file
  // occupies the bare key, a folder occupies the prefix.
  const destinationOccupied = (await listAllUnderPrefix(toPrefix)).length > 0
    || await objectExists(toKey);

  if (destinationOccupied) {
    const error = new Error('Something with that name already exists here');
    error.statusCode = 409;
    throw error;
  }

  if (objects.length > SYNC_OBJECT_LIMIT) {
    const error = new Error('Folder is too large to move in one request');
    error.statusCode = 409;
    error.details = { objectCount: objects.length, limit: SYNC_OBJECT_LIMIT };
    throw error;
  }

  await mapWithConcurrency(objects, COPY_CONCURRENCY, async (object) => {
    const destination = isFolder
      ? toPrefix + object.Key.slice(fromPrefix.length)
      : toKey;

    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: destination,
      CopySource: `${BUCKET}/${encodeURIComponent(object.Key).replace(/%2F/g, '/')}`,
    }));
  });

  await deleteKeys(objects.map((object) => object.Key));

  return { moved: objects.length, from: fromPath, to: toPath };
}

/** List trash, grouped by the deletion batch that produced it. */
async function listTrash(userId) {
  const objects = await listAllUnderPrefix(userTrashPrefix(userId));
  const trashPrefix = userTrashPrefix(userId);
  const groups = new Map();

  for (const object of objects) {
    if (object.Key.endsWith('/')) continue;

    const relative = object.Key.slice(trashPrefix.length);
    const separator = relative.indexOf('/');
    if (separator === -1) continue;

    const deletedAt = relative.slice(0, separator);
    const originalPath = relative.slice(separator + 1);

    if (!groups.has(deletedAt)) groups.set(deletedAt, []);
    groups.get(deletedAt).push({
      name: originalPath.split('/').pop(),
      originalPath,
      trashPath: relative,
      size: object.Size,
      lastModified: object.LastModified,
    });
  }

  return Array.from(groups.entries())
    .map(([deletedAt, items]) => ({
      deletedAt: Number(deletedAt),
      deletedAtDate: new Date(Number(deletedAt)),
      items,
    }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Restore everything under a trash path back to where it came from. */
async function restoreFromTrash(userId, trashPath) {
  const prefix = resolveTrashKey(userId, trashPath);
  const trashRoot = userTrashPrefix(userId);

  let objects = await listAllUnderPrefix(prefix.endsWith('/') ? prefix : `${prefix}/`);
  if (objects.length === 0) {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: prefix }));
    objects = [{ Key: prefix }];
  }

  if (objects.length > SYNC_OBJECT_LIMIT) {
    const error = new Error('Folder is too large to restore in one request');
    error.statusCode = 409;
    error.details = { objectCount: objects.length, limit: SYNC_OBJECT_LIMIT };
    throw error;
  }

  await mapWithConcurrency(objects, COPY_CONCURRENCY, async (object) => {
    const relative = object.Key.slice(trashRoot.length);
    const originalPath = relative.slice(relative.indexOf('/') + 1);
    // resolveUserKey rejects any '.trash' segment, so a crafted trash path
    // cannot restore itself back into trash or outside the user's root.
    const destination = resolveUserKey(userId, originalPath);

    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: destination,
      CopySource: `${BUCKET}/${encodeURIComponent(object.Key).replace(/%2F/g, '/')}`,
      Tagging: '',
      TaggingDirective: 'REPLACE',
    }));
  });

  await deleteKeys(objects.map((object) => object.Key));

  return { restored: objects.length };
}

/** Permanently delete from trash and give the space back. */
async function purgeFromTrash(userId, trashPath) {
  const prefix = resolveTrashKey(userId, trashPath);

  let objects = await listAllUnderPrefix(prefix.endsWith('/') ? prefix : `${prefix}/`);
  if (objects.length === 0) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: prefix }));
    objects = [{ Key: prefix, Size: head.ContentLength }];
  }

  const bytes = objects.reduce((total, object) => total + (object.Size || 0), 0);
  const files = objects.filter((object) => !object.Key.endsWith('/')).length;

  await deleteKeys(objects.map((object) => object.Key));
  await adjustQuota(userId, -bytes, -files);

  return { purged: objects.length, bytes };
}

/**
 * Write an audit row. Never throws — losing a request because the audit insert
 * failed would be worse than the gap, which the logger still captures.
 *
 * @param {object} params
 */
function audit({ userId, actorUserId, action, s3Key = null, bytes = null, req = null }) {
  const ip = req ? (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() : null;
  const userAgent = req ? String(req.headers['user-agent'] || '').slice(0, 512) : null;
  // The insert is fire-and-forget, so an over-long key would drop the row
  // silently rather than surface as an error. Truncate to the column width.
  const key = s3Key === null ? null : String(s3Key).slice(0, 1024);

  return db.query(
    `INSERT INTO user_file_audit (user_id, actor_user_id, action, s3_key, bytes, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, actorUserId, action, key, bytes, ip || null, userAgent]
  ).catch((err) => logger.warn({ err, action, userId }, 'user file audit insert failed'));
}

module.exports = {
  BUCKET,
  REGION,
  DEFAULT_QUOTA_BYTES,
  SIGNED_URL_TTL_SECONDS,
  SYNC_OBJECT_LIMIT,
  TRASH_SEGMENT,
  listPath,
  getFileUrl,
  getUsage,
  reconcileUsage,
  createFolder,
  prepareUpload,
  confirmUpload,
  softDelete,
  move,
  listTrash,
  restoreFromTrash,
  purgeFromTrash,
  audit,
};
