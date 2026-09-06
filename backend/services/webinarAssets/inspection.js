const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { createReadStream } = require('node:fs');
const { open, rm } = require('node:fs/promises');
const { inflateSync } = require('node:zlib');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { TextDecoder } = require('node:util');
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
const MAX_CMAP_MAPPING_WORK = 1_000_000;
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

function assertRange(total, offset, length) {
  if (!hasValidRange(total, offset, length)) throw fontInvalid();
}

function assertNullBytes(body, start, end) {
  assertRange(body.length, start, end - start);
  for (let offset = start; offset < end; offset += 1) {
    if (body[offset] !== 0) throw fontInvalid();
  }
}

function validateNameTable(name) {
  if (name.length < 6) throw fontInvalid();
  const version = name.readUInt16BE(0);
  const recordCount = name.readUInt16BE(2);
  const storageOffset = name.readUInt16BE(4);
  if (![0, 1].includes(version) || recordCount === 0) throw fontInvalid();

  const recordsEnd = 6 + recordCount * 12;
  assertRange(name.length, 6, recordCount * 12);
  let headerEnd = recordsEnd;
  let languageTagCount = 0;
  if (version === 1) {
    assertRange(name.length, recordsEnd, 2);
    languageTagCount = name.readUInt16BE(recordsEnd);
    headerEnd += 2 + languageTagCount * 4;
    assertRange(name.length, recordsEnd + 2, languageTagCount * 4);
  }
  if (storageOffset < headerEnd || storageOffset > name.length) throw fontInvalid();

  let previousKey = null;
  for (let index = 0; index < recordCount; index += 1) {
    const record = 6 + index * 12;
    const key = [
      name.readUInt16BE(record),
      name.readUInt16BE(record + 2),
      name.readUInt16BE(record + 4),
      name.readUInt16BE(record + 6),
    ];
    if (previousKey) {
      for (let part = 0; part < key.length; part += 1) {
        if (key[part] === previousKey[part]) continue;
        if (key[part] < previousKey[part]) throw fontInvalid();
        break;
      }
    }
    previousKey = key;
    const stringLength = name.readUInt16BE(record + 8);
    const stringOffset = name.readUInt16BE(record + 10);
    assertRange(name.length, storageOffset + stringOffset, stringLength);
  }

  if (version === 1) {
    for (let index = 0; index < languageTagCount; index += 1) {
      const record = recordsEnd + 2 + index * 4;
      const stringLength = name.readUInt16BE(record);
      const stringOffset = name.readUInt16BE(record + 2);
      assertRange(name.length, storageOffset + stringOffset, stringLength);
    }
  }
}

function validateCmapGroups(
  cmap, offset, length, groupCount, groupOffset, numGlyphs, constantGlyph, maximumCode, work,
) {
  if (length !== groupOffset + groupCount * 12) throw fontInvalid();
  consumeCmapWork(work, groupCount);
  let previousEnd = -1;
  for (let index = 0; index < groupCount; index += 1) {
    const group = offset + groupOffset + index * 12;
    const start = cmap.readUInt32BE(group);
    const end = cmap.readUInt32BE(group + 4);
    const glyph = cmap.readUInt32BE(group + 8);
    if (start > end || start <= previousEnd || end > maximumCode) throw fontInvalid();
    const lastGlyph = constantGlyph ? glyph : glyph + (end - start);
    if (lastGlyph >= numGlyphs) throw fontInvalid();
    previousEnd = end;
  }
}

function consumeCmapWork(work, mappings) {
  if (!Number.isSafeInteger(mappings) || mappings < 0
    || mappings > MAX_CMAP_MAPPING_WORK - work.mappings) throw fontInvalid();
  work.mappings += mappings;
}

function validateCmapFormatTwo(cmap, offset, length, numGlyphs, work) {
  if (length < 526) throw fontInvalid();
  let maximumKey = 0;
  for (let index = 0; index < 256; index += 1) {
    const key = cmap.readUInt16BE(offset + 6 + index * 2);
    if (key % 8 !== 0) throw fontInvalid();
    maximumKey = Math.max(maximumKey, key);
  }
  const subHeaderCount = maximumKey / 8 + 1;
  const subHeadersEnd = 518 + subHeaderCount * 8;
  if (subHeadersEnd > length) throw fontInvalid();
  for (let index = 0; index < subHeaderCount; index += 1) {
    const subHeader = offset + 518 + index * 8;
    const firstCode = cmap.readUInt16BE(subHeader);
    const entryCount = cmap.readUInt16BE(subHeader + 2);
    const delta = cmap.readInt16BE(subHeader + 4);
    const rangeOffset = cmap.readUInt16BE(subHeader + 6);
    if (firstCode + entryCount > 256 || rangeOffset % 2 !== 0) throw fontInvalid();
    const glyphStart = subHeader + 6 + rangeOffset;
    if (entryCount > 0 && (glyphStart < offset + subHeadersEnd
      || !hasValidRange(offset + length, glyphStart, entryCount * 2))) throw fontInvalid();
    consumeCmapWork(work, entryCount);
    for (let glyphIndex = 0; glyphIndex < entryCount; glyphIndex += 1) {
      const storedGlyph = cmap.readUInt16BE(glyphStart + glyphIndex * 2);
      const mappedGlyph = storedGlyph === 0 ? 0 : (storedGlyph + delta) & 0xffff;
      if (mappedGlyph >= numGlyphs) throw fontInvalid();
    }
  }
}

function validateCmapFormatFour(cmap, offset, length, numGlyphs, work) {
  if (length < 24 || length % 2 !== 0) throw fontInvalid();
  const segmentBytes = cmap.readUInt16BE(offset + 6);
  if (segmentBytes === 0 || segmentBytes % 2 !== 0) throw fontInvalid();
  const segmentCount = segmentBytes / 2;
  const arraysEnd = 16 + segmentCount * 8;
  if (arraysEnd > length) throw fontInvalid();
  const powerOfTwo = 2 ** Math.floor(Math.log2(segmentCount));
  if (cmap.readUInt16BE(offset + 8) !== powerOfTwo * 2
    || cmap.readUInt16BE(offset + 10) !== Math.log2(powerOfTwo)
    || cmap.readUInt16BE(offset + 12) !== segmentBytes - powerOfTwo * 2) throw fontInvalid();
  const endCodes = offset + 14;
  const reservedPad = endCodes + segmentCount * 2;
  const startCodes = reservedPad + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  if (cmap.readUInt16BE(reservedPad) !== 0) throw fontInvalid();

  let previousEnd = -1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = cmap.readUInt16BE(startCodes + index * 2);
    const end = cmap.readUInt16BE(endCodes + index * 2);
    const delta = cmap.readInt16BE(deltas + index * 2);
    const rangeOffsetPosition = rangeOffsets + index * 2;
    const rangeOffset = cmap.readUInt16BE(rangeOffsetPosition);
    if (start > end || end <= previousEnd || start <= previousEnd || rangeOffset % 2 !== 0) {
      throw fontInvalid();
    }
    if (index === segmentCount - 1 && (start !== 0xffff || end !== 0xffff)) throw fontInvalid();
    consumeCmapWork(work, end - start + 1);
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (codePoint + delta) & 0xffff;
      } else {
        const glyphPosition = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
        if (glyphPosition < offset + arraysEnd || glyphPosition + 2 > offset + length) throw fontInvalid();
        glyph = cmap.readUInt16BE(glyphPosition);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph >= numGlyphs) throw fontInvalid();
    }
    previousEnd = end;
  }
}

function readUInt24BE(body, offset) {
  return body[offset] * 0x10000 + body[offset + 1] * 0x100 + body[offset + 2];
}

function validateCmapFormatFourteen(cmap, offset, length, numGlyphs, work) {
  const recordCount = cmap.readUInt32BE(offset + 6);
  const recordsEnd = 10 + recordCount * 11;
  if (recordsEnd > length) throw fontInvalid();
  consumeCmapWork(work, recordCount);
  let previousSelector = -1;
  for (let index = 0; index < recordCount; index += 1) {
    const record = offset + 10 + index * 11;
    const selector = readUInt24BE(cmap, record);
    const defaultOffset = cmap.readUInt32BE(record + 3);
    const nonDefaultOffset = cmap.readUInt32BE(record + 7);
    if (selector <= previousSelector || selector > 0x10ffff) throw fontInvalid();
    previousSelector = selector;
    if (defaultOffset !== 0) {
      if (defaultOffset < recordsEnd || defaultOffset + 4 > length) throw fontInvalid();
      const rangeCount = cmap.readUInt32BE(offset + defaultOffset);
      if (defaultOffset + 4 + rangeCount * 4 > length) throw fontInvalid();
      consumeCmapWork(work, rangeCount);
      let previousEnd = -1;
      for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex += 1) {
        const range = offset + defaultOffset + 4 + rangeIndex * 4;
        const start = readUInt24BE(cmap, range);
        const end = start + cmap[range + 3];
        if (start <= previousEnd || end > 0x10ffff) throw fontInvalid();
        previousEnd = end;
      }
    }
    if (nonDefaultOffset !== 0) {
      if (nonDefaultOffset < recordsEnd || nonDefaultOffset + 4 > length) throw fontInvalid();
      const mappingCount = cmap.readUInt32BE(offset + nonDefaultOffset);
      if (nonDefaultOffset + 4 + mappingCount * 5 > length) throw fontInvalid();
      consumeCmapWork(work, mappingCount);
      let previousCodePoint = -1;
      for (let mappingIndex = 0; mappingIndex < mappingCount; mappingIndex += 1) {
        const mapping = offset + nonDefaultOffset + 4 + mappingIndex * 5;
        const codePoint = readUInt24BE(cmap, mapping);
        const glyph = cmap.readUInt16BE(mapping + 3);
        if (codePoint <= previousCodePoint || codePoint > 0x10ffff || glyph >= numGlyphs) throw fontInvalid();
        previousCodePoint = codePoint;
      }
    }
  }
}

function validateCmapSubtable(cmap, offset, expectedFormat, numGlyphs, work) {
  assertRange(cmap.length, offset, 2);
  const format = cmap.readUInt16BE(offset);
  if (format !== expectedFormat) throw fontInvalid();
  let length;
  if ([0, 2, 4, 6].includes(format)) {
    assertRange(cmap.length, offset, 4);
    length = cmap.readUInt16BE(offset + 2);
  } else if ([8, 10, 12, 13].includes(format)) {
    assertRange(cmap.length, offset, 8);
    if (cmap.readUInt16BE(offset + 2) !== 0) throw fontInvalid();
    length = cmap.readUInt32BE(offset + 4);
  } else if (format === 14) {
    assertRange(cmap.length, offset, 6);
    length = cmap.readUInt32BE(offset + 2);
  } else {
    throw fontInvalid();
  }
  if (length === 0) throw fontInvalid();
  assertRange(cmap.length, offset, length);

  if (format === 0) {
    if (length !== 262) throw fontInvalid();
    consumeCmapWork(work, 256);
    for (let index = 0; index < 256; index += 1) {
      if (cmap[offset + 6 + index] >= numGlyphs) throw fontInvalid();
    }
  } else if (format === 2) {
    validateCmapFormatTwo(cmap, offset, length, numGlyphs, work);
  } else if (format === 4) {
    validateCmapFormatFour(cmap, offset, length, numGlyphs, work);
  } else if (format === 6) {
    if (length < 10) throw fontInvalid();
    const firstCode = cmap.readUInt16BE(offset + 6);
    const entryCount = cmap.readUInt16BE(offset + 8);
    if (length !== 10 + entryCount * 2 || firstCode + entryCount > 0x10000) throw fontInvalid();
    consumeCmapWork(work, entryCount);
    for (let index = 0; index < entryCount; index += 1) {
      if (cmap.readUInt16BE(offset + 10 + index * 2) >= numGlyphs) throw fontInvalid();
    }
  } else if (format === 8) {
    if (length < 8208) throw fontInvalid();
    const groupCount = cmap.readUInt32BE(offset + 8204);
    validateCmapGroups(cmap, offset, length, groupCount, 8208, numGlyphs, false, 0xffffffff, work);
  } else if (format === 10) {
    if (length < 20) throw fontInvalid();
    const firstCode = cmap.readUInt32BE(offset + 12);
    const entryCount = cmap.readUInt32BE(offset + 16);
    if (entryCount > (length - 20) / 2 || length !== 20 + entryCount * 2
      || firstCode + entryCount > 0x110000) throw fontInvalid();
    consumeCmapWork(work, entryCount);
    for (let index = 0; index < entryCount; index += 1) {
      if (cmap.readUInt16BE(offset + 20 + index * 2) >= numGlyphs) throw fontInvalid();
    }
  } else if (format === 12 || format === 13) {
    if (length < 16) throw fontInvalid();
    const groupCount = cmap.readUInt32BE(offset + 12);
    validateCmapGroups(
      cmap, offset, length, groupCount, 16, numGlyphs, format === 13, 0x10ffff, work,
    );
  } else {
    validateCmapFormatFourteen(cmap, offset, length, numGlyphs, work);
  }
}

function validateCmapRecord(format, platformId, encodingId) {
  if (format === 14 && (platformId !== 0 || encodingId !== 5)) throw fontInvalid();
}

function validateCmapTable(cmap, numGlyphs) {
  if (cmap.length < 12 || cmap.readUInt16BE(0) !== 0) throw fontInvalid();
  const recordCount = cmap.readUInt16BE(2);
  const recordsEnd = 4 + recordCount * 8;
  if (recordCount === 0) throw fontInvalid();
  assertRange(cmap.length, 4, recordCount * 8);
  const validatedSubtables = new Set();
  const validatedRecordIndexes = [];
  const work = { mappings: 0 };
  let previousPlatform = -1;
  let previousEncoding = -1;
  for (let index = 0; index < recordCount; index += 1) {
    const record = 4 + index * 8;
    const platformId = cmap.readUInt16BE(record);
    const encodingId = cmap.readUInt16BE(record + 2);
    const offset = cmap.readUInt32BE(record + 4);
    if (platformId < previousPlatform || (platformId === previousPlatform && encodingId < previousEncoding)
      || offset < recordsEnd) throw fontInvalid();
    previousPlatform = platformId;
    previousEncoding = encodingId;
    assertRange(cmap.length, offset, 2);
    const format = cmap.readUInt16BE(offset);
    validateCmapRecord(format, platformId, encodingId);
    const key = `${offset}:${format}`;
    if (!validatedSubtables.has(key)) {
      validateCmapSubtable(cmap, offset, format, numGlyphs, work);
      validatedSubtables.add(key);
      validatedRecordIndexes.push(index);
    }
  }
  return validatedRecordIndexes;
}

function validateSimpleGlyph(glyf, start, end, contourCount, maxp, declaredBounds) {
  let cursor = start + 10;
  if (contourCount === 0 && cursor === end) {
    if (Object.values(declaredBounds).some(value => value !== 0)) throw fontInvalid();
    return [];
  }
  assertRange(end, cursor, contourCount * 2 + 2);
  let finalEndpoint = -1;
  for (let index = 0; index < contourCount; index += 1) {
    const endpoint = glyf.readUInt16BE(cursor + index * 2);
    if (endpoint <= finalEndpoint) throw fontInvalid();
    finalEndpoint = endpoint;
  }
  cursor += contourCount * 2;
  const instructionLength = glyf.readUInt16BE(cursor);
  cursor += 2;
  assertRange(end, cursor, instructionLength);
  cursor += instructionLength;
  const pointCount = finalEndpoint + 1;
  if (contourCount > maxp.maxContours || pointCount > maxp.maxPoints
    || instructionLength > maxp.maxInstructionBytes) throw fontInvalid();

  const flags = [];
  while (flags.length < pointCount) {
    assertRange(end, cursor, 1);
    const flag = glyf[cursor++];
    if (flag & 0x80 || (flag & 0x40 && flags.length > 0)) throw fontInvalid();
    let repetitions = 0;
    if (flag & 0x08) {
      assertRange(end, cursor, 1);
      repetitions = glyf[cursor++];
    }
    if (flags.length + repetitions + 1 > pointCount) throw fontInvalid();
    for (let index = 0; index <= repetitions; index += 1) flags.push(flag);
  }

  let x = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const flag of flags) {
    if (flag & 0x02) {
      assertRange(end, cursor, 1);
      const delta = glyf[cursor++];
      x += flag & 0x10 ? delta : -delta;
    } else if (!(flag & 0x10)) {
      assertRange(end, cursor, 2);
      x += glyf.readInt16BE(cursor);
      cursor += 2;
    }
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
  }

  let y = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const flag of flags) {
    if (flag & 0x04) {
      assertRange(end, cursor, 1);
      const delta = glyf[cursor++];
      y += flag & 0x20 ? delta : -delta;
    } else if (!(flag & 0x20)) {
      assertRange(end, cursor, 2);
      y += glyf.readInt16BE(cursor);
      cursor += 2;
    }
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  if (pointCount === 0) {
    if (Object.values(declaredBounds).some(value => value !== 0)) throw fontInvalid();
  } else if (xMin !== declaredBounds.xMin || yMin !== declaredBounds.yMin
    || xMax !== declaredBounds.xMax || yMax !== declaredBounds.yMax) throw fontInvalid();
  if (end - cursor > 3) throw fontInvalid();
  assertNullBytes(glyf, cursor, end);
  return [];
}

function validateCompositeGlyph(glyf, start, end, glyphId, numGlyphs, maxp) {
  let cursor = start + 10;
  let flags = 0x20;
  let componentCount = 0;
  let hasInstructions = false;
  const components = [];
  while (flags & 0x20) {
    assertRange(end, cursor, 4);
    flags = glyf.readUInt16BE(cursor);
    const componentGlyph = glyf.readUInt16BE(cursor + 2);
    cursor += 4;
    const transformCount = Number(Boolean(flags & 0x0008))
      + Number(Boolean(flags & 0x0040)) + Number(Boolean(flags & 0x0080));
    if (flags & 0xe010 || transformCount > 1 || (flags & 0x0800 && flags & 0x1000)
      || (componentCount === 0 && !(flags & 0x0002))
      || componentGlyph >= numGlyphs || componentGlyph === glyphId) throw fontInvalid();
    const argumentBytes = flags & 0x0001 ? 4 : 2;
    const transformBytes = flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0;
    assertRange(end, cursor, argumentBytes + transformBytes);
    cursor += argumentBytes + transformBytes;
    hasInstructions ||= Boolean(flags & 0x0100);
    componentCount += 1;
    if (componentCount > maxp.maxComponentElements) throw fontInvalid();
    components.push(componentGlyph);
  }
  if (componentCount === 0) throw fontInvalid();
  if (hasInstructions) {
    assertRange(end, cursor, 2);
    const instructionLength = glyf.readUInt16BE(cursor);
    cursor += 2;
    assertRange(end, cursor, instructionLength);
    cursor += instructionLength;
    if (instructionLength > maxp.maxInstructionBytes) throw fontInvalid();
  }
  if (end - cursor > 3) throw fontInvalid();
  assertNullBytes(glyf, cursor, end);
  return components;
}

function validateCompositeGraph(componentsByGlyph, maximumDepth) {
  const states = new Uint8Array(componentsByGlyph.length);
  const depths = new Uint16Array(componentsByGlyph.length);
  for (let root = 0; root < componentsByGlyph.length; root += 1) {
    if (states[root] !== 0) continue;
    const stack = [{ glyph: root, childIndex: 0 }];
    states[root] = 1;
    while (stack.length > 0) {
      const frame = stack.at(-1);
      const children = componentsByGlyph[frame.glyph];
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex++];
        if (states[child] === 1) throw fontInvalid();
        if (states[child] === 0) {
          states[child] = 1;
          stack.push({ glyph: child, childIndex: 0 });
        }
      } else {
        let depth = 0;
        for (const child of children) depth = Math.max(depth, depths[child] + 1);
        if (depth > maximumDepth) throw fontInvalid();
        depths[frame.glyph] = depth;
        states[frame.glyph] = 2;
        stack.pop();
      }
    }
  }
}

function validateTrueTypeOutlines(tables, head, maxp) {
  const glyf = tables.get('glyf');
  const loca = tables.get('loca');
  if (!glyf && !loca) return;
  if (!glyf || !loca || maxp.version !== 0x00010000 || ![0, 1].includes(head.indexToLocFormat)) {
    throw fontInvalid();
  }
  const entryBytes = head.indexToLocFormat === 0 ? 2 : 4;
  if (loca.length !== (maxp.numGlyphs + 1) * entryBytes) throw fontInvalid();
  const offsets = [];
  for (let index = 0; index <= maxp.numGlyphs; index += 1) {
    const offset = head.indexToLocFormat === 0
      ? loca.readUInt16BE(index * 2) * 2
      : loca.readUInt32BE(index * 4);
    if (offset > glyf.length || (index > 0 && offset < offsets[index - 1])) throw fontInvalid();
    offsets.push(offset);
  }
  if (offsets.at(-1) !== glyf.length) throw fontInvalid();

  const componentsByGlyph = Array.from({ length: maxp.numGlyphs }, () => []);
  for (let glyphId = 0; glyphId < maxp.numGlyphs; glyphId += 1) {
    const start = offsets[glyphId];
    const end = offsets[glyphId + 1];
    if (start === end) continue;
    if (end - start < 10) throw fontInvalid();
    const contourCount = glyf.readInt16BE(start);
    const xMin = glyf.readInt16BE(start + 2);
    const yMin = glyf.readInt16BE(start + 4);
    const xMax = glyf.readInt16BE(start + 6);
    const yMax = glyf.readInt16BE(start + 8);
    if (xMin > xMax || yMin > yMax) throw fontInvalid();
    componentsByGlyph[glyphId] = contourCount >= 0
      ? validateSimpleGlyph(glyf, start, end, contourCount, maxp, { xMin, yMin, xMax, yMax })
      : validateCompositeGlyph(glyf, start, end, glyphId, maxp.numGlyphs, maxp);
  }
  validateCompositeGraph(componentsByGlyph, maxp.maxComponentDepth);
}

function validateHeadAndMaxp(head, maxp, hasTrueTypeOutlines) {
  if (head.length !== 54 || head.readUInt32BE(0) !== 0x00010000
    || head.readUInt32BE(12) !== 0x5f0f3cf5
    || head.readUInt16BE(18) < 16 || head.readUInt16BE(18) > 16_384
    || ![0, 1].includes(head.readInt16BE(50)) || head.readInt16BE(52) !== 0) throw fontInvalid();
  if (maxp.length < 6) throw fontInvalid();
  const version = maxp.readUInt32BE(0);
  const numGlyphs = maxp.readUInt16BE(4);
  if (numGlyphs === 0 || (version === 0x00005000 && maxp.length !== 6)
    || (version === 0x00010000 && maxp.length !== 32)
    || ![0x00005000, 0x00010000].includes(version)
    || (hasTrueTypeOutlines && version !== 0x00010000)) throw fontInvalid();
  return {
    version,
    numGlyphs,
    maxPoints: version === 0x00010000 ? maxp.readUInt16BE(6) : 0,
    maxContours: version === 0x00010000 ? maxp.readUInt16BE(8) : 0,
    maxInstructionBytes: version === 0x00010000 ? maxp.readUInt16BE(26) : 0,
    maxComponentElements: version === 0x00010000 ? maxp.readUInt16BE(28) : 0,
    maxComponentDepth: version === 0x00010000 ? maxp.readUInt16BE(30) : 0,
  };
}

function validateSfnt(sfnt, expectedLength, verifyChecksums) {
  if (!Buffer.isBuffer(sfnt) || sfnt.length !== expectedLength || sfnt.length > MAX_FONT_SFNT_BYTES
    || sfnt.length < SFNT_HEADER_BYTES) throw fontInvalid();

  const tableCount = sfnt.readUInt16BE(4);
  const directoryEnd = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_DIRECTORY_BYTES;
  if (tableCount === 0 || directoryEnd > sfnt.length) throw fontInvalid();

  const tables = new Map();
  const ranges = [];
  let previousTag = null;
  for (let index = 0; index < tableCount; index += 1) {
    const entry = SFNT_HEADER_BYTES + index * SFNT_TABLE_DIRECTORY_BYTES;
    const tag = sfnt.toString('ascii', entry, entry + 4);
    const checksum = sfnt.readUInt32BE(entry + 4);
    const offset = sfnt.readUInt32BE(entry + 8);
    const length = sfnt.readUInt32BE(entry + 12);
    if (!tag || tables.has(tag) || length === 0 || offset % 4 !== 0
      || offset < directoryEnd || !hasValidRange(sfnt.length, offset, length)) throw fontInvalid();
    const tagBytes = sfnt.subarray(entry, entry + 4);
    if (previousTag && Buffer.compare(previousTag, tagBytes) >= 0) throw fontInvalid();
    previousTag = tagBytes;
    const table = sfnt.subarray(offset, offset + length);
    if (verifyChecksums && tableChecksum(table, tag === 'head') !== checksum) throw fontInvalid();
    tables.set(tag, table);
    ranges.push({ offset, end: offset + length, paddedEnd: alignToFour(offset + length) });
  }
  ranges.sort((left, right) => left.offset - right.offset);
  let expectedOffset = directoryEnd;
  for (const range of ranges) {
    if (range.offset !== expectedOffset) throw fontInvalid();
    assertNullBytes(sfnt, range.end, range.paddedEnd);
    expectedOffset = range.paddedEnd;
  }
  if (expectedOffset !== sfnt.length || (verifyChecksums && tableChecksum(sfnt) !== 0xb1b0afba)) {
    throw fontInvalid();
  }

  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const cmap = tables.get('cmap');
  const name = tables.get('name');
  if (!head || !maxp || !cmap || !name) throw fontInvalid();
  const maxpValues = validateHeadAndMaxp(head, maxp, tables.has('glyf') || tables.has('loca'));
  const headValues = { indexToLocFormat: head.readInt16BE(50) };
  validateNameTable(name);
  const cmapRecordIndexes = validateCmapTable(cmap, maxpValues.numGlyphs);
  validateTrueTypeOutlines(tables, headValues, maxpValues);
  return { tables, numGlyphs: maxpValues.numGlyphs, cmapRecordIndexes };
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
  let headOffset;
  for (const table of tables.sort((left, right) => Buffer.compare(
    Buffer.from(left.tag, 'ascii'), Buffer.from(right.tag, 'ascii'),
  ))) {
    sfnt.write(table.tag, directoryOffset, 4, 'ascii');
    sfnt.writeUInt32BE(table.checksum, directoryOffset + 4);
    sfnt.writeUInt32BE(dataOffset, directoryOffset + 8);
    sfnt.writeUInt32BE(table.data.length, directoryOffset + 12);
    table.data.copy(sfnt, dataOffset);
    if (table.tag === 'head') headOffset = dataOffset;
    directoryOffset += SFNT_TABLE_DIRECTORY_BYTES;
    dataOffset += alignToFour(table.data.length);
  }
  if (headOffset !== undefined) {
    sfnt.writeUInt32BE(0, headOffset + 8);
    sfnt.writeUInt32BE((0xb1b0afba - tableChecksum(sfnt)) >>> 0, headOffset + 8);
  }
  return sfnt;
}

function inflateExactly(body, expectedLength) {
  if (expectedLength === 0 || expectedLength > MAX_FONT_SFNT_BYTES) throw fontInvalid();
  try {
    const inflated = inflateSync(body, { info: true, maxOutputLength: expectedLength });
    if (inflated.buffer.length !== expectedLength || inflated.engine.bytesWritten !== body.length) {
      throw fontInvalid();
    }
    return inflated.buffer;
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw fontInvalid();
  }
}

function validateWoffMetadata(metadata) {
  let depth = 0;
  let roots = 0;
  let root;
  let invalid = false;
  const parser = new SaxesParser();
  parser.on('error', () => { invalid = true; });
  parser.on('doctype', () => { invalid = true; });
  parser.on('opentag', tag => {
    if (depth === 0) {
      root = tag;
      roots += 1;
    }
    depth += 1;
  });
  parser.on('closetag', () => { depth -= 1; });
  parser.on('text', text => {
    if (depth === 0 && text.trim()) invalid = true;
  });
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(metadata);
    parser.write(source).close();
  } catch {
    invalid = true;
  }
  if (invalid || depth !== 0 || roots !== 1 || root?.name !== 'metadata'
    || root?.attributes?.version !== '1.0') throw fontInvalid();
}

function validateWoff(body) {
  const tableCount = body.readUInt16BE(12);
  const directoryEnd = WOFF_HEADER_BYTES + tableCount * WOFF_TABLE_DIRECTORY_BYTES;
  const expectedLength = body.readUInt32BE(16);
  if (directoryEnd > body.length || expectedLength > MAX_FONT_SFNT_BYTES) throw fontInvalid();

  const tables = [];
  const seenTags = new Set();
  const containerRanges = [];
  let previousTag = null;
  let decodedLength = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_DIRECTORY_BYTES;
  for (let index = 0; index < tableCount; index += 1) {
    const entry = WOFF_HEADER_BYTES + index * WOFF_TABLE_DIRECTORY_BYTES;
    const tag = body.toString('ascii', entry, entry + 4);
    const offset = body.readUInt32BE(entry + 4);
    const compressedLength = body.readUInt32BE(entry + 8);
    const originalLength = body.readUInt32BE(entry + 12);
    const checksum = body.readUInt32BE(entry + 16);
    const tagBytes = body.subarray(entry, entry + 4);
    if (!tag || seenTags.has(tag) || originalLength === 0 || compressedLength === 0
      || compressedLength > originalLength || offset < directoryEnd || offset % 4 !== 0
      || (previousTag && Buffer.compare(previousTag, tagBytes) >= 0)
      || !hasValidRange(body.length, offset, compressedLength)) throw fontInvalid();
    previousTag = tagBytes;
    decodedLength += alignToFour(originalLength);
    if (decodedLength > MAX_FONT_SFNT_BYTES) throw fontInvalid();
    const encoded = body.subarray(offset, offset + compressedLength);
    const data = compressedLength < originalLength ? inflateExactly(encoded, originalLength) : encoded;
    if (tableChecksum(data, tag === 'head') !== checksum) throw fontInvalid();
    seenTags.add(tag);
    containerRanges.push({ offset, end: offset + compressedLength, paddedEnd: alignToFour(offset + compressedLength) });
    tables.push({ tag, checksum, data });
  }
  if (decodedLength !== expectedLength) throw fontInvalid();
  containerRanges.sort((left, right) => left.offset - right.offset);
  let containerOffset = directoryEnd;
  for (const range of containerRanges) {
    if (range.offset !== containerOffset) throw fontInvalid();
    assertNullBytes(body, range.end, range.paddedEnd);
    containerOffset = range.paddedEnd;
  }

  const metadataOffset = body.readUInt32BE(24);
  const metadataLength = body.readUInt32BE(28);
  const metadataOriginalLength = body.readUInt32BE(32);
  const privateOffset = body.readUInt32BE(36);
  const privateLength = body.readUInt32BE(40);
  if ((metadataOffset === 0) !== (metadataLength === 0) || (metadataLength === 0) !== (metadataOriginalLength === 0)
    || (privateOffset === 0) !== (privateLength === 0)
    || (metadataLength > 0 && (metadataOffset % 4 !== 0 || metadataOffset !== containerOffset
      || !hasValidRange(body.length, metadataOffset, metadataLength)))
    || (privateLength > 0 && (privateOffset % 4 !== 0
      || !hasValidRange(body.length, privateOffset, privateLength)))) throw fontInvalid();
  if (metadataLength > 0) {
    const metadata = inflateExactly(
      body.subarray(metadataOffset, metadataOffset + metadataLength), metadataOriginalLength,
    );
    validateWoffMetadata(metadata);
    containerOffset = metadataOffset + metadataLength;
  }
  if (privateLength > 0) {
    const privateStart = alignToFour(containerOffset);
    if (privateOffset !== privateStart) throw fontInvalid();
    assertNullBytes(body, containerOffset, privateStart);
    containerOffset = privateOffset + privateLength;
  }
  if (containerOffset !== body.length) throw fontInvalid();
  const sfnt = buildSfnt(body.readUInt32BE(4), tables, expectedLength);
  return sfnt;
}

function readBase128(body, state) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (state.offset >= body.length || value & 0xe0000000) throw fontInvalid();
    const byte = body[state.offset++];
    if (index === 0 && byte === 0x80) throw fontInvalid();
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

function forceFontkitValidation(sfnt, expectedGlyphs, cmapRecordIndexes) {
  const font = fontkit.create(sfnt);
  if (!Number.isSafeInteger(font.numGlyphs) || font.numGlyphs !== expectedGlyphs
    || !font.name || !font.cmap || !Array.isArray(font.cmap.tables)) throw fontInvalid();
  for (const tag of Object.keys(font.directory.tables)) {
    if (tag === 'glyf') continue;
    const descriptor = Object.getOwnPropertyDescriptor(font, tag);
    if (descriptor?.get && font[tag] === undefined) throw fontInvalid();
  }
  for (const recordIndex of cmapRecordIndexes) {
    const record = font.cmap.tables[recordIndex];
    if (!record?.table) throw fontInvalid();
  }
  for (let glyphId = 0; glyphId < font.numGlyphs; glyphId += 1) {
    const glyph = font.getGlyph(glyphId);
    if (!glyph || !Array.isArray(glyph.path?.commands) || !Number.isFinite(glyph.advanceWidth)) {
      throw fontInvalid();
    }
  }
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
    const validated = validateSfnt(sfnt, expectedLength, true);
    forceFontkitValidation(sfnt, validated.numGlyphs, validated.cmapRecordIndexes);
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

function canonicalDetectedMimeType(mimeType) {
  return ({ 'audio/x-wav': 'audio/wav', 'image/jpg': 'image/jpeg' })[mimeType] || mimeType;
}

async function detectMimeTypeFromFile(file) {
  try {
    const { fileTypeFromFile } = await import('file-type');
    const detected = await fileTypeFromFile(file);
    return detected ? canonicalDetectedMimeType(detected.mime) : null;
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

async function probeDuration(temporaryFile) {
  try {
    const output = await execFfprobe(temporaryFile);
    const seconds = Number(JSON.parse(output).format?.duration);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset duration is invalid');
    }
    return Math.round(seconds * 1000);
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw inspectionError('ASSET_INSPECTION_PROBE_FAILED', 'Unable to inspect asset duration');
  }
}

async function writeAll(fileHandle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await fileHandle.write(chunk, offset, chunk.length - offset, null);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw inspectionError('ASSET_INSPECTION_INVALID', 'Unable to write temporary asset file');
    }
    offset += bytesWritten;
  }
}

async function spoolMediaStream({ stream, fileHandle, maximum, declaredBytes }) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset body must be a readable stream');
  }

  const hash = createHash('sha256');
  let byteSize = 0;
  try {
    for await (const piece of stream) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      if (chunk.length > maximum - byteSize) {
        stream.destroy();
        throw inspectionError('ASSET_INSPECTION_TOO_LARGE', 'Asset exceeds its size limit');
      }
      if (chunk.length > declaredBytes - byteSize) {
        stream.destroy();
        throw inspectionError('ASSET_INSPECTION_SIZE_MISMATCH', 'Asset size does not match its declaration');
      }
      await writeAll(fileHandle, chunk);
      hash.update(chunk);
      byteSize += chunk.length;
    }
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Unable to read asset body');
  }
  if (byteSize !== declaredBytes) {
    throw inspectionError('ASSET_INSPECTION_SIZE_MISMATCH', 'Asset size does not match its declaration');
  }
  return { byteSize, sha256: hash.digest('hex') };
}

async function closeApprovedStream(stream) {
  if (!stream || stream.closed) return;
  await new Promise(resolve => {
    stream.once('close', resolve);
    stream.destroy();
    if (stream.closed) resolve();
  });
}

async function inspectStreamedMedia({
  stream,
  declaredBytes,
  mimeType,
  rule,
  consumeApprovedBody,
}) {
  const extension = EXTENSIONS[mimeType];
  const temporaryFile = path.join(tmpdir(), `webinar-asset-${randomUUID()}${extension}`);
  let fileHandle;
  let approvedStream;
  let created = false;
  let failure;
  let outcome;

  try {
    fileHandle = await open(temporaryFile, 'wx', 0o600);
    created = true;
    const content = await spoolMediaStream({
      stream,
      fileHandle,
      maximum: rule.maxBytes,
      declaredBytes,
    });
    await fileHandle.close();
    fileHandle = null;

    const actualMimeType = await detectMimeTypeFromFile(temporaryFile);
    if (!actualMimeType) {
      throw inspectionError('ASSET_INSPECTION_UNSUPPORTED', 'Asset bytes are not an approved media type');
    }
    if (actualMimeType !== mimeType) {
      throw inspectionError('ASSET_INSPECTION_MIME_MISMATCH', 'Asset MIME type does not match its bytes');
    }
    const inspected = {
      mediaType: rule.mediaType,
      mimeType,
      byteSize: content.byteSize,
      sha256: content.sha256,
      width: null,
      height: null,
      durationMs: await probeDuration(temporaryFile),
    };

    if (typeof consumeApprovedBody === 'function') {
      approvedStream = createReadStream(temporaryFile, { flags: 'r' });
      try {
        outcome = await consumeApprovedBody({ ...inspected, approvedBody: approvedStream });
      } catch (error) {
        failure = error;
      }
    } else {
      outcome = inspected;
    }
  } catch (error) {
    if (!failure) {
      failure = error instanceof AssetInspectionError
        ? error
        : inspectionError('ASSET_INSPECTION_INVALID', 'Asset inspection failed');
    }
  } finally {
    try {
      await closeApprovedStream(approvedStream);
    } catch {
      if (!failure) {
        failure = inspectionError('ASSET_INSPECTION_CLEANUP_FAILED', 'Unable to close temporary asset stream');
      }
    }
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        if (!failure) {
          failure = inspectionError('ASSET_INSPECTION_CLEANUP_FAILED', 'Unable to close temporary asset file');
        }
      }
    }
    if (created) {
      try {
        await rm(temporaryFile, { force: true });
      } catch {
        if (!failure) {
          failure = inspectionError('ASSET_INSPECTION_CLEANUP_FAILED', 'Unable to remove temporary asset file');
        }
      }
    }
  }

  if (failure) throw failure;
  return outcome;
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

async function inspectAsset({
  stream,
  declaredMimeType,
  declaredBytes,
  filename,
  consumeApprovedBody,
} = {}) {
  const mimeType = normalizedMimeType(declaredMimeType);
  const rule = MEDIA_RULES[mimeType];
  if (!rule || typeof filename !== 'string' || !filename.trim() || !Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset metadata is invalid');
  }
  if (declaredBytes > rule.maxBytes) {
    throw inspectionError('ASSET_INSPECTION_TOO_LARGE', 'Asset exceeds its size limit');
  }

  if (rule.mediaType === 'audio' || rule.mediaType === 'video') {
    return inspectStreamedMedia({
      stream,
      declaredBytes,
      mimeType,
      rule,
      consumeApprovedBody,
    });
  }

  let inspected;
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
    inspected = {
      mediaType: rule.mediaType,
      mimeType,
      byteSize: approvedBody.length,
      sha256: createHash('sha256').update(approvedBody).digest('hex'),
      width: dimensions.width ?? null,
      height: dimensions.height ?? null,
      durationMs: null,
      approvedBody,
    };
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset inspection failed');
  }
  return typeof consumeApprovedBody === 'function'
    ? consumeApprovedBody(inspected)
    : inspected;
}

module.exports = {
  AssetInspectionError,
  inspectAsset,
  sanitizeSvg,
};
