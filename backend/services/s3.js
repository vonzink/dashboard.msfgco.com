/**
 * services/s3.js
 *
 * Centralised S3 helpers — presigned upload/download URLs,
 * object deletion, and bucket/client configuration.
 *
 * Two S3 regions are used:
 *   • us-east-1  → forms library bucket  (msfg-mortgage-documents-prod)
 *   • us-west-2  → media bucket          (msfg-media: avatars, employee docs)
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Clients & Buckets ────────────────────────────────────────────

const s3East = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const s3West = new S3Client({ region: 'us-west-2' });

const BUCKETS = {
  forms: 'msfg-mortgage-documents-prod',
  media: 'msfg-media',
};

/** Pick the right client for a given bucket. */
function clientForBucket(bucket) {
  return bucket === BUCKETS.media ? s3West : s3East;
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
    console.warn(`S3 delete failed (${bucket}/${key}):`, err.message);
  }
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

module.exports = {
  BUCKETS,
  getUploadUrl,
  getDownloadUrl,
  deleteObject,
  sanitizeFileName,
  buildMediaKey,
  buildFormsKey,
};
