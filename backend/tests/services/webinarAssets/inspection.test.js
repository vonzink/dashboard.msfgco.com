import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const fsPromises = require('node:fs/promises');
const childProcess = require('node:child_process');
const wawoff = require('wawoff2');
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

function woffTable(body, tag) {
  const tableCount = body.readUInt16BE(12);
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 44 + index * 20;
    if (body.toString('ascii', offset, offset + 4) === tag) {
      return {
        offset: body.readUInt32BE(offset + 4),
        compressedLength: body.readUInt32BE(offset + 8),
      };
    }
  }
  throw new Error(`Expected WOFF ${tag} table`);
}

function corruptWoffTable(body, tag) {
  const malformed = Buffer.from(body);
  const table = woffTable(malformed, tag);
  malformed[table.offset + Math.floor(table.compressedLength / 2)] ^= 1;
  return malformed;
}

function corruptWoff2TransformedContent(body) {
  const malformed = Buffer.from(body);
  // This bit falls in the Brotli payload which expands into the transformed glyf table.
  malformed[488] ^= 0x20;
  return malformed;
}

function alignToFour(value) {
  return Math.ceil(value / 4) * 4;
}

function fontTableChecksum(table, zeroHeadAdjustment = false) {
  let checksum = 0;
  for (let offset = 0; offset < table.length; offset += 4) {
    let word = 0;
    for (let byte = 0; byte < 4 && offset + byte < table.length; byte += 1) {
      if (zeroHeadAdjustment && offset + byte >= 8 && offset + byte < 12) continue;
      word |= table[offset + byte] << (24 - byte * 8);
    }
    checksum = (checksum + (word >>> 0)) >>> 0;
  }
  return checksum;
}

function rebuildChecksummedWoff(body, targetTag, mutate) {
  const tableCount = body.readUInt16BE(12);
  const directoryEnd = 44 + tableCount * 20;
  const tables = [];
  let outputLength = directoryEnd;

  for (let index = 0; index < tableCount; index += 1) {
    const entry = 44 + index * 20;
    const tag = body.toString('ascii', entry, entry + 4);
    const offset = body.readUInt32BE(entry + 4);
    const compressedLength = body.readUInt32BE(entry + 8);
    const originalLength = body.readUInt32BE(entry + 12);
    const data = compressedLength < originalLength
      ? inflateSync(body.subarray(offset, offset + compressedLength))
      : Buffer.from(body.subarray(offset, offset + compressedLength));
    if (tag === targetTag) mutate(data);
    const compressed = deflateSync(data);
    const encoded = compressed.length < data.length ? compressed : data;
    tables.push({ tag, data, encoded, offset: outputLength });
    outputLength = alignToFour(outputLength + encoded.length);
  }

  const rebuilt = Buffer.alloc(outputLength);
  body.copy(rebuilt, 0, 0, 44);
  rebuilt.writeUInt32BE(rebuilt.length, 8);
  for (let index = 0; index < tables.length; index += 1) {
    const entry = 44 + index * 20;
    const table = tables[index];
    rebuilt.write(table.tag, entry, 4, 'ascii');
    rebuilt.writeUInt32BE(table.offset, entry + 4);
    rebuilt.writeUInt32BE(table.encoded.length, entry + 8);
    rebuilt.writeUInt32BE(table.data.length, entry + 12);
    rebuilt.writeUInt32BE(fontTableChecksum(table.data, table.tag === 'head'), entry + 16);
    table.encoded.copy(rebuilt, table.offset);
  }
  return rebuilt;
}

function sfntTable(body, tag) {
  const tableCount = body.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const directoryOffset = 12 + index * 16;
    if (body.toString('ascii', directoryOffset, directoryOffset + 4) === tag) {
      return {
        directoryOffset,
        offset: body.readUInt32BE(directoryOffset + 8),
        length: body.readUInt32BE(directoryOffset + 12),
      };
    }
  }
  throw new Error(`Expected SFNT ${tag} table`);
}

async function woff2WithDescendingSimpleGlyphEndpoints(body) {
  const sfnt = Buffer.from(await wawoff.decompress(body));
  const glyf = sfntTable(sfnt, 'glyf');
  const firstGlyph = glyf.offset;
  if (sfnt.readInt16BE(firstGlyph) < 2
    || sfnt.readUInt16BE(firstGlyph + 10) !== 3
    || sfnt.readUInt16BE(firstGlyph + 12) !== 7) {
    throw new Error('Expected the fixture first glyph to have contour endpoints 3 and 7');
  }
  sfnt.writeUInt16BE(65_535, firstGlyph + 10);
  sfnt.writeUInt32BE(
    fontTableChecksum(sfnt.subarray(glyf.offset, glyf.offset + glyf.length)),
    glyf.directoryOffset + 4,
  );
  return Buffer.from(await wawoff.compress(sfnt));
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

    expect(result).toMatchObject({ mediaType: 'image', mimeType: 'image/gif', width: 1, height: 1 });
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

  it('rejects corruption in a compressed WOFF name table', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const malformed = corruptWoffTable(body, 'name');

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', 'corrupt-name.woff')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it.each([
    ['name record count', 'name', table => table.writeUInt16BE(65_535, 2)],
    ['name string storage offset', 'name', table => table.writeUInt16BE(table.length + 1, 4)],
    ['cmap version', 'cmap', table => table.writeUInt16BE(1, 0)],
    ['cmap encoding record count', 'cmap', table => table.writeUInt16BE(65_535, 2)],
  ])('rejects a checksummed WOFF with an invalid %s', async (name, tag, mutate) => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const malformed = rebuildChecksummedWoff(body, tag, mutate);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', `invalid-${tag}.woff`)))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects a WOFF whose table payloads are relocated off four-byte boundaries', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const tableCount = body.readUInt16BE(12);
    const directoryEnd = 44 + tableCount * 20;
    const malformed = Buffer.alloc(body.length + 1);
    body.copy(malformed, 0, 0, directoryEnd);
    body.copy(malformed, directoryEnd + 1, directoryEnd);
    malformed.writeUInt32BE(malformed.length, 8);
    for (let index = 0; index < tableCount; index += 1) {
      const entry = 44 + index * 20;
      malformed.writeUInt32BE(body.readUInt32BE(entry + 4) + 1, entry + 4);
    }

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', 'misaligned.woff')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects trailing WOFF junk even when the declared container length includes it', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const malformed = Buffer.concat([body, Buffer.from([0])]);
    malformed.writeUInt32BE(malformed.length, 8);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', 'trailing.woff')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects non-null WOFF table padding', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const malformed = Buffer.from(body);
    const firstTable = woffTable(malformed, 'GDEF');
    malformed[firstTable.offset + firstTable.compressedLength] = 1;

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', 'padding.woff')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects a misaligned WOFF private-data block', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const malformed = Buffer.concat([body, Buffer.from([0, 0xab])]);
    malformed.writeUInt32BE(malformed.length, 8);
    malformed.writeUInt32BE(body.length + 1, 36);
    malformed.writeUInt32BE(1, 40);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', 'private.woff')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects a WOFF metadata block that is not valid compressed metadata', async () => {
    const body = await readFile(new URL('valid.woff', fixtures));
    const malformed = Buffer.concat([body, Buffer.from('test')]);
    malformed.writeUInt32BE(malformed.length, 8);
    malformed.writeUInt32BE(body.length, 24);
    malformed.writeUInt32BE(4, 28);
    malformed.writeUInt32BE(4, 32);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff', 'metadata.woff')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects a WOFF2 font whose header understates the decoded SFNT size', async () => {
    const body = await readFile(new URL('valid.woff2', fixtures));
    const malformed = Buffer.from(body);
    malformed.writeUInt32BE(1, 16);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff2', 'tiny-sfnt.woff2')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects corruption in transformed WOFF2 glyph content', async () => {
    const body = await readFile(new URL('valid.woff2', fixtures));
    const malformed = corruptWoff2TransformedContent(body);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff2', 'corrupt-glyf.woff2')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
  });

  it('rejects checksummed WOFF2 glyph data with descending contour endpoints', async () => {
    const body = await readFile(new URL('valid.woff2', fixtures));
    const malformed = await woff2WithDescendingSimpleGlyphEndpoints(body);

    await expect(inspection.inspectAsset(assetInput(malformed, 'font/woff2', 'invalid-glyph.woff2')))
      .rejects.toMatchObject({ code: 'ASSET_INSPECTION_INVALID' });
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
