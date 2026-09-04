import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AssetReferenceError,
  createReferenceService,
} = require('../../../services/webinarAssets/references');

const FIRST_VERSION = '11111111-1111-4111-8111-111111111111';
const SECOND_VERSION = '22222222-2222-4222-8222-222222222222';
const SLIDE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = {
  bucket: 'assets-test',
  cdnBaseUrl: 'https://assets.example',
  quarantinePrefix: 'quarantine/',
};

function candidate(overrides = {}) {
  return {
    webinarId: 42,
    masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
    masterCss: '',
    slides: [{
      id: SLIDE_ID,
      html: '',
      css: '',
      javascript: '',
    }],
    ...overrides,
  };
}

function available(id, overrides = {}) {
  return {
    id,
    status: 'available',
    archived_at: null,
    family_archived_at: null,
    sha256: id === FIRST_VERSION ? 'a'.repeat(64) : 'b'.repeat(64),
    s3_key: `approved/sha256/${id === FIRST_VERSION ? 'a'.repeat(64) : 'b'.repeat(64)}/asset`,
    ...overrides,
  };
}

function connectionWith(rows = []) {
  const calls = [];
  return {
    calls,
    connection: {
      query: vi.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM webinar_asset_versions')) return [rows];
        return [{ affectedRows: 1 }];
      }),
    },
  };
}

describe('webinar asset live and revision references', () => {
  it('rejects a non-canonical token with a controlled client error before querying storage metadata', async () => {
    const { connection, calls } = connectionWith([]);
    const service = createReferenceService({ config });

    await expect(service.validateAndReplaceReferences(connection, candidate({
      masterCss: 'body { background: url({{ASSET:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA}}); }',
    }))).rejects.toMatchObject({ status: 422, code: 'ASSET_TOKEN_FORMAT' });

    expect(calls).toEqual([]);
  });

  it('rejects a missing asset version before replacing current references', async () => {
    const { connection, calls } = connectionWith([]);
    const service = createReferenceService({ config });

    await expect(service.validateAndReplaceReferences(connection, candidate({
      masterCss: `body { background: url({{ASSET:${FIRST_VERSION}}}); }`,
    }))).rejects.toMatchObject({ status: 422, code: 'ASSET_NOT_FOUND' });

    expect(calls.some(({ sql }) => sql.startsWith('DELETE FROM webinar_asset_references'))).toBe(false);
  });

  it.each([
    ['processing', { status: 'processing' }],
    ['archived version', { status: 'archived', archived_at: '2026-09-04T10:00:00.000Z' }],
    ['archived family', { family_archived_at: '2026-09-04T10:00:00.000Z' }],
  ])('rejects an unavailable %s before replacing current references', async (_label, overrides) => {
    const { connection, calls } = connectionWith([available(FIRST_VERSION, overrides)]);
    const service = createReferenceService({ config });

    await expect(service.validateAndReplaceReferences(connection, candidate({
      masterCss: `body { background: url({{ASSET:${FIRST_VERSION}}}); }`,
    }))).rejects.toMatchObject({ status: 422, code: 'ASSET_NOT_AVAILABLE' });

    expect(calls.some(({ sql }) => sql.startsWith('DELETE FROM webinar_asset_references'))).toBe(false);
  });

  it('rejects an available row whose persisted delivery path is not the canonical checksum path', async () => {
    const { connection, calls } = connectionWith([available(FIRST_VERSION, {
      s3_key: 'approved/legacy/customer-logo.png',
    })]);
    const service = createReferenceService({ config });

    await expect(service.validateAndReplaceReferences(connection, candidate({
      masterCss: `body { background: url({{ASSET:${FIRST_VERSION}}}); }`,
    }))).rejects.toMatchObject({ status: 422, code: 'ASSET_NOT_AVAILABLE' });

    expect(calls.some(({ sql }) => sql.startsWith('DELETE FROM webinar_asset_references'))).toBe(false);
  });

  it('locks every unique version and its family in one ordered query to serialize archive decisions', async () => {
    const { connection, calls } = connectionWith([
      available(FIRST_VERSION),
      available(SECOND_VERSION),
    ]);
    const service = createReferenceService({ config });

    await service.validateAndReplaceReferences(connection, candidate({
      masterHtml: `<img src="{{ASSET:${SECOND_VERSION}}}"><main>{{SLIDE_CONTENT}}</main>`,
      masterCss: `body { background: url({{ASSET:${FIRST_VERSION}}}); }`,
    }));

    const selection = calls.find(({ sql }) => sql.includes('FROM webinar_asset_versions'));
    expect(selection.sql).toContain('JOIN webinar_assets');
    expect(selection.sql).toContain('ORDER BY v.id');
    expect(selection.sql).toContain('FOR UPDATE');
    expect(selection.params).toEqual([FIRST_VERSION, SECOND_VERSION]);
  });

  it('replaces only one webinar complete reference set and deduplicates repeated surface tokens', async () => {
    const { connection, calls } = connectionWith([available(FIRST_VERSION)]);
    const service = createReferenceService({ config });
    const token = `{{ASSET:${FIRST_VERSION}}}`;

    const result = await service.validateAndReplaceReferences(connection, candidate({
      masterHtml: `<img src="${token}"><main>{{SLIDE_CONTENT}}</main>`,
      slides: [{
        id: SLIDE_ID,
        html: `<img src="${token}"><img src="${token}">`,
        css: `.hero { background: url(${token}); }`,
        javascript: `window.asset = '${token}';`,
      }],
    }));

    const deletion = calls.filter(({ sql }) => sql.startsWith('DELETE FROM webinar_asset_references'));
    expect(deletion).toEqual([{ sql: 'DELETE FROM webinar_asset_references WHERE webinar_id = ?', params: [42] }]);
    const inserts = calls.filter(({ sql }) => sql.startsWith('INSERT INTO webinar_asset_references'));
    expect(inserts.map(({ params }) => params)).toEqual([
      [42, null, FIRST_VERSION, 'master_html'],
      [42, SLIDE_ID, FIRST_VERSION, 'slide_html'],
      [42, SLIDE_ID, FIRST_VERSION, 'slide_css'],
      [42, SLIDE_ID, FIRST_VERSION, 'slide_javascript'],
    ]);
    expect(result.assetVersionIds).toEqual([FIRST_VERSION]);
    expect(result.urlsByVersionId.get(FIRST_VERSION)).toBe(
      `https://assets.example/approved/sha256/${'a'.repeat(64)}/asset`,
    );
  });

  it('clears obsolete live references without requiring asset delivery configuration', async () => {
    const { connection, calls } = connectionWith([]);
    const service = createReferenceService({ config: null, loadConfig: vi.fn(() => {
      throw new Error('configuration should not be loaded');
    }) });

    await expect(service.validateAndReplaceReferences(connection, candidate())).resolves.toEqual({
      assetVersionIds: [],
      urlsByVersionId: new Map(),
    });
    expect(calls).toEqual([{
      sql: 'DELETE FROM webinar_asset_references WHERE webinar_id = ?',
      params: [42],
    }]);
  });

  it('records an append-only, sorted, deduplicated revision dependency set', async () => {
    const { connection, calls } = connectionWith([]);
    const service = createReferenceService({ config });

    await service.recordRevisionAssetReferences(connection, 91, [SECOND_VERSION, FIRST_VERSION, SECOND_VERSION]);

    expect(calls).toEqual([
      {
        sql: 'INSERT INTO webinar_revision_asset_references (revision_id, asset_version_id) VALUES (?, ?)',
        params: [91, FIRST_VERSION],
      },
      {
        sql: 'INSERT INTO webinar_revision_asset_references (revision_id, asset_version_id) VALUES (?, ?)',
        params: [91, SECOND_VERSION],
      },
    ]);
  });

  it('uses a controlled reference error contract', () => {
    const error = new AssetReferenceError('ASSET_NOT_FOUND', 'Asset version not found', 422);
    expect(error).toMatchObject({
      name: 'AssetReferenceError',
      code: 'ASSET_NOT_FOUND',
      message: 'Asset version not found',
      status: 422,
    });
  });
});
