const { randomUUID } = require('node:crypto');
const db = require('../../db/connection');
const {
  assertCandidateWithinLimits, loadResourcePolicy, validateAnchor, validateCss,
  validateJavascript, validateMasterHtml, validateSlideHtml,
} = require('./contentPolicy');
const {
  RevisionError,
  assetVersionIdsFromSnapshot,
  buildCompleteSnapshot,
  captureAdmissionPolicy,
  getRevisionForRestore,
  insertRevision,
} = require('./revisions');
const { recordAuditEvent: defaultRecordAuditEvent } = require('./audit');
const { aggregateRollbackFailure, runTransaction } = require('./transaction');
const {
  validateAndReplaceReferences: defaultSyncAssetReferences,
  recordRevisionAssetReferences: defaultRecordRevisionAssetReferences,
} = require('../webinarAssets/references');

const SAFE_MASTER = '<main class="webinar-slide">{{SLIDE_CONTENT}}</main>';
const ASSET_TOKEN = /\{\{ASSET:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}\}/i;

class WebinarMutationError extends Error {
  constructor(code, message = 'Webinar mutation failed', extra = {}) {
    super(message);
    this.name = 'WebinarMutationError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function cloneSlide(row) {
  return {
    id: row.id,
    position: Number(row.position),
    anchor: row.anchor,
    title: row.title,
    targetSeconds: Number(row.target_seconds),
    speakerNotes: row.speaker_notes,
    html: row.html,
    css: row.css,
    javascript: row.javascript,
  };
}

async function lockWebinar(connection, webinarId) {
  const [rows] = await connection.query(
    `SELECT p.id, p.slug, p.title, p.master_html, p.master_css, p.live_version,
            p.audience_enabled, p.primary_owner_user_id, p.updated_at, p.updated_by_user_id,
            u.name AS updater_name
     FROM webinar_presentations p
     LEFT JOIN users u ON u.id = p.updated_by_user_id
     WHERE p.id = ? AND p.archived_at IS NULL
     FOR UPDATE`,
    [webinarId],
  );
  if (!rows[0]) throw new WebinarMutationError('WEBINAR_NOT_FOUND', 'Webinar not found', { status: 404 });
  return rows[0];
}

function assertExpectedVersion(webinar, expectedVersion) {
  const currentVersion = Number(webinar.live_version);
  if (currentVersion !== Number(expectedVersion)) {
    throw new WebinarMutationError('VERSION_CONFLICT', 'Webinar has changed', {
      status: 409,
      currentVersion,
      updatedAt: webinar.updated_at,
      updatedBy: { id: Number(webinar.updated_by_user_id), name: webinar.updater_name || null },
    });
  }
}

function assertLockedWebinarEdit(webinar, { actorUserId, actorIsAdmin }) {
  if (Number.isSafeInteger(actorUserId) && actorUserId > 0
    && (actorIsAdmin === true || Number(webinar.primary_owner_user_id) === actorUserId)) return;
  throw new WebinarMutationError(
    'WEBINAR_ACCESS_DENIED',
    'Webinar owner or administrator access required',
    { status: 403 },
  );
}

async function activeSlides(connection, webinarId) {
  const [rows] = await connection.query(
    `SELECT id, position, anchor, title, target_seconds, speaker_notes, html, css, javascript
     FROM webinar_slides
     WHERE webinar_id = ? AND archived_at IS NULL
     ORDER BY position ASC`,
    [webinarId],
  );
  return rows.map(cloneSlide);
}

async function assertRestoreSlideOwnership(connection, webinarId, slideIds) {
  if (!slideIds.length) return;
  const placeholders = slideIds.map(() => '?').join(', ');
  const [rows] = await connection.query(
    `SELECT id, webinar_id FROM webinar_slides WHERE id IN (${placeholders}) FOR UPDATE`,
    slideIds,
  );
  if (rows.some(row => Number(row.webinar_id) !== Number(webinarId))) {
    throw new WebinarMutationError('RESTORE_SLIDE_OWNERSHIP_CONFLICT', 'Restore slide belongs to a different webinar', { status: 409 });
  }
}

function validationError(issues) {
  return new WebinarMutationError('CONTENT_VALIDATION_FAILED', 'Webinar content failed validation', { status: 400, issues });
}

function validationPolicy() {
  return loadResourcePolicy();
}

function validateCandidate(candidate, policy = validationPolicy()) {
  if (hasAssetTokens(candidate) && !policy.assetOrigin) {
    throw new WebinarMutationError('ASSET_ORIGIN_NOT_CONFIGURED', 'Asset origin is not configured', { status: 503 });
  }
  const issues = [
    ...validateMasterHtml(candidate.masterHtml, policy).issues,
    ...validateCss(candidate.masterCss, 'master_css', policy).issues,
  ];
  for (const slide of candidate.slides) {
    issues.push(
      ...validateAnchor(slide.anchor).issues,
      ...validateSlideHtml(slide.html, policy).issues,
      ...validateCss(slide.css, 'slide_css', policy).issues,
      ...validateJavascript(slide.javascript).issues,
    );
    if (!Number.isInteger(slide.targetSeconds) || slide.targetSeconds < 0 || slide.targetSeconds > 7200) {
      issues.push({ code: 'TARGET_SECONDS_RANGE', surface: 'target_seconds' });
    }
  }
  if (issues.length) throw validationError(issues);
  try {
    assertCandidateWithinLimits(candidate, policy);
  } catch (error) {
    throw validationError(error.issues || [{ code: error.code || 'CONTENT_LIMIT_EXCEEDED' }]);
  }
  return policy;
}

function hasAssetTokens(value) {
  if (typeof value === 'string') return ASSET_TOKEN.test(value);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(hasAssetTokens);
}

function candidateFrom(webinar, slides) {
  return {
    webinarId: Number(webinar.id),
    slug: webinar.slug,
    title: webinar.title,
    masterHtml: webinar.master_html,
    masterCss: webinar.master_css,
    slides: slides.map(slide => ({ ...slide })),
  };
}

function nextAnchor(existing, desired) {
  if (!existing.has(desired)) return desired;
  let suffix = 2;
  while (existing.has(`${desired}-${suffix}`)) suffix += 1;
  return `${desired}-${suffix}`;
}

function resultFor(webinar) {
  return {
    webinarId: Number(webinar.id),
    liveVersion: Number(webinar.live_version),
    updatedAt: webinar.updated_at,
    primaryOwnerUserId: Number(webinar.primary_owner_user_id),
    audienceEnabled: Boolean(Number(webinar.audience_enabled)),
  };
}

function resultSlideFor(slide) {
  return {
    id: slide.id,
    anchor: slide.anchor,
    title: slide.title,
    targetSeconds: slide.targetSeconds,
    speakerNotes: slide.speakerNotes,
    html: slide.html,
    css: slide.css,
    javascript: slide.javascript,
  };
}

function assertExactAssetDependencies(validatedAssetVersionIds, snapshotAssetVersionIds) {
  if (validatedAssetVersionIds.length === snapshotAssetVersionIds.length
    && validatedAssetVersionIds.every((assetVersionId, index) => (
      assetVersionId === snapshotAssetVersionIds[index]
    ))) return;
  throw new WebinarMutationError(
    'ASSET_REFERENCE_STATE_MISMATCH',
    'Webinar asset references did not match the revision snapshot',
    { status: 500 },
  );
}

async function readCurrentMetadata(connection, webinarId) {
  const [rows] = await connection.query(
    `SELECT id, live_version, updated_at, primary_owner_user_id, audience_enabled
     FROM webinar_presentations WHERE id = ?`,
    [webinarId],
  );
  if (!rows[0]) throw new WebinarMutationError('WEBINAR_NOT_FOUND', 'Webinar not found', { status: 404 });
  return rows[0];
}

async function findActiveOwner(connection, userId) {
  const [rows] = await connection.query('SELECT id, name FROM users WHERE id = ? AND is_active = 1', [userId]);
  if (!rows[0]) throw new WebinarMutationError('OWNER_NOT_ACTIVE', 'Owner must be an active user', { status: 400 });
  return rows[0];
}

function createMutationService({
  db: connectionPool = db,
  validateCandidate: candidateValidator = validateCandidate,
  syncAssetReferences = defaultSyncAssetReferences,
  recordRevisionAssetReferences = defaultRecordRevisionAssetReferences,
  recordAuditEvent = defaultRecordAuditEvent,
} = {}) {
  async function contentMutation({ webinarId, actorUserId, actorIsAdmin, expectedVersion, changeType, changeSummary, transform, apply }) {
    return runTransaction(connectionPool, async connection => {
      const webinar = await lockWebinar(connection, webinarId);
      assertLockedWebinarEdit(webinar, { actorUserId, actorIsAdmin });
      assertExpectedVersion(webinar, expectedVersion);
      const candidate = candidateFrom(webinar, await activeSlides(connection, webinarId));
      const transformed = await transform(candidate, connection, webinar);
      let admissionPolicy = transformed?.admissionPolicy;
      if (!admissionPolicy) {
        const resourcePolicy = validationPolicy();
        await candidateValidator(candidate, resourcePolicy);
        admissionPolicy = captureAdmissionPolicy(resourcePolicy);
      }
      await apply(connection, candidate, webinar);
      const { assetVersionIds = [] } = await syncAssetReferences(connection, candidate);
      const snapshot = await buildCompleteSnapshot(connection, webinarId, { admissionPolicy });
      const snapshotAssetVersionIds = assetVersionIdsFromSnapshot(snapshot);
      assertExactAssetDependencies(assetVersionIds, snapshotAssetVersionIds);
      const liveVersion = Number(webinar.live_version) + 1;
      const revisionId = await insertRevision(connection, { webinarId, liveVersion, snapshot, changeType, changeSummary, actorUserId });
      await recordRevisionAssetReferences(connection, revisionId, snapshotAssetVersionIds);
      await connection.query(
        'UPDATE webinar_presentations SET live_version = ?, updated_by_user_id = ? WHERE id = ?',
        [liveVersion, actorUserId, webinarId],
      );
      await recordAuditEvent(connection, {
        webinarId, actorUserId, eventType: 'content_saved', targetType: 'webinar', targetId: webinarId,
        metadata: { liveVersion, changeType },
      });
      const current = await readCurrentMetadata(connection, webinarId);
      const result = resultFor(current);
      if (transformed?.createdSlide) result.slide = transformed.createdSlide;
      return result;
    });
  }

  function saveMaster(input) {
    return contentMutation({
      ...input, changeType: 'master_saved', changeSummary: 'Updated master presentation',
      transform: async candidate => { candidate.masterHtml = input.masterHtml; candidate.masterCss = input.masterCss; },
      apply: (connection, candidate, webinar) => connection.query(
        'UPDATE webinar_presentations SET master_html = ?, master_css = ?, updated_by_user_id = ? WHERE id = ?',
        [candidate.masterHtml, candidate.masterCss, input.actorUserId, webinar.id],
      ),
    });
  }

  function saveSlide(input) {
    return contentMutation({
      ...input, changeType: 'slide_saved', changeSummary: 'Updated slide',
      transform: async candidate => {
        const index = candidate.slides.findIndex(slide => slide.id === input.slideId);
        if (index < 0) throw new WebinarMutationError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 });
        candidate.slides[index] = { ...candidate.slides[index], anchor: input.anchor, title: input.title, targetSeconds: input.targetSeconds, speakerNotes: input.speakerNotes, html: input.html, css: input.css, javascript: input.javascript };
        if (candidate.slides.some((slide, current) => current !== index && slide.anchor === input.anchor)) throw new WebinarMutationError('ANCHOR_CONFLICT', 'Slide anchor already exists', { status: 409 });
      },
      apply: (connection, candidate) => {
        const slide = candidate.slides.find(value => value.id === input.slideId);
        return connection.query(
          `UPDATE webinar_slides SET anchor = ?, title = ?, target_seconds = ?, speaker_notes = ?, html = ?, css = ?, javascript = ?, updated_by_user_id = ?
           WHERE id = ? AND webinar_id = ?`,
          [slide.anchor, slide.title, slide.targetSeconds, slide.speakerNotes, slide.html, slide.css, slide.javascript, input.actorUserId, input.slideId, input.webinarId],
        );
      },
    });
  }

  function addSlide(input) {
    let created;
    return contentMutation({
      ...input, changeType: input.sourceSlideId ? 'slide_duplicated' : 'slide_added', changeSummary: input.sourceSlideId ? 'Duplicated slide' : 'Added slide',
      transform: async candidate => {
        const source = input.sourceSlideId ? candidate.slides.find(slide => slide.id === input.sourceSlideId) : null;
        if (input.sourceSlideId && !source) throw new WebinarMutationError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 });
        const anchors = new Set(candidate.slides.map(slide => slide.anchor));
        created = source
          ? {
            id: randomUUID(), position: candidate.slides.length, anchor: nextAnchor(anchors, `${source.anchor}-copy`),
            title: source.title, targetSeconds: source.targetSeconds, speakerNotes: source.speakerNotes,
            html: source.html, css: source.css, javascript: source.javascript,
          }
          : {
            id: randomUUID(), position: candidate.slides.length, anchor: input.anchor,
            title: input.title, targetSeconds: input.targetSeconds, speakerNotes: input.speakerNotes,
            html: input.html, css: input.css, javascript: input.javascript,
          };
        if (!source && anchors.has(created.anchor)) throw new WebinarMutationError('ANCHOR_CONFLICT', 'Slide anchor already exists', { status: 409 });
        candidate.slides.push(created);
        return { createdSlide: resultSlideFor(created) };
      },
      apply: connection => connection.query(
        `INSERT INTO webinar_slides
           (id, webinar_id, position, anchor, title, target_seconds, speaker_notes, html, css, javascript, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.id, input.webinarId, created.position, created.anchor, created.title, created.targetSeconds, created.speakerNotes, created.html, created.css, created.javascript, input.actorUserId, input.actorUserId],
      ),
    });
  }

  function duplicateSlide(input) {
    return addSlide(input);
  }

  function reorderSlides(input) {
    return contentMutation({
      ...input, changeType: 'slides_reordered', changeSummary: 'Reordered slides',
      transform: async candidate => {
        const actual = new Set(candidate.slides.map(slide => slide.id));
        const supplied = new Set(input.slideIds);
        if (actual.size !== supplied.size || [...actual].some(id => !supplied.has(id))) throw new WebinarMutationError('SLIDE_SET_MISMATCH', 'Slide order must include every active slide', { status: 400 });
        candidate.slides = input.slideIds.map((id, position) => ({ ...candidate.slides.find(slide => slide.id === id), position }));
      },
      apply: async (connection, candidate) => {
        // The active-position unique key makes a direct 0↔1 swap invalid.
        // Move the entire active set out of the real range first, then normalize.
        await connection.query(
          'UPDATE webinar_slides SET position = position + 1000000 WHERE webinar_id = ? AND archived_at IS NULL',
          [input.webinarId],
        );
        for (const slide of candidate.slides) {
          await connection.query('UPDATE webinar_slides SET position = ?, updated_by_user_id = ? WHERE id = ? AND webinar_id = ?', [slide.position, input.actorUserId, slide.id, input.webinarId]);
        }
      },
    });
  }

  function archiveSlide(input) {
    return contentMutation({
      ...input, changeType: 'slide_archived', changeSummary: 'Archived slide',
      transform: async candidate => {
        if (!candidate.slides.some(slide => slide.id === input.slideId)) throw new WebinarMutationError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 });
        if (candidate.slides.length === 1) {
          throw new WebinarMutationError(
            'LAST_SLIDE_REQUIRED',
            'A webinar must retain at least one live slide',
            { status: 409 },
          );
        }
        candidate.slides = candidate.slides.filter(slide => slide.id !== input.slideId).map((slide, position) => ({ ...slide, position }));
      },
      apply: async (connection, candidate) => {
        await connection.query(
          'UPDATE webinar_slides SET position = NULL, archived_at = CURRENT_TIMESTAMP(3), updated_by_user_id = ? WHERE id = ? AND webinar_id = ?',
          [input.actorUserId, input.slideId, input.webinarId],
        );
        for (const slide of candidate.slides) await connection.query('UPDATE webinar_slides SET position = ? WHERE id = ? AND webinar_id = ?', [slide.position, slide.id, input.webinarId]);
      },
    });
  }

  async function restoreRevision(input) {
    return contentMutation({
      ...input, changeType: 'revision_restored', changeSummary: 'Restored revision',
      transform: async (candidate, connection) => {
        let revision;
        try {
          revision = await getRevisionForRestore(input.webinarId, input.revisionId, connection);
        } catch (error) {
          if (error instanceof RevisionError && error.code === 'REVISION_POLICY_INCOMPATIBLE') {
            throw new WebinarMutationError(
              error.code,
              'Revision cannot be restored under the current security policy',
              { status: 409 },
            );
          }
          throw error;
        }
        if (!revision) throw new WebinarMutationError('REVISION_NOT_FOUND', 'Revision not found', { status: 404 });
        await assertRestoreSlideOwnership(connection, input.webinarId, revision.snapshot.slides.map(slide => slide.id));
        candidate.slug = revision.snapshot.webinar.slug;
        candidate.title = revision.snapshot.webinar.title;
        candidate.masterHtml = revision.snapshot.webinar.masterHtml;
        candidate.masterCss = revision.snapshot.webinar.masterCss;
        candidate.slides = revision.snapshot.slides.map(slide => ({ ...slide }));
        return { admissionPolicy: revision.admissionPolicy };
      },
      apply: async (connection, candidate) => {
        await connection.query('UPDATE webinar_presentations SET slug = ?, title = ?, master_html = ?, master_css = ?, updated_by_user_id = ? WHERE id = ?', [candidate.slug, candidate.title, candidate.masterHtml, candidate.masterCss, input.actorUserId, input.webinarId]);
        await connection.query('UPDATE webinar_slides SET position = NULL, archived_at = CURRENT_TIMESTAMP(3), updated_by_user_id = ? WHERE webinar_id = ? AND archived_at IS NULL', [input.actorUserId, input.webinarId]);
        for (const slide of candidate.slides) {
          const [updated] = await connection.query(
            `UPDATE webinar_slides SET position = ?, anchor = ?, title = ?, target_seconds = ?, speaker_notes = ?, html = ?, css = ?, javascript = ?, archived_at = NULL, updated_by_user_id = ?
             WHERE id = ? AND webinar_id = ?`,
            [slide.position, slide.anchor, slide.title, slide.targetSeconds, slide.speakerNotes, slide.html, slide.css, slide.javascript, input.actorUserId, slide.id, input.webinarId],
          );
          if (!updated.affectedRows) {
            await connection.query(
              `INSERT INTO webinar_slides (id, webinar_id, position, anchor, title, target_seconds, speaker_notes, html, css, javascript, created_by_user_id, updated_by_user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [slide.id, input.webinarId, slide.position, slide.anchor, slide.title, slide.targetSeconds, slide.speakerNotes, slide.html, slide.css, slide.javascript, input.actorUserId, input.actorUserId],
            );
          }
        }
      },
    });
  }

  async function createWebinar(input) {
    return runTransaction(connectionPool, async connection => {
      await findActiveOwner(connection, input.primaryOwnerUserId);
      const candidate = { masterHtml: SAFE_MASTER, masterCss: '', slides: [{ id: randomUUID(), position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' }] };
      const resourcePolicy = validationPolicy();
      await candidateValidator(candidate, resourcePolicy);
      const admissionPolicy = captureAdmissionPolicy(resourcePolicy);
      const [created] = await connection.query(
        `INSERT INTO webinar_presentations
           (slug, title, primary_owner_user_id, master_html, master_css, audience_enabled, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [input.slug, input.title, input.primaryOwnerUserId, candidate.masterHtml, candidate.masterCss, input.actorUserId, input.actorUserId],
      );
      const webinarId = Number(created.insertId);
      candidate.webinarId = webinarId;
      const slide = candidate.slides[0];
      await connection.query(
        `INSERT INTO webinar_slides (id, webinar_id, position, anchor, title, target_seconds, speaker_notes, html, css, javascript, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, 0, 'opening', 'Opening', 0, '', '', '', '', ?, ?)`,
        [slide.id, webinarId, input.actorUserId, input.actorUserId],
      );
      const { assetVersionIds = [] } = await syncAssetReferences(connection, candidate);
      const snapshot = await buildCompleteSnapshot(connection, webinarId, { admissionPolicy });
      const snapshotAssetVersionIds = assetVersionIdsFromSnapshot(snapshot);
      assertExactAssetDependencies(assetVersionIds, snapshotAssetVersionIds);
      const revisionId = await insertRevision(connection, { webinarId, liveVersion: 1, snapshot, changeType: 'webinar_created', changeSummary: 'Created webinar', actorUserId: input.actorUserId });
      await recordRevisionAssetReferences(connection, revisionId, snapshotAssetVersionIds);
      await connection.query('UPDATE webinar_presentations SET live_version = 1, updated_by_user_id = ? WHERE id = ?', [input.actorUserId, webinarId]);
      await recordAuditEvent(connection, { webinarId, actorUserId: input.actorUserId, eventType: 'webinar_created', targetType: 'webinar', targetId: webinarId, metadata: { liveVersion: 1 } });
      const current = await readCurrentMetadata(connection, webinarId);
      return resultFor(current);
    });
  }

  async function metadataMutation(input, action) {
    return runTransaction(connectionPool, async connection => {
      const webinar = await lockWebinar(connection, input.webinarId);
      await action(connection, webinar);
      const current = await readCurrentMetadata(connection, input.webinarId);
      return resultFor(current);
    });
  }

  function archiveWebinar(input) {
    return metadataMutation(input, async (connection, webinar) => {
      await connection.query('UPDATE webinar_presentations SET archived_at = CURRENT_TIMESTAMP(3), audience_enabled = 0, updated_by_user_id = ? WHERE id = ?', [input.actorUserId, webinar.id]);
      await recordAuditEvent(connection, { webinarId: input.webinarId, actorUserId: input.actorUserId, eventType: 'webinar_archived', targetType: 'webinar', targetId: webinar.id, metadata: { archived: true, audienceEnabled: false } });
    });
  }

  function changeOwner(input) {
    return metadataMutation(input, async (connection, webinar) => {
      await findActiveOwner(connection, input.primaryOwnerUserId);
      await connection.query('UPDATE webinar_presentations SET primary_owner_user_id = ?, updated_by_user_id = ? WHERE id = ?', [input.primaryOwnerUserId, input.actorUserId, webinar.id]);
      await recordAuditEvent(connection, { webinarId: input.webinarId, actorUserId: input.actorUserId, eventType: 'owner_changed', targetType: 'webinar', targetId: webinar.id, metadata: { primaryOwnerUserId: input.primaryOwnerUserId } });
    });
  }

  function changeAudienceAccess(input) {
    return metadataMutation(input, async (connection, webinar) => {
      await connection.query('UPDATE webinar_presentations SET audience_enabled = ?, updated_by_user_id = ? WHERE id = ?', [input.enabled ? 1 : 0, input.actorUserId, webinar.id]);
      await recordAuditEvent(connection, { webinarId: input.webinarId, actorUserId: input.actorUserId, eventType: 'audience_access_changed', targetType: 'webinar', targetId: webinar.id, metadata: { audienceEnabled: input.enabled } });
    });
  }

  return { createWebinar, archiveWebinar, saveMaster, addSlide, duplicateSlide, saveSlide, reorderSlides, archiveSlide, restoreRevision, changeOwner, changeAudienceAccess };
}

module.exports = {
  WebinarMutationError,
  aggregateRollbackFailure,
  assertExpectedVersion,
  assertLockedWebinarEdit,
  lockWebinar,
  runTransaction,
  validateCandidate,
  createMutationService,
  ...createMutationService(),
};
