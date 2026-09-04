import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
const {
  WebinarMutationError,
  createMutationService,
} = require('../../services/webinars/mutations');
const { WebinarNoteError } = require('../../services/webinars/notes');
const {
  AssetReferenceError,
  createReferenceService,
} = require('../../services/webinarAssets/references');

const slideId = '11111111-1111-4111-8111-111111111111';
const secondSlideId = '22222222-2222-4222-8222-222222222222';
const validMaster = {
  expectedVersion: 3,
  masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
  masterCss: ':root { color: #123456; }',
};
const validSlide = {
  expectedVersion: 3,
  anchor: 'opening',
  title: 'Opening',
  targetSeconds: 90,
  speakerNotes: 'Shared note',
  html: '<section>Welcome</section>',
  css: '.slide { display: grid; }',
  javascript: 'const ready = true;',
};
const webinar = {
  id: 2,
  slug: 'first-home',
  title: 'First Home',
  primaryOwnerUserId: 7,
  liveVersion: 3,
  audienceEnabled: false,
  masterHtml: validMaster.masterHtml,
  masterCss: validMaster.masterCss,
  slides: [{ id: slideId }],
};

function identity(id, role = 'user') {
  return { db: { id, role, is_active: 1 }, groups: [role] };
}

function makeServices() {
  const repository = {
    listForRequest: vi.fn().mockResolvedValue([webinar]),
    getPrivateDocument: vi.fn().mockResolvedValue(webinar),
  };
  const revisions = { listHistory: vi.fn().mockResolvedValue([{ id: 11, version: 3 }]) };
  const mutations = {
    createWebinar: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 1 }),
    archiveWebinar: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 3 }),
    saveMaster: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    addSlide: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    duplicateSlide: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    saveSlide: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    reorderSlides: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    archiveSlide: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    restoreRevision: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 4 }),
    changeOwner: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 3 }),
    changeAudienceAccess: vi.fn().mockResolvedValue({ webinarId: 2, liveVersion: 3 }),
  };
  const notes = {
    listNotes: vi.fn().mockResolvedValue([{ id: 5, slideId, body: 'Mine' }]),
    addNote: vi.fn().mockResolvedValue({ id: 5, slideId, body: 'Private note' }),
    updateNote: vi.fn().mockResolvedValue({ id: 5, body: 'Updated note' }),
    deleteNote: vi.fn().mockResolvedValue({ id: 5 }),
  };
  return { repository, revisions, mutations, notes };
}

function authenticateFromHeader(req, _res, next) {
  req.user = JSON.parse(req.get('x-test-user') || '{}');
  next();
}

function allServiceMocks(serviceModules) {
  return Object.values(serviceModules)
    .flatMap(service => Object.values(service))
    .filter(vi.isMockFunction);
}

let services;
let operationalLogger;
let server;

// This is the executable coverage manifest for the approved private API. The
// exact-dispatch and identity-matrix tests below both consume every row, while
// the named boundary cases identify the route-specific malformed/error checks.
function approvedRouteContracts() {
  return [
    {
      label: 'list', method: 'GET', path: '/api/webinars', route: 'GET /api/webinars',
      status: 200, access: 'active-internal', boundaries: ['authorization', 'exact dispatch', 'unexpected error'],
      target: () => services.repository.listForRequest,
      assertArgs: (call, user = identity(7)) => {
        expect(call).toHaveLength(1);
        expect(call[0].user).toEqual(user);
      },
    },
    {
      label: 'get', method: 'GET', path: '/api/webinars/2', route: 'GET /api/webinars/:id',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID', 'exact dispatch', 'archived 404', 'unexpected error'],
      target: () => services.repository.getPrivateDocument, args: [2],
    },
    {
      label: 'create', method: 'POST', path: '/api/webinars', route: 'POST /api/webinars',
      status: 201, access: 'admin', boundaries: ['authorization', 'malformed body', 'exact dispatch', 'controlled/unexpected error'],
      user: identity(7, 'admin'), body: { slug: 'intro', title: 'Intro', primaryOwnerUserId: 8 },
      target: () => services.mutations.createWebinar,
      args: [{ slug: 'intro', title: 'Intro', primaryOwnerUserId: 8, actorUserId: 7 }],
    },
    {
      label: 'save master', method: 'PUT', path: '/api/webinars/2/master', route: 'PUT /api/webinars/:id/master',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'archived 404', 'controlled/unexpected error'],
      body: validMaster, target: () => services.mutations.saveMaster,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, ...validMaster }],
    },
    {
      label: 'add slide', method: 'POST', path: '/api/webinars/2/slides', route: 'POST /api/webinars/:id/slides (add)',
      status: 201, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'controlled/unexpected error'],
      body: validSlide, target: () => services.mutations.addSlide,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, ...validSlide }],
    },
    {
      label: 'duplicate slide', method: 'POST', path: '/api/webinars/2/slides', route: 'POST /api/webinars/:id/slides (duplicate)',
      status: 201, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'missing slide', 'controlled/unexpected error'],
      body: { expectedVersion: 3, sourceSlideId: slideId },
      target: () => services.mutations.duplicateSlide,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, expectedVersion: 3, sourceSlideId: slideId }],
    },
    {
      label: 'save slide', method: 'PUT', path: `/api/webinars/2/slides/${slideId}`, route: 'PUT /api/webinars/:id/slides/:slideId',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'missing/archived slide', 'controlled/unexpected error'],
      body: validSlide, target: () => services.mutations.saveSlide,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, ...validSlide, slideId }],
    },
    {
      label: 'reorder slides', method: 'PUT', path: '/api/webinars/2/slides/order', route: 'PUT /api/webinars/:id/slides/order',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'controlled/unexpected error'],
      body: { expectedVersion: 3, slideIds: [secondSlideId, slideId] },
      target: () => services.mutations.reorderSlides,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, expectedVersion: 3, slideIds: [secondSlideId, slideId] }],
    },
    {
      label: 'archive slide', method: 'DELETE', path: `/api/webinars/2/slides/${slideId}`, route: 'DELETE /api/webinars/:id/slides/:slideId',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'missing/archived slide', 'controlled/unexpected error'],
      body: { expectedVersion: 3 }, target: () => services.mutations.archiveSlide,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, expectedVersion: 3, slideId }],
    },
    {
      label: 'history', method: 'GET', path: '/api/webinars/2/history', route: 'GET /api/webinars/:id/history',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID', 'exact dispatch', 'archived 404', 'unexpected error'],
      target: () => services.revisions.listHistory, args: [2],
    },
    {
      label: 'restore', method: 'POST', path: '/api/webinars/2/history/11/restore', route: 'POST /api/webinars/:id/history/:revisionId/restore',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'controlled/unexpected error'],
      body: { expectedVersion: 3 }, target: () => services.mutations.restoreRevision,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: false, expectedVersion: 3, revisionId: 11 }],
    },
    {
      label: 'change owner', method: 'PUT', path: '/api/webinars/2/owner', route: 'PUT /api/webinars/:id/owner',
      status: 200, access: 'admin', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'controlled/unexpected error'],
      user: identity(7, 'admin'), body: { primaryOwnerUserId: 8 },
      target: () => services.mutations.changeOwner,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: true, primaryOwnerUserId: 8 }],
    },
    {
      label: 'change audience', method: 'PUT', path: '/api/webinars/2/audience-access', route: 'PUT /api/webinars/:id/audience-access',
      status: 200, access: 'admin', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'controlled/unexpected error'],
      user: identity(7, 'admin'), body: { enabled: true },
      target: () => services.mutations.changeAudienceAccess,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: true, enabled: true }],
    },
    {
      label: 'archive webinar', method: 'DELETE', path: '/api/webinars/2', route: 'DELETE /api/webinars/:id',
      status: 200, access: 'admin', boundaries: ['authorization', 'malformed ID', 'exact dispatch', 'archived 404', 'controlled/unexpected error'],
      user: identity(7, 'admin'), target: () => services.mutations.archiveWebinar,
      args: [{ webinarId: 2, actorUserId: 7, actorIsAdmin: true }],
    },
    {
      label: 'list notes', method: 'GET', path: '/api/webinars/2/notes', route: 'GET /api/webinars/:id/notes',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID', 'exact dispatch', 'archived 404', 'unexpected error'],
      target: () => services.notes.listNotes, args: [{ userId: 7, webinarId: 2 }],
    },
    {
      label: 'add note', method: 'POST', path: `/api/webinars/2/slides/${slideId}/notes`, route: 'POST /api/webinars/:id/slides/:slideId/notes',
      status: 201, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'missing/archived slide', 'controlled/unexpected error'],
      body: { body: 'Private note' }, target: () => services.notes.addNote,
      args: [{ userId: 7, actorIsAdmin: false, webinarId: 2, slideId, body: 'Private note' }],
    },
    {
      label: 'update note', method: 'PUT', path: '/api/webinars/2/notes/5', route: 'PUT /api/webinars/:id/notes/:noteId',
      status: 200, access: 'owner', boundaries: ['authorization', 'malformed ID/body', 'exact dispatch', 'indistinguishable owner 404', 'controlled/unexpected error'],
      body: { body: 'Updated note' }, target: () => services.notes.updateNote,
      args: [{ userId: 7, actorIsAdmin: false, webinarId: 2, noteId: 5, body: 'Updated note' }],
    },
    {
      label: 'delete note', method: 'DELETE', path: '/api/webinars/2/notes/5', route: 'DELETE /api/webinars/:id/notes/:noteId',
      status: 204, access: 'owner', boundaries: ['authorization', 'malformed ID', 'exact dispatch', 'indistinguishable owner 404', 'controlled/unexpected error'],
      target: () => services.notes.deleteNote, args: [{ userId: 7, actorIsAdmin: false, webinarId: 2, noteId: 5 }],
    },
  ];
}

beforeEach(async () => {
  services = makeServices();
  operationalLogger = { info: vi.fn() };
  const app = createApp({
    webinarAuthenticate: authenticateFromHeader,
    webinarServices: services,
    webinarOperationalLogger: operationalLogger,
    webinarWriteLimit: 1000,
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function request(method, path, body, user = identity(7), extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (user !== null) headers['x-test-user'] = JSON.stringify(user);
  if (body !== undefined && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function rawRequest(method, path, rawBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: body ? JSON.parse(body) : null,
      }));
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

function expectOneOperationalRecord(expected) {
  expect(operationalLogger.info).toHaveBeenCalledTimes(1);
  expect(operationalLogger.info).toHaveBeenCalledWith(
    expected,
    'webinar operational event',
  );
}

async function useRealAssetReferenceMutation(versionRows, { collectTokens } = {}) {
  await new Promise(resolve => server.close(resolve));
  const committed = {
    masterHtml: validMaster.masterHtml,
    masterCss: validMaster.masterCss,
    references: [{ webinarId: 2, assetVersionId: secondSlideId, surface: 'master_css' }],
    liveVersion: 3,
  };
  let transaction = null;
  const state = () => transaction || committed;
  const connection = {
    beginTransaction: vi.fn(async () => {
      transaction = structuredClone(committed);
    }),
    commit: vi.fn(async () => {
      Object.assign(committed, transaction);
      transaction = null;
    }),
    rollback: vi.fn(async () => {
      transaction = null;
    }),
    release: vi.fn(),
    query: vi.fn(async (sql, params = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM webinar_presentations p') && normalized.includes('FOR UPDATE')) {
        return [[{
          id: 2,
          slug: 'first-home',
          title: 'First Home',
          master_html: state().masterHtml,
          master_css: state().masterCss,
          live_version: state().liveVersion,
          audience_enabled: 0,
          primary_owner_user_id: 7,
          updated_at: '2026-09-04T12:00:00.000Z',
          updated_by_user_id: 7,
          updater_name: 'Owner',
        }]];
      }
      if (normalized.includes('FROM webinar_slides') && normalized.includes('ORDER BY position')) {
        return [[]];
      }
      if (normalized.startsWith('UPDATE webinar_presentations SET master_html = ?')) {
        state().masterHtml = params[0];
        state().masterCss = params[1];
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes('FROM webinar_assets a') && normalized.includes('WHERE EXISTS')) {
        return [versionRows.length ? [{ id: 'asset-family-for-route-test' }] : []];
      }
      if (normalized.includes('FROM webinar_asset_versions v') && normalized.includes('WHERE v.id IN')) {
        return [structuredClone(versionRows)];
      }
      if (normalized.startsWith('DELETE FROM webinar_asset_references')) {
        state().references = [];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected asset-reference route query: ${normalized}`);
    }),
  };
  const db = { getConnection: vi.fn().mockResolvedValue(connection) };
  const references = createReferenceService({
    config: {
      bucket: 'test-assets',
      cdnBaseUrl: 'https://assets.example',
      quarantinePrefix: 'quarantine/',
    },
    ...(collectTokens ? { collectTokens } : {}),
  });
  const mutations = createMutationService({
    db,
    validateCandidate: vi.fn().mockResolvedValue(undefined),
    syncAssetReferences: references.validateAndReplaceReferences,
  });
  const app = createApp({
    webinarAuthenticate: authenticateFromHeader,
    webinarServices: {
      repository: {
        listForRequest: vi.fn(),
        getPrivateDocument: vi.fn().mockResolvedValue(webinar),
      },
      revisions: { listHistory: vi.fn() },
      mutations,
      notes: makeServices().notes,
    },
    webinarOperationalLogger: operationalLogger,
    webinarWriteLimit: 1000,
  });
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  return { committed, connection };
}

describe('private webinar API through the production application factory', () => {
  it('enumerates every approved verb/path and its required boundary categories', () => {
    const contracts = approvedRouteContracts();
    expect(contracts.map(contract => contract.route)).toEqual([
      'GET /api/webinars',
      'GET /api/webinars/:id',
      'POST /api/webinars',
      'PUT /api/webinars/:id/master',
      'POST /api/webinars/:id/slides (add)',
      'POST /api/webinars/:id/slides (duplicate)',
      'PUT /api/webinars/:id/slides/:slideId',
      'PUT /api/webinars/:id/slides/order',
      'DELETE /api/webinars/:id/slides/:slideId',
      'GET /api/webinars/:id/history',
      'POST /api/webinars/:id/history/:revisionId/restore',
      'PUT /api/webinars/:id/owner',
      'PUT /api/webinars/:id/audience-access',
      'DELETE /api/webinars/:id',
      'GET /api/webinars/:id/notes',
      'POST /api/webinars/:id/slides/:slideId/notes',
      'PUT /api/webinars/:id/notes/:noteId',
      'DELETE /api/webinars/:id/notes/:noteId',
    ]);
    expect(contracts.every(contract => contract.boundaries.includes('authorization'))).toBe(true);
    expect(contracts.every(contract => contract.boundaries.includes('exact dispatch'))).toBe(true);
    expect(contracts.some(contract => contract.boundaries.some(value => value.includes('malformed')))).toBe(true);
    expect(contracts.some(contract => contract.boundaries.some(value => value.includes('controlled')))).toBe(true);
    expect(contracts.some(contract => contract.boundaries.some(value => value.includes('unexpected')))).toBe(true);
  });

  it.each(approvedRouteContracts())('dispatches the exact $label service contract', async ({ method, path, body, status, user, target, args, assertArgs }) => {
    const response = await request(method, path, body, user || identity(7));
    expect(response.status).toBe(status);
    const service = target();
    expect(service).toHaveBeenCalledTimes(1);
    if (assertArgs) assertArgs(service.mock.calls[0]);
    else expect(service.mock.calls[0]).toEqual(args);
  });

  it.each(approvedRouteContracts())('enforces the owner/admin/other identity matrix for $label', async (contract) => {
    const { method, path, body, status, access } = contract;
    const roles = [
      ['owner', identity(7)],
      ['admin', identity(1, 'admin')],
      ['other', identity(8)],
    ];
    for (const [role, user] of roles) {
      vi.clearAllMocks();
      const expectedStatus = access === 'active-internal'
        || (access === 'owner' && role !== 'other')
        || (access === 'admin' && role === 'admin')
        ? status
        : 403;
      const response = await request(method, path, body, user);
      expect(response.status).toBe(expectedStatus);
      if (contract.label === 'list') {
        expect(services.repository.listForRequest).toHaveBeenCalledTimes(1);
        contract.assertArgs(services.repository.listForRequest.mock.calls[0], user);
      }
      if (expectedStatus === 403) {
        const protectedActions = [
          ...Object.values(services.mutations),
          ...Object.values(services.notes),
          ...Object.values(services.revisions),
        ];
        expect(protectedActions.every(mock => mock.mock.calls.length === 0)).toBe(true);
      }
    }
  });

  it.each(approvedRouteContracts().filter(contract => contract.path.includes('/api/webinars/2')))(
    'rejects a malformed webinar ID on the $label route before domain dispatch',
    async ({ method, path, body, access }) => {
      const user = access === 'admin' ? identity(1, 'admin') : identity(7);
      const response = await request(
        method,
        path.replace('/api/webinars/2', '/api/webinars/not-an-id'),
        body,
        user,
      );
      expect(response.status).toBe(400);
      expect(allServiceMocks(services).every(mock => mock.mock.calls.length === 0)).toBe(true);
    },
  );

  it.each([
    ['webinar id', 'GET', '/api/webinars/not-an-id', undefined],
    ['webinar id before body', 'PUT', '/api/webinars/0/master', validMaster],
    ['slide id on save', 'PUT', '/api/webinars/2/slides/not-a-uuid', validSlide],
    ['slide id on archive', 'DELETE', '/api/webinars/2/slides/not-a-uuid', { expectedVersion: 3 }],
    ['slide id on note add', 'POST', '/api/webinars/2/slides/not-a-uuid/notes', { body: 'Note' }],
    ['duplicate source slide id', 'POST', '/api/webinars/2/slides', { expectedVersion: 3, sourceSlideId: 'not-a-uuid' }],
    ['ordered slide id', 'PUT', '/api/webinars/2/slides/order', { expectedVersion: 3, slideIds: ['not-a-uuid'] }],
    ['revision id', 'POST', '/api/webinars/2/history/not-an-id/restore', { expectedVersion: 3 }],
    ['note id on update', 'PUT', '/api/webinars/2/notes/not-an-id', { body: 'Note' }],
    ['note id on delete', 'DELETE', '/api/webinars/2/notes/0', undefined],
    ['create body', 'POST', '/api/webinars', { slug: 'Invalid Slug', title: '', primaryOwnerUserId: 0 }],
    ['master body', 'PUT', '/api/webinars/2/master', { expectedVersion: -1, masterHtml: 'missing token' }],
    ['add-slide body', 'POST', '/api/webinars/2/slides', { expectedVersion: 3, title: 'Missing fields' }],
    ['save-slide body', 'PUT', `/api/webinars/2/slides/${slideId}`, { ...validSlide, unexpected: 'secret' }],
    ['archive-slide body', 'DELETE', `/api/webinars/2/slides/${slideId}`, { expectedVersion: -1 }],
    ['restore body', 'POST', '/api/webinars/2/history/11/restore', { expectedVersion: -1 }],
    ['owner body', 'PUT', '/api/webinars/2/owner', { primaryOwnerUserId: 0 }],
    ['audience body', 'PUT', '/api/webinars/2/audience-access', { enabled: 'yes' }],
    ['add-note body', 'POST', `/api/webinars/2/slides/${slideId}/notes`, { body: '' }],
    ['update-note body', 'PUT', '/api/webinars/2/notes/5', { body: '', userId: 999 }],
  ])('rejects malformed %s before dispatching a domain service', async (_label, method, path, body) => {
    const user = path === '/api/webinars' ? identity(1, 'admin') : identity(7);
    const response = await request(method, path, body, user);
    expect(response.status).toBe(400);
    expect(allServiceMocks(services).every(mock => mock.mock.calls.length === 0)).toBe(true);
  });

  it('derives actor and current-user note identities from authentication and rejects payload identity fields', async () => {
    const mutation = await request('PUT', '/api/webinars/2/master', {
      ...validMaster,
      actorUserId: 999,
      actorIsAdmin: true,
    }, identity(42));
    expect(mutation.status).toBe(400);
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();

    vi.clearAllMocks();
    services.repository.getPrivateDocument.mockResolvedValue({ ...webinar, primaryOwnerUserId: 42 });
    await request('POST', `/api/webinars/2/slides/${slideId}/notes`, { body: 'Mine' }, identity(42));
    expect(services.notes.addNote).toHaveBeenCalledWith({
      userId: 42, actorIsAdmin: false, webinarId: 2, slideId, body: 'Mine',
    });
  });

  it.each([
    ['unauthenticated request', null, 401],
    ['unmapped authenticated identity', { sub: 'cognito-only', groups: ['user'] }, 401],
    ['inactive mapped identity', { db: { id: 7, role: 'user', is_active: 0 }, groups: ['user'] }, 403],
    ['external mapped identity', { db: { id: 7, role: 'external', is_active: 1 }, groups: ['external'] }, 403],
  ])('runs the production list-route mapped/active/internal gate for %s', async (_label, user, status) => {
    const response = await request('GET', '/api/webinars', undefined, user);
    expect(response.status).toBe(status);
    expect(allServiceMocks(services).every(mock => mock.mock.calls.length === 0)).toBe(true);
  });

  it.each(approvedRouteContracts())('masks an unexpected $label dependency error through the production boundary', async (contract) => {
    contract.target().mockRejectedValueOnce(Object.assign(
      new Error('ER_ACCESS_DENIED password=secret source=<script>'),
      { code: 'VERSION_CONFLICT', status: 409 },
    ));

    const response = await request(
      contract.method,
      contract.path,
      contract.body,
      contract.user || identity(7),
    );

    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
    const record = {
      event: 'webinar.database_failure',
      actorUserId: 7,
      statusCode: 500,
      reasonCode: 'DATABASE_FAILURE',
    };
    if (contract.path.includes('/api/webinars/2')) record.webinarId = 2;
    expectOneOperationalRecord(record);
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/ER_ACCESS_DENIED|VERSION_CONFLICT|password|script/);
  });
});

describe('archived and current-user 404 route contracts', () => {
  it.each([
    ['private read', 'GET', '/api/webinars/2', undefined, identity(7), 7],
    ['owner mutation', 'PUT', '/api/webinars/2/master', validMaster, identity(7), 7],
    ['admin archive mutation', 'DELETE', '/api/webinars/2', undefined, identity(1, 'admin'), 1],
  ])('returns the safe archived-webinar response before %s dispatch', async (_label, method, path, body, user, actorUserId) => {
    services.repository.getPrivateDocument.mockResolvedValueOnce(null);

    const response = await request(method, path, body, user);

    expect(response).toEqual({
      status: 404,
      body: { error: 'Webinar not found', code: 'WEBINAR_NOT_FOUND' },
    });
    expect(services.repository.getPrivateDocument.mock.calls).toEqual([[2]]);
    expect([
      ...Object.values(services.revisions),
      ...Object.values(services.mutations),
      ...Object.values(services.notes),
    ].every(mock => mock.mock.calls.length === 0)).toBe(true);
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', webinarId: 2, actorUserId,
      statusCode: 404, reasonCode: 'WEBINAR_NOT_FOUND',
    });
  });

  it.each([
    {
      label: 'duplicate source', method: 'POST', path: '/api/webinars/2/slides',
      body: { expectedVersion: 3, sourceSlideId: slideId },
      target: () => services.mutations.duplicateSlide,
      error: () => new WebinarMutationError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 }),
      args: { webinarId: 2, actorUserId: 7, actorIsAdmin: false, expectedVersion: 3, sourceSlideId: slideId },
    },
    {
      label: 'save', method: 'PUT', path: `/api/webinars/2/slides/${slideId}`,
      body: validSlide, target: () => services.mutations.saveSlide,
      error: () => new WebinarMutationError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 }),
      args: { webinarId: 2, actorUserId: 7, actorIsAdmin: false, ...validSlide, slideId },
    },
    {
      label: 'archive', method: 'DELETE', path: `/api/webinars/2/slides/${slideId}`,
      body: { expectedVersion: 3 }, target: () => services.mutations.archiveSlide,
      error: () => new WebinarMutationError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 }),
      args: { webinarId: 2, actorUserId: 7, actorIsAdmin: false, expectedVersion: 3, slideId },
    },
    {
      label: 'private-note add', method: 'POST', path: `/api/webinars/2/slides/${slideId}/notes`,
      body: { body: 'Private note' }, target: () => services.notes.addNote,
      error: () => new WebinarNoteError('SLIDE_NOT_FOUND', 'Slide not found', { status: 404 }),
      args: { userId: 7, actorIsAdmin: false, webinarId: 2, slideId, body: 'Private note' },
    },
  ])('returns the same safe 404 for a missing or archived slide on $label', async ({ method, path, body, target, error, args }) => {
    target().mockRejectedValueOnce(error());

    const response = await request(method, path, body);

    expect(response).toEqual({
      status: 404,
      body: { error: 'Slide not found', code: 'SLIDE_NOT_FOUND' },
    });
    expect(target().mock.calls).toEqual([[args]]);
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', webinarId: 2, actorUserId: 7,
      statusCode: 404, reasonCode: 'SLIDE_NOT_FOUND',
    });
  });

  it.each([
    ['missing note on update', 'PUT', { body: 'Updated note' }, () => services.notes.updateNote,
      { userId: 42, actorIsAdmin: false, webinarId: 2, noteId: 77, body: 'Updated note' }],
    ['another user\'s note on update', 'PUT', { body: 'Updated note' }, () => services.notes.updateNote,
      { userId: 42, actorIsAdmin: false, webinarId: 2, noteId: 77, body: 'Updated note' }],
    ['missing note on delete', 'DELETE', undefined, () => services.notes.deleteNote,
      { userId: 42, actorIsAdmin: false, webinarId: 2, noteId: 77 }],
    ['another user\'s note on delete', 'DELETE', undefined, () => services.notes.deleteNote,
      { userId: 42, actorIsAdmin: false, webinarId: 2, noteId: 77 }],
  ])('keeps %s indistinguishable and dispatches exact current-user identity', async (_label, method, body, target, args) => {
    services.repository.getPrivateDocument.mockResolvedValueOnce({
      ...webinar,
      primaryOwnerUserId: 42,
    });
    target().mockRejectedValueOnce(new WebinarNoteError(
      'NOTE_NOT_FOUND',
      'Note not found',
      { status: 404 },
    ));

    const response = await request(method, '/api/webinars/2/notes/77', body, identity(42));

    expect(response).toEqual({
      status: 404,
      body: { error: 'Note not found', code: 'NOTE_NOT_FOUND' },
    });
    expect(target().mock.calls).toEqual([[args]]);
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', webinarId: 2, actorUserId: 42,
      statusCode: 404, reasonCode: 'NOTE_NOT_FOUND',
    });
  });
});

describe('exact post-filter operational reason codes', () => {
  it('records the exact admin-only denial code once', async () => {
    const response = await request('PUT', '/api/webinars/2/owner', { primaryOwnerUserId: 8 });
    expect(response).toMatchObject({ status: 403, body: { code: 'ADMIN_ACCESS_REQUIRED' } });
    expectOneOperationalRecord({
      event: 'webinar.authorization_denied', webinarId: 2, actorUserId: 7,
      statusCode: 403, reasonCode: 'ADMIN_ACCESS_REQUIRED',
    });
  });

  it('records the exact owner denial code once', async () => {
    const response = await request('PUT', '/api/webinars/2/master', validMaster, identity(8));
    expect(response).toMatchObject({ status: 403, body: { code: 'WEBINAR_ACCESS_DENIED' } });
    expectOneOperationalRecord({
      event: 'webinar.authorization_denied', webinarId: 2, actorUserId: 8,
      statusCode: 403, reasonCode: 'WEBINAR_ACCESS_DENIED',
    });
  });

  it.each([
    ['route validation', 'VALIDATION_FAILED', () => request('PUT', '/api/webinars/2/master', { expectedVersion: -1 })],
    ['anchor conflict', 'ANCHOR_CONFLICT', () => {
      services.mutations.saveSlide.mockRejectedValueOnce(new WebinarMutationError(
        'ANCHOR_CONFLICT', 'Anchor already exists', { status: 409 },
      ));
      return request('PUT', `/api/webinars/2/slides/${slideId}`, validSlide);
    }],
    ['restore ownership conflict', 'RESTORE_SLIDE_OWNERSHIP_CONFLICT', () => {
      services.mutations.restoreRevision.mockRejectedValueOnce(new WebinarMutationError(
        'RESTORE_SLIDE_OWNERSHIP_CONFLICT',
        'Restore slide belongs to another webinar',
        { status: 409 },
      ));
      return request('POST', '/api/webinars/2/history/11/restore', { expectedVersion: 3 });
    }],
    ['restore policy incompatibility', 'REVISION_POLICY_INCOMPATIBLE', () => {
      services.mutations.restoreRevision.mockRejectedValueOnce(new WebinarMutationError(
        'REVISION_POLICY_INCOMPATIBLE',
        'Revision cannot be restored under the current security policy',
        { status: 409 },
      ));
      return request('POST', '/api/webinars/2/history/11/restore', { expectedVersion: 3 });
    }],
    ['controlled content validation', 'CONTENT_VALIDATION_FAILED', () => {
      services.mutations.saveMaster.mockRejectedValueOnce(new WebinarMutationError(
        'CONTENT_VALIDATION_FAILED',
        'Content failed validation',
        { status: 400, issues: [{ code: 'FORBIDDEN_HTML', surface: 'master_html' }] },
      ));
      return request('PUT', '/api/webinars/2/master', validMaster);
    }],
    ['note validation', 'NOTE_BODY_TOO_LONG', () => {
      services.notes.updateNote.mockRejectedValueOnce(new WebinarNoteError(
        'NOTE_BODY_TOO_LONG',
        'Note body exceeds 10,000 bytes',
        { status: 400 },
      ));
      return request('PUT', '/api/webinars/2/notes/5', { body: 'Private note' });
    }],
  ])('retains the exact %s code in the final logger record', async (_label, reasonCode, run) => {
    await run();
    expect(operationalLogger.info).toHaveBeenCalledTimes(1);
    expect(operationalLogger.info.mock.calls[0][0]).toMatchObject({ reasonCode });
  });

  it('preserves the controlled version-conflict response metadata and exact final code', async () => {
    services.mutations.saveMaster.mockRejectedValueOnce(new WebinarMutationError(
      'VERSION_CONFLICT',
      'Webinar has changed',
      {
        status: 409,
        currentVersion: 4,
        updatedAt: '2026-09-03T10:01:00.000Z',
        updatedBy: { id: 8, name: 'Another Editor' },
      },
    ));

    const response = await request('PUT', '/api/webinars/2/master', validMaster);

    expect(response).toEqual({
      status: 409,
      body: {
        error: 'Webinar has changed',
        code: 'VERSION_CONFLICT',
        currentVersion: 4,
        updatedAt: '2026-09-03T10:01:00.000Z',
        updatedBy: { id: 8, name: 'Another Editor' },
      },
    });
    expectOneOperationalRecord({
      event: 'webinar.version_conflict',
      webinarId: 2,
      actorUserId: 7,
      statusCode: 409,
      reasonCode: 'VERSION_CONFLICT',
    });
  });

  it('classifies unexpected database failures without raw codes, messages, bodies, or secrets', async () => {
    services.mutations.saveMaster.mockRejectedValueOnce(Object.assign(
      new Error('ER_ACCESS_DENIED password=secret source=<script>'),
      { code: 'ER_ACCESS_DENIED' },
    ));
    const response = await request('PUT', '/api/webinars/2/master', {
      ...validMaster,
      masterCss: '/* secret request body */',
    });
    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expectOneOperationalRecord({
      event: 'webinar.database_failure', webinarId: 2, actorUserId: 7,
      statusCode: 500, reasonCode: 'DATABASE_FAILURE',
    });
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/ER_ACCESS_DENIED|password|script|secret request body/);
  });

  it('does not trust a generic database error that spoofs a controlled code and status', async () => {
    services.mutations.saveMaster.mockRejectedValueOnce(Object.assign(
      new Error('password=secret source=<script>'),
      { code: 'VERSION_CONFLICT', status: 409, currentVersion: 999 },
    ));

    const response = await request('PUT', '/api/webinars/2/master', validMaster);

    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expectOneOperationalRecord({
      event: 'webinar.database_failure', webinarId: 2, actorUserId: 7,
      statusCode: 500, reasonCode: 'DATABASE_FAILURE',
    });
    expect(JSON.stringify(operationalLogger.info.mock.calls))
      .not.toMatch(/VERSION_CONFLICT|password|script|999/);
  });

  it('uses the production-safe boundary when document loading fails unexpectedly', async () => {
    services.repository.getPrivateDocument.mockRejectedValueOnce(new Error('raw database source and password'));
    const response = await request('GET', '/api/webinars/2');
    expect(response).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expectOneOperationalRecord({
      event: 'webinar.database_failure', webinarId: 2, actorUserId: 7,
      statusCode: 500, reasonCode: 'DATABASE_FAILURE',
    });
  });
});

describe('trusted asset-reference failures through the real mutation transaction', () => {
  const tokenVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const availableVersion = {
    id: tokenVersionId,
    status: 'available',
    archived_at: null,
    sha256: 'a'.repeat(64),
    s3_key: `approved/sha256/${'a'.repeat(64)}/asset`,
    family_archived_at: null,
  };

  it.each([
    {
      label: 'missing version',
      token: `{{ASSET:${tokenVersionId}}}`,
      rows: [],
      code: 'ASSET_NOT_FOUND',
      message: 'Asset version not found',
    },
    {
      label: 'processing version',
      token: `{{ASSET:${tokenVersionId}}}`,
      rows: [{
        ...availableVersion,
        status: 'processing',
        sha256: null,
        s3_key: 'quarantine/private-bucket/internal-source-name.png',
      }],
      code: 'ASSET_NOT_AVAILABLE',
      message: 'Asset version is not available',
    },
    {
      label: 'archived family',
      token: `{{ASSET:${tokenVersionId}}}`,
      rows: [{ ...availableVersion, family_archived_at: '2026-09-04T13:00:00.000Z' }],
      code: 'ASSET_NOT_AVAILABLE',
      message: 'Asset version is not available',
    },
    {
      label: 'uppercase noncanonical token',
      token: `{{ASSET:${tokenVersionId.toUpperCase()}}}`,
      rows: [availableVersion],
      code: 'ASSET_TOKEN_FORMAT',
      message: 'Asset token is invalid',
    },
  ])('returns controlled 422 and rolls back for $label', async ({ token, rows, code, message }) => {
    const { committed, connection } = await useRealAssetReferenceMutation(rows);
    const before = structuredClone(committed);

    const response = await request('PUT', '/api/webinars/2/master', {
      expectedVersion: 3,
      masterHtml: validMaster.masterHtml,
      masterCss: `.hero { background-image: url("${token}"); } /* private request source */`,
    });

    expect(response).toEqual({ status: 422, body: { error: message, code } });
    expect(committed).toEqual(before);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected',
      webinarId: 2,
      actorUserId: 7,
      statusCode: 422,
      reasonCode: code,
    });
    expect(JSON.stringify({ response, events: operationalLogger.info.mock.calls }))
      .not.toMatch(/private request source|private-bucket|internal-source-name|quarantine|password/i);
  });

  it('uses the closed response message even when a trusted reference error carries private details', async () => {
    const collectTokens = () => {
      throw new AssetReferenceError(
        'ASSET_NOT_FOUND',
        'private bucket password and source body',
        422,
      );
    };
    const { connection } = await useRealAssetReferenceMutation([], { collectTokens });

    const response = await request('PUT', '/api/webinars/2/master', {
      ...validMaster,
      masterCss: `body { background: url("{{ASSET:${tokenVersionId}}}"); }`,
    });

    expect(response).toEqual({
      status: 422,
      body: { error: 'Asset version not found', code: 'ASSET_NOT_FOUND' },
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(JSON.stringify({ response, events: operationalLogger.info.mock.calls }))
      .not.toMatch(/private|bucket|password|source body/i);
  });
});

describe('production transport and limiter contract', () => {
  it.each([
    ['anonymous callers', null, 401],
    ['unmapped callers', { sub: 'cognito-only', groups: ['user'] }, 401],
    ['inactive callers', { db: { id: 7, role: 'user', is_active: 0 }, groups: ['user'] }, 403],
    ['external callers', identity(7, 'external'), 403],
  ])('rate limits repeated %s by IP before authentication and body parsing', async (_label, user, rejectedStatus) => {
    await new Promise(resolve => server.close(resolve));
    const app = createApp({
      webinarAuthenticate: authenticateFromHeader,
      webinarServices: services,
      webinarOperationalLogger: operationalLogger,
      webinarIpWriteLimit: 2,
      webinarWriteLimit: 100,
    });
    server = await new Promise(resolve => {
      const listener = app.listen(0, () => resolve(listener));
    });

    const statuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push((await request('PUT', '/api/webinars/2/master', validMaster, user)).status);
    }
    expect(statuses).toEqual([rejectedStatus, rejectedStatus, 429]);
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();
  });

  it('records declared 413 rejections exactly once after filtering', async () => {
    const response = await request(
      'POST',
      '/api/webinars',
      { source: 'x'.repeat(2 * 1024 * 1024) },
      identity(1, 'admin'),
    );
    expect(response).toMatchObject({ status: 413, body: { code: 'CONTENT_LIMIT_EXCEEDED' } });
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', statusCode: 413,
      reasonCode: 'CONTENT_LIMIT_EXCEEDED',
    });
  }, 30000);

  it('records streamed 413 rejections exactly once after filtering', async () => {
    const response = await rawRequest(
      'PUT',
      '/api/webinars/2/master',
      'x'.repeat(2 * 1024 * 1024 + 1),
      {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        'x-test-user': JSON.stringify(identity(7)),
      },
    );
    expect(response).toMatchObject({ status: 413, body: { code: 'CONTENT_LIMIT_EXCEEDED' } });
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', statusCode: 413,
      reasonCode: 'CONTENT_LIMIT_EXCEEDED',
    });
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();
  }, 30000);

  it('accepts an exact raw 2 MiB mutation at transport and rejects 2 MiB plus one byte', async () => {
    const prefix = '{"expectedVersion":3,"masterHtml":"';
    const suffix = '","masterCss":""}';
    const exactBody = `${prefix}${'x'.repeat(
      (2 * 1024 * 1024) - Buffer.byteLength(prefix) - Buffer.byteLength(suffix),
    )}${suffix}`;
    const overBody = `${exactBody} `;
    expect(Buffer.byteLength(exactBody)).toBe(2 * 1024 * 1024);
    expect(Buffer.byteLength(overBody)).toBe((2 * 1024 * 1024) + 1);

    const exact = await rawRequest('PUT', '/api/webinars/2/master', exactBody, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(exactBody)),
      'x-test-user': JSON.stringify(identity(7)),
    });
    expect(exact).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(exact.status).not.toBe(413);
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const over = await rawRequest('PUT', '/api/webinars/2/master', overBody, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(overBody)),
      'x-test-user': JSON.stringify(identity(7)),
    });
    expect(over).toEqual({
      status: 413,
      body: { error: 'Webinar request exceeds 2 MB limit', code: 'CONTENT_LIMIT_EXCEEDED' },
    });
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', statusCode: 413,
      reasonCode: 'CONTENT_LIMIT_EXCEEDED',
    });
  }, 30000);

  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects an oversized chunked %s stream before route service dispatch',
    async (contentType) => {
      const response = await rawRequest(
        'PUT',
        '/api/webinars/2/master',
        'x'.repeat((2 * 1024 * 1024) + 1),
        {
          'content-type': contentType,
          'transfer-encoding': 'chunked',
          'x-test-user': JSON.stringify(identity(7)),
        },
      );
      expect(response).toEqual({
        status: 413,
        body: { error: 'Webinar request exceeds 2 MB limit', code: 'CONTENT_LIMIT_EXCEEDED' },
      });
      expect(services.mutations.saveMaster).not.toHaveBeenCalled();
      expectOneOperationalRecord({
        event: 'webinar.validation_rejected', statusCode: 413,
        reasonCode: 'CONTENT_LIMIT_EXCEEDED',
      });
    },
    30000,
  );

  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'records under-limit unsupported %s media with its structured non-413 response',
    async (contentType) => {
      const response = await rawRequest('PUT', '/api/webinars/2/master', 'not json', {
        'content-type': contentType,
        'transfer-encoding': 'chunked',
        'x-test-user': JSON.stringify(identity(7)),
      });
      expect(response).toEqual({
        status: 400,
        body: { error: 'Unsupported media type', code: 'UNSUPPORTED_MEDIA_TYPE' },
      });
      expect(response.status).not.toBe(413);
      expect(services.mutations.saveMaster).not.toHaveBeenCalled();
      expectOneOperationalRecord({
        event: 'webinar.validation_rejected', statusCode: 400,
        reasonCode: 'UNSUPPORTED_MEDIA_TYPE',
      });
    },
  );

  it('records malformed JSON with its exact code and never dispatches a route', async () => {
    const response = await rawRequest('PUT', '/api/webinars/2/master', '{not-json', {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
      'x-test-user': JSON.stringify(identity(7)),
    });
    expect(response).toMatchObject({ status: 400, body: { code: 'MALFORMED_JSON' } });
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', statusCode: 400,
      reasonCode: 'MALFORMED_JSON',
    });
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();
  });

  it('uses the real identity limiter, skips safe methods, and resets its store with each app', async () => {
    await new Promise(resolve => server.close(resolve));
    const app = createApp({
      webinarAuthenticate: authenticateFromHeader,
      webinarServices: services,
      webinarOperationalLogger: operationalLogger,
      webinarWriteLimit: 2,
    });
    server = await new Promise(resolve => {
      const listener = app.listen(0, () => resolve(listener));
    });

    expect((await request('PUT', '/api/webinars/2/master', validMaster, identity(7))).status).toBe(200);
    expect((await request('PUT', '/api/webinars/2/master', validMaster, identity(7))).status).toBe(200);
    expect((await request('PUT', '/api/webinars/2/master', validMaster, identity(7))).status).toBe(429);
    expect((await request('PUT', '/api/webinars/2/master', validMaster, identity(1, 'admin'))).status).toBe(200);
    expect((await request('GET', '/api/webinars/2', undefined, identity(7))).status).toBe(200);
    expect((await request('HEAD', '/api/webinars/2', undefined, identity(7))).status).toBe(200);
    expect((await request('OPTIONS', '/api/webinars/2', undefined, identity(7))).status).not.toBe(429);
  });

  it('does not let the general 200-write limiter shadow webinar identity writes', async () => {
    for (let count = 0; count < 201; count += 1) {
      const response = await request('PUT', '/api/webinars/2/master', validMaster, identity(7));
      expect(response.status).toBe(200);
    }
  }, 30000);

  it('keeps the raw transport boundary scoped away from unrelated routes', async () => {
    const oversized = { source: 'x'.repeat(2 * 1024 * 1024) };
    expect((await request('POST', '/api/unrelated', oversized)).status).toBe(404);
  }, 30000);
});
