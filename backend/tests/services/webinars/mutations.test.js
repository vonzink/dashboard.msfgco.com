import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMutationService } = require('../../../services/webinars/mutations');

const stableId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const masterHtml = '<main>{{SLIDE_CONTENT}}</main>';

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

describe('Webinar Studio live mutations', () => {
  it('locks, validates, snapshots, versions and commits a Master save atomically', async () => {
    const { api, calls } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml, masterCss: 'main { color: navy; }' }))
      .resolves.toMatchObject({ webinarId: 2, liveVersion: 5 });
    expect(calls).toEqual(expect.arrayContaining(['beginTransaction', 'lock:2', 'revision:5', 'commit']));
    expect(calls.indexOf('revision:5')).toBeGreaterThan(calls.indexOf('write'));
    expect(calls).not.toContain('rollback');
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
    expect(stages).toEqual(['begin', 'lock-version', 'complete-validation', 'asset-sync', 'normalized-writes', 'snapshot', 'revision', 'revision-assets', 'live-version', 'audit', 'commit']);
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

  it('returns private conflict metadata and never commits a stale write', async () => {
    const { api, calls } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 3, masterHtml, masterCss: '' }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT', currentVersion: 4, updatedBy: { id: 8, name: 'Another Editor' } });
    expect(calls).not.toContain('commit');
    expect(calls).toContain('rollback');
  });

  it('validates the complete candidate before beginning writes and fails closed for unavailable asset hooks', async () => {
    const { api, calls } = service();
    await expect(api.saveMaster({ webinarId: 2, actorUserId: 7, expectedVersion: 4, masterHtml: '<script>bad()</script>{{SLIDE_CONTENT}}', masterCss: '' }))
      .rejects.toMatchObject({ code: 'CONTENT_VALIDATION_FAILED' });
    expect(calls).not.toContain('write');
    expect(calls).not.toContain('revision:5');

    vi.stubEnv('WEBINAR_ASSET_CDN_BASE_URL', 'https://assets.example');
    const unavailable = service();
    await expect(unavailable.api.saveSlide({ webinarId: 2, slideId: stableId, actorUserId: 7, expectedVersion: 4, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '<img src="{{ASSET:11111111-1111-4111-8111-111111111111}}">', css: '', javascript: '' }))
      .rejects.toMatchObject({ code: 'ASSET_LIBRARY_NOT_READY' });
    expect(unavailable.calls).toContain('rollback');
    expect(unavailable.calls).not.toContain('revision:5');
    vi.unstubAllEnvs();
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

  it('archives a slide without deleting its stable identity', async () => {
    const { api, connection } = service();
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
    const restored = { schemaVersion: 1, webinar: { slug: 'restored-intro', title: 'Restored intro', masterHtml, masterCss: '' }, slides: [{ id: stableId, position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' }] };
    const { api, connection } = service();
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
    expect(connection.query.mock.calls.some(([sql, params]) => sql.includes('SET slug = ?, title = ?') && params[0] === 'restored-intro' && params[1] === 'Restored intro')).toBe(true);
    expect(connection.query.mock.calls.some(([sql, params]) => sql.includes('archived_at = NULL') && params.includes(stableId))).toBe(true);
    await api.archiveWebinar({ webinarId: 2, actorUserId: 7 });
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('archived_at = CURRENT_TIMESTAMP(3), audience_enabled = 0'))).toBe(true);
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
