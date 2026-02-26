// Admin — Employee documents
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject, buildMediaKey } = require('../../services/s3');

// GET /users/:id/documents
router.get('/:id/documents', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      `SELECT ed.*, u.name AS uploader_name
       FROM employee_documents ed
       JOIN users u ON ed.uploaded_by = u.id
       WHERE ed.user_id = ?
       ORDER BY ed.created_at DESC`,
      [req.params.id]
    );
    res.json(docs);
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/documents/upload-url
router.post('/:id/documents/upload-url', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileName, fileType } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });

    const fileKey = buildMediaKey('employee-documents', userId, fileName);
    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType || 'application/octet-stream');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/documents/confirm
router.post('/:id/documents/confirm', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { fileKey, fileName, fileType, fileSize, category, description } = req.body;
    const uploadedBy = req.user?.db?.id;

    if (!fileKey || !fileName) {
      return res.status(400).json({ error: 'fileKey and fileName are required' });
    }

    const [result] = await db.query(
      `INSERT INTO employee_documents (user_id, file_name, file_s3_key, file_size, file_type, category, description, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, fileName, fileKey, fileSize || null, fileType || null, category || null, description || null, uploadedBy]
    );

    const [docs] = await db.query(
      `SELECT ed.*, u.name AS uploader_name
       FROM employee_documents ed JOIN users u ON ed.uploaded_by = u.id
       WHERE ed.id = ?`,
      [result.insertId]
    );

    res.status(201).json(docs[0]);
  } catch (error) {
    next(error);
  }
});

// GET /users/:id/documents/:docId/download-url
router.get('/:id/documents/:docId/download-url', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      'SELECT file_s3_key, file_name FROM employee_documents WHERE id = ? AND user_id = ?',
      [req.params.docId, req.params.id]
    );

    if (docs.length === 0) return res.status(404).json({ error: 'Document not found' });

    const downloadUrl = await getDownloadUrl(BUCKETS.media, docs[0].file_s3_key);
    res.json({ downloadUrl, fileName: docs[0].file_name, expiresIn: 900 });
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id/documents/:docId
router.delete('/:id/documents/:docId', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      'SELECT file_s3_key FROM employee_documents WHERE id = ? AND user_id = ?',
      [req.params.docId, req.params.id]
    );

    if (docs.length > 0 && docs[0].file_s3_key) {
      await deleteObject(BUCKETS.media, docs[0].file_s3_key);
    }

    await db.query('DELETE FROM employee_documents WHERE id = ? AND user_id = ?', [req.params.docId, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
