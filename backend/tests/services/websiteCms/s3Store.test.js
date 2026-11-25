import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createS3PublicationStore } = require('../../../services/websiteCms/s3Store');
const { createWebsiteCmsService } = require('../../../services/websiteCms/service');
const { createLocalCmsAdapters } = require('../../../services/websiteCms/local');
const fixture = require('../../../contracts/website/v1/fixtures/published.json');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const s3Error = (name, status) => Object.assign(Error(name), { name, $metadata: { httpStatusCode: status } });

/** In-memory S3 with the conditional-write behavior verified on the staging bucket. */
function fakeS3() {
  const objects = new Map();
  const calls = [];
  let beforePut = null;
  return {
    objects, calls,
    onBeforePut(fn) { beforePut = fn; },
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push({ name, key: input.Key });
      const existing = objects.get(input.Key);
      if (name === 'HeadObjectCommand') {
        if (!existing) throw s3Error('NotFound', 404);
        return { ETag: existing.etag, ContentLength: existing.bytes.length, Metadata: existing.metadata };
      }
      if (name === 'GetObjectCommand') {
        if (!existing) throw s3Error('NoSuchKey', 404);
        return { ETag: existing.etag, ContentLength: existing.bytes.length, Body: { transformToByteArray: async () => new Uint8Array(existing.bytes) } };
      }
      if (name === 'PutObjectCommand') {
        if (beforePut) { const hook = beforePut; beforePut = null; await hook(input); }
        const now = objects.get(input.Key);
        if (input.IfNoneMatch === '*' && now) throw s3Error('PreconditionFailed', 412);
        if (input.IfMatch !== undefined && (!now || now.etag !== input.IfMatch)) throw s3Error('PreconditionFailed', 412);
        const bytes = Buffer.from(input.Body);
        if (input.ChecksumSHA256 !== Buffer.from(sha(bytes), 'hex').toString('base64')) throw s3Error('BadDigest', 400);
        const etag = `"${randomUUID()}"`;
        objects.set(input.Key, { bytes, etag, metadata: input.Metadata });
        return { ETag: etag };
      }
      throw Error(`unexpected command ${name}`);
    },
  };
}

function seed() {
  const snapshot = structuredClone(fixture); const assets = {};
  for (const set of snapshot.media) for (const file of set.files) {
    const bytes = Buffer.from(`synthetic ${file.path}`); assets[file.path] = bytes;
    file.bytes = bytes.length; file.sha256 = sha(bytes);
  }
  const manifest = Buffer.from(JSON.stringify(snapshot));
  return { snapshot, manifest, assets, pointer: { generation: 1, publicationId: snapshot.publicationId, manifestKey: `publications/${snapshot.publicationId}/snapshot.json`, sha256: sha(manifest), schemaVersion: 1, activatedAt: new Date().toISOString() } };
}
const nextPointer = (bundle, generation) => ({ ...bundle.pointer, generation, activatedAt: new Date().toISOString() });

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('S3 publication store', () => {
  it('rejects invalid configuration', () => {
    expect(() => createS3PublicationStore({ client: fakeS3(), bucket: 'Bad_Bucket' })).toThrow('website_s3_configuration_invalid');
    expect(() => createS3PublicationStore({ bucket: 'ok-bucket' })).toThrow('website_s3_configuration_invalid');
  });

  it('seeds a verified release and reads it back', async () => {
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    const initial = seed();
    await publicationStore.seedRelease(initial);
    expect(s3.objects.has('current.json')).toBe(true);
    expect(s3.objects.has(initial.pointer.manifestKey)).toBe(true);
    expect(s3.objects.has(`publications/${initial.pointer.publicationId}/pointer.json`)).toBe(true);
    const current = await publicationStore.readCurrent();
    expect(current.snapshot).toEqual(initial.snapshot);
    expect(current.pointer).toEqual(initial.pointer);
    // Reseeding the identical release is a no-op; a different seed conflicts.
    await publicationStore.seedRelease(initial);
    const other = seed(); other.pointer.activatedAt = '2020-01-01T00:00:00.000Z';
    await expect(publicationStore.seedRelease(other)).rejects.toMatchObject({ status: 409 });
  });

  it('never re-uploads identical immutable objects and refuses different bytes at the same key', async () => {
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    const initial = seed();
    await publicationStore.writeCandidate(initial);
    const puts = () => s3.calls.filter(call => call.name === 'PutObjectCommand').length;
    const before = puts();
    await publicationStore.writeCandidate(initial);
    expect(puts()).toBe(before);
    const path = initial.snapshot.media[0].files[0].path;
    s3.objects.set(path.slice(1), { ...s3.objects.get(path.slice(1)), metadata: { sha256: 'different' } });
    await expect(publicationStore.writeCandidate(initial)).rejects.toMatchObject({ status: 409, code: 'website_immutable_object_conflict' });
  });

  it('activates only from the expected generation', async () => {
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    const initial = seed(); await publicationStore.seedRelease(initial);
    await expect(publicationStore.activate(nextPointer(initial, 3), 2)).rejects.toMatchObject({ status: 409 });
    await expect(publicationStore.activate(nextPointer(initial, 3), 1)).rejects.toMatchObject({ status: 409 });
    const pointer = nextPointer(initial, 2);
    await publicationStore.activate(pointer, 1);
    expect((await publicationStore.readPointer()).generation).toBe(2);
    await publicationStore.activate(pointer, 1); // idempotent retry of the same activation
    expect((await publicationStore.readPointer()).generation).toBe(2);
  });

  it.each([['PreconditionFailed', 412], ['ConditionalRequestConflict', 409]])('a concurrent winner makes activation fail with a conflict (%s)', async (name, status) => {
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    const initial = seed(); await publicationStore.seedRelease(initial);
    const rival = { ...nextPointer(initial, 2), publicationId: 'rival-publication', manifestKey: 'publications/rival-publication/snapshot.json', activatedAt: '2030-01-01T00:00:00.000Z' };
    s3.onBeforePut(async () => {
      if (name === 'ConditionalRequestConflict') {
        s3.objects.set('current.json', { bytes: Buffer.from(JSON.stringify(rival)), etag: '"rival"', metadata: {} });
        throw s3Error(name, status);
      }
      s3.objects.set('current.json', { bytes: Buffer.from(JSON.stringify(rival)), etag: '"rival"', metadata: {} });
    });
    await expect(publicationStore.activate(nextPointer(initial, 2), 1)).rejects.toMatchObject({ status: 409, code: 'website_publication_conflict' });
    expect((await publicationStore.readPointer()).activatedAt).toBe(rival.activatedAt);
  });

  it('treats a lost response for its own pointer write as success', async () => {
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    const initial = seed(); await publicationStore.seedRelease(initial);
    const pointer = nextPointer(initial, 2);
    s3.onBeforePut(async () => {
      s3.objects.set('current.json', { bytes: Buffer.from(JSON.stringify(pointer)), etag: '"mine"', metadata: {} });
      throw s3Error('ConditionalRequestConflict', 409);
    });
    await publicationStore.activate(pointer, 1);
    expect(await publicationStore.readPointer()).toEqual(pointer);
  });

  it('reports S3 outages as 503 and missing releases as 422', async () => {
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    const initial = seed(); await publicationStore.seedRelease(initial);
    await expect(publicationStore.readRelease('missing-release')).rejects.toMatchObject({ status: 422 });
    const send = s3.send; s3.send = async command => { if (command.constructor.name === 'GetObjectCommand' && command.input.Key !== 'current.json') throw s3Error('ServiceUnavailable', 503); return send(command); };
    await expect(publicationStore.readCurrent()).rejects.toMatchObject({ status: 503 });
  });

  it('binds the bucket to one owner and creates revocations only once', async () => {
    const s3 = fakeS3(); const store = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    await store.claimOwner('mysql:db/one');
    await store.claimOwner('mysql:db/one');
    await expect(store.claimOwner('mysql:db/two')).rejects.toMatchObject({ status: 409 });
    expect(await store.publicationStore.ensureRevocations()).toBe(true);
    expect(await store.publicationStore.ensureRevocations()).toBe(false);
  });

  it('runs the real service publish and rollback against the S3 store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cms-s3-service-')); roots.push(root);
    const initial = seed();
    const { repository } = await createLocalCmsAdapters({ editorialDirectory: join(root, 'editorial'), publicationDirectory: join(root, 'unused'), seed: initial, grants: { publisher: ['website.edit', 'website.publish'] } });
    const s3 = fakeS3(); const { publicationStore } = createS3PublicationStore({ client: s3, bucket: 'test-bucket' });
    await publicationStore.seedRelease(initial);
    const service = createWebsiteCmsService({ repository, publicationStore });
    const actor = { id: 'publisher', is_active: true };
    const page = await service.getEntity({ actor, kind: 'page', id: 'page-0' });
    const content = structuredClone(page.latest.content); content.title = 'Published through S3';
    const saved = await service.saveRevision({ actor, entity: { kind: 'page', id: 'page-0' }, baseRevisionId: page.latest.revisionId, content });
    const published = await service.publishSelection({ actor, request: { requestId: 'request-s3', basePublicationId: initial.pointer.publicationId, selections: [{ kind: 'page', id: 'page-0', revisionId: saved.revisionId, action: 'replace' }] } });
    expect(published).toMatchObject({ generation: 2, status: 'active' });
    expect((await publicationStore.readCurrent()).snapshot.pages.find(p => p.id === 'page-0').title).toBe('Published through S3');
    const rolledBack = await service.rollbackPublication({ actor, publicationId: initial.pointer.publicationId, requestId: 'rollback-s3', expectedGeneration: 2 });
    expect(rolledBack).toMatchObject({ generation: 3, publicationId: initial.pointer.publicationId, status: 'active' });
    expect((await publicationStore.readCurrent()).snapshot).toEqual(initial.snapshot);
    // Both releases stay retained for future rollbacks.
    await expect(publicationStore.readRelease(published.publicationId)).resolves.toBeTruthy();
  });
});
