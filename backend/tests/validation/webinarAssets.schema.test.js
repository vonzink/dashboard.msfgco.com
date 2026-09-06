import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const schemas = require('../../validation/schemas/webinarAssets');

const validUpload = {
  displayName: 'Closing timeline',
  description: 'A reusable closing timeline.',
  filename: 'timeline.svg',
  contentType: 'image/svg+xml',
  byteSize: 4096,
};

describe('webinar asset schemas', () => {
  it.each([
    ['PNG', 'image/png', 20 * 1024 * 1024],
    ['JPEG', 'image/jpeg', 20 * 1024 * 1024],
    ['WebP', 'image/webp', 20 * 1024 * 1024],
    ['GIF', 'image/gif', 20 * 1024 * 1024],
    ['SVG', 'image/svg+xml', 5 * 1024 * 1024],
    ['WOFF', 'font/woff', 10 * 1024 * 1024],
    ['WOFF2', 'font/woff2', 10 * 1024 * 1024],
    ['MP3', 'audio/mpeg', 100 * 1024 * 1024],
    ['WAV', 'audio/wav', 100 * 1024 * 1024],
    ['MP4', 'video/mp4', 500 * 1024 * 1024],
    ['WebM', 'video/webm', 500 * 1024 * 1024],
  ])('accepts the declared %s type through its exact size limit', (_label, contentType, byteSize) => {
    expect(schemas.createUploadIntent.safeParse({ ...validUpload, contentType, byteSize }).success).toBe(true);
    expect(schemas.createVersionIntent.safeParse({
      filename: validUpload.filename,
      contentType,
      byteSize,
    }).success).toBe(true);
  });

  it.each([
    ['unsupported content type', { contentType: 'text/html' }],
    ['zero bytes', { byteSize: 0 }],
    ['fractional bytes', { byteSize: 1.5 }],
    ['bytes over declared type limit', { contentType: 'image/svg+xml', byteSize: (5 * 1024 * 1024) + 1 }],
    ['empty display name', { displayName: '   ' }],
    ['oversized display name', { displayName: 'x'.repeat(256) }],
    ['empty filename', { filename: '   ' }],
    ['oversized filename', { filename: 'x'.repeat(256) }],
    ['oversized description', { description: 'x'.repeat(65536) }],
    ['forged actor identity', { actorUserId: 999 }],
    ['forged administrator authority', { isAdmin: true }],
    ['unknown field', { privateKey: 'quarantine/secret' }],
  ])('rejects upload intent input with %s', (_label, change) => {
    expect(schemas.createUploadIntent.safeParse({ ...validUpload, ...change }).success).toBe(false);
  });

  it.each([
    ['catalog media type outside the approved family', { mediaType: 'pdf' }],
    ['catalog status outside lifecycle states', { status: 'deleted' }],
    ['oversized search', { search: 'x'.repeat(256) }],
    ['query actor identity', { actorUserId: '999' }],
    ['unknown query key', { source: 'private' }],
  ])('rejects %s', (_label, value) => {
    expect(schemas.listCatalog.safeParse(value).success).toBe(false);
  });

  it('trims valid catalog filters and accepts every catalog lifecycle state', () => {
    expect(schemas.listCatalog.parse({ search: ' logo ', mediaType: 'image', status: 'available' }))
      .toEqual({ search: 'logo', mediaType: 'image', status: 'available' });
    for (const status of ['processing', 'available', 'rejected', 'archived']) {
      expect(schemas.listCatalog.safeParse({ status }).success).toBe(true);
    }
  });

  it('enforces the MySQL TEXT limit in UTF-8 bytes for persisted descriptions', () => {
    const withinLimit = '😀'.repeat(16383);
    const overLimit = '😀'.repeat(16384);

    expect(Buffer.byteLength(withinLimit, 'utf8')).toBe(65532);
    expect(Buffer.byteLength(overLimit, 'utf8')).toBe(65536);
    expect(schemas.createUploadIntent.safeParse({ ...validUpload, description: withinLimit }).success).toBe(true);
    expect(schemas.updateFamily.safeParse({ description: withinLimit }).success).toBe(true);
    expect(schemas.createUploadIntent.safeParse({ ...validUpload, description: overLimit }).success).toBe(false);
    expect(schemas.updateFamily.safeParse({ description: overLimit }).success).toBe(false);
  });

  it.each([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ])('accepts lowercase RFC 4122 UUID parameters', (value) => {
    expect(schemas.assetId.parse(value)).toBe(value);
    expect(schemas.versionId.parse(value)).toBe(value);
  });

  it.each([
    '11111111-1111-4111-8111-11111111111',
    '11111111-1111-6111-8111-111111111111',
    '11111111-1111-4111-c111-111111111111',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  ])('rejects malformed or noncanonical UUID parameter %s', (value) => {
    expect(schemas.assetId.safeParse(value).success).toBe(false);
    expect(schemas.versionId.safeParse(value).success).toBe(false);
  });

  it.each([
    ['family label update', { displayName: 'Updated', description: 'New label' }],
    ['family archive', { archive: true }],
  ])('accepts a %s mutation', (_label, body) => {
    expect(schemas.updateFamily.safeParse(body).success).toBe(true);
  });

  it.each([
    ['empty family mutation', {}],
    ['false archive no-op', { archive: false }],
    ['archive mixed with labels', { archive: true, displayName: 'Ambiguous' }],
    ['forged family actor', { displayName: 'Updated', actorUserId: 999 }],
    ['forged family admin', { archive: true, isAdmin: true }],
  ])('rejects %s', (_label, body) => {
    expect(schemas.updateFamily.safeParse(body).success).toBe(false);
  });

  it('requires the exact archive-version mutation and an empty confirm body', () => {
    expect(schemas.archiveVersion.parse({ archive: true })).toEqual({ archive: true });
    expect(schemas.archiveVersion.safeParse({ archive: false }).success).toBe(false);
    expect(schemas.archiveVersion.safeParse({ archive: true, isAdmin: true }).success).toBe(false);
    expect(schemas.confirmUpload.parse({})).toEqual({});
    expect(schemas.confirmUpload.safeParse({ actorUserId: 999 }).success).toBe(false);
  });
});
