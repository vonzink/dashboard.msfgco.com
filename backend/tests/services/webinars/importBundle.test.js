import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createImportService, ImportError } = require('../../../services/webinars/importBundle');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0C3335"/></svg>');
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNg+M/wHwAF/gL+Zl9+gAAAAABJRU5ErkJggg==', 'base64');
const SLIDE_ONE = '11111111-1111-5111-8111-111111111111';
const SLIDE_TWO = '22222222-2222-5222-8222-222222222222';
const LOGO_VERSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHOTO_VERSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const POLICY_ENV = {
  WEBINAR_ASSET_CDN_BASE_URL: 'https://webinar-assets.example',
  WEBINAR_EXTERNAL_STYLE_ORIGINS: 'https://fonts.googleapis.com',
  WEBINAR_EXTERNAL_FONT_ORIGINS: 'https://fonts.gstatic.com',
};

function bundle(overrides = {}) {
  return {
    schemaVersion: 1,
    webinar: { slug: 'first-home', title: 'Your first home' },
    master: {
      html: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat"><div class="slide-scaler">{{SLIDE_CONTENT}}</div>',
      css: '.slide { color: navy; }',
    },
    slides: [
      { id: SLIDE_ONE, position: 0, anchor: 'opening', title: 'Opening', targetSeconds: 120, speakerNotes: 'Welcome.', html: '<section class="slide"><img src="{{LOCAL_ASSET:brand-logo-svg}}" alt="Logo"></section>', css: '', javascript: 'window.ready = true;' },
      { id: SLIDE_TWO, position: 1, anchor: 'wrap', title: 'Wrap', targetSeconds: 90, speakerNotes: 'Thanks.', html: '<section class="slide"><img src="{{LOCAL_ASSET:portraits-seth-png}}" alt=""></section>', css: '', javascript: 'const logo = "{{LOCAL_ASSET:brand-logo-svg}}";' },
    ],
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    slug: 'first-home',
    root: 'first-home/deck',
    assets: [
      { key: 'brand-logo-svg', path: 'assets/brand/logo.svg', mimeType: 'image/svg+xml', byteSize: LOGO.length, sha256: sha256(LOGO), usedBy: ['opening.html', 'wrap.javascript'] },
      { key: 'portraits-seth-png', path: 'assets/portraits/seth.png', mimeType: 'image/png', byteSize: PHOTO.length, sha256: sha256(PHOTO), usedBy: ['wrap.html'] },
    ],
    ...overrides,
  };
}

/* An in-memory stand-in for the three things the importer reads from MySQL:
   active users, existing webinars, and available asset versions. */
function fakeDatabase({ users, slugs = [], available = {} } = {}) {
  const rows = users || [
    { id: 7, email: 'seth.angell@msfg.us', name: 'Seth Angell', role: 'user' },
    { id: 1, email: 'zachary.zink@msfg.us', name: 'Zachary Zink', role: 'admin' },
  ];
  const query = vi.fn(async (sql, params = []) => {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) throw new Error(`importer must not write directly: ${sql}`);
    if (sql.includes('FROM users')) return [rows.filter(row => row.email.toLowerCase() === String(params[0]).toLowerCase())];
    if (sql.includes('FROM webinar_presentations')) return [slugs.includes(params[0]) ? [{ id: 20 }] : []];
    if (sql.includes('FROM webinar_asset_versions')) return [available[params[0]] ? [{ id: available[params[0]] }] : []];
    throw new Error(`Unhandled query: ${sql}`);
  });
  return { query };
}

function fakeCatalog({ versions = [LOGO_VERSION, PHOTO_VERSION], scansBeforeAvailable = 1, reject = null } = {}) {
  const pending = new Map();
  const createUploadIntent = vi.fn(async input => {
    const versionId = versions[createUploadIntent.mock.calls.length - 1];
    pending.set(versionId, { polls: 0, filename: input.filename });
    return { assetId: `family-${versionId}`, versionId, uploadUrl: `https://uploads.example/${versionId}`, expiresInSeconds: 600 };
  });
  const confirmUpload = vi.fn(async ({ versionId }) => {
    const state = pending.get(versionId);
    state.polls += 1;
    if (state.polls <= scansBeforeAvailable) return { versionId, status: 'processing' };
    if (reject === state.filename) return { versionId, status: 'rejected', rejectionCode: 'MALWARE_DETECTED' };
    return { versionId, status: 'available', sha256: 'f'.repeat(64), publicUrl: 'https://webinar-assets.example/approved/x' };
  });
  return { createUploadIntent, confirmUpload };
}

describe('Webinar bundle importer', () => {
  let dir;
  let paths;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'webinar-import-'));
    paths = {
      bundle: path.join(dir, 'source-bundle.json'),
      assets: path.join(dir, 'asset-manifest.json'),
      assetRoot: path.join(dir, 'deck'),
      plan: path.join(dir, 'runtime', 'deck-import-plan.json'),
    };
    await mkdir(path.join(paths.assetRoot, 'assets', 'brand'), { recursive: true });
    await mkdir(path.join(paths.assetRoot, 'assets', 'portraits'), { recursive: true });
    await writeFile(path.join(paths.assetRoot, 'assets', 'brand', 'logo.svg'), LOGO);
    await writeFile(path.join(paths.assetRoot, 'assets', 'portraits', 'seth.png'), PHOTO);
    await writeFile(paths.bundle, JSON.stringify(bundle()));
    await writeFile(paths.assets, JSON.stringify(manifest()));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function setup(options = {}) {
    const db = options.db || fakeDatabase(options.database);
    const catalog = options.catalog || fakeCatalog(options.catalogOptions);
    const mutations = { importWebinar: vi.fn(async () => ({ webinarId: 20, liveVersion: 1, audienceEnabled: false, primaryOwnerUserId: 7 })) };
    const fetchImpl = options.fetchImpl || vi.fn(async () => ({ ok: true, status: 200 }));
    const service = createImportService({
      db, catalog, mutations, fetchImpl,
      env: POLICY_ENV,
      sleep: vi.fn(async () => {}),
      pollIntervalMs: 1,
      pollTimeoutMs: options.pollTimeoutMs ?? 1000,
      now: options.now,
    });
    const planInput = { bundlePath: paths.bundle, assetsPath: paths.assets, assetRoot: paths.assetRoot, ownerEmail: 'seth.angell@msfg.us', actorEmail: 'zachary.zink@msfg.us' };
    return { service, db, catalog, mutations, fetchImpl, planInput };
  }

  async function plannedAndWritten(context) {
    const planned = await context.service.planImport(context.planInput);
    await mkdir(path.dirname(paths.plan), { recursive: true });
    await writeFile(paths.plan, planned.planJson);
    return planned;
  }

  describe('planImport', () => {
    it('summarises the import, binds it to a hash, and writes nothing', async () => {
      const context = setup();
      const { plan, planJson, planSha256 } = await context.service.planImport(context.planInput);

      expect(plan.summary).toEqual({ slug: 'first-home', slides: 2, assets: 2, uploads: 2, reused: 0, ownerMatches: 1, actorMatches: 1, audienceEnabled: false });
      expect(plan.owner).toEqual({ email: 'seth.angell@msfg.us', userId: 7 });
      expect(plan.actor).toEqual({ email: 'zachary.zink@msfg.us', userId: 1 });
      expect(planSha256).toBe(sha256(planJson));
      expect(planSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(context.catalog.createUploadIntent).not.toHaveBeenCalled();
      expect(context.mutations.importWebinar).not.toHaveBeenCalled();
      expect(context.fetchImpl).not.toHaveBeenCalled();
    });

    it('is deterministic for the same inputs', async () => {
      const first = await setup().service.planImport(setup().planInput);
      const second = await setup().service.planImport(setup().planInput);
      expect(second.planSha256).toBe(first.planSha256);
    });

    it('never puts storage keys or upload URLs in the plan', async () => {
      const { planJson } = await setup().service.planImport(setup().planInput);
      expect(planJson).not.toMatch(/quarantine\/|approved\/|uploads\.example|s3_key|X-Amz/i);
    });

    it('records the hash the asset will have after inspection and reuses an existing version', async () => {
      const inspectedLogo = require('../../../services/webinarAssets/inspection').sanitizeSvg(LOGO);
      const context = setup({ database: { available: { [sha256(inspectedLogo)]: LOGO_VERSION } } });
      const { plan } = await context.service.planImport(context.planInput);

      expect(plan.assets.find(asset => asset.key === 'brand-logo-svg')).toMatchObject({ approvedSha256: sha256(inspectedLogo), action: 'reuse' });
      expect(plan.assets.find(asset => asset.key === 'portraits-seth-png')).toMatchObject({ approvedSha256: sha256(PHOTO), action: 'upload' });
      expect(plan.summary).toMatchObject({ uploads: 1, reused: 1 });
    });

    it.each([
      ['an owner who is not found', { ownerEmail: 'nobody@msfg.us' }, 'IMPORT_OWNER_UNRESOLVED'],
      ['an actor who is not found', { actorEmail: 'nobody@msfg.us' }, 'IMPORT_ACTOR_UNRESOLVED'],
      ['a relative bundle path', { bundlePath: 'source-bundle.json' }, 'IMPORT_INPUT_INVALID'],
    ])('stops for %s', async (_name, overrides, code) => {
      const context = setup();
      await expect(context.service.planImport({ ...context.planInput, ...overrides })).rejects.toMatchObject({ code });
    });

    it('stops when an email matches more than one active user', async () => {
      const context = setup({ database: { users: [
        { id: 7, email: 'seth.angell@msfg.us', name: 'Seth', role: 'user' },
        { id: 8, email: 'Seth.Angell@msfg.us', name: 'Seth again', role: 'user' },
        { id: 1, email: 'zachary.zink@msfg.us', name: 'Zachary', role: 'admin' },
      ] } });
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_OWNER_UNRESOLVED', matches: 2 });
    });

    it('requires the acting user to be an administrator', async () => {
      const context = setup({ database: { users: [
        { id: 7, email: 'seth.angell@msfg.us', name: 'Seth', role: 'user' },
        { id: 1, email: 'zachary.zink@msfg.us', name: 'Zachary', role: 'user' },
      ] } });
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_ACTOR_NOT_ADMIN' });
    });

    it('stops when the webinar slug already exists', async () => {
      const context = setup({ database: { slugs: ['first-home'] } });
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_ALREADY_APPLIED' });
    });

    it('stops when an asset file does not match its manifest checksum', async () => {
      await writeFile(path.join(paths.assetRoot, 'assets', 'portraits', 'seth.png'), Buffer.concat([PHOTO, Buffer.from('x')]));
      const context = setup();
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_ASSET_CHECKSUM_MISMATCH', key: 'portraits-seth-png' });
    });

    it('stops when an asset would fail inspection', async () => {
      const notPng = Buffer.from('this is not a png');
      await writeFile(path.join(paths.assetRoot, 'assets', 'portraits', 'seth.png'), notPng);
      const changed = manifest();
      Object.assign(changed.assets[1], { byteSize: notPng.length, sha256: sha256(notPng) });
      await writeFile(paths.assets, JSON.stringify(changed));
      const context = setup();
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_ASSET_REJECTED', key: 'portraits-seth-png' });
    });

    it('stops when a slide uses an asset the manifest does not list', async () => {
      const changed = manifest();
      changed.assets.pop();
      await writeFile(paths.assets, JSON.stringify(changed));
      const context = setup();
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_BUNDLE_INVALID' });
    });

    it('stops when the content fails the Studio content policy', async () => {
      const changed = bundle();
      changed.slides[0].html += '<a href="https://example.com">out</a>';
      await writeFile(paths.bundle, JSON.stringify(changed));
      const context = setup();
      const failure = await context.service.planImport(context.planInput).catch(error => error);
      expect(failure).toBeInstanceOf(ImportError);
      expect(failure.code).toBe('IMPORT_CONTENT_INVALID');
      expect(failure.issues.map(issue => issue.code)).toContain('RESOURCE_ORIGIN_FORBIDDEN');
    });

    it('stops when an asset path tries to leave the asset root', async () => {
      const changed = manifest();
      changed.assets[0].path = '../outside.svg';
      await writeFile(paths.assets, JSON.stringify(changed));
      const context = setup();
      await expect(context.service.planImport(context.planInput)).rejects.toMatchObject({ code: 'IMPORT_BUNDLE_INVALID' });
    });
  });

  describe('applyImport', () => {
    it('uploads through the scan, swaps in real asset ids, and creates the webinar hidden', async () => {
      const context = setup();
      const { planSha256 } = await plannedAndWritten(context);

      const report = await context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 });

      expect(context.catalog.createUploadIntent).toHaveBeenCalledTimes(2);
      expect(context.catalog.createUploadIntent).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: 1, isAdmin: true, filename: 'logo.svg', mimeType: 'image/svg+xml', byteSize: LOGO.length,
      }));
      expect(context.fetchImpl).toHaveBeenCalledWith(`https://uploads.example/${LOGO_VERSION}`, expect.objectContaining({
        method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' },
      }));
      expect(Buffer.from(context.fetchImpl.mock.calls[0][1].body)).toEqual(LOGO);

      const imported = context.mutations.importWebinar.mock.calls[0][0];
      expect(imported).toMatchObject({ slug: 'first-home', title: 'Your first home', primaryOwnerUserId: 7, actorUserId: 1 });
      expect(imported.slides.map(slide => slide.id)).toEqual([SLIDE_ONE, SLIDE_TWO]);
      expect(imported.slides[0].html).toContain(`src="{{ASSET:${LOGO_VERSION}}}"`);
      expect(imported.slides[1].html).toContain(`src="{{ASSET:${PHOTO_VERSION}}}"`);
      expect(imported.slides[1].javascript).toContain(`{{ASSET:${LOGO_VERSION}}}`);
      expect(JSON.stringify(imported)).not.toContain('LOCAL_ASSET');

      expect(report).toEqual({
        slug: 'first-home', webinarId: 20, liveVersion: 1, audienceEnabled: false, slides: 2,
        assets: [
          { key: 'brand-logo-svg', versionId: LOGO_VERSION, action: 'uploaded' },
          { key: 'portraits-seth-png', versionId: PHOTO_VERSION, action: 'uploaded' },
        ],
      });
    });

    it('reuses an asset version that is already available instead of uploading it again', async () => {
      const context = setup({ database: { available: { [sha256(PHOTO)]: PHOTO_VERSION } }, catalogOptions: { versions: [LOGO_VERSION] } });
      const { planSha256 } = await plannedAndWritten(context);

      const report = await context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 });

      expect(context.catalog.createUploadIntent).toHaveBeenCalledTimes(1);
      expect(report.assets).toEqual([
        { key: 'brand-logo-svg', versionId: LOGO_VERSION, action: 'uploaded' },
        { key: 'portraits-seth-png', versionId: PHOTO_VERSION, action: 'reused' },
      ]);
    });

    it('refuses a plan whose hash is not the one that was approved', async () => {
      const context = setup();
      await plannedAndWritten(context);

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: '0'.repeat(64) }))
        .rejects.toMatchObject({ code: 'IMPORT_PLAN_DRIFT' });
      expect(context.catalog.createUploadIntent).not.toHaveBeenCalled();
      expect(context.mutations.importWebinar).not.toHaveBeenCalled();
    });

    it('refuses when the bundle changed after the plan was made', async () => {
      const context = setup();
      const { planSha256 } = await plannedAndWritten(context);
      const changed = bundle();
      changed.slides[0].title = 'Changed after review';
      await writeFile(paths.bundle, JSON.stringify(changed));

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 }))
        .rejects.toMatchObject({ code: 'IMPORT_INPUT_DRIFT' });
      expect(context.catalog.createUploadIntent).not.toHaveBeenCalled();
    });

    it('refuses when an asset file changed after the plan was made', async () => {
      const context = setup();
      const { planSha256 } = await plannedAndWritten(context);
      await writeFile(path.join(paths.assetRoot, 'assets', 'brand', 'logo.svg'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 }))
        .rejects.toMatchObject({ code: 'IMPORT_INPUT_DRIFT' });
      expect(context.catalog.createUploadIntent).not.toHaveBeenCalled();
    });

    it('reports an already-imported webinar without changing anything', async () => {
      const planning = setup();
      const { planSha256 } = await plannedAndWritten(planning);
      const context = setup({ database: { slugs: ['first-home'] } });

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 }))
        .rejects.toMatchObject({ code: 'IMPORT_ALREADY_APPLIED' });
      expect(context.catalog.createUploadIntent).not.toHaveBeenCalled();
      expect(context.mutations.importWebinar).not.toHaveBeenCalled();
    });

    it('stops without creating the webinar when the scan rejects an asset', async () => {
      const context = setup({ catalogOptions: { reject: 'seth.png' } });
      const { planSha256 } = await plannedAndWritten(context);

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 }))
        .rejects.toMatchObject({ code: 'IMPORT_ASSET_REJECTED', key: 'portraits-seth-png', rejectionCode: 'MALWARE_DETECTED' });
      expect(context.mutations.importWebinar).not.toHaveBeenCalled();
    });

    it('stops without creating the webinar when an upload is refused', async () => {
      const context = setup({ fetchImpl: vi.fn(async () => ({ ok: false, status: 403 })) });
      const { planSha256 } = await plannedAndWritten(context);

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 }))
        .rejects.toMatchObject({ code: 'IMPORT_ASSET_UPLOAD_FAILED', key: 'brand-logo-svg', status: 403 });
      expect(context.mutations.importWebinar).not.toHaveBeenCalled();
    });

    it('stops when the scan does not finish in time', async () => {
      let clock = 0;
      const context = setup({ catalogOptions: { scansBeforeAvailable: Infinity }, pollTimeoutMs: 50, now: () => { clock += 20; return clock; } });
      const { planSha256 } = await plannedAndWritten(context);

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 }))
        .rejects.toMatchObject({ code: 'IMPORT_ASSET_TIMEOUT' });
      expect(context.mutations.importWebinar).not.toHaveBeenCalled();
    });

    it('keeps waiting when the inspection queue is briefly full', async () => {
      const catalog = fakeCatalog({ scansBeforeAvailable: 0 });
      const confirm = catalog.confirmUpload;
      let busy = true;
      catalog.confirmUpload = vi.fn(async input => {
        if (busy) { busy = false; throw Object.assign(new Error('busy'), { code: 'ASSET_INSPECTION_BUSY', status: 503 }); }
        return confirm(input);
      });
      const context = setup({ catalog });
      const { planSha256 } = await plannedAndWritten(context);

      await expect(context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 })).resolves.toMatchObject({ webinarId: 20 });
    });

    it('leaves the plan file untouched', async () => {
      const context = setup();
      const { planSha256, planJson } = await plannedAndWritten(context);
      await context.service.applyImport({ planPath: paths.plan, expectedPlanSha256: planSha256 });
      expect(await readFile(paths.plan, 'utf8')).toBe(planJson);
    });
  });
});
