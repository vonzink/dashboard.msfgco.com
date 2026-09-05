import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PublicBundleError,
  createPublicBundleService,
  toPublicBundle,
} = require('../../../services/webinars/publicBundle');

const FIRST_VERSION = '11111111-1111-4111-8111-111111111111';
const SECOND_VERSION = '22222222-2222-4222-8222-222222222222';
const FIRST_SLIDE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_SLIDE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIRST_SHA = 'a'.repeat(64);
const SECOND_SHA = 'b'.repeat(64);
const ASSET_CONFIG = Object.freeze({
  bucket: 'webinar-assets-test',
  cdnBaseUrl: 'https://assets.example',
  quarantinePrefix: 'quarantine/',
});
const RESOURCE_POLICY = Object.freeze({
  assetOrigin: 'https://assets.example',
  stylesheetOrigins: Object.freeze(['https://styles.example']),
  fontOrigins: Object.freeze(['https://fonts.example']),
});

function liveRows(overrides = {}) {
  const masterHtml = `<main><img src="{{ASSET:${FIRST_VERSION}}}">{{SLIDE_CONTENT}}</main>`;
  return [{
    webinar_id: 12,
    webinar_slug: 'first-home-without-mystery',
    webinar_title: 'Your first home, without the mystery.',
    master_html: masterHtml,
    master_css: ':root{--green:#8cc63e}',
    live_version: 8,
    slide_id: FIRST_SLIDE,
    slide_position: 0,
    slide_anchor: 'opening',
    slide_title: 'Opening',
    slide_html: `<img src="{{ASSET:${FIRST_VERSION}}}">`,
    slide_css: '',
    slide_javascript: '',
    primary_owner_user_id: 77,
    speaker_notes: 'private speaker note',
    target_seconds: 75,
    updated_at: '2026-09-04T10:00:00.000Z',
    ...overrides,
  }];
}

function availableVersion(id, overrides = {}) {
  const sha256 = id === FIRST_VERSION ? FIRST_SHA : SECOND_SHA;
  return {
    id,
    status: 'available',
    archived_at: null,
    family_archived_at: null,
    sha256,
    s3_key: `approved/sha256/${sha256}/asset`,
    original_filename: 'confidential-client-name.png',
    uploaded_by_user_id: 77,
    ...overrides,
  };
}

function database({ rows = liveRows(), versions = [availableVersion(FIRST_VERSION)] } = {}) {
  return {
    query: vi.fn(async (sql, params = []) => {
      if (sql.includes('FROM webinar_presentations p')) return [structuredClone(rows)];
      if (sql.includes('SELECT a.id') && sql.includes('FROM webinar_assets a')) {
        return [[{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }]];
      }
      if (sql.includes('FROM webinar_asset_versions v')) {
        return [structuredClone(versions.filter(version => params.includes(version.id)))];
      }
      throw new Error(`Unexpected database query: ${sql}`);
    }),
  };
}

function service(state = {}) {
  const db = database(state);
  return {
    db,
    api: createPublicBundleService({
      db,
      loadAssetConfig: () => ASSET_CONFIG,
      loadResourcePolicy: () => RESOURCE_POLICY,
    }),
  };
}

function objectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    objectKeys(child, keys);
  }
  return keys;
}

describe('public Webinar Studio live bundle compiler', () => {
  it('returns only the exact public allow-list while keeping source tokenized', async () => {
    const { api, db } = service();

    const result = await api.getLiveBundleBySlug('first-home-without-mystery');

    expect(result.bundle).toEqual({
      schemaVersion: 1,
      webinar: {
        id: 12,
        slug: 'first-home-without-mystery',
        title: 'Your first home, without the mystery.',
        liveVersion: 8,
      },
      master: {
        html: `<main><img src="{{ASSET:${FIRST_VERSION}}}">{{SLIDE_CONTENT}}</main>`,
        css: ':root{--green:#8cc63e}',
      },
      slides: [{
        id: FIRST_SLIDE,
        position: 0,
        anchor: 'opening',
        title: 'Opening',
        html: `<img src="{{ASSET:${FIRST_VERSION}}}">`,
        css: '',
        javascript: '',
      }],
      assets: {
        [FIRST_VERSION]: `https://assets.example/approved/sha256/${FIRST_SHA}/asset`,
      },
      resourcePolicy: {
        assetOrigin: 'https://assets.example',
        stylesheetOrigins: ['https://styles.example'],
        fontOrigins: ['https://fonts.example'],
      },
    });
    expect(result.json).toBe(JSON.stringify(result.bundle));
    expect(result.etag).toMatch(/^"[a-f0-9]{64}"$/);

    const keys = objectKeys(result.bundle);
    expect(keys).not.toEqual(expect.arrayContaining([
      'primaryOwnerUserId', 'speakerNotes', 'targetSeconds', 'updatedAt', 'originalFilename',
      's3Key', 'uploadedByUserId', 'userId', 'settings', 'history', 'audit',
    ]));
    expect(result.json).not.toContain('private speaker note');
    expect(result.json).not.toContain('confidential-client-name.png');
    expect(result.json).not.toContain('2026-09-04T10:00:00.000Z');

    const [publicSql, params] = db.query.mock.calls[0];
    expect(publicSql).not.toMatch(/SELECT\s+\*/i);
    expect(publicSql).toContain('p.audience_enabled = 1');
    expect(publicSql).toContain('p.archived_at IS NULL');
    expect(publicSql).toContain('s.archived_at IS NULL');
    expect(publicSql).toContain('ORDER BY s.position ASC, s.id ASC');
    expect(publicSql).not.toMatch(/owner|speaker_notes|target_seconds|created_at|updated_at|audit|cognito/i);
    expect(params).toEqual(['first-home-without-mystery']);
  });

  it('sorts contiguous numeric positions deterministically and emits byte-identical JSON and ETags', async () => {
    const rows = [
      ...liveRows({
        slide_id: SECOND_SLIDE,
        slide_position: '1',
        slide_anchor: 'later',
        slide_title: 'Later',
        slide_html: `<img src="{{ASSET:${SECOND_VERSION}}}">`,
      }),
      ...liveRows({ slide_position: '0' }),
    ];
    const state = {
      rows,
      versions: [availableVersion(SECOND_VERSION), availableVersion(FIRST_VERSION)],
    };
    const first = await service(state).api.getLiveBundleBySlug('first-home-without-mystery');
    const second = await service({
      ...state,
      versions: [...state.versions].reverse(),
    }).api.getLiveBundleBySlug('first-home-without-mystery');

    expect(first.bundle.slides.map(slide => slide.position)).toEqual([0, 1]);
    expect(Object.keys(first.bundle.assets)).toEqual([FIRST_VERSION, SECOND_VERSION]);
    expect(second.json).toBe(first.json);
    expect(second.etag).toBe(first.etag);
  });

  it.each([
    ['title', { webinar_title: 'A changed public title' }],
    ['Master CSS', { master_css: 'body{color:navy}' }],
    ['slide code', { slide_javascript: 'window.changed=true;' }],
  ])('changes the ETag when the public %s changes', async (_label, override) => {
    const baseline = await service().api.getLiveBundleBySlug('first-home-without-mystery');
    const changed = await service({ rows: liveRows(override) }).api.getLiveBundleBySlug('first-home-without-mystery');
    expect(changed.etag).not.toBe(baseline.etag);
  });

  it('returns null when the explicit audience-enabled active webinar query has no rows', async () => {
    const { api, db } = service({ rows: [] });
    await expect(api.getLiveBundleBySlug('private-or-missing')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('accepts a canonical webinar slug that begins with a number', async () => {
    const result = await service({
      rows: liveRows({ webinar_slug: '2026-home' }),
    }).api.getLiveBundleBySlug('2026-home');
    expect(result.bundle.webinar.slug).toBe('2026-home');
  });

  it.each(['first--home', 'first-home-'])(
    'rejects the noncanonical webinar slug %s without weakening slide-anchor rules',
    async webinarSlug => {
      const { api } = service({ rows: liveRows({ webinar_slug: webinarSlug }) });
      await expect(api.getLiveBundleBySlug(webinarSlug)).rejects.toMatchObject({
        status: 503,
        code: 'PUBLIC_BUNDLE_INVALID',
      });
    },
  );

  it('deduplicates repeated canonical asset tokens into one immutable public-map entry', async () => {
    const rows = liveRows({
      master_css: `body{background:url({{ASSET:${FIRST_VERSION}}})}`,
      slide_html: `<img src="{{ASSET:${FIRST_VERSION}}}"><img src="{{ASSET:${FIRST_VERSION}}}">`,
      slide_javascript: `window.logo='{{ASSET:${FIRST_VERSION}}}';`,
    });
    const result = await service({ rows }).api.getLiveBundleBySlug('first-home-without-mystery');
    expect(Object.keys(result.bundle.assets)).toEqual([FIRST_VERSION]);
    expect(result.bundle.slides[0].javascript).toContain(`{{ASSET:${FIRST_VERSION}}}`);
  });

  it('resolves public assets without issuing DML or locking reads', async () => {
    const { api, db } = service();
    await api.getLiveBundleBySlug('first-home-without-mystery');

    const sql = db.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/);
    expect(sql).not.toContain('FOR UPDATE');
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['forbidden Master HTML', { master_html: '<script>alert(1)</script><main>{{SLIDE_CONTENT}}</main>' }],
    ['a forbidden Master CSS import', { master_css: '@import "https://evil.example/master.css";' }],
    ['an evil slide HTML URL', { slide_html: '<img src="https://evil.example/private.png">' }],
    ['a forbidden CSS import', { slide_css: '@import "https://evil.example/theme.css";' }],
    ['malformed CSS', { slide_css: '.slide { color: red' }],
    ['invalid JavaScript', { slide_javascript: 'const broken = ;' }],
    ['oversize slide HTML', { slide_html: 'x'.repeat(256001) }],
  ])('fails closed when persisted live code contains %s', async (_label, override) => {
    const { api } = service({ rows: liveRows(override) });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
    });
  });

  it('revalidates persisted source when the server resource policy becomes tighter', async () => {
    const rows = liveRows({
      slide_html: '<link rel="stylesheet" href="https://legacy-styles.example/theme.css"><section>Previously admitted content</section>',
    });
    const { api } = service({ rows, versions: [] });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
    });
  });

  it.each([
    ['a missing version', []],
    ['a processing version', [availableVersion(FIRST_VERSION, { status: 'processing' })]],
    ['an archived version', [availableVersion(FIRST_VERSION, { archived_at: '2026-09-04T10:00:00.000Z' })]],
    ['an archived family', [availableVersion(FIRST_VERSION, { family_archived_at: '2026-09-04T10:00:00.000Z' })]],
    ['a noncanonical delivery key', [availableVersion(FIRST_VERSION, { s3_key: 'approved/legacy/private.png' })]],
    ['a checksum-mismatched delivery key', [availableVersion(FIRST_VERSION, { sha256: SECOND_SHA })]],
  ])('fails the complete bundle with one controlled error for %s', async (_label, versions) => {
    const { api } = service({ versions });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toEqual(expect.objectContaining({
      name: 'PublicBundleError',
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
      message: 'Public webinar is temporarily unavailable',
    }));
  });

  it('fails closed on malformed asset tokens without exposing token parser details', async () => {
    const { api } = service({ rows: liveRows({ slide_html: '<img src="{{ASSET:not-a-uuid}}">' }) });
    let thrown;
    try {
      await api.getLiveBundleBySlug('first-home-without-mystery');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PublicBundleError);
    expect(thrown).toMatchObject({ status: 503, code: 'PUBLIC_BUNDLE_INVALID' });
    expect(JSON.stringify(thrown)).not.toMatch(/ASSET_TOKEN|not-a-uuid|stack|s3/i);
  });

  it.each([
    ['missing', '<main>No mount</main>'],
    ['extra', '<main>{{SLIDE_CONTENT}}{{SLIDE_CONTENT}}</main>'],
  ])('fails closed when Master HTML has a %s slide-content mount', async (_label, masterHtml) => {
    const { api } = service({ rows: liveRows({ master_html: masterHtml }) });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
    });
  });

  it.each([
    ['Master', { master_html: '<main data-slide-mount>{{SLIDE_CONTENT}}</main>' }],
    ['slide', { slide_html: '<section DATA-SLIDE-MOUNT="owned"></section>' }],
  ])('fails closed when %s HTML claims the renderer mount attribute', async (_surface, override) => {
    const { api } = service({ rows: liveRows(override) });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
      message: 'Public webinar is temporarily unavailable',
    });
  });

  it.each([
    ['duplicate', [
      ...liveRows({ slide_position: 3 }),
      ...liveRows({ slide_id: SECOND_SLIDE, slide_position: '3', slide_anchor: 'duplicate-position' }),
    ]],
    ['negative', liveRows({ slide_position: -1 })],
    ['fractional', liveRows({ slide_position: 1.5 })],
    ['nonnumeric', liveRows({ slide_position: 'first' })],
    ['noncontiguous', [
      ...liveRows({ slide_position: 0 }),
      ...liveRows({ slide_id: SECOND_SLIDE, slide_position: 2, slide_anchor: 'third' }),
    ]],
  ])('fails closed for %s live slide positions', async (_label, rows) => {
    const { api } = service({ rows });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
    });
  });

  it.each([
    ['a malformed slide UUID', liveRows({ slide_id: 'not-a-slide-uuid' })],
    ['an uppercase anchor', liveRows({ slide_anchor: 'Opening' })],
    ['a duplicate slide UUID', [
      ...liveRows({ slide_position: 0 }),
      ...liveRows({ slide_position: 1, slide_anchor: 'second' }),
    ]],
    ['a duplicate slide anchor', [
      ...liveRows({ slide_position: 0 }),
      ...liveRows({ slide_id: SECOND_SLIDE, slide_position: 1 }),
    ]],
    ['a blank slide title', liveRows({ slide_title: '   ' })],
    ['an overlong slide title', liveRows({ slide_title: 't'.repeat(256) })],
    ['an invalid webinar slug', liveRows({ webinar_slug: 'First Home' })],
    ['a blank webinar title', liveRows({ webinar_title: ' ' })],
    ['an overlong webinar title', liveRows({ webinar_title: 'w'.repeat(256) })],
  ])('fails closed for public metadata with %s', async (_label, rows) => {
    const { api } = service({ rows });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
    });
  });

  it.each([
    ['missing asset origin', { ...RESOURCE_POLICY, assetOrigin: null }, ASSET_CONFIG],
    ['non-HTTPS stylesheet origin', { ...RESOURCE_POLICY, stylesheetOrigins: ['http://styles.example'] }, ASSET_CONFIG],
    ['asset policy and delivery mismatch', RESOURCE_POLICY, { ...ASSET_CONFIG, cdnBaseUrl: 'https://other-assets.example' }],
  ])('fails closed for a server resource policy with %s', async (_label, resourcePolicy, assetConfig) => {
    const db = database();
    const api = createPublicBundleService({
      db,
      loadAssetConfig: () => assetConfig,
      loadResourcePolicy: () => resourcePolicy,
    });
    await expect(api.getLiveBundleBySlug('first-home-without-mystery')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_BUNDLE_INVALID',
    });
  });

  it('rejects inconsistent joined webinar state instead of compiling a mixed bundle', () => {
    const rows = [
      ...liveRows(),
      ...liveRows({ slide_id: SECOND_SLIDE, slide_position: 1, live_version: 9 }),
    ];
    expect(() => toPublicBundle(rows, new Map([[FIRST_VERSION, 'https://assets.example/asset']]), RESOURCE_POLICY))
      .toThrowError(expect.objectContaining({ code: 'PUBLIC_BUNDLE_INVALID' }));
  });
});
