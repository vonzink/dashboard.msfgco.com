const { createHash } = require('node:crypto');
const db = require('../../db/connection');
const { loadAssetConfig: defaultLoadAssetConfig } = require('../webinarAssets/config');
const { createReferenceService } = require('../webinarAssets/references');
const { replaceAssetTokens } = require('../webinarAssets/tokens');
const {
  assertCandidateWithinLimits,
  exactHttpsOrigin,
  loadResourcePolicy: defaultLoadResourcePolicy,
  validateAnchor,
  validateCss,
  validateJavascript,
  validateMasterHtml,
  validateSlideHtml,
} = require('./contentPolicy');

const SLIDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_TITLE_LENGTH = 255;

const LIVE_BUNDLE_SQL = `SELECT p.id AS webinar_id, p.slug AS webinar_slug, p.title AS webinar_title,
       p.master_html, p.master_css, p.live_version,
       s.id AS slide_id, s.position AS slide_position, s.anchor AS slide_anchor,
       s.title AS slide_title, s.html AS slide_html, s.css AS slide_css,
       s.javascript AS slide_javascript
FROM webinar_presentations p
LEFT JOIN webinar_slides s
  ON s.webinar_id = p.id AND s.archived_at IS NULL
WHERE p.slug = ?
  AND p.archived_at IS NULL
  AND p.audience_enabled = 1
ORDER BY s.position ASC, s.id ASC`;

class PublicBundleError extends Error {
  constructor(cause) {
    super('Public webinar is temporarily unavailable', cause === undefined ? undefined : { cause });
    this.name = 'PublicBundleError';
    this.code = 'PUBLIC_BUNDLE_INVALID';
    this.status = 503;
  }
}

function fail(cause) {
  if (cause instanceof PublicBundleError) throw cause;
  throw new PublicBundleError(cause);
}

function integer(value, { positive = false } = {}) {
  if (value === '' || value === null || value === undefined) fail();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) fail();
  return number;
}

function string(value) {
  if (typeof value !== 'string') fail();
  return value;
}

function title(value) {
  const normalized = string(value);
  if (!normalized.trim() || normalized.length > MAX_TITLE_LENGTH) fail();
  return normalized;
}

function normalizeOrigin(value) {
  const origin = exactHttpsOrigin(value);
  if (!origin) fail();
  return origin;
}

function normalizeOriginList(value) {
  if (!Array.isArray(value)) fail();
  return [...new Set(value.map(normalizeOrigin))].sort();
}

function normalizeResourcePolicy(policy) {
  if (!policy || typeof policy !== 'object') fail();
  return {
    assetOrigin: normalizeOrigin(policy.assetOrigin),
    stylesheetOrigins: normalizeOriginList(policy.stylesheetOrigins),
    fontOrigins: normalizeOriginList(policy.fontOrigins),
  };
}

function sameWebinar(left, right) {
  return Number(left.webinar_id) === Number(right.webinar_id)
    && left.webinar_slug === right.webinar_slug
    && left.webinar_title === right.webinar_title
    && left.master_html === right.master_html
    && left.master_css === right.master_css
    && Number(left.live_version) === Number(right.live_version);
}

function validatePersistedContent(normalized, resourcePolicy) {
  const candidate = {
    webinarId: normalized.webinar.id,
    masterHtml: normalized.master.html,
    masterCss: normalized.master.css,
    slides: normalized.slides,
  };
  const issues = [
    ...validateMasterHtml(candidate.masterHtml, resourcePolicy).issues,
    ...validateCss(candidate.masterCss, 'master_css', resourcePolicy).issues,
  ];
  for (const slide of candidate.slides) {
    issues.push(
      ...validateSlideHtml(slide.html, resourcePolicy).issues,
      ...validateCss(slide.css, 'slide_css', resourcePolicy).issues,
      ...validateJavascript(slide.javascript).issues,
    );
  }
  if (issues.length) fail();
  try {
    assertCandidateWithinLimits(candidate, resourcePolicy);
  } catch (error) {
    fail(error);
  }
}

function normalizeRows(rows, resourcePolicy) {
  if (!Array.isArray(rows) || !rows.length) fail();
  const first = rows[0];
  const webinar = {
    id: integer(first.webinar_id, { positive: true }),
    slug: string(first.webinar_slug),
    title: title(first.webinar_title),
    liveVersion: integer(first.live_version),
  };
  const master = {
    html: string(first.master_html),
    css: string(first.master_css),
  };

  if (rows.some(row => !sameWebinar(first, row))) fail();
  if (validateAnchor(webinar.slug).issues.length) fail();

  const slides = [];
  const positions = new Set();
  const slideIds = new Set();
  const anchors = new Set();
  for (const row of rows) {
    if (row.slide_id === null || row.slide_id === undefined) {
      if (rows.length !== 1) fail();
      continue;
    }
    const position = integer(row.slide_position);
    const id = string(row.slide_id);
    const anchor = string(row.slide_anchor);
    if (!SLIDE_ID.test(id) || validateAnchor(anchor).issues.length
      || positions.has(position) || slideIds.has(id) || anchors.has(anchor)) fail();
    positions.add(position);
    slideIds.add(id);
    anchors.add(anchor);
    slides.push({
      id,
      position,
      anchor,
      title: title(row.slide_title),
      html: string(row.slide_html),
      css: string(row.slide_css),
      javascript: string(row.slide_javascript),
    });
  }
  slides.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  if (slides.some((slide, index) => slide.position !== index)) fail();
  const normalized = { webinar, master, slides };
  validatePersistedContent(normalized, resourcePolicy);
  return normalized;
}

function normalizedAssetEntries(assetUrls, assetOrigin) {
  if (!assetUrls || typeof assetUrls.entries !== 'function') fail();
  return [...assetUrls.entries()]
    .map(([versionId, publicUrl]) => {
      if (typeof versionId !== 'string' || typeof publicUrl !== 'string') fail();
      let parsed;
      try {
        parsed = new URL(publicUrl);
      } catch (error) {
        fail(error);
      }
      if (parsed.protocol !== 'https:' || parsed.origin !== assetOrigin
        || parsed.username || parsed.password || parsed.search || parsed.hash) fail();
      return [versionId, publicUrl];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function toPublicBundle(rows, assetUrls, policy = defaultLoadResourcePolicy()) {
  const resourcePolicy = normalizeResourcePolicy(policy);
  const normalized = normalizeRows(rows, resourcePolicy);
  const assets = Object.fromEntries(normalizedAssetEntries(assetUrls, resourcePolicy.assetOrigin));
  return {
    schemaVersion: 1,
    webinar: normalized.webinar,
    master: normalized.master,
    slides: normalized.slides,
    assets,
    resourcePolicy,
  };
}

function assertSourcesResolve(normalized, urlsByVersionId) {
  const sources = [normalized.master.html, normalized.master.css];
  for (const slide of normalized.slides) {
    sources.push(slide.html, slide.css, slide.javascript);
  }
  for (const source of sources) replaceAssetTokens(source, urlsByVersionId);
}

function createPublicBundleService({
  db: connectionPool = db,
  loadAssetConfig = defaultLoadAssetConfig,
  loadResourcePolicy = defaultLoadResourcePolicy,
} = {}) {
  async function getLiveBundleBySlug(slug) {
    if (typeof slug !== 'string' || !slug || slug.length > 190) return null;
    try {
      const [rows] = await connectionPool.query(LIVE_BUNDLE_SQL, [slug]);
      if (!rows[0]) return null;

      const resourcePolicy = normalizeResourcePolicy(loadResourcePolicy());
      const normalized = normalizeRows(rows, resourcePolicy);
      const assetConfig = loadAssetConfig();
      if (new URL(assetConfig.cdnBaseUrl).origin !== resourcePolicy.assetOrigin) fail();

      // The reviewed reference service owns the canonical availability, family,
      // checksum-path, and immutable public-URL checks. This entry point is pure.
      const referenceService = createReferenceService({ config: assetConfig });
      const resolved = await referenceService.resolveAvailableReferences(
        connectionPool,
        {
          webinarId: normalized.webinar.id,
          masterHtml: normalized.master.html,
          masterCss: normalized.master.css,
          slides: normalized.slides,
        },
      );
      assertSourcesResolve(normalized, resolved.urlsByVersionId);

      const bundle = toPublicBundle(rows, resolved.urlsByVersionId, resourcePolicy);
      const json = JSON.stringify(bundle);
      const etag = `"${createHash('sha256').update(json).digest('hex')}"`;
      return { bundle, json, etag };
    } catch (error) {
      fail(error);
    }
  }

  return { getLiveBundleBySlug };
}

const service = createPublicBundleService();

module.exports = {
  PublicBundleError,
  createPublicBundleService,
  getLiveBundleBySlug: service.getLiveBundleBySlug,
  toPublicBundle,
};
