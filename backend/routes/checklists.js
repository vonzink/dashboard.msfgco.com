// Checklists HTTP routes.
//
// This file is intentionally thin — all DB queries, transaction handling, and
// authorization live in backend/services/checklists/*. Handlers below should
// stay as short orchestrators: validate → service call → response.

const express = require('express');
const multer = require('multer');
const router = express.Router();

// In-memory upload for PDF conversion — 10 MB cap. We never persist the file.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  },
});

const { getUserId, requireDbUser } = require('../middleware/userContext');
const { ok, created, deleted, fail } = require('../utils/response');
const {
  checklistTemplate: templateSchema,
  checklistTemplateUpdate: templateUpdateSchema,
  loanChecklistAssign: assignSchema,
  loanChecklistRename: renameSchema,
  loanChecklistItemUpdate: itemUpdateSchema,
  loanChecklistSubitemUpdate: subitemUpdateSchema,
  loanChecklistItemCreate: itemCreateSchema,
  loanChecklistSubitemCreate: subitemCreateSchema,
  loanChecklistImport: importSchema,
  loanChecklistReorder: reorderSchema,
  checklistNoteCreate: noteCreateSchema,
  validate,
} = require('../validation/schemas');

const templates = require('../services/checklists/templates.service');
const loanChecklists = require('../services/checklists/loanChecklists.service');

router.use(requireDbUser);

// Translate a service-thrown error (which may carry `status`) into a JSON fail
// response. Returns true if handled; callers should `return` after.
function handleServiceError(res, err) {
  if (err.status) {
    fail(res, err.message, err.status);
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════
//  TEMPLATES
// ════════════════════════════════════════════════

router.get('/templates', async (req, res, next) => {
  try { ok(res, await templates.list(getUserId(req))); }
  catch (err) { next(err); }
});

router.get('/templates/:id', async (req, res, next) => {
  try { ok(res, await templates.getById(getUserId(req), req.params.id)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.post('/templates', validate(templateSchema), async (req, res, next) => {
  try { created(res, await templates.create(getUserId(req), req.body)); }
  catch (err) { next(err); }
});

router.put('/templates/:id', validate(templateUpdateSchema), async (req, res, next) => {
  try { ok(res, await templates.update(getUserId(req), req.params.id, req.body)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.delete('/templates/:id', async (req, res, next) => {
  try { await templates.remove(getUserId(req), req.params.id); deleted(res); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// ════════════════════════════════════════════════
//  LOAN CHECKLISTS
// ════════════════════════════════════════════════

router.get('/loan/:sourceType/:sourceItemId', async (req, res, next) => {
  try { ok(res, await loanChecklists.getForLoan(req.params.sourceType, req.params.sourceItemId)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.post('/loan/:sourceType/:sourceItemId/assign', validate(assignSchema), async (req, res, next) => {
  try {
    const result = await loanChecklists.assignTemplate(
      getUserId(req), req.params.sourceType, req.params.sourceItemId,
      req.body.template_id, req.body.name,
    );
    created(res, result);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.get('/loan-checklist/:checklistId', async (req, res, next) => {
  try {
    const cl = await loanChecklists.getById(req.params.checklistId);
    if (!cl) return fail(res, 'Checklist not found', 404);
    ok(res, cl);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.put('/loan-checklist/:checklistId', validate(renameSchema), async (req, res, next) => {
  try {
    await loanChecklists.renameChecklist(getUserId(req), req.params.checklistId, req.body.name);
    ok(res, { success: true });
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.delete('/loan-checklist/:checklistId', async (req, res, next) => {
  try {
    await loanChecklists.deleteChecklist(getUserId(req), req.params.checklistId);
    deleted(res);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.post('/loan-checklist/:checklistId/items', validate(itemCreateSchema), async (req, res, next) => {
  try {
    const item = await loanChecklists.addItemToChecklist(getUserId(req), req.params.checklistId, req.body);
    created(res, item);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.put('/loan/:sourceType/:sourceItemId/reorder', validate(reorderSchema), async (req, res, next) => {
  try {
    const result = await loanChecklists.reorderItems(
      getUserId(req), req.params.sourceType, req.params.sourceItemId, req.body.items,
    );
    ok(res, result);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// Make Checklist from a PDF (file-local — stays on this loan only)
router.post('/loan/:sourceType/:sourceItemId/from-pdf', pdfUpload.single('pdf'), async (req, res, next) => {
  try {
    if (!req.file) return fail(res, 'No PDF uploaded', 400);
    const result = await loanChecklists.createFromPdf(
      getUserId(req),
      req.params.sourceType,
      req.params.sourceItemId,
      req.file.buffer,
      { filename: req.file.originalname },
    );
    created(res, result);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.post('/loan/:sourceType/:sourceItemId/import', validate(importSchema), async (req, res, next) => {
  try {
    const result = await loanChecklists.importItems(
      getUserId(req), req.params.sourceType, req.params.sourceItemId, req.body,
    );
    ok(res, result);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// Export a SINGLE checklist as JSON (frontend renders .md client-side).
router.get('/loan-checklist/:checklistId/export', async (req, res, next) => {
  try {
    const cl = await loanChecklists.getById(req.params.checklistId);
    if (!cl) return fail(res, 'Checklist not found', 404);
    ok(res, cl);
  } catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// ── Items ───────────────────────────────────────

router.put('/loan-items/:itemId', validate(itemUpdateSchema), async (req, res, next) => {
  try { ok(res, await loanChecklists.updateItem(getUserId(req), req.params.itemId, req.body)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.delete('/loan-items/:itemId', async (req, res, next) => {
  try { await loanChecklists.deleteItem(getUserId(req), req.params.itemId); deleted(res); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.post('/loan-items/:itemId/subitems', validate(subitemCreateSchema), async (req, res, next) => {
  try { created(res, await loanChecklists.addSubitem(getUserId(req), req.params.itemId, req.body)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// ── Item notes (time-stamped call log) ──────────

router.post('/loan-items/:itemId/notes', validate(noteCreateSchema), async (req, res, next) => {
  try { created(res, await loanChecklists.addItemNote(getUserId(req), req.params.itemId, req.body.body)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.delete('/loan-item-notes/:noteId', async (req, res, next) => {
  try { await loanChecklists.deleteItemNote(getUserId(req), req.params.noteId); deleted(res); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// ── Subitems ────────────────────────────────────

router.put('/loan-subitems/:subitemId', validate(subitemUpdateSchema), async (req, res, next) => {
  try { ok(res, await loanChecklists.updateSubitem(getUserId(req), req.params.subitemId, req.body)); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

router.delete('/loan-subitems/:subitemId', async (req, res, next) => {
  try { await loanChecklists.deleteSubitem(getUserId(req), req.params.subitemId); deleted(res); }
  catch (err) { if (!handleServiceError(res, err)) next(err); }
});

// ── Batch status (for table badges) ─────────────

router.get('/status/:sourceType', async (req, res, next) => {
  try { ok(res, await loanChecklists.getStatusMap(req.params.sourceType)); }
  catch (err) { next(err); }
});

module.exports = router;
