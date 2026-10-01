/* Imports a reviewed Webinar Studio source bundle.
 *
 * A bundle is a complete deck exported from a static webinar: Master HTML/CSS,
 * every slide, and a manifest of the local media it uses. The import has two
 * steps that are bound together by a hash:
 *
 *   planImport   reads everything, checks everything, writes nothing, and
 *                returns a plan plus its SHA-256.
 *   applyImport  accepts only that exact plan, releases each asset through the
 *                normal quarantine, scan and inspection path, and then creates
 *                the webinar, hidden from audiences, in one transaction.
 *
 * Nothing here writes to MySQL or S3 directly; the asset catalog and the
 * webinar mutation service do, under their own rules.
 */

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { loadResourcePolicy } = require('./contentPolicy');
const defaultMutations = require('./mutations');
const { MEDIA_RULES } = require('../webinarAssets/config');

const LOCAL_ASSET_TOKEN = /\{\{LOCAL_ASSET:([a-z0-9-]+)\}\}/g;
const ASSET_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SURFACES = ['html', 'css', 'javascript'];
const SLIDE_FIELDS = ['id', 'anchor', 'title', 'speakerNotes', 'html', 'css', 'javascript'];
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

class ImportError extends Error {
  constructor(code, message = 'Webinar import failed', extra = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const sha256 = value => createHash('sha256').update(value).digest('hex');

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  }
  return value;
}

/* Sorted keys and a trailing newline, so the same plan always hashes the same. */
function canonicalJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function tokenKeys(source) {
  return [...String(source).matchAll(LOCAL_ASSET_TOKEN)].map(match => match[1]);
}

function surfacesOf(bundle) {
  return [bundle.master.html, bundle.master.css, ...bundle.slides.flatMap(slide => SURFACES.map(field => slide[field]))];
}

function replaceLocalAssetTokens(bundle, versionIdFor) {
  const swap = source => source.replace(LOCAL_ASSET_TOKEN, (_token, key) => `{{ASSET:${versionIdFor(key)}}}`);
  return {
    masterHtml: swap(bundle.master.html),
    masterCss: swap(bundle.master.css),
    slides: bundle.slides.map(slide => ({
      id: slide.id,
      anchor: slide.anchor,
      title: slide.title,
      targetSeconds: slide.targetSeconds,
      speakerNotes: slide.speakerNotes,
      html: swap(slide.html),
      css: swap(slide.css),
      javascript: swap(slide.javascript),
    })),
  };
}

/* A well-formed stand-in id per local asset, so the content policy can be
   checked before any asset version exists. */
function placeholderVersionId(key) {
  const hex = sha256(`local-asset:${key}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function safeAssetPath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0')) return false;
  const normalized = path.posix.normalize(value.split(path.sep).join('/'));
  return normalized === value && !normalized.startsWith('..');
}

/* Shape and cross-reference checks for a bundle and its asset manifest.
   Content rules belong to the content policy and run in planImport. */
function validateImportBundle({ bundle, assetManifest }) {
  const issues = [];
  const add = (code, detail) => issues.push({ code, ...detail });
  const isString = value => typeof value === 'string';

  if (!bundle || bundle.schemaVersion !== 1) add('BUNDLE_SCHEMA_VERSION');
  if (!bundle?.webinar || !isString(bundle.webinar.slug) || !isString(bundle.webinar.title)) add('BUNDLE_WEBINAR');
  if (!bundle?.master || !isString(bundle.master.html) || !isString(bundle.master.css)) add('BUNDLE_MASTER');
  if (!Array.isArray(bundle?.slides) || !bundle.slides.length) add('BUNDLE_SLIDES');
  else {
    bundle.slides.forEach((slide, position) => {
      if (!slide || SLIDE_FIELDS.some(field => !isString(slide[field])) || !Number.isInteger(slide.targetSeconds)) {
        add('BUNDLE_SLIDE', { position });
      }
    });
  }

  if (!assetManifest || assetManifest.schemaVersion !== 1 || !Array.isArray(assetManifest.assets)) add('MANIFEST_SCHEMA');
  else {
    const seen = new Set();
    for (const asset of assetManifest.assets) {
      const rule = MEDIA_RULES[asset?.mimeType];
      if (!asset || !isString(asset.key) || !ASSET_KEY.test(asset.key) || seen.has(asset.key)
        || !safeAssetPath(asset.path) || !rule
        || !Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0 || asset.byteSize > rule.maxBytes
        || !isString(asset.sha256) || !SHA256.test(asset.sha256)) {
        add('MANIFEST_ASSET', { key: isString(asset?.key) ? asset.key : null });
        continue;
      }
      seen.add(asset.key);
    }
    if (!issues.length) {
      const used = new Set(surfacesOf(bundle).flatMap(tokenKeys));
      for (const key of used) if (!seen.has(key)) add('ASSET_NOT_IN_MANIFEST', { key });
      for (const key of seen) if (!used.has(key)) add('ASSET_NOT_REFERENCED', { key });
    }
  }

  if (issues.length) throw new ImportError('IMPORT_BUNDLE_INVALID', 'Webinar bundle is invalid', { issues });
  return { bundle, assetManifest };
}

function createImportService({
  db = require('../../db/connection'),
  catalog = require('../webinarAssets/catalog'),
  inspection = require('../webinarAssets/inspection'),
  mutations = defaultMutations,
  validateCandidate = defaultMutations.validateCandidate,
  fetchImpl = globalThis.fetch,
  env = process.env,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
} = {}) {
  async function readInput(file, label) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) {
      throw new ImportError('IMPORT_INPUT_INVALID', `${label} must be an absolute path`);
    }
    try {
      return await fs.readFile(file);
    } catch {
      throw new ImportError('IMPORT_INPUT_INVALID', `${label} could not be read`);
    }
  }

  function parseJson(bytes, label) {
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new ImportError('IMPORT_INPUT_INVALID', `${label} is not valid JSON`);
    }
  }

  async function resolveUser(email, role) {
    const code = role === 'owner' ? 'IMPORT_OWNER_UNRESOLVED' : 'IMPORT_ACTOR_UNRESOLVED';
    const address = typeof email === 'string' ? email.trim() : '';
    if (!address) throw new ImportError(code, `The ${role} email is required`, { matches: 0 });
    const [rows] = await db.query('SELECT id, email, name, role FROM users WHERE email = ? AND is_active = 1', [address]);
    if (rows.length !== 1) {
      throw new ImportError(code, `The ${role} email must match exactly one active user`, { matches: rows.length });
    }
    return { email: address, userId: Number(rows[0].id), isAdmin: rows[0].role === 'admin' };
  }

  async function resolveUsers(ownerEmail, actorEmail) {
    const owner = await resolveUser(ownerEmail, 'owner');
    const actor = await resolveUser(actorEmail, 'actor');
    /* Assets are released before the webinar exists, which only an
       administrator may do. */
    if (!actor.isAdmin) throw new ImportError('IMPORT_ACTOR_NOT_ADMIN', 'The acting user must be an administrator');
    return {
      owner: { email: owner.email, userId: owner.userId },
      actor: { email: actor.email, userId: actor.userId },
    };
  }

  async function assertSlugAvailable(slug) {
    const [rows] = await db.query('SELECT id FROM webinar_presentations WHERE slug = ? LIMIT 1', [slug]);
    if (rows[0]) throw new ImportError('IMPORT_ALREADY_APPLIED', 'A webinar with this slug already exists', { slug });
  }

  async function findAvailableVersion(asset) {
    const [rows] = await db.query(
      `SELECT v.id
       FROM webinar_asset_versions v
       JOIN webinar_assets a ON a.id = v.asset_id
       WHERE v.sha256 = ? AND v.status = 'available' AND v.mime_type = ? AND a.archived_at IS NULL
       ORDER BY v.created_at ASC, v.id ASC
       LIMIT 1`,
      [asset.approvedSha256, asset.mimeType],
    );
    return rows[0] ? rows[0].id : null;
  }

  async function readAsset(assetRoot, asset, driftCode) {
    const root = path.resolve(assetRoot);
    const file = path.resolve(root, asset.path);
    if (!file.startsWith(`${root}${path.sep}`)) {
      throw new ImportError('IMPORT_BUNDLE_INVALID', 'Asset path leaves the asset root', { issues: [{ code: 'MANIFEST_ASSET', key: asset.key }] });
    }
    let body;
    try {
      body = await fs.readFile(file);
    } catch {
      throw new ImportError(driftCode, 'Asset file could not be read', { key: asset.key });
    }
    if (body.length !== asset.byteSize || sha256(body) !== asset.sha256) {
      throw new ImportError(driftCode, 'Asset file does not match its recorded checksum', { key: asset.key });
    }
    return body;
  }

  /* Run the same inspection the upload confirmation will run, so a file that
     would be rejected is caught before anything is uploaded, and so the hash
     the library will store is known up front. */
  async function inspectLocally(asset, body) {
    try {
      const inspected = await inspection.inspectAsset({
        stream: Readable.from([body]),
        declaredMimeType: asset.mimeType,
        declaredBytes: body.length,
        filename: path.posix.basename(asset.path),
        consumeApprovedBody: async result => {
          if (result.approvedBody && typeof result.approvedBody[Symbol.asyncIterator] === 'function'
            && !Buffer.isBuffer(result.approvedBody)) {
            for await (const chunk of result.approvedBody) void chunk;
          }
          return { sha256: result.sha256 };
        },
      });
      return inspected.sha256;
    } catch (error) {
      throw new ImportError('IMPORT_ASSET_REJECTED', 'Asset would be rejected by inspection', {
        key: asset.key,
        rejectionCode: typeof error?.code === 'string' ? error.code : 'ASSET_INSPECTION_INVALID',
      });
    }
  }

  async function assertContentAdmissible(bundle, policy) {
    const candidate = replaceLocalAssetTokens(bundle, placeholderVersionId);
    candidate.slides = candidate.slides.map((slide, position) => ({ ...slide, position }));
    try {
      await validateCandidate(candidate, policy);
    } catch (error) {
      throw new ImportError('IMPORT_CONTENT_INVALID', 'Webinar content failed the Studio content policy', {
        issues: Array.isArray(error?.issues) ? error.issues : [{ code: error?.code || 'CONTENT_VALIDATION_FAILED' }],
      });
    }
  }

  async function planImport({ bundlePath, assetsPath, assetRoot, ownerEmail, actorEmail }) {
    if (typeof assetRoot !== 'string' || !path.isAbsolute(assetRoot)) {
      throw new ImportError('IMPORT_INPUT_INVALID', 'The asset root must be an absolute path');
    }
    const bundleBytes = await readInput(bundlePath, 'The bundle');
    const manifestBytes = await readInput(assetsPath, 'The asset manifest');
    const { bundle, assetManifest } = validateImportBundle({
      bundle: parseJson(bundleBytes, 'The bundle'),
      assetManifest: parseJson(manifestBytes, 'The asset manifest'),
    });

    const { owner, actor } = await resolveUsers(ownerEmail, actorEmail);
    await assertSlugAvailable(bundle.webinar.slug);

    const policy = loadResourcePolicy(env);
    await assertContentAdmissible(bundle, policy);

    const assets = [];
    for (const entry of assetManifest.assets) {
      const body = await readAsset(assetRoot, entry, 'IMPORT_ASSET_CHECKSUM_MISMATCH');
      const asset = {
        key: entry.key,
        path: entry.path,
        mimeType: entry.mimeType,
        byteSize: entry.byteSize,
        sha256: entry.sha256,
        approvedSha256: await inspectLocally(entry, body),
      };
      asset.action = (await findAvailableVersion(asset)) ? 'reuse' : 'upload';
      assets.push(asset);
    }

    const plan = {
      schemaVersion: 1,
      slug: bundle.webinar.slug,
      title: bundle.webinar.title,
      owner,
      actor,
      inputs: {
        bundle: { path: bundlePath, sha256: sha256(bundleBytes) },
        assets: { path: assetsPath, sha256: sha256(manifestBytes) },
        assetRoot,
      },
      assets,
      resourcePolicy: {
        assetOrigin: policy.assetOrigin,
        stylesheetOrigins: [...policy.stylesheetOrigins],
        fontOrigins: [...policy.fontOrigins],
      },
      summary: {
        slug: bundle.webinar.slug,
        slides: bundle.slides.length,
        assets: assets.length,
        uploads: assets.filter(asset => asset.action === 'upload').length,
        reused: assets.filter(asset => asset.action === 'reuse').length,
        ownerMatches: 1,
        actorMatches: 1,
        audienceEnabled: false,
      },
    };
    const planJson = canonicalJson(plan);
    return { plan, planJson, planSha256: sha256(planJson) };
  }

  function displayNameFor(asset) {
    const base = path.posix.basename(asset.path, path.posix.extname(asset.path));
    return (base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || asset.key).slice(0, 255);
  }

  async function uploadAsset(plan, asset, body) {
    const intent = await catalog.createUploadIntent({
      actorUserId: plan.actor.userId,
      isAdmin: true,
      displayName: displayNameFor(asset),
      description: `Imported with the ${plan.slug} webinar.`,
      filename: path.posix.basename(asset.path),
      mimeType: asset.mimeType,
      byteSize: body.length,
    });
    let response;
    try {
      response = await fetchImpl(intent.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': asset.mimeType },
        body,
      });
    } catch {
      throw new ImportError('IMPORT_ASSET_UPLOAD_FAILED', 'Asset upload failed', { key: asset.key, status: null });
    }
    if (!response || response.ok !== true) {
      throw new ImportError('IMPORT_ASSET_UPLOAD_FAILED', 'Asset upload was refused', { key: asset.key, status: response?.status ?? null });
    }
    return intent.versionId;
  }

  async function waitUntilAvailable(plan, asset, versionId, deadline) {
    for (;;) {
      let result;
      try {
        result = await catalog.confirmUpload({ actorUserId: plan.actor.userId, isAdmin: true, versionId });
      } catch (error) {
        if (error?.code !== 'ASSET_INSPECTION_BUSY') throw error;
        result = { status: 'processing' };
      }
      if (result.status === 'available') return;
      if (result.status !== 'processing') {
        throw new ImportError('IMPORT_ASSET_REJECTED', 'Asset was rejected by the scan or inspection', {
          key: asset.key, rejectionCode: result.rejectionCode || result.status,
        });
      }
      if (now() > deadline) {
        throw new ImportError('IMPORT_ASSET_TIMEOUT', 'Asset scan did not finish in time', { key: asset.key });
      }
      await sleep(pollIntervalMs);
    }
  }

  /* Upload everything that needs uploading first, then wait: the malware scan
     runs on all of them at once instead of one after another. An asset that
     is already available, from an earlier run or another deck, is reused. */
  async function releaseAssets(plan, bodies) {
    const released = new Map();
    const pending = [];
    for (const asset of plan.assets) {
      const existing = await findAvailableVersion(asset);
      if (existing) {
        released.set(asset.key, { versionId: existing, action: 'reused' });
        continue;
      }
      const versionId = await uploadAsset(plan, asset, bodies.get(asset.key));
      released.set(asset.key, { versionId, action: 'uploaded' });
      pending.push({ asset, versionId });
    }
    const deadline = now() + pollTimeoutMs;
    for (const { asset, versionId } of pending) await waitUntilAvailable(plan, asset, versionId, deadline);
    return released;
  }

  async function applyImport({ planPath, expectedPlanSha256 }) {
    const planBytes = await readInput(planPath, 'The plan');
    if (typeof expectedPlanSha256 !== 'string' || sha256(planBytes) !== expectedPlanSha256) {
      throw new ImportError('IMPORT_PLAN_DRIFT', 'The plan is not the one that was approved');
    }
    const plan = parseJson(planBytes, 'The plan');
    if (!plan || plan.schemaVersion !== 1 || !Array.isArray(plan.assets) || !plan.inputs || !plan.owner || !plan.actor) {
      throw new ImportError('IMPORT_PLAN_DRIFT', 'The plan is not a version this importer understands');
    }

    const bundleBytes = await readInput(plan.inputs.bundle.path, 'The bundle');
    const manifestBytes = await readInput(plan.inputs.assets.path, 'The asset manifest');
    if (sha256(bundleBytes) !== plan.inputs.bundle.sha256 || sha256(manifestBytes) !== plan.inputs.assets.sha256) {
      throw new ImportError('IMPORT_INPUT_DRIFT', 'The bundle changed after the plan was made');
    }
    const { bundle } = validateImportBundle({
      bundle: parseJson(bundleBytes, 'The bundle'),
      assetManifest: parseJson(manifestBytes, 'The asset manifest'),
    });
    const bodies = new Map();
    for (const asset of plan.assets) bodies.set(asset.key, await readAsset(plan.inputs.assetRoot, asset, 'IMPORT_INPUT_DRIFT'));

    const { owner, actor } = await resolveUsers(plan.owner.email, plan.actor.email);
    if (owner.userId !== plan.owner.userId || actor.userId !== plan.actor.userId) {
      throw new ImportError('IMPORT_PLAN_DRIFT', 'The owner or acting user changed after the plan was made');
    }
    await assertSlugAvailable(plan.slug);

    const released = await releaseAssets(plan, bodies);
    const candidate = replaceLocalAssetTokens(bundle, key => released.get(key).versionId);
    const result = await mutations.importWebinar({
      slug: plan.slug,
      title: plan.title,
      primaryOwnerUserId: plan.owner.userId,
      actorUserId: plan.actor.userId,
      ...candidate,
    });

    return {
      slug: plan.slug,
      webinarId: result.webinarId,
      liveVersion: result.liveVersion,
      audienceEnabled: result.audienceEnabled,
      slides: bundle.slides.length,
      assets: plan.assets.map(asset => ({ key: asset.key, ...released.get(asset.key) })),
    };
  }

  return { planImport, applyImport };
}

module.exports = {
  ImportError,
  canonicalJson,
  createImportService,
  replaceLocalAssetTokens,
  validateImportBundle,
};
