const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');
const ffprobe = require('ffprobe-static');
const { parseDocument } = require('htmlparser2');
const { MEDIA_RULES } = require('./config');

const PROBE_TIMEOUT_MS = 10_000;
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

function svgRoot(source) {
  const document = parseDocument(source, {
    xmlMode: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
  });
  return document.children.find(node => node.type === 'tag' && node.name.toLowerCase() === 'svg');
}

function sanitizeSvg(source) {
  const sourceText = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(sourceText) || !svgRoot(sourceText)) {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'SVG source is invalid');
  }

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
  const root = svgRoot(sanitized);
  if (!root || root.name.toLowerCase() !== 'svg') {
    throw inspectionError('ASSET_INSPECTION_INVALID', 'SVG sanitization produced invalid markup');
  }
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

async function detectMimeType(body) {
  if (/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(body.toString('utf8'))) {
    return 'image/svg+xml';
  }
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(body);
  if (!detected) return null;
  return ({ 'audio/x-wav': 'audio/wav', 'image/jpg': 'image/jpeg' })[detected.mime] || detected.mime;
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
  try {
    await writeFile(temporaryFile, body, { flag: 'wx' });
    const output = await execFfprobe(temporaryFile);
    const seconds = Number(JSON.parse(output).format?.duration);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw inspectionError('ASSET_INSPECTION_INVALID', 'Asset duration is invalid');
    }
    return Math.round(seconds * 1000);
  } catch (error) {
    if (error instanceof AssetInspectionError) throw error;
    throw inspectionError('ASSET_INSPECTION_PROBE_FAILED', 'Unable to inspect asset duration');
  } finally {
    await rm(temporaryFile, { force: true });
  }
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

  const body = await readLimitedStream(stream, rule.maxBytes);
  if (body.length !== declaredBytes) {
    throw inspectionError('ASSET_INSPECTION_SIZE_MISMATCH', 'Asset size does not match its declaration');
  }

  const actualMimeType = await detectMimeType(body);
  if (!actualMimeType) throw inspectionError('ASSET_INSPECTION_UNSUPPORTED', 'Asset bytes are not an approved media type');
  if (actualMimeType !== mimeType) throw inspectionError('ASSET_INSPECTION_MIME_MISMATCH', 'Asset MIME type does not match its bytes');

  const approvedBody = rule.mediaType === 'svg' ? sanitizeSvg(body) : body;
  const dimensions = rule.mediaType === 'image'
    ? await sharp(approvedBody, { failOn: 'error' }).metadata()
    : {};
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
}

module.exports = {
  AssetInspectionError,
  inspectAsset,
  sanitizeSvg,
};
