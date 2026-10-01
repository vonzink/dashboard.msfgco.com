import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMutationService } = require('../../../services/webinars/mutations');
const { LIMITS } = require('../../../services/webinars/limits');

const stableId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const assetVersionId = '33333333-3333-4333-8333-333333333333';
const masterHtml = '<main>{{SLIDE_CONTENT}}</main>';

afterEach(() => vi.unstubAllEnvs());

function versionedSnapshot({ admissionVersion = 1, assetOrigin = null, stylesheetOrigins = [] } = {}) {
  return {
    schemaVersion: 2,
    admissionPolicy: {
      version: admissionVersion,
      resourcePolicy: { assetOrigin, stylesheetOrigins, fontOrigins: [] },
    },
    webinar: { slug: 'restored-intro', title: 'Restored intro', masterHtml, masterCss: '' },
    slides: [{ id: stableId, position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' }],
  };
}

function currentWebinar(overrides = {}) {
  return { id: 2, slug: 'intro', title: 'Intro', master_html: masterHtml, master_css: '', live_version: 4, audience_enabled: 0, primary_owner_user_id: 7, updated_at: '2026-09-03T10:00:00.000Z', updated_by_user_id: 8, updater_name: 'Another Editor', ...overrides };
}

function activeSlides() {
  return [{ id: stableId, position: 0, anchor: 'opening', title: 'Opening', target_seconds: 0, speaker_notes: '', html: '', css: '', javascript: '' }];
}

function fakeDatabase({ webinar = currentWebinar(), slides = activeSlides(), owner = { id: 7, name: 'Owner' }, throwOn = null } = {}) {
  const calls = [];
  const connection = {
    beginTransaction: vi.fn(async () => calls.push('beginTransaction')),
    commit: vi.fn(async () => calls.push('commit')),
    rollback: vi.fn(async () => calls.push('rollback')),
    release: vi.fn(() => calls.push('release')),
    destroy: vi.fn(() => calls.push('destroy')),
    query: vi.fn(async (sql, params = []) => {
      if (throwOn && sql.includes(throwOn)) throw new Error('write failed');
      if (sql.includes('FOR UPDATE') && sql.includes('webinar_presentations')) { calls.push(`lock:${params[0]}`); return [[webinar]]; }
      if (sql.includes('FROM webinar_slides') && sql.includes('ORDER BY position')) return [[...slides]];
      if (sql.includes('FROM webinar_presentations') && sql.includes('WHERE id = ?')) return [[webinar]];
      if (sql.includes('FROM users')) return [[owner]];
      if (sql.includes('INSERT INTO webinar_revisions')) { calls.push(`revision:${params[1]}`); return [{ insertId: 91 }]; }
      if (sql.includes('UPDATE webinar_presentations SET live_version')) {
        webinar.live_version = params[0];
        webinar.updated_at = '2026-09-03T10:01:00.000Z';
        calls.push('write');
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_presentations SET')) {
        if (sql.includes('primary_owner_user_id')) webinar.primary_owner_user_id = params[0];
        if (sql.includes('audience_enabled')) webinar.audience_enabled = params[0];
        webinar.updated_at = '2026-09-03T10:01:00.000Z';
        calls.push('write');
        return [{ affectedRows: 1 }];
      }
      if (/^(UPDATE|INSERT INTO|DELETE FROM)/.test(sql.trim())) { calls.push('write'); return [{ insertId: 2, affectedRows: 1 }]; }
      return [[]];
    }),
  };
  return { calls, db: { getConnection: vi.fn().mockResolvedValue(connection) }, connection };
}

function service(options = {}) {
  const fake = fakeDatabase(options);
  return { ...fake, api: createMutationService({ db: fake.db, validateCandidate: options.validateCandidate, syncAssetReferences: options.syncAssetReferences, recordRevisionAssetReferences: options.recordRevisionAssetReferences, recordAuditEvent: options.recordAuditEvent || vi.fn().mockResolvedValue({ id: 1 }) }) };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function statefulMutationModel(initial) {
  let committed = copy(initial);
  let transaction = null;
  const calls = [];
  const state = () => transaction || committed;
  const presentation = id => state().presentations.find(row => Number(row.id) === Number(id));
  const connection = {
    beginTransaction: vi.fn(async () => { transaction = copy(committed); calls.push('begin'); }),
    commit: vi.fn(async () => { committed = transaction; transaction = null; calls.push('commit'); }),
    rollback: vi.fn(async () => { transaction = null; calls.push('rollback'); }),
    release: vi.fn(),
    destroy: vi.fn(),
    query: vi.fn(async (sql, params = []) => {
      const db = state();
      if (sql.includes('FROM users')) return [[db.users.find(user => Number(user.id) === Number(params[0]) && Number(user.is_active) === 1)].filter(Boolean)];
      if (sql.includes('FROM webinar_revisions') && sql.includes('WHERE webinar_id = ? AND id = ?')) return [[db.revisions.find(row => Number(row.webinar_id) === Number(params[0]) && Number(row.id) === Number(params[1]))].filter(Boolean)];
      if (sql.includes('FROM webinar_assets a') && sql.includes('WHERE EXISTS')) {
        const matched = (db.assetVersions || []).filter(version => params.includes(version.id));
        return [matched.length ? [{ id: 'asset-family-for-mutation-test' }] : []];
      }
      if (sql.includes('FROM webinar_asset_versions')) {
        return [(db.assetVersions || []).filter(version => params.includes(version.id))];
      }
      if (sql.includes('FOR UPDATE') && sql.includes('webinar_presentations')) {
        const row = presentation(params[0]);
        return [[row && { ...row, updater_name: 'Editor' }].filter(Boolean)];
      }
      if (sql.includes('SELECT id, webinar_id FROM webinar_slides')) {
        return [db.slides.filter(slide => params.includes(slide.id)).map(slide => ({ id: slide.id, webinar_id: slide.webinar_id }))];
      }
      if (sql.includes('SELECT slug, title, master_html')) return [[presentation(params[0])].filter(Boolean)];
      if (sql.includes('SELECT id, live_version, updated_at')) return [[presentation(params[0])].filter(Boolean)];
      if (sql.includes('FROM webinar_presentations') && sql.includes('WHERE id = ?')) return [[presentation(params[0])].filter(Boolean)];
      if (sql.includes('FROM webinar_slides') && sql.includes('ORDER BY position')) {
        return [db.slides.filter(slide => Number(slide.webinar_id) === Number(params[0]) && !slide.archived_at).sort((a, b) => a.position - b.position)];
      }
      if (sql.includes('INSERT INTO webinar_presentations')) {
        const id = db.nextPresentationId++;
        db.presentations.push({ id, slug: params[0], title: params[1], primary_owner_user_id: params[2], master_html: params[3], master_css: params[4], audience_enabled: 0, live_version: 0, created_by_user_id: params[5], updated_by_user_id: params[6], updated_at: '2026-09-03T11:00:00.000Z', archived_at: null });
        return [{ insertId: id }];
      }
      if (sql.includes('INSERT INTO webinar_slides')) {
        if (sql.includes("VALUES (?, ?, 0, 'opening'")) {
          db.slides.push({ id: params[0], webinar_id: params[1], position: 0, anchor: 'opening', title: 'Opening', target_seconds: 0, speaker_notes: '', html: '', css: '', javascript: '', archived_at: null });
        } else {
          db.slides.push({ id: params[0], webinar_id: params[1], position: params[2], anchor: params[3], title: params[4], target_seconds: params[5], speaker_notes: params[6], html: params[7], css: params[8], javascript: params[9], archived_at: null });
        }
        return [{ insertId: 1, affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO webinar_revisions')) {
        const id = db.nextRevisionId++;
        db.revisions.push({ id, webinar_id: params[0], version: params[1], snapshot: params[2], change_type: params[3], change_summary: params[4], created_by_user_id: params[5] });
        return [{ insertId: id }];
      }
      if (sql.startsWith('DELETE FROM webinar_asset_references')) {
        if (db.assetReferences) {
          db.assetReferences = db.assetReferences.filter(row => Number(row.webinar_id) !== Number(params[0]));
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO webinar_asset_references')) {
        db.assetReferences.push({ webinar_id: params[0], slide_id: params[1], asset_version_id: params[2], surface: params[3] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO webinar_revision_asset_references')) {
        db.revisionAssetReferences.push({ revision_id: params[0], asset_version_id: params[1] });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_presentations SET live_version = ?')) {
        const row = presentation(params[2]); row.live_version = params[0]; row.updated_by_user_id = params[1]; row.updated_at = '2026-09-03T11:00:01.000Z'; return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_presentations SET live_version = 1')) {
        const row = presentation(params[1]); row.live_version = 1; row.updated_by_user_id = params[0]; row.updated_at = '2026-09-03T11:00:01.000Z'; return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_presentations SET slug = ?')) {
        const row = presentation(params[5]); Object.assign(row, { slug: params[0], title: params[1], master_html: params[2], master_css: params[3], updated_by_user_id: params[4], updated_at: '2026-09-03T11:00:01.000Z' }); return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_slides SET anchor = ?')) {
        const slide = db.slides.find(row => row.id === params[8] && Number(row.webinar_id) === Number(params[9]));
        if (!slide) return [{ affectedRows: 0 }];
        Object.assign(slide, { anchor: params[0], title: params[1], target_seconds: params[2], speaker_notes: params[3], html: params[4], css: params[5], javascript: params[6] });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_slides SET position = NULL')) {
        db.slides.filter(slide => Number(slide.webinar_id) === Number(params[1]) && !slide.archived_at).forEach(slide => { slide.position = null; slide.archived_at = '2026-09-03T11:00:01.000Z'; }); return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE webinar_slides SET position = ?, anchor')) {
        const slide = db.slides.find(row => row.id === params[9] && Number(row.webinar_id) === Number(params[10]));
        if (!slide) return [{ affectedRows: 0 }];
        Object.assign(slide, { position: params[0], anchor: params[1], title: params[2], target_seconds: params[3], speaker_notes: params[4], html: params[5], css: params[6], javascript: params[7], archived_at: null });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled model query: ${sql}`);
    }),
  };
  return {
    calls,
    db: { getConnection: vi.fn().mockResolvedValue(connection) },
    connection,
    committed: () => copy(committed),
    audit: async (_connection, event) => { state().audit.push(copy(event)); return { id: state().audit.length }; },
  };
}

describe('Webinar Studio live mutations', () => {
  it('locks, validates, snapshots, versions and commits a Master save atomically', async () => {
    const { api, calls } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: 'main { color: navy; }' }))
      .resolves.toMatchObject({ webinarId: 2, liveVersion: 5 });
    expect(calls).toEqual(expect.arrayContaining(['beginTransaction', 'lock:2', 'revision:5', 'commit']));
    expect(calls.indexOf('revision:5')).toBeGreaterThan(calls.indexOf('write'));
    expect(calls).not.toContain('rollback');
  });

  it('allows a small save when the server-loaded multi-slide deck exceeds the raw request limit', async () => {
    const htmlWrapperBytes = Buffer.byteLength('<section></section>');
    const largeHtml = `<section>${'h'.repeat(LIMITS.slide_html - htmlWrapperBytes)}</section>`;
    const largeJavascript = `/*${'j'.repeat(LIMITS.slide_javascript - 4)}*/`;
    const slides = [stableId, secondId, '33333333-3333-4333-8333-333333333333']
      .map((id, position) => ({
        id,
        position,
        anchor: `slide-${position + 1}`,
        title: `Slide ${position + 1}`,
        target_seconds: 0,
        speaker_notes: '',
        html: largeHtml,
        css: '',
        javascript: largeJavascript,
      }));
    const loadedDeckBytes = slides.reduce(
      (total, slide) => total + Buffer.byteLength(slide.html) + Buffer.byteLength(slide.javascript),
      0,
    );
    expect(loadedDeckBytes).toBeGreaterThan(LIMITS.request);

    const { api, calls } = service({ slides });
    await expect(api.saveMaster({
      webinarId: 2,
      actorUserId: 7,
      expectedVersion: 4,
      masterHtml,
      masterCss: 'main { color: navy; }',
    })).resolves.toMatchObject({ liveVersion: 5 });
    expect(calls).toContain('commit');
  });

  it('returns the post-mutation database timestamp, never the row-lock timestamp', async () => {
    const { api } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' }))
      .resolves.toMatchObject({ liveVersion: 5, updatedAt: '2026-09-03T10:01:00.000Z' });
  });

  it('keeps the required transaction stages in strict order', async () => {
    const stages = [];
    const { api, connection } = service({
      validateCandidate: () => stages.push('complete-validation'),
      syncAssetReferences: async () => { stages.push('asset-sync'); return { assetVersionIds: [] }; },
      recordRevisionAssetReferences: async () => stages.push('revision-assets'),
      recordAuditEvent: async () => stages.push('audit'),
    });
    const originalQuery = connection.query.getMockImplementation();
    connection.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FOR UPDATE') && sql.includes('webinar_presentations')) stages.push('lock-version');
      if (sql.includes('UPDATE webinar_presentations SET master_html')) stages.push('normalized-writes');
      if (sql.includes('SELECT slug, title, master_html')) stages.push('snapshot');
      if (sql.includes('INSERT INTO webinar_revisions')) stages.push('revision');
      if (sql.includes('UPDATE webinar_presentations SET live_version')) stages.push('live-version');
      return originalQuery(sql, params);
    });
    connection.beginTransaction.mockImplementation(async () => stages.push('begin'));
    connection.commit.mockImplementation(async () => stages.push('commit'));
    await api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' });
    expect(stages).toEqual(['begin', 'lock-version', 'complete-validation', 'normalized-writes', 'asset-sync', 'snapshot', 'revision', 'revision-assets', 'live-version', 'audit', 'commit']);
  });

  it.each([
    ['save Master', fixture => fixture.api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' })],
    ['save slide', fixture => fixture.api.saveSlide({ webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' })],
    ['add slide', fixture => fixture.api.addSlide({ webinarId: 2, actorUserId: 7, expectedVersion: 4, anchor: 'agenda', title: 'Agenda', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' })],
    ['duplicate slide', fixture => fixture.api.duplicateSlide({ webinarId: 2, actorUserId: 7, expectedVersion: 4, sourceSlideId: stableId })],
    ['reorder slides', fixture => fixture.api.reorderSlides({ webinarId: 2, actorUserId: 7, expectedVersion: 4, slideIds: [stableId] })],
    ['archive slide', fixture => fixture.api.archiveSlide({ webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4 }), {
      slides: [...activeSlides(), { ...activeSlides()[0], id: secondId, position: 1, anchor: 'agenda' }],
    }],
  ])('binds the complete post-transform candidate for %s before revision insertion', async (_label, run, serviceOptions = {}) => {
    const stages = [];
    const syncAssetReferences = vi.fn(async (_connection, candidate) => {
      stages.push('references');
      expect(candidate.webinarId).toBe(2);
      expect(candidate.masterHtml).toBe(masterHtml);
      expect(Array.isArray(candidate.slides)).toBe(true);
      return { assetVersionIds: [] };
    });
    const recordRevisionAssetReferences = vi.fn(async () => stages.push('revision-references'));
    const fixture = service({ ...serviceOptions, syncAssetReferences, recordRevisionAssetReferences });
    const originalQuery = fixture.connection.query.getMockImplementation();
    fixture.connection.query.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO webinar_revisions')) stages.push('revision');
      return originalQuery(sql, params);
    });

    await run(fixture);

    expect(syncAssetReferences).toHaveBeenCalledTimes(1);
    expect(recordRevisionAssetReferences).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(['references', 'revision', 'revision-references']);
  });

  it('binds the complete inserted candidate during webinar creation', async () => {
    const syncAssetReferences = vi.fn().mockResolvedValue({ assetVersionIds: [] });
    const recordRevisionAssetReferences = vi.fn().mockResolvedValue(undefined);
    const fixture = service({ syncAssetReferences, recordRevisionAssetReferences });

    await fixture.api.createWebinar({
      slug: 'intro', title: 'Intro', primaryOwnerUserId: 7, actorUserId: 1,
    });

    expect(syncAssetReferences).toHaveBeenCalledWith(fixture.connection, expect.objectContaining({
      webinarId: 2,
      masterHtml: '<main class="webinar-slide">{{SLIDE_CONTENT}}</main>',
      slides: [expect.objectContaining({ position: 0, anchor: 'opening' })],
    }));
    expect(recordRevisionAssetReferences).toHaveBeenCalledWith(fixture.connection, 91, []);
  });

  it.each([
    ['revision insert', { throwOn: 'INSERT INTO webinar_revisions' }],
    ['live-version update', { throwOn: 'UPDATE webinar_presentations SET live_version' }],
    ['revision asset references', { recordRevisionAssetReferences: vi.fn().mockRejectedValue(new Error('asset refs failed')) }],
    ['audit write', { recordAuditEvent: vi.fn().mockRejectedValue(new Error('audit failed')) }],
  ])('rolls back and never commits when %s fails', async (_name, options) => {
    const { api, calls } = service(options);
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' })).rejects.toThrow();
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('commit');
  });

  it('rolls back a failed commit after all durable mutation stages', async () => {
    const { api, connection, calls } = service();
    connection.commit.mockImplementation(async () => {
      calls.push('commit-attempt');
      throw new Error('commit failed');
    });
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' })).rejects.toThrow('commit failed');
    expect(calls).toContain('revision:5');
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('commit');
  });

  it('rolls back create and metadata transactions when their audit record fails', async () => {
    const recordAuditEvent = vi.fn().mockRejectedValue(new Error('audit failed'));
    const create = service({ recordAuditEvent });
    await expect(create.api.createWebinar({ slug: 'intro', title: 'Intro', primaryOwnerUserId: 7, actorUserId: 1 })).rejects.toThrow('audit failed');
    expect(create.calls).toContain('rollback');
    expect(create.calls).not.toContain('commit');

    const metadata = service({ recordAuditEvent });
    await expect(metadata.api.changeAudienceAccess({ webinarId: 2, enabled: true, actorUserId: 1 })).rejects.toThrow('audit failed');
    expect(metadata.calls).toContain('rollback');
    expect(metadata.calls).not.toContain('commit');
  });

  it.each([
    ['content', primary => service({ validateCandidate: vi.fn().mockRejectedValue(primary) }), ({ api }) => api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' })],
    ['create', primary => service({ validateCandidate: vi.fn().mockRejectedValue(primary) }), ({ api }) => api.createWebinar({ slug: 'intro', title: 'Intro', primaryOwnerUserId: 7, actorUserId: 1 })],
    ['metadata', primary => service({ recordAuditEvent: vi.fn().mockRejectedValue(primary) }), ({ api }) => api.changeAudienceAccess({ webinarId: 2, enabled: true, actorUserId: 1 })],
  ])('preserves the %s primary failure when rollback fails and destroys the connection', async (_name, setup, run) => {
    const primary = new Error('primary transaction failure');
    const rollback = new Error('rollback failure');
    const fixture = setup(primary);
    fixture.connection.rollback.mockImplementation(async () => {
      fixture.calls.push('rollback');
      throw rollback;
    });

    let thrown;
    try {
      await run(fixture);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.errors).toEqual([primary, rollback]);
    expect(thrown.cause).toBe(primary);
    expect(thrown.primaryError).toBe(primary);
    expect(thrown.rollbackError).toBe(rollback);
    expect(fixture.connection.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.connection.release).not.toHaveBeenCalled();
    expect(fixture.calls.slice(-2)).toEqual(['rollback', 'destroy']);
  });

  it('returns private conflict metadata and never commits a stale write', async () => {
    const { api, calls } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 3, masterHtml, masterCss: '' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT', currentVersion: 4, updatedBy: { id: 8, name: 'Another Editor' } });
    expect(calls).not.toContain('commit');
    expect(calls).toContain('rollback');
  });

  it.each([
    ['save', ({ api }) => api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '' })],
    ['restore', ({ api }) => api.restoreRevision({ webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4 })],
  ])('denies a stale former owner %s after the locked row reflects reassignment', async (_name, run) => {
    const fixture = service({ webinar: currentWebinar({ primary_owner_user_id: 8 }) });

    await expect(run(fixture)).rejects.toMatchObject({
      code: 'WEBINAR_ACCESS_DENIED',
      status: 403,
    });
    expect(fixture.calls).toContain('lock:2');
    expect(fixture.calls).toContain('rollback');
    expect(fixture.calls).not.toContain('write');
    expect(fixture.calls).not.toContain('commit');
  });

  it('allows a server-asserted administrator after locking a webinar owned by someone else', async () => {
    const { api, calls } = service({ webinar: currentWebinar({ primary_owner_user_id: 8 }) });

    await expect(api.saveMaster({
      webinarId: 2,
      actorUserId: 1,
      actorIsAdmin: true,
      expectedVersion: 4,
      masterHtml,
      masterCss: '',
    })).resolves.toMatchObject({ liveVersion: 5 });
    expect(calls).toContain('commit');
  });

  it('validates the complete candidate before beginning writes and rejects unknown asset versions', async () => {
    const { api, calls } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml: '<script>bad()</script>{{SLIDE_CONTENT}}', masterCss: '' }))
      .rejects.toMatchObject({ code: 'CONTENT_VALIDATION_FAILED' });
    expect(calls).not.toContain('write');
    expect(calls).not.toContain('revision:5');

    vi.stubEnv('WEBINAR_ASSET_BUCKET', 'asset-test');
    vi.stubEnv('WEBINAR_ASSET_CDN_BASE_URL', 'https://assets.example');
    const unavailable = service();
    await expect(unavailable.api.saveSlide({ webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '<img src="{{ASSET:11111111-1111-4111-8111-111111111111}}">', css: '', javascript: '' }))
      .rejects.toMatchObject({ status: 422, code: 'ASSET_NOT_FOUND' });
    expect(unavailable.calls).toContain('rollback');
    expect(unavailable.calls).not.toContain('revision:5');
    vi.unstubAllEnvs();
  });

  it('rolls back normalized rows, references, live version, and revisions when asset validation fails', async () => {
    vi.stubEnv('WEBINAR_ASSET_BUCKET', 'asset-test');
    vi.stubEnv('WEBINAR_ASSET_CDN_BASE_URL', 'https://assets.example');
    const initial = {
      users: [{ id: 7, name: 'Owner', is_active: 1 }],
      presentations: [{ ...currentWebinar(), archived_at: null }],
      slides: [{ ...activeSlides()[0], webinar_id: 2, archived_at: null }],
      revisions: [],
      audit: [],
      assetVersions: [{
        id: assetVersionId,
        status: 'processing',
        archived_at: null,
        family_archived_at: null,
        sha256: null,
        s3_key: `quarantine/${assetVersionId}/image.png`,
      }],
      assetReferences: [{ webinar_id: 2, slide_id: stableId, asset_version_id: secondId, surface: 'slide_html' }],
      revisionAssetReferences: [],
      nextPresentationId: 3,
      nextRevisionId: 90,
    };
    const model = statefulMutationModel(initial);
    const api = createMutationService({ db: model.db, recordAuditEvent: model.audit });

    await expect(api.saveSlide({
      webinarId: 2,
      slideId: stableId,
      actorUserId: 7,
      expectedVersion: 4,
      anchor: 'opening',
      title: 'Opening changed',
      targetSeconds: 10,
      speakerNotes: '',
      html: `<img src="{{ASSET:${assetVersionId}}}">`,
      css: '',
      javascript: '',
    })).rejects.toMatchObject({ status: 422, code: 'ASSET_NOT_AVAILABLE' });

    expect(model.committed()).toEqual(initial);
    expect(model.calls).toContain('rollback');
    expect(model.calls).not.toContain('commit');
  });

  it('stores tokens unchanged while replacing live references and recording exact revision dependencies', async () => {
    vi.stubEnv('WEBINAR_ASSET_BUCKET', 'asset-test');
    vi.stubEnv('WEBINAR_ASSET_CDN_BASE_URL', 'https://assets.example');
    const token = `{{ASSET:${assetVersionId}}}`;
    const initial = {
      users: [{ id: 7, name: 'Owner', is_active: 1 }],
      presentations: [{ ...currentWebinar(), archived_at: null }],
      slides: [{ ...activeSlides()[0], webinar_id: 2, archived_at: null }],
      revisions: [],
      audit: [],
      assetVersions: [{
        id: assetVersionId,
        status: 'available',
        archived_at: null,
        family_archived_at: null,
        sha256: 'c'.repeat(64),
        s3_key: `approved/sha256/${'c'.repeat(64)}/asset`,
      }],
      assetReferences: [],
      revisionAssetReferences: [],
      nextPresentationId: 3,
      nextRevisionId: 90,
    };
    const model = statefulMutationModel(initial);
    const api = createMutationService({ db: model.db, recordAuditEvent: model.audit });

    await expect(api.saveSlide({
      webinarId: 2,
      slideId: stableId,
      actorUserId: 7,
      expectedVersion: 4,
      anchor: 'opening',
      title: 'Opening',
      targetSeconds: 0,
      speakerNotes: '',
      html: `<img src="${token}"><img src="${token}">`,
      css: '',
      javascript: '',
    })).resolves.toMatchObject({ liveVersion: 5 });

    const state = model.committed();
    expect(state.assetReferences).toEqual([{ webinar_id: 2, slide_id: stableId, asset_version_id: assetVersionId, surface: 'slide_html' }]);
    expect(state.revisionAssetReferences).toEqual([{ revision_id: 90, asset_version_id: assetVersionId }]);
    expect(state.slides[0].html).toBe(`<img src="${token}"><img src="${token}">`);
    expect(JSON.parse(state.revisions[0].snapshot).slides[0].html).toBe(`<img src="${token}"><img src="${token}">`);
  });

  it('restores and rebinds every exact historical asset version without rewriting snapshot tokens', async () => {
    vi.stubEnv('WEBINAR_ASSET_BUCKET', 'asset-test');
    vi.stubEnv('WEBINAR_ASSET_CDN_BASE_URL', 'https://assets.example');
    const secondAssetVersionId = '44444444-4444-4444-8444-444444444444';
    const restored = versionedSnapshot({ assetOrigin: 'https://assets.example' });
    restored.webinar.masterCss = `:root { --logo: url({{ASSET:${secondAssetVersionId}}}); }`;
    restored.slides[0].html = `<img src="{{ASSET:${assetVersionId}}}">`;
    const initial = {
      users: [{ id: 7, name: 'Owner', is_active: 1 }],
      presentations: [{ ...currentWebinar(), archived_at: null }],
      slides: [{ ...activeSlides()[0], webinar_id: 2, archived_at: null }],
      revisions: [{ id: 18, webinar_id: 2, version: 2, snapshot: JSON.stringify(restored) }],
      audit: [],
      assetVersions: [
        { id: assetVersionId, status: 'available', archived_at: null, family_archived_at: null, sha256: 'c'.repeat(64), s3_key: `approved/sha256/${'c'.repeat(64)}/asset` },
        { id: secondAssetVersionId, status: 'available', archived_at: null, family_archived_at: null, sha256: 'd'.repeat(64), s3_key: `approved/sha256/${'d'.repeat(64)}/asset` },
      ],
      assetReferences: [{ webinar_id: 2, slide_id: stableId, asset_version_id: secondId, surface: 'slide_html' }],
      revisionAssetReferences: [
        { revision_id: 18, asset_version_id: assetVersionId },
        { revision_id: 18, asset_version_id: secondAssetVersionId },
      ],
      nextPresentationId: 3,
      nextRevisionId: 19,
    };
    const model = statefulMutationModel(initial);
    const api = createMutationService({ db: model.db, recordAuditEvent: model.audit });

    await expect(api.restoreRevision({
      webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4,
    })).resolves.toMatchObject({ liveVersion: 5 });

    const state = model.committed();
    expect(state.assetReferences).toEqual([
      { webinar_id: 2, slide_id: null, asset_version_id: secondAssetVersionId, surface: 'master_css' },
      { webinar_id: 2, slide_id: stableId, asset_version_id: assetVersionId, surface: 'slide_html' },
    ]);
    expect(state.revisionAssetReferences).toEqual([
      { revision_id: 18, asset_version_id: assetVersionId },
      { revision_id: 18, asset_version_id: secondAssetVersionId },
      { revision_id: 19, asset_version_id: assetVersionId },
      { revision_id: 19, asset_version_id: secondAssetVersionId },
    ]);
    const newSnapshot = JSON.parse(state.revisions.find(revision => revision.id === 19).snapshot);
    expect(newSnapshot.webinar.masterCss).toContain(`{{ASSET:${secondAssetVersionId}}}`);
    expect(newSnapshot.slides[0].html).toContain(`{{ASSET:${assetVersionId}}}`);
  });

  it('rejects asset tokens before an injected asset hook can allow an unconfigured origin', async () => {
    const syncAssetReferences = vi.fn().mockResolvedValue({ assetVersionIds: [] });
    const { api, calls } = service({ syncAssetReferences });
    await expect(api.saveSlide({ webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '<img src="{{ASSET:11111111-1111-4111-8111-111111111111}}">', css: '', javascript: '' }))
      .rejects.toMatchObject({ code: 'ASSET_ORIGIN_NOT_CONFIGURED' });
    expect(syncAssetReferences).not.toHaveBeenCalled();
    expect(calls).not.toContain('commit');
  });

  it('rolls back without a revision when a normalized write fails', async () => {
    const { api, calls } = service({ throwOn: 'UPDATE webinar_presentations SET master_html' });
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: 'x{}' })).rejects.toThrow('write failed');
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('revision:5');
  });

  it('rolls back when validated live references do not match the persisted revision snapshot', async () => {
    const syncAssetReferences = vi.fn().mockResolvedValue({ assetVersionIds: [assetVersionId] });
    const { api, calls } = service({ syncAssetReferences });

    await expect(api.saveMaster({
      webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: '',
    })).rejects.toMatchObject({ code: 'ASSET_REFERENCE_STATE_MISMATCH', status: 500 });

    expect(calls).toContain('rollback');
    expect(calls).not.toContain('revision:5');
    expect(calls).not.toContain('commit');
  });

  it('rejects archiving the final live slide after taking the webinar row lock', async () => {
    const { api, calls, connection } = service();

    await expect(api.archiveSlide({
      webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4,
    })).rejects.toMatchObject({ code: 'LAST_SLIDE_REQUIRED', status: 409 });

    expect(calls).toContain('lock:2');
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('write');
    expect(calls).not.toContain('commit');
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('archived_at = CURRENT_TIMESTAMP(3)'))).toBe(false);
    const statements = connection.query.mock.calls.map(([sql]) => sql);
    const lockIndex = statements.findIndex(sql => sql.includes('webinar_presentations') && sql.includes('FOR UPDATE'));
    const activeSlideReadIndex = statements.findIndex(sql => sql.includes('FROM webinar_slides') && sql.includes('ORDER BY position'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(activeSlideReadIndex).toBeGreaterThan(lockIndex);
  });

  it('archives one of two live slides without deleting its stable identity', async () => {
    const slides = [
      ...activeSlides(),
      { ...activeSlides()[0], id: secondId, position: 1, anchor: 'agenda' },
    ];
    const { api, connection } = service({ slides });
    await api.archiveSlide({ webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4 });
    expect(connection.query.mock.calls).toContainEqual([expect.stringContaining('position = NULL, archived_at = CURRENT_TIMESTAMP(3)'), [7, stableId, 2]]);
  });

  it('duplicates with a new UUID and unique anchor and reorders only the complete active set', async () => {
    const { api, connection } = service({ slides: [...activeSlides(), { ...activeSlides()[0], id: secondId, position: 1, anchor: 'agenda' }] });
    await api.addSlide({ webinarId: 2, actorUserId: 7, expectedVersion: 4, sourceSlideId: stableId });
    const insert = connection.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO webinar_slides'));
    expect(insert[1][0]).not.toBe(stableId);
    expect(insert[1][3]).toMatch(/^opening-copy(?:-\d+)?$/);
    await expect(api.reorderSlides({ webinarId: 2, actorUserId: 7, expectedVersion: 5, slideIds: [stableId] })).rejects.toMatchObject({ code: 'SLIDE_SET_MISMATCH' });
  });

  it('returns the exact committed server-created slide for add and duplicate without a follow-up lookup', async () => {
    const added = service();
    const addResult = await added.api.addSlide({
      webinarId: 2,
      actorUserId: 7,
      expectedVersion: 4,
      anchor: 'agenda',
      title: 'Agenda',
      targetSeconds: 45,
      speakerNotes: 'Shared note',
      html: '<section>Agenda</section>',
      css: '.agenda{display:grid}',
      javascript: 'window.ready = true;',
    });
    const addInsert = added.connection.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO webinar_slides'));
    expect(addResult.slide).toEqual({
      id: addInsert[1][0],
      anchor: 'agenda',
      title: 'Agenda',
      targetSeconds: 45,
      speakerNotes: 'Shared note',
      html: '<section>Agenda</section>',
      css: '.agenda{display:grid}',
      javascript: 'window.ready = true;',
    });
    expect(added.calls.at(-1)).toBe('release');
    expect(added.calls).toContain('commit');

    const duplicated = service();
    const duplicateResult = await duplicated.api.duplicateSlide({
      webinarId: 2,
      actorUserId: 7,
      expectedVersion: 4,
      sourceSlideId: stableId,
    });
    const duplicateInsert = duplicated.connection.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO webinar_slides'));
    expect(duplicateResult.slide).toEqual({
      id: duplicateInsert[1][0],
      anchor: 'opening-copy',
      title: 'Opening',
      targetSeconds: 0,
      speakerNotes: '',
      html: '',
      css: '',
      javascript: '',
    });
  });

  it('duplicates only the active server-loaded source and ignores client overrides', async () => {
    const { api, connection } = service({ slides: [{ ...activeSlides()[0], title: 'Server title', html: '<section>server</section>', javascript: 'window.server = true;' }] });
    await api.duplicateSlide({ webinarId: 2, actorUserId: 7, expectedVersion: 4, sourceSlideId: stableId, title: 'Client override', html: '<section>client</section>' });
    const insert = connection.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO webinar_slides'));
    expect(insert[1]).toContain('Server title');
    expect(insert[1]).toContain('<section>server</section>');
    expect(insert[1]).toContain('window.server = true;');
    await expect(api.duplicateSlide({ webinarId: 2, actorUserId: 7, expectedVersion: 5, sourceSlideId: secondId })).rejects.toMatchObject({ code: 'SLIDE_NOT_FOUND' });
  });

  it('frees unique positions before applying a reordered active set', async () => {
    const { api, connection } = service({ slides: [...activeSlides(), { ...activeSlides()[0], id: secondId, position: 1, anchor: 'agenda' }] });
    await api.reorderSlides({ webinarId: 2, actorUserId: 7, expectedVersion: 4, slideIds: [secondId, stableId] });
    const positionWrites = connection.query.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('position'));
    expect(positionWrites.some(sql => sql.includes('position = position +'))).toBe(true);
  });

  it('restores archived stable IDs into current plus one and archives a presentation non-destructively', async () => {
    const restored = versionedSnapshot({ stylesheetOrigins: ['https://styles.old.example'] });
    restored.webinar.masterHtml = '<link rel="stylesheet" href="https://styles.old.example/theme.css"><main>{{SLIDE_CONTENT}}</main>';
    vi.stubEnv('WEBINAR_EXTERNAL_STYLE_ORIGINS', 'https://styles.new.example');
    const laterCandidateValidator = vi.fn().mockRejectedValue(new Error('later routine validator rejected old policy'));
    const { api, connection } = service({ validateCandidate: laterCandidateValidator });
    connection.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes('FOR UPDATE') && sql.includes('webinar_presentations')) return [[currentWebinar()]];
      if (sql.includes('FROM webinar_revisions')) return [[{ id: 18, webinar_id: 2, version: 2, snapshot: JSON.stringify(restored) }]];
      if (sql.includes('FROM webinar_slides') && sql.includes('ORDER BY position')) return [[...activeSlides()]];
      if (sql.includes('SELECT id, webinar_id FROM webinar_slides')) return [[]];
      if (sql.includes('SELECT id, live_version, updated_at')) return [[currentWebinar({ live_version: 5, updated_at: '2026-09-03T10:01:00.000Z' })]];
      if (sql.includes('FROM webinar_presentations') && sql.includes('WHERE id = ?')) return [[currentWebinar()]];
      if (sql.includes('INSERT INTO webinar_revisions')) return [{ insertId: 19 }];
      return [{ affectedRows: 1, insertId: 2 }];
    });
    await expect(api.restoreRevision({ webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4 })).resolves.toMatchObject({ liveVersion: 5 });
    expect(laterCandidateValidator).not.toHaveBeenCalled();
    const insertedRevision = connection.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO webinar_revisions'));
    expect(JSON.parse(insertedRevision[1][2]).admissionPolicy).toEqual(restored.admissionPolicy);
    expect(connection.query.mock.calls.some(([sql, params]) => sql.includes('SET slug = ?, title = ?') && params[0] === 'restored-intro' && params[1] === 'Restored intro')).toBe(true);
    expect(connection.query.mock.calls.some(([sql, params]) => sql.includes('archived_at = NULL') && params.includes(stableId))).toBe(true);
    await api.archiveWebinar({ webinarId: 2, actorUserId: 7 });
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('archived_at = CURRENT_TIMESTAMP(3), audience_enabled = 0'))).toBe(true);
  });

  it('maps an explicitly unsupported restore policy to a stable controlled conflict before writes', async () => {
    const restored = versionedSnapshot({ admissionVersion: 999 });
    const { api, connection, calls } = service();
    connection.query.mockImplementation(async (sql) => {
      if (sql.includes('FOR UPDATE') && sql.includes('webinar_presentations')) return [[currentWebinar()]];
      if (sql.includes('FROM webinar_revisions')) return [[{
        id: 18, webinar_id: 2, version: 2, snapshot: JSON.stringify(restored),
      }]];
      if (sql.includes('FROM webinar_slides') && sql.includes('ORDER BY position')) return [[...activeSlides()]];
      return [{ affectedRows: 1 }];
    });

    await expect(api.restoreRevision({
      webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4,
    })).rejects.toMatchObject({
      code: 'REVISION_POLICY_INCOMPATIBLE',
      status: 409,
      message: 'Revision cannot be restored under the current security policy',
    });
    expect(calls).toContain('rollback');
    expect(connection.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql.trim()))).toBe(false);
  });

  it('rejects a cross-webinar restore ID before any normalized write', async () => {
    const restored = { schemaVersion: 1, webinar: { slug: 'intro', title: 'Intro', masterHtml, masterCss: '' }, slides: [{ id: stableId, position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' }] };
    const { api, connection, calls } = service();
    connection.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes('FOR UPDATE') && sql.includes('webinar_presentations')) return [[currentWebinar()]];
      if (sql.includes('FROM webinar_revisions')) return [[{ id: 18, webinar_id: 2, version: 2, snapshot: JSON.stringify(restored) }]];
      if (sql.includes('FROM webinar_slides') && sql.includes('ORDER BY position')) return [[...activeSlides()]];
      if (sql.includes('SELECT id, webinar_id FROM webinar_slides')) return [[{ id: stableId, webinar_id: 99 }]];
      return [{ affectedRows: 1 }];
    });
    await expect(api.restoreRevision({ webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4 })).rejects.toMatchObject({ code: 'RESTORE_SLIDE_OWNERSHIP_CONFLICT' });
    expect(connection.query.mock.calls.some(([sql]) => /^(UPDATE|INSERT)/.test(sql.trim()))).toBe(false);
    expect(calls).not.toContain('commit');
  });

  it('creates an audience-disabled webinar with one opening slide and revision one in one transaction', async () => {
    const { api, connection, calls } = service();
    connection.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes('FROM users')) return [[{ id: 7, name: 'Owner' }]];
      if (sql.includes('INSERT INTO webinar_presentations')) return [{ insertId: 2 }];
      if (sql.includes('SELECT id, live_version, updated_at')) return [[currentWebinar({ live_version: 1, updated_at: '2026-09-03T10:01:00.000Z' })]];
      if (sql.includes('FROM webinar_presentations') && sql.includes('WHERE id = ?')) return [[currentWebinar({ live_version: 0 })]];
      if (sql.includes('FROM webinar_slides')) return [[...activeSlides()]];
      if (sql.includes('INSERT INTO webinar_revisions')) { calls.push(`revision:${params[1]}`); return [{ insertId: 1 }]; }
      return [{ affectedRows: 1 }];
    });
    await expect(api.createWebinar({ slug: 'intro', title: 'Intro', primaryOwnerUserId: 7, actorUserId: 1 })).resolves.toMatchObject({ webinarId: 2, liveVersion: 1, updatedAt: '2026-09-03T10:01:00.000Z' });
    const presentation = connection.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO webinar_presentations'));
    expect(presentation[0]).toContain('audience_enabled');
    expect(presentation[0]).toContain('0');
    expect(presentation[1]).toContain('<main class="webinar-slide">{{SLIDE_CONTENT}}</main>');
    expect(calls).toEqual(expect.arrayContaining(['beginTransaction', 'revision:1', 'commit']));
  });

  it('commits complete create state atomically in a transaction-local model', async () => {
    const model = statefulMutationModel({ users: [{ id: 7, name: 'Owner', is_active: 1 }], presentations: [], slides: [], revisions: [], audit: [], nextPresentationId: 20, nextRevisionId: 90 });
    const api = createMutationService({ db: model.db, recordAuditEvent: model.audit });
    await expect(api.createWebinar({ slug: 'first-time-homebuyer', title: 'First Time Homebuyer', primaryOwnerUserId: 7, actorUserId: 1 }))
      .resolves.toMatchObject({ webinarId: 20, liveVersion: 1, updatedAt: '2026-09-03T11:00:01.000Z' });
    const state = model.committed();
    expect(state.presentations).toEqual([expect.objectContaining({ id: 20, primary_owner_user_id: 7, audience_enabled: 0, live_version: 1, master_html: '<main class="webinar-slide">{{SLIDE_CONTENT}}</main>', master_css: '' })]);
    expect(state.slides).toEqual([expect.objectContaining({ webinar_id: 20, position: 0, anchor: 'opening', title: 'Opening', html: '', css: '', javascript: '', archived_at: null })]);
    expect(JSON.parse(state.revisions[0].snapshot)).toEqual({
      schemaVersion: 2,
      admissionPolicy: {
        version: 1,
        resourcePolicy: { assetOrigin: null, stylesheetOrigins: [], fontOrigins: [] },
      },
      webinar: { slug: 'first-time-homebuyer', title: 'First Time Homebuyer', masterHtml: '<main class="webinar-slide">{{SLIDE_CONTENT}}</main>', masterCss: '' },
      slides: [expect.objectContaining({ position: 0, anchor: 'opening' })],
    });
    expect(state.audit).toEqual([expect.objectContaining({ eventType: 'webinar_created', webinarId: 20, metadata: { liveVersion: 1 } })]);
    expect(model.calls).toEqual(['begin', 'commit']);
  });

  it('commits restored live/archived slides and a new complete revision in a transaction-local model', async () => {
    const restored = { schemaVersion: 1, webinar: { slug: 'restored', title: 'Restored', masterHtml, masterCss: '' }, slides: [{ id: stableId, position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 20, speakerNotes: 'restored note', html: '<section>restored</section>', css: '', javascript: '' }] };
    const initial = {
      users: [{ id: 7, name: 'Owner', is_active: 1 }],
      presentations: [{ ...currentWebinar(), archived_at: null }],
      slides: [
        { ...activeSlides()[0], webinar_id: 2, archived_at: '2026-09-01T00:00:00.000Z', position: null },
        { id: secondId, webinar_id: 2, position: 0, anchor: 'old-slide', title: 'Old', target_seconds: 0, speaker_notes: '', html: '<section>old</section>', css: '', javascript: '', archived_at: null },
      ],
      revisions: [{ id: 18, webinar_id: 2, version: 2, snapshot: JSON.stringify(restored) }], audit: [], nextPresentationId: 3, nextRevisionId: 19,
    };
    const model = statefulMutationModel(initial);
    const api = createMutationService({ db: model.db, recordAuditEvent: model.audit });
    await expect(api.restoreRevision({ webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4 })).resolves.toMatchObject({ liveVersion: 5 });
    const state = model.committed();
    expect(state.slides.find(slide => slide.id === stableId)).toEqual(expect.objectContaining({ archived_at: null, position: 0, html: '<section>restored</section>' }));
    expect(state.slides.find(slide => slide.id === secondId)).toEqual(expect.objectContaining({ archived_at: '2026-09-03T11:00:01.000Z', position: null }));
    expect(state.revisions).toHaveLength(2);
    expect(state.revisions[1]).toEqual(expect.objectContaining({ version: 5, change_type: 'revision_restored' }));
    expect(JSON.parse(state.revisions[1].snapshot).slides).toEqual([expect.objectContaining({ id: stableId, position: 0 })]);
    expect(state.audit).toEqual([expect.objectContaining({ eventType: 'content_saved', metadata: { liveVersion: 5, changeType: 'revision_restored' } })]);
  });

  it.each(['revision', 'audit', 'commit'])('rolls back all material create state when %s fails', async stage => {
    const initial = { users: [{ id: 7, name: 'Owner', is_active: 1 }], presentations: [], slides: [], revisions: [], audit: [], nextPresentationId: 20, nextRevisionId: 90 };
    const model = statefulMutationModel(initial);
    const recordAuditEvent = stage === 'audit' ? vi.fn().mockRejectedValue(new Error('audit failed')) : model.audit;
    if (stage === 'revision') {
      const base = model.connection.query.getMockImplementation();
      model.connection.query.mockImplementation((sql, params) => sql.includes('INSERT INTO webinar_revisions') ? Promise.reject(new Error('revision failed')) : base(sql, params));
    }
    if (stage === 'commit') model.connection.commit.mockImplementation(async () => { throw new Error('commit failed'); });
    const api = createMutationService({ db: model.db, recordAuditEvent });
    await expect(api.createWebinar({ slug: 'intro', title: 'Intro', primaryOwnerUserId: 7, actorUserId: 1 })).rejects.toThrow();
    expect(model.committed()).toEqual(initial);
    expect(model.calls).toContain('rollback');
    if (stage !== 'commit') expect(model.calls).not.toContain('commit');
  });

  it.each(['revision', 'audit', 'commit'])('rolls back all material restore state when %s fails', async stage => {
    const restored = { schemaVersion: 1, webinar: { slug: 'restored', title: 'Restored', masterHtml, masterCss: '' }, slides: [{ id: stableId, position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 20, speakerNotes: 'restored note', html: '<section>restored</section>', css: '', javascript: '' }] };
    const initial = {
      users: [{ id: 7, name: 'Owner', is_active: 1 }], presentations: [{ ...currentWebinar(), archived_at: null }],
      slides: [
        { ...activeSlides()[0], webinar_id: 2, archived_at: '2026-09-01T00:00:00.000Z', position: null },
        { id: secondId, webinar_id: 2, position: 0, anchor: 'old-slide', title: 'Old', target_seconds: 0, speaker_notes: '', html: '<section>old</section>', css: '', javascript: '', archived_at: null },
      ],
      revisions: [{ id: 18, webinar_id: 2, version: 2, snapshot: JSON.stringify(restored) }], audit: [], nextPresentationId: 3, nextRevisionId: 19,
    };
    const model = statefulMutationModel(initial);
    const recordAuditEvent = stage === 'audit' ? vi.fn().mockRejectedValue(new Error('audit failed')) : model.audit;
    if (stage === 'revision') {
      const base = model.connection.query.getMockImplementation();
      model.connection.query.mockImplementation((sql, params) => sql.includes('INSERT INTO webinar_revisions') ? Promise.reject(new Error('revision failed')) : base(sql, params));
    }
    if (stage === 'commit') model.connection.commit.mockImplementation(async () => { throw new Error('commit failed'); });
    const api = createMutationService({ db: model.db, recordAuditEvent });
    await expect(api.restoreRevision({ webinarId: 2, revisionId: 18, actorUserId: 7, expectedVersion: 4 })).rejects.toThrow();
    expect(model.committed()).toEqual(initial);
    expect(model.calls).toContain('rollback');
    if (stage !== 'commit') expect(model.calls).not.toContain('commit');
  });

  it('rejects a missing or inactive creation owner before inserting webinar rows', async () => {
    const { api, connection, calls } = service({ owner: null });
    await expect(api.createWebinar({ slug: 'intro', title: 'Intro', primaryOwnerUserId: 7, actorUserId: 1 }))
      .rejects.toMatchObject({ code: 'OWNER_NOT_ACTIVE' });
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO webinar_presentations'))).toBe(false);
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('commit');
  });

  it('changes owner and audience metadata without advancing a content revision', async () => {
    const audit = vi.fn().mockResolvedValue({ id: 1 });
    const { api, calls } = service({ recordAuditEvent: audit });
    await expect(api.changeOwner({ webinarId: 2, primaryOwnerUserId: 7, actorUserId: 1 })).resolves.toMatchObject({ liveVersion: 4, primaryOwnerUserId: 7, updatedAt: '2026-09-03T10:01:00.000Z' });
    await expect(api.changeAudienceAccess({ webinarId: 2, enabled: true, actorUserId: 1 })).resolves.toMatchObject({ liveVersion: 4, audienceEnabled: true, updatedAt: '2026-09-03T10:01:00.000Z' });
    expect(calls).not.toContain('revision:5');
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
