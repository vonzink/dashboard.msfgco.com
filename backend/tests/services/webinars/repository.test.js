import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../../db/connection');
const repositoryPath = path.resolve(import.meta.dirname, '../../../services/webinars/repository.js');
const originalDb = require.cache[dbPath];
const db = { query: vi.fn() };

function requestFor(user) {
  return {
    headers: {},
    user: { db: user, groups: [user.role] },
  };
}

function loadRepository() {
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  delete require.cache[repositoryPath];
  return require(repositoryPath);
}

beforeEach(() => {
  db.query.mockReset();
});

afterEach(() => {
  delete require.cache[repositoryPath];
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
});

describe('Webinar Studio repository', () => {
  it('lists only a primary owner’s active webinars through a parameterized query', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: 14,
        slug: 'homebuyer-basics',
        title: 'Homebuyer Basics',
        primary_owner_user_id: 7,
        live_version: 3,
        audience_enabled: 1,
      },
    ]]);

    const { listForRequest } = loadRepository();
    await expect(listForRequest(requestFor({ id: 7, role: 'user' }))).resolves.toEqual([{
      id: 14,
      slug: 'homebuyer-basics',
      title: 'Homebuyer Basics',
      primaryOwnerUserId: 7,
      liveVersion: 3,
      audienceEnabled: true,
    }]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('primary_owner_user_id = ?'), [7]);
  });

  it('lists every active webinar for an administrator without an owner predicate', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const { listForRequest } = loadRepository();
    await expect(listForRequest(requestFor({ id: 1, role: 'admin' }))).resolves.toEqual([]);
    expect(db.query).toHaveBeenLastCalledWith(expect.not.stringContaining('primary_owner_user_id = ?'), []);
  });

  it('maps a private document with ordered active slides and no private side-table reads', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          id: 14,
          slug: 'homebuyer-basics',
          title: 'Homebuyer Basics',
          primary_owner_user_id: 7,
          master_html: '<main>{{SLIDE_CONTENT}}</main>',
          master_css: 'main { color: navy; }',
          live_version: 3,
          audience_enabled: 1,
        },
      ]])
      .mockResolvedValueOnce([[
        {
          id: '11111111-1111-4111-8111-111111111111',
          anchor: 'welcome',
          title: 'Welcome',
          target_seconds: 45,
          speaker_notes: 'Open with the agenda.',
          html: '<section>Welcome</section>',
          css: '.slide { color: blue; }',
          javascript: 'window.slideReady = true;',
        },
      ]]);

    const { getPrivateDocument } = loadRepository();
    const document = await getPrivateDocument(14);
    expect(document).toEqual(expect.objectContaining({
      id: 14,
      slug: 'homebuyer-basics',
      title: 'Homebuyer Basics',
      primaryOwnerUserId: 7,
      liveVersion: 3,
      audienceEnabled: true,
      masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
      masterCss: 'main { color: navy; }',
      resourcePolicy: expect.objectContaining({
        stylesheetOrigins: expect.any(Array),
        fontOrigins: expect.any(Array),
      }),
      slides: [{
        id: '11111111-1111-4111-8111-111111111111',
        anchor: 'welcome',
        title: 'Welcome',
        targetSeconds: 45,
        speakerNotes: 'Open with the agenda.',
        html: '<section>Welcome</section>',
        css: '.slide { color: blue; }',
        javascript: 'window.slideReady = true;',
      }],
    }));
    expect(document.resourcePolicy).toHaveProperty('assetOrigin');

    const sql = db.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('archived_at IS NULL');
    expect(sql).toContain('ORDER BY position ASC');
    expect(sql).not.toContain('webinar_presenter_notes');
    expect(sql).not.toContain('webinar_presenter_settings');
    expect(sql).not.toContain('webinar_audit_events');
    expect(db.query).toHaveBeenNthCalledWith(1, expect.any(String), [14]);
    expect(db.query).toHaveBeenNthCalledWith(2, expect.any(String), [14]);
  });

  it('returns only the ordered public slide allow-list for an enabled webinar', async () => {
    db.query.mockResolvedValueOnce([[
      {
        id: '11111111-1111-4111-8111-111111111111',
        anchor: 'welcome',
        title: 'Welcome',
        html: '<section>Welcome</section>',
        css: '.slide { color: blue; }',
        javascript: 'window.slideReady = true;',
        speaker_notes: 'This must not be public.',
      },
    ]]);

    const { getLiveSlides } = loadRepository();
    await expect(getLiveSlides(14)).resolves.toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      anchor: 'welcome',
      title: 'Welcome',
      html: '<section>Welcome</section>',
      css: '.slide { color: blue; }',
      javascript: 'window.slideReady = true;',
    }]);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('audience_enabled = 1');
    expect(sql).toContain('archived_at IS NULL');
    expect(sql).toContain('ORDER BY s.position ASC');
    expect(sql).not.toContain('speaker_notes');
    expect(params).toEqual([14]);
  });
});
