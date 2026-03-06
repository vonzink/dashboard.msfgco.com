/**
 * routes/guidelines.js
 *
 * Endpoints for searching, uploading, and managing lending guideline PDFs.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, hasRole, requireDbUser } = require('../middleware/userContext');
const { guidelineUpload, guidelineProcess, guidelineSearch, validate, validateQuery } = require('../validation/schemas');
const { getUploadUrl, deleteObject, BUCKETS } = require('../services/s3');
const { processGuideline } = require('../services/guidelineParser');
const logger = require('../lib/logger');

const S3_GUIDELINES_PREFIX = 'guidelines';

router.use(requireDbUser);

// ── GET /api/guidelines/search ─────────────────────────────────
// FULLTEXT search across all ready guideline chunks
router.get('/search', validateQuery(guidelineSearch), async (req, res, next) => {
  try {
    const { q, product_type, page, limit } = req.query;
    const offset = (page - 1) * limit;

    // Build boolean-mode search term
    // Add + prefix to each word for AND matching
    const searchTerm = q
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => `+${w}*`)
      .join(' ');

    // For the snippet LOCATE, use the first significant word
    const firstWord = q.split(/\s+/).find(w => w.length > 2) || q.split(/\s+/)[0] || q;

    let sql = `
      SELECT gc.id, gc.section_id, gc.section_title, gc.page_number,
             gc.chunk_index, gc.product_type, gc.file_id, gf.file_name,
             MATCH(gc.section_title, gc.content) AGAINST(? IN BOOLEAN MODE) AS relevance,
             SUBSTRING(gc.content, GREATEST(1, LOCATE(?, gc.content) - 80), 250) AS snippet
      FROM guideline_chunks gc
      JOIN guideline_files gf ON gc.file_id = gf.id
      WHERE gf.status = 'ready'
        AND MATCH(gc.section_title, gc.content) AGAINST(? IN BOOLEAN MODE)
    `;

    const params = [searchTerm, firstWord, searchTerm];

    if (product_type) {
      sql += ' AND gc.product_type = ?';
      params.push(product_type);
    }

    sql += ' ORDER BY relevance DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await db.query(sql, params);

    // Get total count for pagination
    let countSql = `
      SELECT COUNT(*) AS total
      FROM guideline_chunks gc
      JOIN guideline_files gf ON gc.file_id = gf.id
      WHERE gf.status = 'ready'
        AND MATCH(gc.section_title, gc.content) AGAINST(? IN BOOLEAN MODE)
    `;
    const countParams = [searchTerm];

    if (product_type) {
      countSql += ' AND gc.product_type = ?';
      countParams.push(product_type);
    }

    const [[{ total }]] = await db.query(countSql, countParams);

    res.json({
      results: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/guidelines/files ─────────────────────────────────
// List all uploaded guideline files
router.get('/files', async (req, res, next) => {
  try {
    const [files] = await db.query(
      `SELECT gf.*, u.name AS uploader_name
       FROM guideline_files gf
       LEFT JOIN users u ON gf.uploaded_by = u.id
       ORDER BY gf.created_at DESC`
    );
    res.json(files);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/guidelines/chunks/:id ────────────────────────────
// Get full content of a single chunk
router.get('/chunks/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT gc.*, gf.file_name
       FROM guideline_chunks gc
       JOIN guideline_files gf ON gc.file_id = gf.id
       WHERE gc.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Chunk not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

// ── POST /api/guidelines/upload-url ───────────────────────────
// Admin only: get a presigned S3 upload URL for a guideline PDF
router.post('/upload-url', validate(guidelineUpload), async (req, res, next) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { fileName, fileType, fileSize, productType, versionLabel } = req.body;
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `${S3_GUIDELINES_PREFIX}/${productType}/${Date.now()}-${safeFileName}`;

    // Create file record in DB
    const userId = getUserId(req);
    const [result] = await db.query(
      `INSERT INTO guideline_files (file_name, s3_key, product_type, version_label, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fileName, s3Key, productType, versionLabel || null, fileSize, userId]
    );

    // Generate presigned upload URL
    const upload = await getUploadUrl(BUCKETS.forms, s3Key, fileType || 'application/pdf');

    res.status(201).json({
      fileId: result.insertId,
      s3Key,
      uploadUrl: upload.uploadUrl,
      bucket: BUCKETS.forms,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/guidelines/process ──────────────────────────────
// Admin only: trigger PDF parsing after upload completes
router.post('/process', validate(guidelineProcess), async (req, res, next) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { fileId, s3Key, productType } = req.body;

    // Verify file exists and is still in processing state
    const [[file]] = await db.query('SELECT id, status FROM guideline_files WHERE id = ?', [fileId]);
    if (!file) {
      return res.status(404).json({ error: 'Guideline file not found' });
    }

    // Reset to processing if re-processing
    await db.query('UPDATE guideline_files SET status = ?, error_message = NULL WHERE id = ?', ['processing', fileId]);

    // Respond immediately — processing happens async
    res.json({ message: 'Processing started', fileId });

    // Process in background (don't await)
    processGuideline(fileId, s3Key, productType).catch(err => {
      logger.error({ fileId, err }, 'Background guideline processing failed');
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/guidelines/files/:id/status ──────────────────────
// Check processing status of a file
router.get('/files/:id/status', async (req, res, next) => {
  try {
    const [[file]] = await db.query(
      'SELECT id, status, error_message, total_pages, total_sections FROM guideline_files WHERE id = ?',
      [req.params.id]
    );

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(file);
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/guidelines/files/:id ──────────────────────────
// Admin only: delete file + cascaded chunks
router.delete('/files/:id', async (req, res, next) => {
  try {
    if (!hasRole(req, 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get file info for S3 cleanup
    const [[file]] = await db.query('SELECT id, s3_key FROM guideline_files WHERE id = ?', [req.params.id]);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete from DB (chunks cascade)
    await db.query('DELETE FROM guideline_files WHERE id = ?', [file.id]);

    // Best-effort S3 cleanup
    deleteObject(BUCKETS.forms, file.s3_key).catch(() => {});

    deleted(res, 'Guideline file deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
