import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const fsPromises = require('node:fs/promises');
const childProcess = require('node:child_process');
const inspectionPath = require.resolve('../../../services/webinarAssets/inspection');
const fixtures = new URL('../../fixtures/webinar-assets/', import.meta.url);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNg+M/wHwAF/gL+Zl9+gAAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex');
const ANIMATED_GIF = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020244010021f90401000000002c00000000010001000002024401003b', 'hex');

function wavHeader() {
  const body = Buffer.alloc(44);
  body.write('RIFF', 0);
  body.writeUInt32LE(36, 4);
  body.write('WAVEfmt ', 8);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(8_000, 24);
  body.writeUInt32LE(16_000, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write('data', 36);
  return body;
}

function woff({ reserved = 0, totalLength = 68, tableOffset = 64, compressedLength = 4, originalLength = 4 } = {}) {
  const body = Buffer.alloc(68);
  body.write('wOFF', 0);
  body.writeUInt32BE(0x00010000, 4);
  body.writeUInt32BE(totalLength, 8);
  body.writeUInt16BE(1, 12);
  body.writeUInt16BE(reserved, 14);
  body.writeUInt32BE(28, 16);
  body.writeUInt16BE(1, 20);
  body.write('name', 44);
  body.writeUInt32BE(tableOffset, 48);
  body.writeUInt32BE(compressedLength, 52);
  body.writeUInt32BE(originalLength, 56);
  body.write('test', 64);
  return body;
}

function woff2ZeroHeader() {
  const body = Buffer.alloc(48);
  body.write('wOF2', 0);
  return body;
}

function assetInput(body, declaredMimeType, filename) {
  return {
    stream: streamOf(body),
    declaredMimeType,
    declaredBytes: body.length,
    filename,
  };
}

let inspection;
let execFileSpy;
let rmSpy;

function streamOf(body) {
  return Readable.from([body]);
}

beforeEach(() => {
  execFileSpy = vi.spyOn(childProcess, 'execFile');
  delete require.cache[inspectionPath];
  inspection = require('../../../services/webinarAssets/inspection');
});

afterEach(() => {
  execFileSpy.mockRestore();
  rmSpy?.mockRestore();
  rmSpy = undefined;
  delete require.cache[inspectionPath];
});

describe('Webinar asset inspection', () => {
  it('identifies a PNG from its bytes and records its raster dimensions', async () => {
    const result = await inspection.inspectAsset({
      stream: streamOf(PNG),
      declaredMimeType: 'image/png',
      declaredBytes: PNG.length,
      filename: 'cover.png',
    });

    expect(result).toMatchObject({
      mediaType: 'image',
      mimeType: 'image/png',
      byteSize: PNG.length,
      width: 1,
      height: 1,
      durationMs: null,
      approvedBody: PNG,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a truncated PNG after a full raster decode', async () => {
    const truncated = PNG.subarray(0, -18);

    await expect(inspection.inspectAsset(assetInput(truncated, 'image/png', 'truncated.png')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('fully decodes every frame of animated GIF media', async () => {
    const result = await inspection.inspectAsset(assetInput(ANIMATED_GIF, 'image/gif', 'animated.gif'));

    expect(result).toMatchObject({ mediaType: 'image', mimeType: 'image/gif', width: 1, height: 2 });
  });

  it('rejects a GIF truncated after its first complete frame', async () => {
    const truncated = ANIMATED_GIF.subarray(0, -5);

    await expect(inspection.inspectAsset(assetInput(truncated, 'image/gif', 'truncated.gif')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects a .mp4 filename whose bytes are not a video', async () => {
    const body = Buffer.from('this is not a video');

    await expect(inspection.inspectAsset({
      stream: streamOf(body),
      declaredMimeType: 'video/mp4',
      declaredBytes: body.length,
      filename: 'deck.mp4',
    })).rejects.toMatchObject({ code: 'ASSET_INSPECTION_UNSUPPORTED' });
  });

  it('rejects a declared MIME type that disagrees with the bytes', async () => {
    await expect(inspection.inspectAsset({
      stream: streamOf(PNG),
      declaredMimeType: 'image/jpeg',
      declaredBytes: PNG.length,
      filename: 'cover.jpg',
    })).rejects.toMatchObject({ code: 'ASSET_INSPECTION_MIME_MISMATCH' });
  });

  it('stops reading as soon as the declared type limit is exceeded', async () => {
    const maximum = 20 * 1024 * 1024;
    const source = Readable.from([Buffer.alloc(maximum), Buffer.from([0])]);

    await expect(inspection.inspectAsset({
      stream: source,
      declaredMimeType: 'image/png',
      declaredBytes: maximum,
      filename: 'too-large.png',
    })).rejects.toMatchObject({ code: 'ASSET_INSPECTION_TOO_LARGE' });
  });

  it('normalizes stream failures into a deterministic inspection error', async () => {
    const source = Readable.from((async function* () {
      yield PNG;
      throw new Error('upstream read failure');
    }()));

    await expect(inspection.inspectAsset({
      stream: source,
      declaredMimeType: 'image/png',
      declaredBytes: PNG.length,
      filename: 'cover.png',
    })).rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('produces the same SHA-256 for the same approved source bytes', async () => {
    const input = () => ({
      stream: streamOf(PNG),
      declaredMimeType: 'image/png',
      declaredBytes: PNG.length,
      filename: 'cover.png',
    });

    const first = await inspection.inspectAsset(input());
    const second = await inspection.inspectAsset(input());

    expect(first.sha256).toBe(second.sha256);
  });

  it('sanitizes active SVG content before hashing and approval', async () => {
    const svg = await readFile(new URL('active.svg', fixtures));
    const result = await inspection.inspectAsset({
      stream: streamOf(svg),
      declaredMimeType: 'image/svg+xml',
      declaredBytes: svg.length,
      filename: 'mark.svg',
    });

    expect(result.mimeType).toBe('image/svg+xml');
    expect(result.approvedBody.toString()).not.toMatch(/script|onload|foreignObject|evil\.example|javascript:|animate/i);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ['trailing text', '<svg xmlns="http://www.w3.org/2000/svg"></svg>unsafe'],
    ['multiple roots', '<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['mismatched tags', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
    ['unclosed root', '<svg xmlns="http://www.w3.org/2000/svg"><g></g>'],
    ['wrong namespace', '<svg xmlns="https://example.test/not-svg"></svg>'],
  ])('rejects SVG with %s', async (name, source) => {
    const body = Buffer.from(source);

    await expect(inspection.inspectAsset(assetInput(body, 'image/svg+xml', 'mark.svg')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it.each([
    ['a zeroed WOFF header', Buffer.from('774f464600000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex'), 'font/woff', 'empty.woff'],
    ['a truncated WOFF container', woff().subarray(0, 60), 'font/woff', 'truncated.woff'],
    ['a WOFF reserved field', woff({ reserved: 1 }), 'font/woff', 'reserved.woff'],
    ['a WOFF table outside the container', woff({ tableOffset: 65, compressedLength: 4 }), 'font/woff', 'bounds.woff'],
    ['a WOFF compressed length larger than original', woff({ compressedLength: 5, originalLength: 4 }), 'font/woff', 'compressed.woff'],
    ['a zeroed WOFF2 header', woff2ZeroHeader(), 'font/woff2', 'empty.woff2'],
  ])('rejects %s', async (name, body, declaredMimeType, filename) => {
    await expect(inspection.inspectAsset(assetInput(body, declaredMimeType, filename)))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it.each([
    ['font/woff', 'valid.woff'],
    ['font/woff2', 'valid.woff2'],
  ])('accepts a real valid %s container', async (declaredMimeType, filename) => {
    const body = await readFile(new URL(filename, fixtures));

    await expect(inspection.inspectAsset(assetInput(body, declaredMimeType, filename)))
      .resolves.toMatchObject({ mediaType: 'font', mimeType: declaredMimeType });
  });

  it.each([
    ['WOFF declared SFNT size above 64 MiB', 'valid.woff', 'font/woff', 16],
    ['WOFF2 declared SFNT size above 64 MiB', 'valid.woff2', 'font/woff2', 16],
    ['a WOFF2 transform-version inconsistency', 'valid.woff2', 'font/woff2', 48],
  ])('rejects %s', async (name, filename, declaredMimeType, offset) => {
    const body = await readFile(new URL(filename, fixtures));
    const malformed = Buffer.from(body);
    if (offset === 16) malformed.writeUInt32BE(64 * 1024 * 1024 + 1, offset);
    else malformed[offset] = 0xff;

    await expect(inspection.inspectAsset(assetInput(malformed, declaredMimeType, filename)))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('does not decode a complete non-SVG upload as UTF-8 before type detection', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const originalToString = Buffer.prototype.toString;
    const toStringSpy = vi.spyOn(Buffer.prototype, 'toString').mockImplementation(function (...args) {
      if (this === body && args[1] === undefined && args[2] === undefined) {
        throw new Error('complete upload was decoded as UTF-8');
      }
      return originalToString.apply(this, args);
    });

    try {
      await expect(inspection.inspectAsset(assetInput(body, 'font/woff', 'body.woff')))
        .resolves.toMatchObject({ mediaType: 'font', mimeType: 'font/woff' });
    } finally {
      toStringSpy.mockRestore();
    }
  });

  it('normalizes ffprobe duration seconds to milliseconds for audio and video', async () => {
    const probeOutput = JSON.stringify({ format: { duration: '1.234' } });
    execFileSpy.mockImplementation((file, args, options, callback) => callback(null, probeOutput, ''));

    for (const [body, declaredMimeType, filename, mediaType] of [
      [wavHeader(), 'audio/wav', 'track.wav', 'audio'],
      [MP4, 'video/mp4', 'deck.mp4', 'video'],
    ]) {
      await expect(inspection.inspectAsset({
        stream: streamOf(body),
        declaredMimeType,
        declaredBytes: body.length,
        filename,
      })).resolves.toMatchObject({ mediaType, mimeType: declaredMimeType, durationMs: 1234 });
    }
  });

  it('keeps the primary ffprobe error when temporary-file cleanup also fails', async () => {
    execFileSpy.mockImplementation((file, args, options, callback) => callback(new Error('ffprobe failed')));
    rmSpy = vi.spyOn(fsPromises, 'rm').mockRejectedValue(new Error('cleanup failed'));
    delete require.cache[inspectionPath];
    inspection = require('../../../services/webinarAssets/inspection');
    const body = wavHeader();

    await expect(inspection.inspectAsset(assetInput(body, 'audio/wav', 'track.wav')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_PROBE_FAILED' });
  });

  it('normalizes a successful probe cleanup failure', async () => {
    execFileSpy.mockImplementation((file, args, options, callback) => callback(null, '{"format":{"duration":"1"}}', ''));
    rmSpy = vi.spyOn(fsPromises, 'rm').mockRejectedValue(new Error('cleanup failed'));
    delete require.cache[inspectionPath];
    inspection = require('../../../services/webinarAssets/inspection');
    const body = wavHeader();

    await expect(inspection.inspectAsset(assetInput(body, 'audio/wav', 'track.wav')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_CLEANUP_FAILED' });
  });
});
