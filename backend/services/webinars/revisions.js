const db = require('../../db/connection');
const { LIMITS } = require('./limits');
const {
  assertCandidateWithinLimits,
  exactHttpsOrigin,
  loadResourcePolicy,
  validateCss,
  validateJavascript,
  validateMasterHtml,
  validateSlideHtml,
} = require('./contentPolicy');
const { collectSurfaceTokens } = require('../webinarAssets/tokens');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANCHOR = /^[a-z][a-z0-9-]{0,189}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENT_SCHEMA_VERSION = 2;
const CURRENT_ADMISSION_POLICY_VERSION = 1;
const MAX_POLICY_ORIGINS = 64;
const WEBINAR_FIELDS = ['slug', 'title', 'masterHtml', 'masterCss'];
const SLIDE_FIELDS = ['id', 'position', 'anchor', 'title', 'targetSeconds', 'speakerNotes', 'html', 'css', 'javascript'];
const SNAPSHOT_V1_FIELDS = ['schemaVersion', 'webinar', 'slides'];
const SNAPSHOT_V2_FIELDS = ['schemaVersion', 'admissionPolicy', 'webinar', 'slides'];
const ADMISSION_POLICY_FIELDS = ['version', 'resourcePolicy'];
const RESOURCE_POLICY_FIELDS = ['assetOrigin', 'stylesheetOrigins', 'fontOrigins'];
const POLICY_COMPATIBILITY_ISSUES = new Set([
  'ASSET_ORIGIN_NOT_CONFIGURED',
  'RESOURCE_ORIGIN_FORBIDDEN',
]);

class RevisionError extends Error {
  constructor(code, message = 'Invalid webinar revision') {
    super(message);
    this.name = 'RevisionError';
    this.code = code;
  }
}

function invalidSnapshot() {
  throw new RevisionError('REVISION_SNAPSHOT_INVALID');
}

function incompatiblePolicy() {
  throw new RevisionError(
    'REVISION_POLICY_INCOMPATIBLE',
    'Revision cannot be restored under the current security policy',
  );
}

function number(value) {
  return value === null || value === undefined ? null : Number(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function canonicalOriginList(value) {
  if (!Array.isArray(value) || value.length > MAX_POLICY_ORIGINS) invalidSnapshot();
  const origins = [];
  for (const origin of value) {
    if (typeof origin !== 'string' || origin.length > 2048 || exactHttpsOrigin(origin) !== origin) {
      invalidSnapshot();
    }
    origins.push(origin);
  }
  if (new Set(origins).size !== origins.length) invalidSnapshot();
  return Object.freeze(origins);
}

function canonicalResourcePolicy(value) {
  if (!exactKeys(value, RESOURCE_POLICY_FIELDS)) invalidSnapshot();
  if (value.assetOrigin !== null && (
    typeof value.assetOrigin !== 'string'
    || value.assetOrigin.length > 2048
    || exactHttpsOrigin(value.assetOrigin) !== value.assetOrigin
  )) invalidSnapshot();
  return Object.freeze({
    assetOrigin: value.assetOrigin,
    stylesheetOrigins: canonicalOriginList(value.stylesheetOrigins),
    fontOrigins: canonicalOriginList(value.fontOrigins),
  });
}

function captureAdmissionPolicy(resourcePolicy = loadResourcePolicy()) {
  const canonical = canonicalResourcePolicy({
    assetOrigin: resourcePolicy.assetOrigin ?? null,
    stylesheetOrigins: [...(resourcePolicy.stylesheetOrigins || [])],
    fontOrigins: [...(resourcePolicy.fontOrigins || [])],
  });
  return Object.freeze({
    version: CURRENT_ADMISSION_POLICY_VERSION,
    resourcePolicy: canonical,
  });
}

function canonicalAdmissionPolicy(value) {
  if (!exactKeys(value, ADMISSION_POLICY_FIELDS)
    || !Number.isSafeInteger(value.version) || value.version < 1) invalidSnapshot();
  return Object.freeze({
    version: value.version,
    resourcePolicy: canonicalResourcePolicy(value.resourcePolicy),
  });
}

function parseRevokedPolicyVersions(env) {
  const raw = env.WEBINAR_REVISION_REVOKED_POLICY_VERSIONS;
  if (raw === undefined || raw === '') return new Set();
  if (typeof raw !== 'string') incompatiblePolicy();
  const values = raw.split(',').map(value => value.trim());
  if (values.some(value => !/^[1-9]\d*$/.test(value))) incompatiblePolicy();
  const versions = values.map(Number);
  if (versions.some(value => !Number.isSafeInteger(value))) incompatiblePolicy();
  return new Set(versions);
}

function parseRevokedOrigins(env) {
  const raw = env.WEBINAR_REVISION_REVOKED_ORIGINS;
  if (raw === undefined || raw === '') return new Set();
  if (typeof raw !== 'string') incompatiblePolicy();
  const values = raw.split(',').map(value => value.trim());
  if (values.some(value => !value || exactHttpsOrigin(value) !== value)) incompatiblePolicy();
  return new Set(values);
}

function effectiveResourcePolicy(admissionPolicy, env) {
  const revokedVersions = parseRevokedPolicyVersions(env);
  if (admissionPolicy.version !== CURRENT_ADMISSION_POLICY_VERSION
    || revokedVersions.has(admissionPolicy.version)) incompatiblePolicy();
  const revokedOrigins = parseRevokedOrigins(env);
  const { resourcePolicy } = admissionPolicy;
  return Object.freeze({
    assetOrigin: revokedOrigins.has(resourcePolicy.assetOrigin) ? null : resourcePolicy.assetOrigin,
    stylesheetOrigins: Object.freeze(
      resourcePolicy.stylesheetOrigins.filter(origin => !revokedOrigins.has(origin)),
    ),
    fontOrigins: Object.freeze(
      resourcePolicy.fontOrigins.filter(origin => !revokedOrigins.has(origin)),
    ),
  });
}

function snapshotFromRows(webinar, slides, admissionPolicy = captureAdmissionPolicy()) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    admissionPolicy,
    webinar: {
      slug: webinar.slug,
      title: webinar.title,
      masterHtml: webinar.master_html,
      masterCss: webinar.master_css,
    },
    slides: slides.map(slide => ({
      id: slide.id,
      position: number(slide.position),
      anchor: slide.anchor,
      title: slide.title,
      targetSeconds: number(slide.target_seconds),
      speakerNotes: slide.speaker_notes,
      html: slide.html,
      css: slide.css,
      javascript: slide.javascript,
    })),
  };
}

async function buildCompleteSnapshot(connection, webinarId, { admissionPolicy } = {}) {
  const [webinars] = await connection.query(
    `SELECT slug, title, master_html, master_css
     FROM webinar_presentations
     WHERE id = ? AND archived_at IS NULL`,
    [webinarId],
  );
  if (!webinars[0]) throw new RevisionError('WEBINAR_NOT_FOUND', 'Webinar not found');
  const [slides] = await connection.query(
    `SELECT id, position, anchor, title, target_seconds, speaker_notes, html, css, javascript
     FROM webinar_slides
     WHERE webinar_id = ? AND archived_at IS NULL
     ORDER BY position ASC`,
    [webinarId],
  );
  const policy = admissionPolicy
    ? canonicalAdmissionPolicy(admissionPolicy)
    : captureAdmissionPolicy();
  return snapshotFromRows(webinars[0], slides, policy);
}

function snapshotContentIssues(snapshot, resourcePolicy) {
  const candidate = {
    masterHtml: snapshot.webinar.masterHtml,
    masterCss: snapshot.webinar.masterCss,
    slides: snapshot.slides,
  };
  const issues = [
    ...validateMasterHtml(candidate.masterHtml, resourcePolicy).issues,
    ...validateCss(candidate.masterCss, 'master_css', resourcePolicy).issues,
  ];
  for (const slide of candidate.slides) {
    issues.push(
      ...validateSlideHtml(slide.html, resourcePolicy).issues,
      ...validateCss(slide.css, 'slide_css', resourcePolicy).issues,
      ...validateJavascript(slide.javascript).issues,
    );
  }
  try {
    assertCandidateWithinLimits(candidate, resourcePolicy);
  } catch (error) {
    issues.push(...(error.issues || [{ code: error.code || 'CONTENT_LIMIT_EXCEEDED' }]));
  }
  return issues;
}

function inspectCompleteSnapshot(snapshot, { env = process.env } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !Number.isSafeInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
    invalidSnapshot();
  }
  if (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    incompatiblePolicy();
  }

  const legacy = snapshot.schemaVersion === 1;
  const expectedFields = legacy ? SNAPSHOT_V1_FIELDS : SNAPSHOT_V2_FIELDS;
  if (!exactKeys(snapshot, expectedFields)) invalidSnapshot();
  const admissionPolicy = legacy
    ? captureAdmissionPolicy(loadResourcePolicy(env))
    : canonicalAdmissionPolicy(snapshot.admissionPolicy);

  if (!exactKeys(snapshot.webinar, WEBINAR_FIELDS)
    || WEBINAR_FIELDS.some(field => typeof snapshot.webinar[field] !== 'string')
    || !SLUG.test(snapshot.webinar.slug) || snapshot.webinar.slug.length > 190
    || !snapshot.webinar.title.trim() || snapshot.webinar.title.length > 255
    || !Array.isArray(snapshot.slides)) {
    invalidSnapshot();
  }
  const ids = new Set();
  const anchors = new Set();
  for (const [position, slide] of snapshot.slides.entries()) {
    if (!exactKeys(slide, SLIDE_FIELDS)
      || !UUID.test(slide.id) || !ANCHOR.test(slide.anchor)
      || !Number.isInteger(slide.position) || slide.position !== position
      || !Number.isInteger(slide.targetSeconds) || slide.targetSeconds < 0 || slide.targetSeconds > 7200
      || ['title', 'speakerNotes', 'html', 'css', 'javascript'].some(field => typeof slide[field] !== 'string')
      || !slide.title.trim() || slide.title.length > 255
      || Buffer.byteLength(slide.speakerNotes, 'utf8') > LIMITS.speaker_notes) {
      invalidSnapshot();
    }
    if (ids.has(slide.id) || anchors.has(slide.anchor)) invalidSnapshot();
    ids.add(slide.id);
    anchors.add(slide.anchor);
  }

  const admittedIssues = snapshotContentIssues(snapshot, admissionPolicy.resourcePolicy);
  if (admittedIssues.length) {
    if (legacy && admittedIssues.every(issue => POLICY_COMPATIBILITY_ISSUES.has(issue.code))) {
      incompatiblePolicy();
    }
    invalidSnapshot();
  }
  const effectivePolicy = effectiveResourcePolicy(admissionPolicy, env);
  if (snapshotContentIssues(snapshot, effectivePolicy).length) incompatiblePolicy();
  return { admissionPolicy, effectivePolicy, legacy };
}

function assertCompleteSnapshot(snapshot, options) {
  inspectCompleteSnapshot(snapshot, options);
  return snapshot;
}

function assetVersionIdsFromSnapshot(snapshot, options) {
  assertCompleteSnapshot(snapshot, options);
  const candidate = {
    masterHtml: snapshot.webinar.masterHtml,
    masterCss: snapshot.webinar.masterCss,
    slides: snapshot.slides,
  };
  return [...new Set(
    collectSurfaceTokens(candidate).map(reference => reference.assetVersionId),
  )].sort();
}

async function insertRevision(connection, { webinarId, liveVersion, snapshot, changeType, changeSummary, actorUserId }) {
  assertCompleteSnapshot(snapshot);
  const [result] = await connection.query(
    `INSERT INTO webinar_revisions
       (webinar_id, version, snapshot, change_type, change_summary, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [webinarId, liveVersion, JSON.stringify(snapshot), changeType, changeSummary, actorUserId],
  );
  return Number(result.insertId);
}

async function listHistory(webinarId) {
  const [rows] = await db.query(
    `SELECT r.id, r.version, r.change_type, r.change_summary, r.created_at, u.name AS creator_name
     FROM webinar_revisions r
     JOIN users u ON u.id = r.created_by_user_id
     WHERE r.webinar_id = ?
     ORDER BY r.version DESC`,
    [webinarId],
  );
  return rows.map(row => ({
    id: number(row.id),
    version: number(row.version),
    changeType: row.change_type,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
    createdBy: { name: row.creator_name },
  }));
}

async function getRevisionForRestore(webinarId, revisionId, connection = db, options) {
  const [rows] = await connection.query(
    `SELECT id, webinar_id, version, snapshot
     FROM webinar_revisions
     WHERE webinar_id = ? AND id = ?`,
    [webinarId, revisionId],
  );
  const row = rows[0];
  if (!row) return null;
  let snapshot;
  try {
    snapshot = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
  } catch {
    invalidSnapshot();
  }
  const { admissionPolicy } = inspectCompleteSnapshot(snapshot, options);
  return {
    id: number(row.id),
    webinarId: number(row.webinar_id),
    version: number(row.version),
    snapshot,
    admissionPolicy,
  };
}

module.exports = {
  CURRENT_ADMISSION_POLICY_VERSION,
  CURRENT_SCHEMA_VERSION,
  RevisionError,
  assetVersionIdsFromSnapshot,
  assertCompleteSnapshot,
  buildCompleteSnapshot,
  captureAdmissionPolicy,
  getRevisionForRestore,
  insertRevision,
  listHistory,
};
