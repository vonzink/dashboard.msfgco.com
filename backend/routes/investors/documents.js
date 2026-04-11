// Investor Documents — S3 file upload/download/delete
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../../db/connection');
const { requireAdmin } = require('../../middleware/userContext');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject } = require('../../services/s3');

const ALLOWED_DOC_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'text/plain': '.txt',
  'text/csv': '.csv',
};
const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

// GET /api/investors/:id/documents
router.get('/:id/documents', async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const [docs] = await db.query(
      'SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY created_at DESC',
      [investorId]
    );
    for (const doc of docs) {
      try { doc.download_url = await getDownloadUrl(BUCKETS.media, doc.file_key); }
      catch { doc.download_url = null; }
    }
    res.json(docs);
  } catch (error) { next(error); }
});

// POST /api/investors/:id/documents/upload-url
router.post('/:id/documents/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (fileSize && fileSize > MAX_DOC_BYTES) {
      return res.status(400).json({ error: 'File must be under 25 MB' });
    }

    const [rows] = await db.query('SELECT id FROM investors WHERE id = ?', [investorId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Investor not found' });

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `investor-documents/${investorId}/${crypto.randomUUID()}-${safeName}`;

    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType || 'application/octet-stream');
    res.json({ ...result, fileKey });
  } catch (error) { next(error); }
});

// POST /api/investors/:id/documents/confirm
router.post('/:id/documents/confirm', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileKey, fileName, fileType, fileSize } = req.body;

    if (!fileKey || !fileName) {
      return res.status(400).json({ error: 'fileKey and fileName are required' });
    }

    const [result] = await db.query(
      `INSERT INTO investor_documents (investor_id, file_name, file_key, file_size, file_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [investorId, fileName, fileKey, fileSize || null, fileType || null, req.dbUser?.id || null]
    );

    const docId = result.insertId;
    let download_url = null;
    try { download_url = await getDownloadUrl(BUCKETS.media, fileKey); } catch {}

    res.status(201).json({ id: docId, investor_id: investorId, file_name: fileName, file_key: fileKey, file_size: fileSize, file_type: fileType, download_url });
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/documents/:docId
router.delete('/:id/documents/:docId', requireAdmin, async (req, res, next) => {
  try {
    const { id: investorId, docId } = req.params;
    const [rows] = await db.query(
      'SELECT * FROM investor_documents WHERE id = ? AND investor_id = ?',
      [docId, investorId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    try { await deleteObject(BUCKETS.media, rows[0].file_key); } catch {}
    await db.query('DELETE FROM investor_documents WHERE id = ?', [docId]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
