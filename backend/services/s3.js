/**
 * services/s3.js
 *
 * Centralised S3 helpers — presigned upload/download URLs,
 * object deletion, and bucket/client configuration.
 *
 * Two S3 regions are used:
 *   • us-east-1  → forms library bucket  (msfg-mortgage-documents-prod)
 *   • us-west-2  → media bucket          (msfg-media: avatars, employee docs)
 *   • us-west-2  → Plaud audio archive   (PLAUD_S3_BUCKET, see services/plaud)
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../lib/logger');

// ── Clients & Buckets ────────────────────────────────────────────

const s3East = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const s3West = new S3Client({ region: 'us-west-2' });

const BUCKETS = {
  forms: 'msfg-mortgage-documents-prod',
  media: 'msfg-media',
  dashboard: process.env.S3_BUCKET_NAME || 'msfg-dashboard-files',
  plaud: process.env.PLAUD_S3_BUCKET || 'msfg-plaud-recordings',
};

/** Buckets that live in us-west-2. Everything else is served from us-east-1. */
const WEST_BUCKETS = new Set([BUCKETS.media, BUCKETS.plaud]);

/** Pick the right client for a given bucket. */
function clientForBucket(bucket) {
  return WEST_BUCKETS.has(bucket) ? s3West : s3East;
}

// ── Presigned URLs ───────────────────────────────────────────────

/**
 * Generate a presigned PUT (upload) URL.
 *
 * @param {string} bucket  — S3 bucket name
 * @param {string} key     — object key (path)
 * @param {string} [contentType='application/octet-stream']
 * @param {number} [expiresIn=3600]
 * @returns {Promise<{ uploadUrl: string, fileKey: string, bucket: string, expiresIn: number }>}
 */
async function getUploadUrl(bucket, key, contentType = 'application/octet-stream', expiresIn = 3600) {
  const client = clientForBucket(bucket);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  return { uploadUrl, fileKey: key, bucket, expiresIn };
}

/**
 * Generate a presigned GET (download) URL.
 *
 * @param {string} bucket
 * @param {string} key
 * @param {number} [expiresIn=900]
 * @returns {Promise<string>}  presigned URL
 */
async function getDownloadUrl(bucket, key, expiresIn = 900) {
  const client = clientForBucket(bucket);
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Delete an object from S3 (best-effort — logs warning on failure).
 *
 * @param {string} bucket
 * @param {string} key
 */
async function deleteObject(bucket, key) {
  const client = clientForBucket(bucket);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    logger.warn({ err, bucket, key }, 'S3 delete failed');
  }
}

/**
 * Download an S3 object and return its contents as a Buffer.
 *
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<Buffer>}
 */
async function getObject(bucket, key) {
  const client = clientForBucket(bucket);
  const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

  // Body is a Readable stream — collect all chunks into a Buffer
  const chunks = [];
  for await (const chunk of Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload a stream (or Buffer) to S3 without buffering it in memory.
 * Uses the SDK's managed multipart Upload so large audio files stream
 * straight through in ~5 MB parts.
 *
 * @param {string} bucket
 * @param {string} key
 * @param {import('stream').Readable|Buffer} body
 * @param {object} [options]
 * @param {string} [options.contentType='application/octet-stream']
 * @param {Record<string,string>} [options.metadata]   S3 user metadata (x-amz-meta-*)
 * @returns {Promise<{ bucket: string, key: string, etag: string|undefined }>}
 */
async function uploadStream(bucket, key, body, { contentType = 'application/octet-stream', metadata } = {}) {
  const client = clientForBucket(bucket);
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(metadata ? { Metadata: metadata } : {}),
    },
  });
  const result = await upload.done();
  return { bucket, key, etag: result?.ETag };
}

// ── Higher-Level Helpers ─────────────────────────────────────────

/**
 * Sanitise a user-provided filename for S3 keys.
 * Strips everything except alphanumerics, dots, hyphens, underscores.
 */
function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Build an S3 key for the media bucket under a given prefix.
 * Result: `<prefix>/<userId>/<timestamp>-<safeName>`
 */
function buildMediaKey(prefix, userId, fileName) {
  const safeName = sanitizeFileName(fileName);
  return `${prefix}/${userId}/${Date.now()}-${safeName}`;
}

/**
 * Build an S3 key for the forms bucket.
 * Sanitises the folder path and appends the filename.
 */
function buildFormsKey(fileName, folder) {
  const safeFolderRaw = (folder || '').replace(/\.\./g, '').replace(/^\//, '');
  const safeFolder = safeFolderRaw ? safeFolderRaw.replace(/\/?$/, '/') : '';
  return safeFolder + fileName;
}

/**
 * Resolve a stored value (S3 key or external URL) to a usable URL.
 * - If it's already an http(s) URL, return as-is.
 * - If it's an S3 key, generate a presigned download URL.
 * - Returns null on any error (never throws).
 *
 * @param {string} bucket
 * @param {string|null} value  S3 key or external URL
 * @returns {Promise<string|null>}
 */
async function resolveUrl(bucket, value) {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  try {
    return await getDownloadUrl(bucket, value);
  } catch (err) {
    logger.warn({ err, bucket, key: value }, 'S3 resolveUrl failed');
    return null;
  }
}

/**
 * Batch-resolve multiple S3 fields on an object.
 * Mutates the object in place, replacing S3 keys with presigned URLs.
 *
 * @param {string} bucket
 * @param {Object} obj
 * @param {string[]} fields  field names to resolve
 */
async function resolveUrls(bucket, obj, fields) {
  if (!obj) return;
  await Promise.all(fields.map(async (field) => {
    if (obj[field]) {
      obj[field] = await resolveUrl(bucket, obj[field]);
    }
  }));
}

module.exports = {
  BUCKETS,
  getUploadUrl,
  getDownloadUrl,
  getObject,
  uploadStream,
  deleteObject,
  resolveUrl,
  resolveUrls,
  sanitizeFileName,
  buildMediaKey,
  buildFormsKey,
};
