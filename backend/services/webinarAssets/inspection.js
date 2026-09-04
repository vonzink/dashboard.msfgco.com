const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { rm, writeFile } = require('node:fs/promises');
const { inflateSync } = require('node:zlib');
const path = require('node:path');
const { tmpdir } = require('node:os');
const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');
const ffprobe = require('ffprobe-static');
const fontkit = require('fontkit');
const wawoff = require('wawoff2');
const { SaxesParser } = require('saxes');
const { MEDIA_RULES } = require('./config');

const PROBE_TIMEOUT_MS = 10_000;
const SVG_PREFIX_BYTES = 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const WOFF_HEADER_BYTES = 44;
const WOFF2_HEADER_BYTES = 48;
const MAX_RASTER_PIXELS = 100_000_000;
const MAX_FONT_SFNT_BYTES = 64 * 1024 * 1024;
const SFNT_HEADER_BYTES = 12;
const SFNT_TABLE_DIRECTORY_BYTES = 16;
const WOFF_TABLE_DIRECTORY_BYTES = 20;
const WOFF2_KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];
const SVG_TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'mask', 'title', 'desc', 'use',
];
const SVG_ATTRIBUTES = [
  'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx',
  'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform', 'preserveAspectRatio',
  'offset', 'stop-color', 'stop-opacity', 'clip-path', 'mask', 'id', 'class',
  'fill-rule', 'clip-rule', 'text-anchor', 'font-family', 'font-size', 'font-weight',
  'dominant-baseline', 'dx', 'dy', 'href',
];
const EXTENSIONS = Object.freeze({
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
});

class AssetInspectionError extends Error {
  constructor(code, message = 'Asset inspection failed') {
    super(message);
    this.name = 'AssetInspectionError';
    this.code = code;
  }
}

function inspectionError(code, message) {
  return new AssetInspectionError(code, message);
}

function normalizedMimeType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function safeSvgAttribute(name, value) {
  const lowerName = name.toLowerCase();
  const stringValue = String(value).trim();
  if (lowerName.startsWith('on')) return false;
  if (lowerName === 'xmlns') return stringValue === 'http://www.w3.org/2000/svg';
  if (/\b(?:javascript|data):|(?:https?:)?\/\//i.test(stringValue)) return false;
  if (lowerName === 'href') return /^#[A-Za-z_][\w:.-]*$/.test(stringValue);
  if (['fill', 'stroke', 'clip-path', 'mask'].includes(lowerName) && /url\(/i.test(stringValue)) {
    return /^url\(#[A-Za-z_][\w:.-]*\)$/i.test(stringValue);
  }
  return true;
}

function assertStrictSvgDocument(source) {
  let root;
  let rootCount = 0;
  let depth = 0;
  let invalid = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => { invalid = true; });
  parser.on('doctype', () => { invalid = true; });
  parser.on('opentag', tag => {
    if (depth === 0) {
      root = tag;
      rootCount += 1;
    }
    depth += 1;
  });
  parser.on('closetag', () => { depth -= 1; });
  parser.on('text', text => {
    if (depth === 0 && text.trim()) invalid = true;
  });
  parser.on('comment', () => {
    if (depth === 0) invalid = true;
  });
  try {
    parser.write(source).close();
  } catch {
    invalid = true;
  }
  if (invalid || depth !== 0 || rootCount !== 1 || root?.name !== 'svg' || root.uri !== SVG_NAMESPACE) {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'SVG source is invalid');
  }
}

function sanitizeSvg(source) {
  const sourceText = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  assertStrictSvgDocument(sourceText);

  const sanitized = sanitizeHtml(sourceText, {
    allowedTags: SVG_TAGS,
    allowedAttributes: { '*': SVG_ATTRIBUTES },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    parser: {
      xmlMode: true,
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
    transformTags: {
      '*': (tagName, attributes) => ({
        tagName,
        attribs: Object.fromEntries(Object.entries(attributes)
          .filter(([name, value]) => safeSvgAttribute(name, value))),
      }),
    },
  });
  assertStrictSvgDocument(sanitized);
  return Buffer.from(sanitized, 'utf8');
}

async function readLimitedStream(stream, maximum) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset body must be a readable stream');
  }

  const chunks = [];
  let byteSize = 0;
  try {
    for await (const piece of stream) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      const remaining = maximum + 1 - byteSize;
      if (remaining <= 0) {
        stream.destroy();
        throw inspectionError('ASSET_INSPECTION_TOO_LARGE', 'Asset exceeds its size limit');
      }
      const accepted = chunk.subarray(0, remaining);
      chunks.push(accepted);
      byteSize += accepted.length;
      if (byteSize > maximum || accepted.length !== chunk.length) {
        stream.destroy();
        throw inspectionError('ASSET_INSPECTION_TOO_LARGE', 'Asset exceeds its size limit');
      }
    }
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Unable to read asset body');
  }
  return Buffer.concat(chunks, byteSize);
}

function hasPrefix(body, text) {
  return body.length >= text.length && body.subarray(0, text.length).equals(Buffer.from(text));
}

function looksLikeSvg(body) {
  return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(body.subarray(0, SVG_PREFIX_BYTES).toString('utf8'));
}

function fontInvalid() {
  return inspectionError('ASSET_INSPECTION_INVALID', 'Font container is invalid');
}

function alignToFour(value) {
  return Math.ceil(value / 4) * 4;
}

function hasValidRange(total, offset, length) {
  return Number.isSafeInteger(offset) && Number.isSafeInteger(length)
    && offset >= 0 && length >= 0 && offset <= total && length <= total - offset;
}

function tableChecksum(table, zeroHeadAdjustment = false) {
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

function validateSfnt(sfnt, expectedLength, verifyChecksums) {
  if (!Buffer.isBuffer(sfnt) || sfnt.length !== expectedLength || sfnt.length > MAX_FONT_SFNT_BYTES
    || sfnt.length < SFNT_HEADER_BYTES) throw fontInvalid();

  const tableCount = sfnt.readUInt16BE(4);
  const directoryEnd = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_DIRECTORY_BYTES;
  if (tableCount === 0 || directoryEnd > sfnt.length) throw fontInvalid();

  const tables = new Map();
  const ranges = [];
  for (let index = 0; index < tableCount; index += 1) {
    const entry = SFNT_HEADER_BYTES + index * SFNT_TABLE_DIRECTORY_BYTES;
    const tag = sfnt.toString('ascii', entry, entry + 4);
    const checksum = sfnt.readUInt32BE(entry + 4);
    const offset = sfnt.readUInt32BE(entry + 8);
    const length = sfnt.readUInt32BE(entry + 12);
    if (!tag || tables.has(tag) || length === 0 || offset % 4 !== 0
      || offset < directoryEnd || !hasValidRange(sfnt.length, offset, length)) throw fontInvalid();
    const table = sfnt.subarray(offset, offset + length);
    if (verifyChecksums && tableChecksum(table, tag === 'head') !== checksum) throw fontInvalid();
    tables.set(tag, table);
    ranges.push([offset, alignToFour(offset + length)]);
  }
  ranges.sort((left, right) => left[0] - right[0]);
  if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1][1])) throw fontInvalid();
  if (ranges.at(-1)?.[1] !== sfnt.length) throw fontInvalid();

  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const cmap = tables.get('cmap');
  const name = tables.get('name');
  if (!head || head.length < 54 || head.readUInt32BE(12) !== 0x5f0f3cf5
    || !maxp || maxp.length < 6 || maxp.readUInt16BE(4) === 0
    || !cmap || cmap.length < 4 || !name || name.length < 6) throw fontInvalid();
}

function buildSfnt(flavor, tables, expectedLength) {
  const sfnt = Buffer.alloc(expectedLength);
  const tableCount = tables.length;
  const powerOfTwo = 2 ** Math.floor(Math.log2(tableCount));
  sfnt.writeUInt32BE(flavor, 0);
  sfnt.writeUInt16BE(tableCount, 4);
  sfnt.writeUInt16BE(powerOfTwo * 16, 6);
  sfnt.writeUInt16BE(Math.log2(powerOfTwo), 8);
  sfnt.writeUInt16BE(tableCount * 16 - powerOfTwo * 16, 10);
  let directoryOffset = SFNT_HEADER_BYTES;
  let dataOffset = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_DIRECTORY_BYTES;
  for (const table of tables.sort((left, right) => left.tag.localeCompare(right.tag))) {
    sfnt.write(table.tag, directoryOffset, 4, 'ascii');
    sfnt.writeUInt32BE(table.checksum, directoryOffset + 4);
    sfnt.writeUInt32BE(dataOffset, directoryOffset + 8);
    sfnt.writeUInt32BE(table.data.length, directoryOffset + 12);
    table.data.copy(sfnt, dataOffset);
    directoryOffset += SFNT_TABLE_DIRECTORY_BYTES;
    dataOffset += alignToFour(table.data.length);
  }
  return sfnt;
}

function validateWoff(body) {
  const tableCount = body.readUInt16BE(12);
  const directoryEnd = WOFF_HEADER_BYTES + tableCount * WOFF_TABLE_DIRECTORY_BYTES;
  const expectedLength = body.readUInt32BE(16);
  if (directoryEnd > body.length || expectedLength > MAX_FONT_SFNT_BYTES) throw fontInvalid();

  const tables = [];
  const seenTags = new Set();
  const containerRanges = [];
  let decodedLength = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_DIRECTORY_BYTES;
  for (let index = 0; index < tableCount; index += 1) {
    const entry = WOFF_HEADER_BYTES + index * WOFF_TABLE_DIRECTORY_BYTES;
    const tag = body.toString('ascii', entry, entry + 4);
    const offset = body.readUInt32BE(entry + 4);
    const compressedLength = body.readUInt32BE(entry + 8);
    const originalLength = body.readUInt32BE(entry + 12);
    const checksum = body.readUInt32BE(entry + 16);
    if (!tag || seenTags.has(tag) || originalLength === 0 || compressedLength === 0
      || compressedLength > originalLength || offset < directoryEnd
      || !hasValidRange(body.length, offset, compressedLength)) throw fontInvalid();
    decodedLength += alignToFour(originalLength);
    if (decodedLength > MAX_FONT_SFNT_BYTES) throw fontInvalid();
    let data;
    try {
      if (compressedLength < originalLength) {
        const inflated = inflateSync(body.subarray(offset, offset + compressedLength), {
          info: true,
          maxOutputLength: originalLength,
        });
        if (inflated.buffer.length !== originalLength || inflated.engine.bytesWritten !== compressedLength) {
          throw fontInvalid();
        }
        data = inflated.buffer;
      } else {
        data = body.subarray(offset, offset + compressedLength);
      }
    } catch (error) {
      if (error instanceof AssetInspectionError) throw error;
      throw fontInvalid();
    }
    if (tableChecksum(data, tag === 'head') !== checksum) throw fontInvalid();
    seenTags.add(tag);
    containerRanges.push([offset, offset + compressedLength]);
    tables.push({ tag, checksum, data });
  }
  if (decodedLength !== expectedLength) throw fontInvalid();
  const metadataOffset = body.readUInt32BE(24);
  const metadataLength = body.readUInt32BE(28);
  const metadataOriginalLength = body.readUInt32BE(32);
  const privateOffset = body.readUInt32BE(36);
  const privateLength = body.readUInt32BE(40);
  if ((metadataOffset === 0) !== (metadataLength === 0) || (metadataLength === 0) !== (metadataOriginalLength === 0)
    || (privateOffset === 0) !== (privateLength === 0)
    || (metadataLength > 0 && !hasValidRange(body.length, metadataOffset, metadataLength))
    || (privateLength > 0 && !hasValidRange(body.length, privateOffset, privateLength))) throw fontInvalid();
  if (metadataLength > 0) containerRanges.push([metadataOffset, metadataOffset + metadataLength]);
  if (privateLength > 0) containerRanges.push([privateOffset, privateOffset + privateLength]);
  containerRanges.sort((left, right) => left[0] - right[0]);
  if (containerRanges.some((range, index) => index > 0 && range[0] < containerRanges[index - 1][1])) throw fontInvalid();
  const sfnt = buildSfnt(body.readUInt32BE(4), tables, expectedLength);
  validateSfnt(sfnt, expectedLength, true);
  return sfnt;
}

function readBase128(body, state) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (state.offset >= body.length || value & 0xe0000000) throw fontInvalid();
    const byte = body[state.offset++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw fontInvalid();
}

function validateWoff2Directory(body) {
  const tableCount = body.readUInt16BE(12);
  const expectedLength = body.readUInt32BE(16);
  const compressedLength = body.readUInt32BE(20);
  const state = { offset: WOFF2_HEADER_BYTES };
  const tables = [];
  const seenTags = new Set();
  let decodedLength = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_DIRECTORY_BYTES;
  let transformedLength = 0;

  for (let index = 0; index < tableCount; index += 1) {
    if (state.offset >= body.length) throw fontInvalid();
    const flags = body[state.offset++];
    const tagIndex = flags & 0x3f;
    const tag = tagIndex === 0x3f
      ? (state.offset + 4 <= body.length ? body.toString('ascii', state.offset, state.offset + 4) : null)
      : WOFF2_KNOWN_TAGS[tagIndex];
    if (tagIndex === 0x3f) state.offset += 4;
    const originalLength = readBase128(body, state);
    const transformVersion = flags >>> 6;
    const glyphTransform = tag === 'glyf' || tag === 'loca';
    const transformed = glyphTransform ? transformVersion === 0 : transformVersion === 1;
    if (!tag || seenTags.has(tag) || originalLength === 0
      || (glyphTransform ? ![0, 3].includes(transformVersion) : ![0, 1].includes(transformVersion))) {
      throw fontInvalid();
    }
    const transformLength = transformed ? readBase128(body, state) : originalLength;
    if (transformLength === 0 && !(tag === 'loca' && transformed)) throw fontInvalid();
    decodedLength += alignToFour(originalLength);
    transformedLength += transformLength;
    if (decodedLength > MAX_FONT_SFNT_BYTES || transformedLength > MAX_FONT_SFNT_BYTES) throw fontInvalid();
    seenTags.add(tag);
    tables.push({ tag, transformed });
  }

  const compressedEnd = state.offset + compressedLength;
  if (expectedLength !== decodedLength || expectedLength > MAX_FONT_SFNT_BYTES
    || !hasValidRange(body.length, state.offset, compressedLength) || compressedEnd > body.length) throw fontInvalid();
  const metadataOffset = body.readUInt32BE(28);
  const metadataLength = body.readUInt32BE(32);
  const metadataOriginalLength = body.readUInt32BE(36);
  const privateOffset = body.readUInt32BE(40);
  const privateLength = body.readUInt32BE(44);
  if ((metadataOffset === 0) !== (metadataLength === 0) || (metadataLength === 0) !== (metadataOriginalLength === 0)
    || (privateOffset === 0) !== (privateLength === 0)
    || (metadataLength > 0 && (metadataOffset < compressedEnd || !hasValidRange(body.length, metadataOffset, metadataLength)))
    || (privateLength > 0 && (privateOffset < compressedEnd || !hasValidRange(body.length, privateOffset, privateLength)))) {
    throw fontInvalid();
  }
  if (metadataLength > 0 && privateLength > 0
    && metadataOffset < privateOffset + privateLength && privateOffset < metadataOffset + metadataLength) throw fontInvalid();
  const glyf = tables.find(table => table.tag === 'glyf');
  const loca = tables.find(table => table.tag === 'loca');
  if ((glyf?.transformed || loca?.transformed) && !(glyf?.transformed && loca?.transformed)) throw fontInvalid();
  return expectedLength;
}

async function validateFont(body, mimeType) {
  const minimum = mimeType === 'font/woff' ? WOFF_HEADER_BYTES : WOFF2_HEADER_BYTES;
  if (body.length < minimum || body.readUInt32BE(8) !== body.length
    || body.readUInt16BE(12) === 0 || body.readUInt16BE(14) !== 0
    || body.readUInt32BE(16) > MAX_FONT_SFNT_BYTES) throw fontInvalid();
  try {
    let sfnt;
    let expectedLength;
    if (mimeType === 'font/woff') {
      expectedLength = body.readUInt32BE(16);
      sfnt = validateWoff(body);
    } else {
      expectedLength = validateWoff2Directory(body);
      sfnt = Buffer.from(await wawoff.decompress(body));
    }
    validateSfnt(sfnt, expectedLength, true);
    const font = fontkit.create(sfnt);
    if (!Number.isSafeInteger(font.numGlyphs) || font.numGlyphs < 1) throw fontInvalid();
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw fontInvalid();
  }
}

function validateAnimatedContainer(body, mimeType) {
  if (mimeType === 'image/gif' && body.at(-1) !== 0x3b) {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'GIF container is incomplete');
  }
}

async function detectMimeType(body, declaredMimeType) {
  if (hasPrefix(body, 'wOFF')) return 'font/woff';
  if (hasPrefix(body, 'wOF2')) return 'font/woff2';
  if (declaredMimeType === 'image/svg+xml' || looksLikeSvg(body)) {
    return 'image/svg+xml';
  }
  try {
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(body);
    if (!detected) return null;
    return ({ 'audio/x-wav': 'audio/wav', 'image/jpg': 'image/jpeg' })[detected.mime] || detected.mime;
  } catch {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset type detection failed');
  }
}

function execFfprobe(file) {
  return new Promise((resolve, reject) => {
    execFile(ffprobe.path, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file,
    ], {
      shell: false,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function probeDuration(body, mimeType) {
  const extension = EXTENSIONS[mimeType];
  const temporaryFile = path.join(tmpdir(), `webinar-asset-${randomUUID()}${extension}`);
  let durationMs;
  let failure;
  try {
    await writeFile(temporaryFile, body, { flag: 'wx' });
    const output = await execFfprobe(temporaryFile);
    const seconds = Number(JSON.parse(output).format?.duration);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset duration is invalid');
    }
    durationMs = Math.round(seconds * 1000);
  } catch (error) {
    failure = error instanceof AssetInspectionError
      ? error
      : inspectionError('ASSET_INSPECTION_PROBE_FAILED', 'Unable to inspect asset duration');
  } finally {
    try {
      await rm(temporaryFile, { force: true });
    } catch {
      if (!failure) failure = inspectionError('ASSET_INSPECTION_CLEANUP_FAILED', 'Unable to remove temporary asset file');
    }
  }
  if (failure) throw failure;
  return durationMs;
}

async function inspectRaster(body) {
  const options = { animated: true, failOn: 'error', limitInputPixels: MAX_RASTER_PIXELS };
  const decoded = sharp(body, options);
  const metadata = await decoded.metadata();
  const frameHeight = metadata.pageHeight || metadata.height;
  const frames = metadata.pages || 1;
  if (!metadata.width || !frameHeight || metadata.width * frameHeight * frames > MAX_RASTER_PIXELS) {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Raster dimensions exceed the inspection limit');
  }
  await sharp(body, options).ensureAlpha().raw().toBuffer();
  return { width: metadata.width, height: frameHeight };
}

async function inspectAsset({ stream, declaredMimeType, declaredBytes, filename } = {}) {
  const mimeType = normalizedMimeType(declaredMimeType);
  const rule = MEDIA_RULES[mimeType];
  if (!rule || typeof filename !== 'string' || !filename.trim() || !Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset metadata is invalid');
  }
  if (declaredBytes > rule.maxBytes) {
    throw inspectionError('ASSET_INSPECTION_TOO_LARGE', 'Asset exceeds its size limit');
  }

  try {
    const body = await readLimitedStream(stream, rule.maxBytes);
    if (body.length !== declaredBytes) {
      throw inspectionError('ASSET_INSPECTION_SIZE_MISMATCH', 'Asset size does not match its declaration');
    }

    const actualMimeType = await detectMimeType(body, mimeType);
    if (!actualMimeType) throw inspectionError('ASSET_INSPECTION_UNSUPPORTED', 'Asset bytes are not an approved media type');
    if (actualMimeType !== mimeType) throw inspectionError('ASSET_INSPECTION_MIME_MISMATCH', 'Asset MIME type does not match its bytes');

    const approvedBody = rule.mediaType === 'svg' ? sanitizeSvg(body) : body;
    if (rule.mediaType === 'font') await validateFont(approvedBody, mimeType);
    if (rule.mediaType === 'image') validateAnimatedContainer(approvedBody, mimeType);
    const dimensions = rule.mediaType === 'image' ? await inspectRaster(approvedBody) : {};
    const durationMs = (rule.mediaType === 'audio' || rule.mediaType === 'video')
      ? await probeDuration(approvedBody, mimeType)
      : null;

    return {
      mediaType: rule.mediaType,
      mimeType,
      byteSize: approvedBody.length,
      sha256: createHash('sha256').update(approvedBody).digest('hex'),
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
      durationMs,
      approvedBody,
    };
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset inspection failed');
  }
}

module.exports = {
  AssetInspectionError,
  inspectAsset,
  sanitizeSvg,
};
