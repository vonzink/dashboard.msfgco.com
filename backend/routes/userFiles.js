// My Files — per-user S3 storage (bucket: msfg-user-folders).
//
// Every endpoint operates on req.user.db.id and never accepts a user ID from
// the client. There is no ?userId= parameter here by design: admin access to
// another user's files lives on separate /admin routes, so a missing check
// cannot silently widen ordinary access.
const express = require('express');
const router = express.Router();
const { requireDbUser } = require('../middleware/userContext');
const { UserFilePathError } = require('../utils/userFileKeys');
const userFiles = require('../services/userFiles');

router.use(requireDbUser);

/** Map S3 and path-validation failures onto sensible status codes. */
function toHttpError(err) {
  if (err instanceof UserFilePathError) {
    return { status: 400, body: { error: err.message } };
  }
  // Quota, over-size-folder and name-collision rejections carry their own
  // status and context. Restricted to 4xx so an S3 5xx still reaches the
  // error logger rather than being reported to the client as their mistake.
  if (err.statusCode >= 400 && err.statusCode < 500) {
    return { status: err.statusCode, body: { error: err.message, ...(err.details || {}) } };
  }
  if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
    return { status: 404, body: { error: 'File not found' } };
  }
  if (err.name === 'AccessDenied' || err.$metadata?.httpStatusCode === 403) {
    return { status: 403, body: { error: 'Access denied' } };
  }
  return null;
}

/** Wrap a handler so path and S3 errors become responses, not 500s. */
function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      const mapped = toHttpError(err);
      if (mapped) return res.status(mapped.status).json(mapped.body);
      return next(err);
    }
  };
}

// ========================================
// GET /api/my-files/list?path=&token=
// ========================================
router.get('/list', handle(async (req, res) => {
  const userId = req.user.db.id;
  const path = req.query.path || '';

  const result = await userFiles.listPath(userId, path, {
    continuationToken: req.query.token || undefined,
  });

  // Listing is logged once per page, not per object.
  userFiles.audit({ userId, actorUserId: userId, action: 'list', s3Key: path, req });

  res.json({ path, ...result });
}));

// ========================================
// GET /api/my-files/snapshot
// ========================================
router.get('/snapshot', handle(async (req, res) => {
  const userId = req.user.db.id;

  const result = await userFiles.snapshot(userId);

  // Deliberately not audited. A linked sync client polls this every 30s, so a
  // row per call would add thousands of entries per user per day and bury the
  // mutations the audit log exists to record. The uploads, deletes and moves
  // that sync performs are each audited by their own endpoint.

  res.json(result);
}));

// ========================================
// GET /api/my-files/download-url?path=
// ========================================
router.get('/download-url', handle(async (req, res) => {
  const userId = req.user.db.id;
  const path = req.query.path;

  if (!path) return res.status(400).json({ error: 'path is required' });

  const result = await userFiles.getFileUrl(userId, path, { inline: false });

  userFiles.audit({
    userId, actorUserId: userId, action: 'download', s3Key: path, bytes: result.size, req,
  });

  res.json(result);
}));

// ========================================
// GET /api/my-files/preview-url?path=
// ========================================
router.get('/preview-url', handle(async (req, res) => {
  const userId = req.user.db.id;
  const path = req.query.path;

  if (!path) return res.status(400).json({ error: 'path is required' });

  const result = await userFiles.getFileUrl(userId, path, { inline: true });

  userFiles.audit({
    userId, actorUserId: userId, action: 'preview', s3Key: path, bytes: result.size, req,
  });

  res.json(result);
}));

// ========================================
// GET /api/my-files/usage
// ========================================
router.get('/usage', handle(async (req, res) => {
  const userId = req.user.db.id;
  const usage = await userFiles.getUsage(userId);

  res.json({
    bytesUsed: usage.bytesUsed,
    fileCount: usage.fileCount,
    quotaBytes: usage.quotaBytes,
    bytesRemaining: Math.max(0, usage.quotaBytes - usage.bytesUsed),
    reconciledAt: usage.reconciledAt,
  });
}));

// ========================================
// POST /api/my-files/folder   { path }
// ========================================
router.post('/folder', handle(async (req, res) => {
  const userId = req.user.db.id;
  const { path } = req.body || {};

  if (!path) return res.status(400).json({ error: 'path is required' });

  const result = await userFiles.createFolder(userId, path);

  userFiles.audit({ userId, actorUserId: userId, action: 'upload', s3Key: result.key, req });

  res.status(201).json({ path: result.path });
}));

// ========================================
// POST /api/my-files/upload-url   { path, size, contentType }
// ========================================
router.post('/upload-url', handle(async (req, res) => {
  const userId = req.user.db.id;
  const { path, size, contentType } = req.body || {};

  if (!path) return res.status(400).json({ error: 'path is required' });
  if (size === undefined || size === null) {
    return res.status(400).json({ error: 'size is required' });
  }

  const result = await userFiles.prepareUpload(userId, path, size, contentType);
  res.json(result);
}));

// ========================================
// POST /api/my-files/upload-complete   { path }
//
// The browser uploads straight to S3, so this is how the backend learns the
// bytes landed and bills them against the quota.
// ========================================
router.post('/upload-complete', handle(async (req, res) => {
  const userId = req.user.db.id;
  const { path } = req.body || {};

  if (!path) return res.status(400).json({ error: 'path is required' });

  const result = await userFiles.confirmUpload(userId, path);

  userFiles.audit({
    userId, actorUserId: userId, action: 'upload', s3Key: path, bytes: result.size, req,
  });

  res.json(result);
}));

// ========================================
// POST /api/my-files/move        (drag to another folder, or rename)
// ========================================
router.post('/move', handle(async (req, res) => {
  const userId = req.user.db.id;
  const { from, to } = req.body || {};

  if (!from) return res.status(400).json({ error: 'from is required' });
  if (!to) return res.status(400).json({ error: 'to is required' });

  const result = await userFiles.move(userId, from, to);

  if (!result.unchanged) {
    userFiles.audit({ userId, actorUserId: userId, action: 'move', s3Key: `${from} -> ${to}`, req });
  }

  res.json(result);
}));

// ========================================
// DELETE /api/my-files?path=     (soft delete into trash)
// ========================================
router.delete('/', handle(async (req, res) => {
  const userId = req.user.db.id;
  const path = req.query.path || (req.body && req.body.path);

  if (!path) return res.status(400).json({ error: 'path is required' });

  const result = await userFiles.softDelete(userId, path);

  userFiles.audit({ userId, actorUserId: userId, action: 'delete', s3Key: path, req });

  res.json(result);
}));

// ========================================
// GET /api/my-files/trash
// ========================================
router.get('/trash', handle(async (req, res) => {
  const userId = req.user.db.id;
  const groups = await userFiles.listTrash(userId);
  res.json({ groups });
}));

// ========================================
// POST /api/my-files/restore   { trashPath }
// ========================================
router.post('/restore', handle(async (req, res) => {
  const userId = req.user.db.id;
  const { trashPath } = req.body || {};

  if (!trashPath) return res.status(400).json({ error: 'trashPath is required' });

  const result = await userFiles.restoreFromTrash(userId, trashPath);

  userFiles.audit({ userId, actorUserId: userId, action: 'restore', s3Key: trashPath, req });

  res.json(result);
}));

// ========================================
// DELETE /api/my-files/trash?trashPath=   (permanent)
// ========================================
router.delete('/trash', handle(async (req, res) => {
  const userId = req.user.db.id;
  const trashPath = req.query.trashPath || (req.body && req.body.trashPath);

  if (!trashPath) return res.status(400).json({ error: 'trashPath is required' });

  const result = await userFiles.purgeFromTrash(userId, trashPath);

  userFiles.audit({
    userId, actorUserId: userId, action: 'purge', s3Key: trashPath, bytes: result.bytes, req,
  });

  res.json(result);
}));

module.exports = router;
