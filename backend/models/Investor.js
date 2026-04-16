/**
 * models/Investor.js
 *
 * Data-access layer for the investors table and its related sub-tables:
 *   investor_team, investor_lender_ids, investor_mortgagee_clauses,
 *   investor_links, investor_turn_times, investor_documents,
 *   investor_custom_toggles, investor_notes, investor_note_tags, investor_tags.
 *
 * Route handlers call these methods instead of writing raw SQL.
 */
const db = require('../db/connection');
const { buildUpdate } = require('../utils/queryBuilder');

// ============================================================
// Column lists (avoid SELECT * in list queries)
// ============================================================
const LIST_COLUMNS = `
  id, investor_key, name,
  account_executive_name, account_executive_email, account_executive_mobile,
  states, best_programs, minimum_fico, in_house_dpa,
  epo, max_comp, underwriting_fee, in_house_servicing,
  servicing, manual_underwriting, non_qm, jumbo,
  subordinate_financing, review_wire_release,
  usda, land_loans, va_loans, bridge_loans, dscr,
  conventional, fha, bank_statement, asset_depletion,
  interest_only, itin_foreign_national, construction, renovation,
  manufactured, doctor, condo_non_warrantable, heloc_second,
  scenario_desk, condo_review, exception_desk,
  website_url, logo_url, notes, is_active`.replace(/\n/g, '');

// ============================================================
// Core CRUD
// ============================================================

/** Check if an investor exists by numeric id. Returns boolean. */
async function exists(id) {
  const [rows] = await db.query('SELECT id FROM investors WHERE id = ?', [id]);
  return rows.length > 0;
}

/**
 * Lightweight investor list.
 * @param {{ showAll?: boolean }} opts
 * @returns {Promise<object[]>} investors with customToggles[]
 */
async function findAll({ showAll = false } = {}) {
  const whereClause = showAll ? '' : 'WHERE is_active = 1';
  const [investors] = await db.query(
    `SELECT ${LIST_COLUMNS} FROM investors ${whereClause} ORDER BY name`
  );

  if (investors.length > 0) {
    const ids = investors.map(i => i.id);
    const [toggles] = await db.query(
      `SELECT investor_id, id, label, enabled, sort_order
       FROM investor_custom_toggles
       WHERE investor_id IN (?)
       ORDER BY sort_order, id`,
      [ids]
    );
    const byInv = {};
    toggles.forEach(t => {
      (byInv[t.investor_id] = byInv[t.investor_id] || []).push(t);
    });
    investors.forEach(inv => { inv.customToggles = byInv[inv.id] || []; });
  }

  return investors;
}

/**
 * Full investor detail with all sub-resources (team, lender IDs, etc.)
 * @param {string} key – investor_key
 * @returns {Promise<object|null>}
 */
async function findByKey(key) {
  const [investors] = await db.query(
    'SELECT * FROM investors WHERE investor_key = ?',
    [key]
  );
  if (investors.length === 0) return null;

  const investor = investors[0];
  const id = investor.id;

  const [teamResult, lenderIdsResult, clausesResult, linksResult, turnTimesResult, documentsResult, customTogglesResult, aesResult] = await Promise.all([
    db.query('SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name', [id]),
    db.query('SELECT * FROM investor_lender_ids WHERE investor_id = ?', [id]),
    db.query('SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?', [id]),
    db.query('SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type', [id]),
    db.query('SELECT * FROM investor_turn_times WHERE investor_id = ? ORDER BY sort_order', [id]),
    db.query('SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY created_at DESC', [id]),
    db.query('SELECT * FROM investor_custom_toggles WHERE investor_id = ? ORDER BY sort_order, id', [id]),
    db.query('SELECT * FROM investor_aes WHERE investor_id = ? ORDER BY sort_order, name', [id]),
  ]);

  investor.team = teamResult[0];
  investor.lenderIds = lenderIdsResult[0]?.[0] || {};
  investor.mortgageeClauses = clausesResult[0];
  investor.links = linksResult[0];
  investor.turnTimes = turnTimesResult[0];
  investor.documents = documentsResult[0];
  investor.customToggles = customTogglesResult[0];
  investor.aes = aesResult[0];

  return investor;
}

/**
 * Lookup a single investor row by numeric id or investor_key.
 * @param {string|number} idOrKey
 * @returns {Promise<object|null>}
 */
async function findByIdOrKey(idOrKey) {
  const isNumeric = /^\d+$/.test(String(idOrKey));
  const col = isNumeric ? 'id' : 'investor_key';
  const [rows] = await db.query(
    `SELECT * FROM investors WHERE ${col} = ?`,
    [idOrKey]
  );
  return rows[0] || null;
}

/** Insert columns for create */
const CREATE_COLUMNS = [
  'investor_key', 'name',
  'account_executive_name', 'account_executive_email',
  'account_executive_mobile', 'account_executive_address',
  'states', 'best_programs', 'minimum_fico', 'in_house_dpa',
  'epo', 'max_comp', 'underwriting_fee', 'in_house_servicing',
  'servicing', 'manual_underwriting', 'non_qm', 'jumbo',
  'subordinate_financing', 'review_wire_release',
  'usda', 'land_loans', 'va_loans', 'bridge_loans', 'dscr',
  'conventional', 'fha', 'bank_statement', 'asset_depletion',
  'interest_only', 'itin_foreign_national', 'construction', 'renovation',
  'manufactured', 'doctor', 'condo_non_warrantable', 'heloc_second',
  'scenario_desk', 'condo_review', 'exception_desk',
  'website_url', 'logo_url', 'login_url', 'notes',
];

/**
 * Create or upsert an investor.
 * @param {object} data - validated request body
 * @returns {Promise<object>} the created/updated investor row
 */
async function create(data) {
  const investorKey = data.investor_key ||
    data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const values = [
    investorKey, data.name,
    data.account_executive_name || null, data.account_executive_email || null,
    data.account_executive_mobile || null, data.account_executive_address || null,
    data.states || null, data.best_programs || null, data.minimum_fico || null, data.in_house_dpa || null,
    data.epo || null, data.max_comp || null, data.underwriting_fee || null, data.in_house_servicing || null,
    data.servicing ?? null, data.manual_underwriting ?? null, data.non_qm ?? null, data.jumbo ?? null,
    data.subordinate_financing ?? null, data.review_wire_release ?? null,
    data.usda ?? null, data.land_loans ?? null, data.va_loans ?? null, data.bridge_loans ?? null, data.dscr ?? null,
    data.conventional ?? null, data.fha ?? null, data.bank_statement ?? null, data.asset_depletion ?? null,
    data.interest_only ?? null, data.itin_foreign_national ?? null, data.construction ?? null, data.renovation ?? null,
    data.manufactured ?? null, data.doctor ?? null, data.condo_non_warrantable ?? null, data.heloc_second ?? null,
    data.scenario_desk ?? null, data.condo_review ?? null, data.exception_desk ?? null,
    data.website_url || null, data.logo_url || null, data.login_url || null, data.notes || null,
  ];

  const cols = CREATE_COLUMNS.join(', ');
  const placeholders = CREATE_COLUMNS.map(() => '?').join(', ');
  const duplicateUpdates = CREATE_COLUMNS.slice(1) // skip investor_key
    .map(c => `${c} = VALUES(${c})`)
    .join(', ');

  await db.query(
    `INSERT INTO investors (${cols}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${duplicateUpdates}, updated_at = NOW()`,
    values
  );

  const [rows] = await db.query('SELECT * FROM investors WHERE investor_key = ?', [investorKey]);
  return rows[0];
}

/**
 * Update an investor.
 * @param {string|number} idOrKey
 * @param {string[]} allowedFields
 * @param {object} data
 * @returns {Promise<object|null>} updated row, or null if not found / nothing to update
 */
async function update(idOrKey, allowedFields, data) {
  const isNumeric = /^\d+$/.test(String(idOrKey));
  const whereCol = isNumeric ? 'id = ?' : 'investor_key = ?';

  const result = buildUpdate('investors', allowedFields, data, { clause: whereCol, values: [idOrKey] });
  if (!result) return { error: 'no_fields' };

  await db.query(result.sql, result.values);

  const [rows] = await db.query(`SELECT * FROM investors WHERE ${whereCol}`, [idOrKey]);
  return rows[0] || null;
}

/**
 * Toggle is_active flag.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function toggleActive(id) {
  await db.query('UPDATE investors SET is_active = NOT is_active WHERE id = ?', [id]);
  const [rows] = await db.query('SELECT id, name, is_active FROM investors WHERE id = ?', [id]);
  return rows[0] || null;
}

/**
 * Delete an investor.
 * @param {string|number} idOrKey
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
async function remove(idOrKey) {
  const isNumeric = /^\d+$/.test(String(idOrKey));
  const whereClause = isNumeric ? 'WHERE id = ?' : 'WHERE investor_key = ?';

  const [existing] = await db.query(`SELECT id FROM investors ${whereClause}`, [idOrKey]);
  if (existing.length === 0) return false;

  await db.query(`DELETE FROM investors ${whereClause}`, [idOrKey]);
  return true;
}

// ============================================================
// Sub-resources — team, lender IDs, clauses, links, turn times
// ============================================================

async function saveAes(investorId, aes) {
  await db.query('DELETE FROM investor_aes WHERE investor_id = ?', [investorId]);
  for (let i = 0; i < aes.length; i++) {
    const a = aes[i];
    if (!a.name && !a.email && !a.mobile) continue;
    await db.query(
      'INSERT INTO investor_aes (investor_id, name, email, mobile, photo_url, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [investorId, a.name || null, a.email || null, a.mobile || null, a.photo_url || null, a.sort_order ?? i]
    );
  }
  const [rows] = await db.query('SELECT * FROM investor_aes WHERE investor_id = ? ORDER BY sort_order, name', [investorId]);
  return rows;
}

async function saveTeam(investorId, team) {
  await db.query('DELETE FROM investor_team WHERE investor_id = ?', [investorId]);
  for (let i = 0; i < team.length; i++) {
    const m = team[i];
    if (!m.name && !m.role) continue;
    await db.query(
      'INSERT INTO investor_team (investor_id, role, name, phone, email, photo_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [investorId, m.role || null, m.name || null, m.phone || null, m.email || null, m.photo_url || null, m.sort_order ?? i]
    );
  }
  const [rows] = await db.query('SELECT * FROM investor_team WHERE investor_id = ? ORDER BY sort_order, name', [investorId]);
  return rows;
}

async function saveLenderIds(investorId, { fha_id, va_id, rd_id }) {
  await db.query(
    `INSERT INTO investor_lender_ids (investor_id, fha_id, va_id, rd_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE fha_id = ?, va_id = ?, rd_id = ?`,
    [investorId, fha_id || null, va_id || null, rd_id || null, fha_id || null, va_id || null, rd_id || null]
  );
  const [rows] = await db.query('SELECT * FROM investor_lender_ids WHERE investor_id = ?', [investorId]);
  return rows[0] || {};
}

async function saveMortgageeClauses(investorId, clauses) {
  await db.query('DELETE FROM investor_mortgagee_clauses WHERE investor_id = ?', [investorId]);
  for (const c of clauses) {
    if (!c.name) continue;
    await db.query(
      'INSERT INTO investor_mortgagee_clauses (investor_id, label, name, isaoa, address) VALUES (?, ?, ?, ?, ?)',
      [investorId, c.label || null, c.name, c.isaoa || null, c.address || null]
    );
  }
  const [rows] = await db.query('SELECT * FROM investor_mortgagee_clauses WHERE investor_id = ?', [investorId]);
  return rows;
}

async function saveLinks(investorId, links) {
  await db.query('DELETE FROM investor_links WHERE investor_id = ?', [investorId]);
  for (const l of links) {
    if (!l.url) continue;
    await db.query(
      'INSERT INTO investor_links (investor_id, link_type, url, label) VALUES (?, ?, ?, ?)',
      [investorId, l.link_type || 'other', l.url, l.label || null]
    );
  }
  const [rows] = await db.query('SELECT * FROM investor_links WHERE investor_id = ? ORDER BY link_type', [investorId]);
  return rows;
}

async function saveTurnTimes(investorId, turnTimes) {
  await db.query('DELETE FROM investor_turn_times WHERE investor_id = ?', [investorId]);
  for (let i = 0; i < turnTimes.length; i++) {
    const t = turnTimes[i];
    if (!t.label || t.value == null) continue;
    const unit = t.unit === 'hours' ? 'hours' : 'days';
    await db.query(
      'INSERT INTO investor_turn_times (investor_id, label, value, unit, sort_order) VALUES (?, ?, ?, ?, ?)',
      [investorId, t.label, t.value, unit, t.sort_order ?? i]
    );
  }
  const [rows] = await db.query('SELECT * FROM investor_turn_times WHERE investor_id = ? ORDER BY sort_order', [investorId]);
  return rows;
}

// ============================================================
// Custom toggles
// ============================================================

async function getCustomToggles(investorId) {
  const [rows] = await db.query(
    'SELECT * FROM investor_custom_toggles WHERE investor_id = ? ORDER BY sort_order, id',
    [investorId]
  );
  return rows;
}

async function createCustomToggle(investorId, { label, enabled, sort_order }) {
  const [result] = await db.query(
    'INSERT INTO investor_custom_toggles (investor_id, label, enabled, sort_order) VALUES (?, ?, ?, ?)',
    [investorId, String(label).trim().slice(0, 100), enabled ? 1 : 0, sort_order || 0]
  );
  const [rows] = await db.query('SELECT * FROM investor_custom_toggles WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function updateCustomToggle(investorId, toggleId, data) {
  const sets = [];
  const vals = [];
  if (data.label !== undefined) { sets.push('label = ?'); vals.push(String(data.label).trim().slice(0, 100)); }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); vals.push(data.enabled ? 1 : 0); }
  if (data.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(data.sort_order); }
  if (sets.length === 0) return null;

  vals.push(toggleId, investorId);
  await db.query(`UPDATE investor_custom_toggles SET ${sets.join(', ')} WHERE id = ? AND investor_id = ?`, vals);

  const [rows] = await db.query('SELECT * FROM investor_custom_toggles WHERE id = ?', [toggleId]);
  return rows[0] || null;
}

async function deleteCustomToggle(investorId, toggleId) {
  await db.query(
    'DELETE FROM investor_custom_toggles WHERE id = ? AND investor_id = ?',
    [toggleId, investorId]
  );
}

// ============================================================
// Documents
// ============================================================

async function getDocuments(investorId) {
  const [docs] = await db.query(
    'SELECT * FROM investor_documents WHERE investor_id = ? ORDER BY created_at DESC',
    [investorId]
  );
  return docs;
}

async function createDocument(investorId, { fileName, fileKey, fileSize, fileType, docType, uploadedBy }) {
  const [result] = await db.query(
    `INSERT INTO investor_documents (investor_id, file_name, file_key, file_size, file_type, doc_type, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [investorId, fileName, fileKey, fileSize || null, fileType || null, docType || null, uploadedBy || null]
  );
  return result.insertId;
}

async function findDocument(investorId, docId) {
  const [rows] = await db.query(
    'SELECT * FROM investor_documents WHERE id = ? AND investor_id = ?',
    [docId, investorId]
  );
  return rows[0] || null;
}

async function updateDocumentType(docId, docType) {
  // docType is a short whitelist string (validated in the route handler).
  // null/empty clears the classification.
  await db.query(
    'UPDATE investor_documents SET doc_type = ? WHERE id = ?',
    [docType || null, docId]
  );
}

async function deleteDocument(docId) {
  await db.query('DELETE FROM investor_documents WHERE id = ?', [docId]);
}

// ============================================================
// Logo & photo helpers (DB operations only — S3 calls stay in routes)
// ============================================================

async function getLogoUrl(investorId) {
  const [rows] = await db.query('SELECT logo_url FROM investors WHERE id = ?', [investorId]);
  return rows[0]?.logo_url || null;
}

async function setLogoUrl(investorId, fileKey) {
  await db.query('UPDATE investors SET logo_url = ?, updated_at = NOW() WHERE id = ?', [fileKey, investorId]);
}

async function clearLogoUrl(investorId) {
  await db.query('UPDATE investors SET logo_url = NULL, updated_at = NOW() WHERE id = ?', [investorId]);
}

async function getAePhotoUrl(investorId) {
  const [rows] = await db.query('SELECT account_executive_photo_url FROM investors WHERE id = ?', [investorId]);
  return rows[0]?.account_executive_photo_url || null;
}

async function setAePhotoUrl(investorId, fileKey) {
  await db.query('UPDATE investors SET account_executive_photo_url = ?, updated_at = NOW() WHERE id = ?', [fileKey, investorId]);
}

async function clearAePhotoUrl(investorId) {
  await db.query('UPDATE investors SET account_executive_photo_url = NULL, updated_at = NOW() WHERE id = ?', [investorId]);
}

// ============================================================
// Notes
// ============================================================

/** Attach tag objects to an array of note rows. */
async function attachNoteTags(notes) {
  if (!notes.length) return notes;
  const noteIds = notes.map(n => n.id);
  const [rows] = await db.query(
    `SELECT nt.note_id, t.id, t.name, t.color
     FROM investor_note_tags nt
     JOIN investor_tags t ON nt.tag_id = t.id
     WHERE nt.note_id IN (?)`,
    [noteIds]
  );
  const byNote = {};
  rows.forEach(r => {
    (byNote[r.note_id] = byNote[r.note_id] || []).push({ id: r.id, name: r.name, color: r.color });
  });
  notes.forEach(n => { n.tags = byNote[n.id] || []; });
  return notes;
}

/** Replace all tags for a note. */
async function syncNoteTags(noteId, tagIds) {
  await db.query('DELETE FROM investor_note_tags WHERE note_id = ?', [noteId]);
  if (tagIds && tagIds.length > 0) {
    const values = tagIds.map(tid => [noteId, parseInt(tid)]);
    await db.query('INSERT IGNORE INTO investor_note_tags (note_id, tag_id) VALUES ?', [values]);
  }
}

async function getNotes(investorId) {
  const [notes] = await db.query(
    'SELECT * FROM investor_notes WHERE investor_id = ? ORDER BY created_at DESC',
    [investorId]
  );
  await attachNoteTags(notes);
  return notes;
}

async function createNote(investorId, { userId, authorName, content, tagIds }) {
  const [result] = await db.query(
    'INSERT INTO investor_notes (investor_id, author_id, author_name, content) VALUES (?, ?, ?, ?)',
    [investorId, userId, authorName, content.trim()]
  );
  if (Array.isArray(tagIds) && tagIds.length > 0) {
    await syncNoteTags(result.insertId, tagIds);
  }
  const [note] = await db.query('SELECT * FROM investor_notes WHERE id = ?', [result.insertId]);
  await attachNoteTags(note);
  return note[0];
}

async function findNote(investorId, noteId) {
  const [rows] = await db.query(
    'SELECT * FROM investor_notes WHERE id = ? AND investor_id = ?',
    [noteId, investorId]
  );
  return rows[0] || null;
}

async function updateNote(noteId, { content, tagIds }) {
  await db.query('UPDATE investor_notes SET content = ? WHERE id = ?', [content.trim(), noteId]);
  if (Array.isArray(tagIds)) {
    await syncNoteTags(parseInt(noteId), tagIds);
  }
  const [updated] = await db.query('SELECT * FROM investor_notes WHERE id = ?', [noteId]);
  await attachNoteTags(updated);
  return updated[0];
}

async function deleteNote(noteId) {
  await db.query('DELETE FROM investor_notes WHERE id = ?', [noteId]);
}

// ============================================================
// Tags
// ============================================================

async function getTags() {
  const [tags] = await db.query(
    `SELECT t.*, (SELECT COUNT(*) FROM investor_note_tags nt WHERE nt.tag_id = t.id) AS usage_count
     FROM investor_tags t ORDER BY t.name`
  );
  return tags;
}

async function createTag(name, color, userId) {
  await db.query(
    'INSERT INTO investor_tags (name, color, created_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=id',
    [name.trim(), color || '#8cc63e', userId]
  );
  const [tags] = await db.query('SELECT * FROM investor_tags WHERE name = ?', [name.trim()]);
  return tags[0];
}

/**
 * Delete a tag. Returns { success, error? }.
 * Blocks deletion if the tag is in use on notes.
 */
async function deleteTag(tagId) {
  const [usage] = await db.query('SELECT COUNT(*) AS cnt FROM investor_note_tags WHERE tag_id = ?', [tagId]);
  if (usage[0].cnt > 0) {
    return { success: false, inUseCount: usage[0].cnt };
  }
  await db.query('DELETE FROM investor_tags WHERE id = ?', [tagId]);
  return { success: true };
}

/** Tag names grouped by investor_id (for frontend search). */
async function getNoteTagsMap() {
  const [rows] = await db.query(
    `SELECT n.investor_id, t.name
     FROM investor_note_tags nt
     JOIN investor_notes n ON nt.note_id = n.id
     JOIN investor_tags t ON nt.tag_id = t.id
     GROUP BY n.investor_id, t.name
     ORDER BY n.investor_id`
  );
  const map = {};
  rows.forEach(r => {
    if (!map[r.investor_id]) map[r.investor_id] = [];
    map[r.investor_id].push(r.name);
  });
  return map;
}

// ============================================================
// Exports
// ============================================================
module.exports = {
  // Core
  exists,
  findAll,
  findByKey,
  findByIdOrKey,
  create,
  update,
  toggleActive,
  remove,
  // Sub-resources
  saveAes,
  saveTeam,
  saveLenderIds,
  saveMortgageeClauses,
  saveLinks,
  saveTurnTimes,
  // Custom toggles
  getCustomToggles,
  createCustomToggle,
  updateCustomToggle,
  deleteCustomToggle,
  // Documents
  getDocuments,
  createDocument,
  findDocument,
  updateDocumentType,
  deleteDocument,
  // Logos & photos
  getLogoUrl,
  setLogoUrl,
  clearLogoUrl,
  getAePhotoUrl,
  setAePhotoUrl,
  clearAePhotoUrl,
  // Notes
  getNotes,
  createNote,
  findNote,
  updateNote,
  deleteNote,
  // Tags
  getTags,
  createTag,
  deleteTag,
  getNoteTagsMap,
};
