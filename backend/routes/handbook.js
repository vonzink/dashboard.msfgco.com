'use strict';

/**
 * routes/handbook.js
 *
 * Endpoints for browsing, searching, and managing the employee handbook.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireDbUser, requireAdmin, getUserId } = require('../middleware/userContext');
const { handbookSearch, handbookSectionUpdate, handbookSectionCreate, validate, validateQuery } = require('../validation/schemas');

router.use(requireDbUser);

// ── GET /api/handbook/documents ──────────────────────────────
// List all documents with nested section titles (no content)
router.get('/documents', async (req, res, next) => {
  try {
    const [docs] = await db.query(
      'SELECT id, slug, title, sort_order FROM handbook_documents ORDER BY sort_order'
    );

    const [sections] = await db.query(
      `SELECT id, document_id, slug, title, sort_order
       FROM handbook_sections
       ORDER BY sort_order`
    );

    // Group sections under their documents
    const result = docs.map(doc => ({
      ...doc,
      sections: sections
        .filter(s => s.document_id === doc.id)
        .map(s => ({ id: s.id, slug: s.slug, title: s.title, sort_order: s.sort_order }))
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/handbook/sections/by-slug/:docSlug/:sectionSlug ─
// Single section with prev/next navigation
router.get('/sections/by-slug/:docSlug/:sectionSlug', async (req, res, next) => {
  try {
    const { docSlug, sectionSlug } = req.params;

    // Get document
    const [[doc]] = await db.query(
      'SELECT id, slug, title FROM handbook_documents WHERE slug = ?',
      [docSlug]
    );
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Get section
    const [[section]] = await db.query(
      `SELECT id, document_id, slug, title, content, sort_order, updated_at
       FROM handbook_sections
       WHERE document_id = ? AND slug = ?`,
      [doc.id, sectionSlug]
    );
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    // Get siblings for prev/next
    const [siblings] = await db.query(
      'SELECT id, slug, title FROM handbook_sections WHERE document_id = ? ORDER BY sort_order',
      [doc.id]
    );
    const idx = siblings.findIndex(s => s.id === section.id);

    res.json({
      ...section,
      doc_slug: doc.slug,
      doc_title: doc.title,
      prev: idx > 0 ? { slug: siblings[idx - 1].slug, title: siblings[idx - 1].title } : null,
      next: idx < siblings.length - 1 ? { slug: siblings[idx + 1].slug, title: siblings[idx + 1].title } : null
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/handbook/search ─────────────────────────────────
// FULLTEXT search across all sections
router.get('/search', validateQuery(handbookSearch), async (req, res, next) => {
  try {
    const { q, limit } = req.query;

    let rows;

    if (q.length < 3) {
      // Short queries: use LIKE fallback
      const like = `%${q}%`;
      [rows] = await db.query(
        `SELECT s.id, s.title, s.slug, s.document_id,
                d.slug AS doc_slug, d.title AS doc_title,
                SUBSTRING(s.content, GREATEST(1, LOCATE(?, s.content) - 80), 250) AS snippet
         FROM handbook_sections s
         JOIN handbook_documents d ON d.id = s.document_id
         WHERE s.title LIKE ? OR s.content LIKE ?
         LIMIT ?`,
        [q, like, like, limit]
      );
    } else {
      // FULLTEXT boolean search
      const searchTerm = q
        .split(/\s+/)
        .filter(w => w.length > 0)
        .map(w => `+${w}*`)
        .join(' ');

      const firstWord = q.split(/\s+/).find(w => w.length > 2) || q.split(/\s+/)[0] || q;

      [rows] = await db.query(
        `SELECT s.id, s.title, s.slug, s.document_id,
                d.slug AS doc_slug, d.title AS doc_title,
                MATCH(s.title, s.content) AGAINST(? IN BOOLEAN MODE) AS relevance,
                SUBSTRING(s.content, GREATEST(1, LOCATE(?, s.content) - 80), 250) AS snippet
         FROM handbook_sections s
         JOIN handbook_documents d ON d.id = s.document_id
         WHERE MATCH(s.title, s.content) AGAINST(? IN BOOLEAN MODE)
         ORDER BY relevance DESC
         LIMIT ?`,
        [searchTerm, firstWord, searchTerm, limit]
      );
    }

    res.json({ results: rows });
  } catch (error) {
    next(error);
  }
});

// ── PUT /api/handbook/sections/:id ───────────────────────────
// Admin: update section title + content
router.put('/sections/:id', requireAdmin, validate(handbookSectionUpdate), async (req, res, next) => {
  try {
    const { title, content } = req.body;
    const userId = getUserId(req);

    const [result] = await db.query(
      `UPDATE handbook_sections SET title = ?, content = ?, updated_by = ? WHERE id = ?`,
      [title, content, userId, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ message: 'Section updated' });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/handbook/documents/:docId/sections ─────────────
// Admin: add new section to a document
router.post('/documents/:docId/sections', requireAdmin, validate(handbookSectionCreate), async (req, res, next) => {
  try {
    const docId = req.params.docId;
    const { title, content } = req.body;
    const userId = getUserId(req);

    // Verify document exists
    const [[doc]] = await db.query('SELECT id FROM handbook_documents WHERE id = ?', [docId]);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Generate slug
    const slug = title
      .toLowerCase()
      .replace(/[''()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Get max sort_order
    const [[maxRow]] = await db.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM handbook_sections WHERE document_id = ?',
      [docId]
    );

    const [result] = await db.query(
      `INSERT INTO handbook_sections (document_id, slug, title, content, sort_order, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [docId, slug, title, content || '', maxRow.max_order + 1, userId]
    );

    res.status(201).json({ id: result.insertId, slug, message: 'Section created' });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/handbook/sections/:id ─────────────────────────
// Admin: delete a section
router.delete('/sections/:id', requireAdmin, async (req, res, next) => {
  try {
    const [result] = await db.query('DELETE FROM handbook_sections WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({ message: 'Section deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
