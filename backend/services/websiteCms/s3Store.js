/**
 * S3 publication store: same interface as the directory store in local.js.
 *
 * Layout (one bucket per environment; the contract fixes manifestKey at the root):
 *   current.json                          active pointer (the only mutable object)
 *   publications/<id>/snapshot.json       release manifest (immutable)
 *   publications/<id>/pointer.json        candidate pointer record (immutable)
 *   <asset path without leading slash>    media (immutable, content-addressed by path+sha256)
 *   .website-cms-owner                    binds the bucket to one editorial authority
 *
 * Activation is conditional: the pointer is replaced only with If-Match on the ETag
 * that was read, after the generation check. S3 answers a lost race with 412
 * (PreconditionFailed) or 409 (ConditionalRequestConflict); both mean "another
 * activation won" and surface as website_publication_conflict unless the winner is
 * this same pointer. Nothing is ever deleted, so rollback can re-activate any release.
 */
const { GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { parseActivePointer, parseSiteSnapshot } = require('../../contracts/website/v1');
const { fail } = require('./errors');
const { validateBundle, hash, MAX_MANIFEST_BYTES, MAX_ASSET_BYTES } = require('./integrity');

const POINTER_KEY = 'current.json';
const OWNER_KEY = '.website-cms-owner';
const MAX_POINTER_BYTES = 16384;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const isMissing = error => error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;
const isConditionLost = error => error?.name === 'PreconditionFailed' || error?.name === 'ConditionalRequestConflict'
  || error?.$metadata?.httpStatusCode === 412 || error?.$metadata?.httpStatusCode === 409;
const sha256Base64 = bytes => Buffer.from(hash(bytes), 'hex').toString('base64');

function objectKey(path) {
  const clean = String(path).replace(/^\//, '');
  // eslint-disable-next-line no-control-regex
  if (!clean || /[%\\\x00-\x1f]/.test(clean) || clean.split('/').some(piece => !piece || piece === '.' || piece === '..')) fail(422, 'website_asset_invalid');
  return clean;
}

function createS3PublicationStore({ client, bucket } = {}) {
  if (typeof client?.send !== 'function' || typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw Error('website_s3_configuration_invalid');
  }

  async function getObject(key, limit) {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (Number(result.ContentLength) > limit) fail(422, 'website_asset_invalid');
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (bytes.length > limit) fail(422, 'website_asset_invalid');
    return { bytes, etag: result.ETag };
  }

  async function putObject(key, bytes, contentType, conditions = {}) {
    return client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: bytes, ContentType: contentType,
      ChecksumSHA256: sha256Base64(bytes), Metadata: { sha256: hash(bytes) },
      CacheControl: 'private, no-store', ...conditions,
    }));
  }

  /** Immutable write: skip when identical bytes exist; a different object at the key is a conflict. */
  async function writeImmutable(key, bytes, contentType) {
    const digest = hash(bytes);
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (head.Metadata?.sha256 === digest && Number(head.ContentLength) === bytes.length) return;
      fail(409, 'website_immutable_object_conflict');
    } catch (error) { if (error.status || !isMissing(error)) throw error; }
    try { await putObject(key, bytes, contentType, { IfNoneMatch: '*' }); }
    catch (error) {
      if (!isConditionLost(error)) throw error;
      // A concurrent writer created it first: identical bytes are fine.
      const { bytes: existing } = await getObject(key, Math.max(bytes.length, 1));
      if (hash(existing) !== digest) fail(409, 'website_immutable_object_conflict');
    }
  }

  async function readPointerWithTag() {
    try {
      const { bytes, etag } = await getObject(POINTER_KEY, MAX_POINTER_BYTES);
      return { pointer: parseActivePointer(JSON.parse(bytes.toString('utf8'))), etag };
    } catch (error) {
      if (isMissing(error)) return { pointer: null, etag: null };
      if (error.status) throw error;
      fail(503, 'website_storage_invalid');
    }
  }

  async function readPointer() {
    const { pointer } = await readPointerWithTag();
    if (!pointer) fail(503, 'website_publication_unavailable');
    return pointer;
  }

  async function readRelease(publicationId, pointer) {
    try {
      if (!ID_PATTERN.test(publicationId)) throw Error();
      const record = pointer ?? parseActivePointer(JSON.parse((await getObject(`publications/${publicationId}/pointer.json`, MAX_POINTER_BYTES)).bytes.toString('utf8')));
      const manifest = (await getObject(objectKey(record.manifestKey), MAX_MANIFEST_BYTES)).bytes;
      const snapshot = parseSiteSnapshot(JSON.parse(manifest.toString('utf8')));
      const assets = {};
      for (const set of snapshot.media) for (const file of set.files) assets[file.path] = (await getObject(objectKey(file.path), MAX_ASSET_BYTES)).bytes;
      return validateBundle({ pointer: record, manifest, assets });
    } catch (error) {
      if (error.status === 503) throw error;
      // S3 transport/service failures are retryable outages, not invalid releases.
      if (!error.status && error.$metadata && !isMissing(error)) fail(503, 'website_storage_unavailable');
      fail(422, 'website_release_invalid');
    }
  }

  const same = (a, b) => a && b && a.generation === b.generation && a.publicationId === b.publicationId && a.sha256 === b.sha256;

  const store = {
    readPointer,
    async readCurrent() { const pointer = await readPointer(); return readRelease(pointer.publicationId, pointer); },
    readRelease,
    async writeCandidate(input) {
      const bundle = validateBundle(input);
      for (const set of bundle.snapshot.media) for (const file of set.files) {
        await writeImmutable(objectKey(file.path), bundle.assets[file.path], file.contentType || 'application/octet-stream');
      }
      await writeImmutable(objectKey(bundle.pointer.manifestKey), bundle.manifest, 'application/json');
      await writeImmutable(`publications/${bundle.pointer.publicationId}/pointer.json`, Buffer.from(JSON.stringify(bundle.pointer)), 'application/json');
    },
    async activate(pointer, expectedGeneration) {
      const { pointer: current, etag } = await readPointerWithTag();
      if (!current) fail(503, 'website_publication_unavailable');
      if (same(current, pointer)) return;
      if (current.generation !== expectedGeneration || pointer.generation !== expectedGeneration + 1) fail(409, 'website_publication_conflict');
      await readRelease(pointer.publicationId, pointer);
      try {
        await putObject(POINTER_KEY, Buffer.from(JSON.stringify(pointer)), 'application/json', { IfMatch: etag });
      } catch (error) {
        if (!isConditionLost(error)) throw error;
        const { pointer: winner } = await readPointerWithTag();
        if (same(winner, pointer)) return; // our own retried write already landed
        fail(409, 'website_publication_conflict');
      }
    },
    /** Write a verified initial release; activates it only when no pointer exists yet. */
    async seedRelease(seed) {
      const bundle = validateBundle(seed);
      await store.writeCandidate(bundle);
      const { pointer: existing } = await readPointerWithTag();
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(bundle.pointer)) fail(409, 'website_local_seed_conflict');
        return bundle;
      }
      try { await putObject(POINTER_KEY, Buffer.from(JSON.stringify(bundle.pointer)), 'application/json', { IfNoneMatch: '*' }); }
      catch (error) {
        if (!isConditionLost(error)) throw error;
        const { pointer: winner } = await readPointerWithTag();
        if (JSON.stringify(winner) !== JSON.stringify(bundle.pointer)) fail(409, 'website_local_seed_conflict');
      }
      return bundle;
    },
    /** Website-side revocation list: create an empty one only if none exists. */
    async ensureRevocations(now = new Date()) {
      const body = Buffer.from(JSON.stringify({ schemaVersion: 1, version: 1, updatedAt: now.toISOString(), revokedOfficerIds: [] }));
      try { await putObject('revocations.json', body, 'application/json', { IfNoneMatch: '*' }); return true; }
      catch (error) { if (isConditionLost(error)) return false; throw error; }
    },
  };

  return {
    publicationStore: store,
    /** One editorial authority per bucket. */
    async claimOwner(owner) {
      if (typeof owner !== 'string' || !owner) fail(400, 'website_local_owner_required');
      try { await putObject(OWNER_KEY, Buffer.from(owner), 'text/plain', { IfNoneMatch: '*' }); }
      catch (error) {
        if (!isConditionLost(error)) throw error;
        const { bytes } = await getObject(OWNER_KEY, 1024);
        if (bytes.toString('utf8') !== owner) fail(409, 'website_local_writer_conflict');
      }
    },
  };
}

module.exports = { createS3PublicationStore };
