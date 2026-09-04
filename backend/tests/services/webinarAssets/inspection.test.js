import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const inspectionPath = require.resolve('../../../services/webinarAssets/inspection');
const fixtures = new URL('../../fixtures/webinar-assets/', import.meta.url);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc00000040101801d0b98b10000000049454e44ae426082', 'hex');
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex');

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

let inspection;
let execFileSpy;

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
});
