import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
const { WebinarMutationError } = require('../../services/webinars/mutations');
const { WebinarNoteError } = require('../../services/webinars/notes');

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
  const headers = { 'x-test-user': JSON.stringify(user), ...extraHeaders };
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

describe('private webinar API through the production application factory', () => {
  it.each([
    {
      label: 'list', method: 'GET', path: '/api/webinars', status: 200,
      target: () => services.repository.listForRequest,
      assertArgs: (call) => {
        expect(call).toHaveLength(1);
        expect(call[0].user).toEqual(identity(7));
      },
    },
    {
      label: 'get', method: 'GET', path: '/api/webinars/2', status: 200,
      target: () => services.repository.getPrivateDocument, args: [2],
    },
    {
      label: 'create', method: 'POST', path: '/api/webinars', status: 201, user: identity(7, 'admin'),
      body: { slug: 'intro', title: 'Intro', primaryOwnerUserId: 8 },
      target: () => services.mutations.createWebinar,
      args: [{ slug: 'intro', title: 'Intro', primaryOwnerUserId: 8, actorUserId: 7 }],
    },
    {
      label: 'save master', method: 'PUT', path: '/api/webinars/2/master', status: 200, body: validMaster,
      target: () => services.mutations.saveMaster,
      args: [{ webinarId: 2, actorUserId: 7, ...validMaster }],
    },
    {
      label: 'add slide', method: 'POST', path: '/api/webinars/2/slides', status: 201, body: validSlide,
      target: () => services.mutations.addSlide,
      args: [{ webinarId: 2, actorUserId: 7, ...validSlide }],
    },
    {
      label: 'duplicate slide', method: 'POST', path: '/api/webinars/2/slides', status: 201,
      body: { expectedVersion: 3, sourceSlideId: slideId },
      target: () => services.mutations.duplicateSlide,
      args: [{ webinarId: 2, actorUserId: 7, expectedVersion: 3, sourceSlideId: slideId }],
    },
    {
      label: 'save slide', method: 'PUT', path: `/api/webinars/2/slides/${slideId}`, status: 200, body: validSlide,
      target: () => services.mutations.saveSlide,
      args: [{ webinarId: 2, actorUserId: 7, ...validSlide, slideId }],
    },
    {
      label: 'reorder slides', method: 'PUT', path: '/api/webinars/2/slides/order', status: 200,
      body: { expectedVersion: 3, slideIds: [secondSlideId, slideId] },
      target: () => services.mutations.reorderSlides,
      args: [{ webinarId: 2, actorUserId: 7, expectedVersion: 3, slideIds: [secondSlideId, slideId] }],
    },
    {
      label: 'archive slide', method: 'DELETE', path: `/api/webinars/2/slides/${slideId}`, status: 200,
      body: { expectedVersion: 3 }, target: () => services.mutations.archiveSlide,
      args: [{ webinarId: 2, actorUserId: 7, expectedVersion: 3, slideId }],
    },
    {
      label: 'history', method: 'GET', path: '/api/webinars/2/history', status: 200,
      target: () => services.revisions.listHistory, args: [2],
    },
    {
      label: 'restore', method: 'POST', path: '/api/webinars/2/history/11/restore', status: 200,
      body: { expectedVersion: 3 }, target: () => services.mutations.restoreRevision,
      args: [{ webinarId: 2, actorUserId: 7, expectedVersion: 3, revisionId: 11 }],
    },
    {
      label: 'change owner', method: 'PUT', path: '/api/webinars/2/owner', status: 200, user: identity(7, 'admin'),
      body: { primaryOwnerUserId: 8 }, target: () => services.mutations.changeOwner,
      args: [{ webinarId: 2, actorUserId: 7, primaryOwnerUserId: 8 }],
    },
    {
      label: 'change audience', method: 'PUT', path: '/api/webinars/2/audience-access', status: 200, user: identity(7, 'admin'),
      body: { enabled: true }, target: () => services.mutations.changeAudienceAccess,
      args: [{ webinarId: 2, actorUserId: 7, enabled: true }],
    },
    {
      label: 'archive webinar', method: 'DELETE', path: '/api/webinars/2', status: 200, user: identity(7, 'admin'),
      target: () => services.mutations.archiveWebinar,
      args: [{ webinarId: 2, actorUserId: 7 }],
    },
    {
      label: 'list notes', method: 'GET', path: '/api/webinars/2/notes', status: 200,
      target: () => services.notes.listNotes, args: [{ userId: 7, webinarId: 2 }],
    },
    {
      label: 'add note', method: 'POST', path: `/api/webinars/2/slides/${slideId}/notes`, status: 201,
      body: { body: 'Private note' }, target: () => services.notes.addNote,
      args: [{ userId: 7, webinarId: 2, slideId, body: 'Private note' }],
    },
    {
      label: 'update note', method: 'PUT', path: '/api/webinars/2/notes/5', status: 200,
      body: { body: 'Updated note' }, target: () => services.notes.updateNote,
      args: [{ userId: 7, webinarId: 2, noteId: 5, body: 'Updated note' }],
    },
    {
      label: 'delete note', method: 'DELETE', path: '/api/webinars/2/notes/5', status: 204,
      target: () => services.notes.deleteNote, args: [{ userId: 7, webinarId: 2, noteId: 5 }],
    },
  ])('dispatches the exact $label service contract', async ({ method, path, body, status, user, target, args, assertArgs }) => {
    const response = await request(method, path, body, user || identity(7));
    expect(response.status).toBe(status);
    const service = target();
    expect(service).toHaveBeenCalledTimes(1);
    if (assertArgs) assertArgs(service.mock.calls[0]);
    else expect(service.mock.calls[0]).toEqual(args);
  });

  it.each([
    ['get', 'GET', '/api/webinars/2', undefined, false],
    ['save master', 'PUT', '/api/webinars/2/master', validMaster, false],
    ['add slide', 'POST', '/api/webinars/2/slides', validSlide, false],
    ['duplicate slide', 'POST', '/api/webinars/2/slides', { expectedVersion: 3, sourceSlideId: slideId }, false],
    ['save slide', 'PUT', `/api/webinars/2/slides/${slideId}`, validSlide, false],
    ['reorder slides', 'PUT', '/api/webinars/2/slides/order', { expectedVersion: 3, slideIds: [slideId] }, false],
    ['archive slide', 'DELETE', `/api/webinars/2/slides/${slideId}`, { expectedVersion: 3 }, false],
    ['history', 'GET', '/api/webinars/2/history', undefined, false],
    ['restore', 'POST', '/api/webinars/2/history/11/restore', { expectedVersion: 3 }, false],
    ['change owner', 'PUT', '/api/webinars/2/owner', { primaryOwnerUserId: 8 }, true],
    ['change audience', 'PUT', '/api/webinars/2/audience-access', { enabled: true }, true],
    ['archive webinar', 'DELETE', '/api/webinars/2', undefined, true],
    ['list notes', 'GET', '/api/webinars/2/notes', undefined, false],
    ['add note', 'POST', `/api/webinars/2/slides/${slideId}/notes`, { body: 'Private note' }, false],
    ['update note', 'PUT', '/api/webinars/2/notes/5', { body: 'Updated note' }, false],
    ['delete note', 'DELETE', '/api/webinars/2/notes/5', undefined, false],
  ])('enforces owner/admin/other authorization for %s', async (_label, method, path, body, adminOnly) => {
    const ownerSuccess = method === 'POST' && (path.endsWith('/slides') || path.endsWith('/notes'))
      ? 201
      : method === 'DELETE' && path.endsWith('/notes/5') ? 204 : 200;
    const roles = [
      ['owner', identity(7), adminOnly ? 403 : ownerSuccess],
      ['admin', identity(1, 'admin'), ownerSuccess],
      ['other', identity(8), 403],
    ];
    for (const [_role, user, expectedStatus] of roles) {
      vi.clearAllMocks();
      const response = await request(method, path, body, user);
      expect(response.status).toBe(expectedStatus);
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

  it.each([
    ['owner', identity(7), 403],
    ['admin', identity(1, 'admin'), 201],
    ['other', identity(8), 403],
  ])('keeps webinar creation admin-only for %s', async (_label, user, status) => {
    const response = await request('POST', '/api/webinars', {
      slug: 'new-webinar', title: 'New Webinar', primaryOwnerUserId: 7,
    }, user);
    expect(response.status).toBe(status);
    expect(services.mutations.createWebinar).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
  });

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
    }, identity(42));
    expect(mutation.status).toBe(400);
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();

    vi.clearAllMocks();
    services.repository.getPrivateDocument.mockResolvedValue({ ...webinar, primaryOwnerUserId: 42 });
    await request('POST', `/api/webinars/2/slides/${slideId}/notes`, { body: 'Mine' }, identity(42));
    expect(services.notes.addNote).toHaveBeenCalledWith({
      userId: 42, webinarId: 2, slideId, body: 'Mine',
    });
  });

  it.each([
    ['absent mapped identity', {}, 401],
    ['inactive mapped identity', { db: { id: 7, role: 'user', is_active: 0 }, groups: ['user'] }, 403],
    ['external mapped identity', { db: { id: 7, role: 'external', is_active: 1 }, groups: ['external'] }, 403],
  ])('runs the production mapped/active/internal gates for %s', async (_label, user, status) => {
    const response = await request('PUT', '/api/webinars/2/master', validMaster, user);
    expect(response.status).toBe(status);
    expect(allServiceMocks(services).every(mock => mock.mock.calls.length === 0)).toBe(true);
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

describe('production transport and limiter contract', () => {
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

  it('records unsupported media with its exact code and never dispatches a route', async () => {
    const response = await rawRequest('PUT', '/api/webinars/2/master', 'not json', {
      'content-type': 'text/plain',
      'transfer-encoding': 'chunked',
      'x-test-user': JSON.stringify(identity(7)),
    });
    expect(response).toMatchObject({ status: 400, body: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
    expectOneOperationalRecord({
      event: 'webinar.validation_rejected', statusCode: 400,
      reasonCode: 'UNSUPPORTED_MEDIA_TYPE',
    });
    expect(services.mutations.saveMaster).not.toHaveBeenCalled();
  });

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
