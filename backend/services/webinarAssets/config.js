const MiB = 1024 * 1024;
const DEFAULT_INSPECTION_CONCURRENCY = 2;
const MAX_INSPECTION_CONCURRENCY = 8;

const MEDIA_RULES = Object.freeze({
  'image/png': Object.freeze({ mediaType: 'image', maxBytes: 20 * MiB }),
  'image/jpeg': Object.freeze({ mediaType: 'image', maxBytes: 20 * MiB }),
  'image/webp': Object.freeze({ mediaType: 'image', maxBytes: 20 * MiB }),
  'image/gif': Object.freeze({ mediaType: 'image', maxBytes: 20 * MiB }),
  'image/svg+xml': Object.freeze({ mediaType: 'svg', maxBytes: 5 * MiB }),
  'font/woff': Object.freeze({ mediaType: 'font', maxBytes: 10 * MiB }),
  'font/woff2': Object.freeze({ mediaType: 'font', maxBytes: 10 * MiB }),
  'audio/mpeg': Object.freeze({ mediaType: 'audio', maxBytes: 100 * MiB }),
  'audio/wav': Object.freeze({ mediaType: 'audio', maxBytes: 100 * MiB }),
  'video/mp4': Object.freeze({ mediaType: 'video', maxBytes: 500 * MiB }),
  'video/webm': Object.freeze({ mediaType: 'video', maxBytes: 500 * MiB }),
});

function assetConfigError(code) {
  const error = new Error(code === 'ASSET_CONFIG_MISSING'
    ? 'Webinar asset bucket and CDN URL must be configured'
    : 'Webinar asset configuration is invalid');
  error.code = code;
  return error;
}

function sanitizeFilename(filename) {
  if (typeof filename !== 'string') throw assetConfigError('ASSET_CONFIG_INVALID');
  const leaf = filename.replace(/\\/g, '/').split('/').filter(Boolean).pop()?.replace(/\0/g, '').trim();
  if (!leaf || leaf === '.' || leaf === '..') throw assetConfigError('ASSET_CONFIG_INVALID');
  return leaf;
}

function normalizeQuarantinePrefix(value) {
  const prefix = typeof value === 'string' && value.trim() ? value.trim() : 'quarantine/';
  const normalized = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw assetConfigError('ASSET_CONFIG_INVALID');
  }
  if (normalized === 'approved' || normalized.startsWith('approved/')) {
    throw assetConfigError('ASSET_CONFIG_INVALID');
  }
  return `${normalized}/`;
}

function normalizeInspectionConcurrency(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_INSPECTION_CONCURRENCY;
  const normalized = typeof value === 'string' ? value.trim() : value;
  const capacity = Number(normalized);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_INSPECTION_CONCURRENCY) {
    throw assetConfigError('ASSET_CONFIG_INVALID');
  }
  return capacity;
}

function loadInspectionConcurrency(env = process.env) {
  return normalizeInspectionConcurrency(env.WEBINAR_ASSET_INSPECTION_CONCURRENCY);
}

function loadAssetConfig(env = process.env) {
  const bucket = typeof env.WEBINAR_ASSET_BUCKET === 'string' ? env.WEBINAR_ASSET_BUCKET.trim() : '';
  const rawCdnBaseUrl = typeof env.WEBINAR_ASSET_CDN_BASE_URL === 'string'
    ? env.WEBINAR_ASSET_CDN_BASE_URL.trim()
    : '';
  if (!bucket || !rawCdnBaseUrl) throw assetConfigError('ASSET_CONFIG_MISSING');

  let parsed;
  try {
    parsed = new URL(rawCdnBaseUrl);
  } catch {
    throw assetConfigError('ASSET_CONFIG_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw assetConfigError('ASSET_CONFIG_INVALID');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  const cdnBaseUrl = `${parsed.origin}${pathname === '/' ? '' : pathname}`;
  return Object.freeze({
    bucket,
    cdnBaseUrl,
    quarantinePrefix: normalizeQuarantinePrefix(env.WEBINAR_ASSET_QUARANTINE_PREFIX),
    inspectionConcurrency: loadInspectionConcurrency(env),
  });
}

function makeQuarantineKey(versionId, filename, quarantinePrefix = 'quarantine/') {
  if (typeof versionId !== 'string' || !versionId.trim()) throw assetConfigError('ASSET_CONFIG_INVALID');
  return `${normalizeQuarantinePrefix(quarantinePrefix)}${versionId.trim()}/${sanitizeFilename(filename)}`;
}

function makeApprovedKey(sha256) {
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw assetConfigError('ASSET_CONFIG_INVALID');
  return `approved/sha256/${sha256}/asset`;
}

function makePublicUrl(config, approvedKey) {
  if (!config || typeof config.cdnBaseUrl !== 'string' || typeof approvedKey !== 'string') {
    throw assetConfigError('ASSET_CONFIG_INVALID');
  }
  if (approvedKey.startsWith(config.quarantinePrefix || 'quarantine/')) {
    const error = new Error('Quarantine assets are never public');
    error.code = 'ASSET_QUARANTINE_PRIVATE';
    throw error;
  }
  if (!approvedKey.startsWith('approved/')) throw assetConfigError('ASSET_CONFIG_INVALID');
  return `${config.cdnBaseUrl}/${approvedKey.split('/').map(encodeURIComponent).join('/')}`;
}

module.exports = {
  DEFAULT_INSPECTION_CONCURRENCY,
  MAX_INSPECTION_CONCURRENCY,
  MEDIA_RULES,
  loadAssetConfig,
  loadInspectionConcurrency,
  makeQuarantineKey,
  makeApprovedKey,
  makePublicUrl,
};
