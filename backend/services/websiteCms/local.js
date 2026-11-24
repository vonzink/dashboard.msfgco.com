/** Explicit LOCAL fixture adapters only. No defaults, production DB access or AWS access.
 * Exclusive lock directories fail closed after process crashes; operators must inspect
 * the pointer/intents before manually recovering a stale lock. Never expire locks by age.
 */
const { mkdir, readFile, writeFile, rename, rm, realpath, stat, lstat, open } = require('node:fs/promises');
const { resolve, join, dirname, isAbsolute, sep } = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseActivePointer, parseSiteSnapshot } = require('../../contracts/website/v1');
const { fail } = require('./errors');
const { seedPublished } = require('./contentEntities');
const { validateBundle, hash, MAX_MANIFEST_BYTES, MAX_ASSET_BYTES } = require('./integrity');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function locked(path, operation) {
  const until = Date.now() + 5000;
  for (;;) {
    try { await mkdir(path); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (Date.now() > until) fail(503, 'website_storage_busy'); await pause(10); }
  }
  try { return await operation(); } finally { await rm(path, { recursive: true }); }
}
async function atomic(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
function within(root, child) { return child.startsWith(root + sep); }
async function readJson(path, maxBytes = 16 * 1024 * 1024) {
  if ((await lstat(path)).isSymbolicLink() || (await stat(path)).size > maxBytes) fail(503, 'website_storage_invalid');
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Directory-backed publication store (release manifests, assets, active pointer).
 * `owner` binds the directory to exactly one editorial authority; a different
 * owner fails closed with website_local_writer_conflict.
 */
async function createLocalPublicationStore({ publicationDirectory, owner } = {}) {
  if (typeof publicationDirectory !== 'string' || !isAbsolute(publicationDirectory)) fail(400, 'website_local_directories_required');
  if (typeof owner !== 'string' || !owner) fail(400, 'website_local_owner_required');
  await mkdir(resolve(publicationDirectory), { recursive: true, mode: 0o700 });
  const published = await realpath(resolve(publicationDirectory));
  function objectPath(key) {
    const clean = key.replace(/^\//, '');
    // Reject control bytes and encoded/path traversal characters before filesystem access.
    // eslint-disable-next-line no-control-regex
    if (!clean || /[%\\\x00-\x1f]/.test(clean) || clean.split('/').some(piece => !piece || piece === '.' || piece === '..')) fail(422, 'website_asset_invalid');
    return join(published, clean);
  }
  async function readObject(key, limit) {
    const path = await realpath(objectPath(key));
    if (!within(published, path) || (await stat(path)).size > limit) fail(422, 'website_asset_invalid');
    const result = await readFile(path);
    if (result.length > limit) fail(422, 'website_asset_invalid');
    return result;
  }
  async function writeImmutable(key, bytes) {
    const path = objectPath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (!within(published, await realpath(dirname(path)))) fail(422, 'website_asset_invalid');
    try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (hash(await readObject(key, Math.max(bytes.length, 1))) !== hash(bytes)) fail(409, 'website_immutable_object_conflict');
    }
  }
  async function readPointer() { return parseActivePointer(await readJson(join(published, 'current.json'), 16384)); }
  async function readRelease(publicationId, pointer) {
    try {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(publicationId)) throw Error();
      const record = pointer ?? parseActivePointer(await readJson(objectPath(`publications/${publicationId}/pointer.json`), 16384));
      const manifest = await readObject(record.manifestKey, MAX_MANIFEST_BYTES);
      const snapshot = parseSiteSnapshot(JSON.parse(manifest.toString('utf8')));
      const assets = {};
      for (const set of snapshot.media) for (const file of set.files) assets[file.path] = await readObject(file.path, MAX_ASSET_BYTES);
      return validateBundle({ pointer: record, manifest, assets });
    } catch (error) { if (error.status) throw error; fail(422, 'website_release_invalid'); }
  }
  const publicationStore = {
    readPointer,
    async readCurrent() { const pointer = await readPointer(); return readRelease(pointer.publicationId, pointer); },
    readRelease,
    async writeCandidate(input) {
      const bundle = validateBundle(input);
      for (const [key, bytes] of Object.entries(bundle.assets)) await writeImmutable(key, bytes);
      await writeImmutable(bundle.pointer.manifestKey, bundle.manifest);
      await writeImmutable(`publications/${bundle.pointer.publicationId}/pointer.json`, Buffer.from(JSON.stringify(bundle.pointer)));
    },
    async activate(pointer, expectedGeneration) {
      return locked(join(published, '.activation-lock'), async () => {
        const current = await readPointer();
        if (current.generation === pointer.generation && current.publicationId === pointer.publicationId && current.sha256 === pointer.sha256) return;
        if (current.generation !== expectedGeneration || pointer.generation !== expectedGeneration + 1) fail(409, 'website_publication_conflict');
        await readRelease(pointer.publicationId, pointer);
        await atomic(join(published, 'current.json'), JSON.stringify(pointer));
      });
    },
    /** Write a verified initial release; only activates it when no pointer exists yet. */
    async seedRelease(seed) {
      const bundle = validateBundle(seed);
      await publicationStore.writeCandidate(bundle);
      try {
        const existing = await readPointer();
        if (JSON.stringify(existing) !== JSON.stringify(bundle.pointer)) fail(409, 'website_local_seed_conflict');
      } catch (error) { if (error.code !== 'ENOENT') throw error; await atomic(join(published, 'current.json'), JSON.stringify(bundle.pointer)); }
      return bundle;
    },
  };
  // One editorial authority per local publication directory, independent of processes.
  const marker = join(published, '.website-cms-owner');
  try { await writeFile(marker, owner, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if ((await lstat(marker)).isSymbolicLink() || await readFile(marker, 'utf8') !== owner) fail(409, 'website_local_writer_conflict'); }
  return { directory: published, publicationStore };
}

async function createLocalCmsAdapters({ editorialDirectory, publicationDirectory, seed, grants } = {}) {
  if (![editorialDirectory, publicationDirectory].every(value => typeof value === 'string' && isAbsolute(value))) fail(400, 'website_local_directories_required');
  const paths = [editorialDirectory, publicationDirectory].map(value => resolve(value));
  if (paths[0] === paths[1] || within(paths[0], paths[1]) || within(paths[1], paths[0])) fail(400, 'website_local_directories_overlap');
  for (const path of paths) await mkdir(path, { recursive: true, mode: 0o700 });
  const [editorial, published] = await Promise.all(paths.map(path => realpath(path)));
  if (editorial === published || within(editorial, published) || within(published, editorial)) fail(400, 'website_local_directories_overlap');
  const statePath = join(editorial, 'editorial.json');
  const { publicationStore } = await createLocalPublicationStore({ publicationDirectory: published, owner: editorial });
  await locked(join(editorial, '.editorial-lock'), async () => {
    try { await readJson(statePath); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!seed || !grants || typeof grants !== 'object' || Array.isArray(grants)) fail(400, 'website_local_seed_required');
    const bundle = validateBundle(seed);
    const state = { version: 1, grants: Object.entries(grants).map(([userId, capabilities]) => ({ userId, capabilities })), revisions: [], latest: [], heroRevisions: [], heroLatest: [], requests: [], audit: [] };
    if (state.grants.some(item => !Array.isArray(item.capabilities) || item.capabilities.some(value => !['website.edit', 'website.publish', 'website.profile.self'].includes(value)))) fail(400, 'website_local_grants_invalid');
    seedPublished(state, bundle.snapshot);
    await publicationStore.seedRelease(bundle);
    await atomic(statePath, JSON.stringify(state));
  });
  const repository = {
    async transaction(operation) {
      return locked(join(editorial, '.editorial-lock'), async () => {
        const state = await readJson(statePath);
        const persist = () => atomic(statePath, JSON.stringify(state));
        const result = await operation(state, persist);
        await persist();
        return result;
      });
    },
  };
  return { repository, publicationStore };
}
module.exports = { createLocalCmsAdapters, createLocalPublicationStore };
