const ASSET_VERSION_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ASSET_TOKEN_PATTERN = new RegExp(`\\{\\{ASSET:(${ASSET_VERSION_ID})\\}\\}`, 'i');
const ASSET_TOKEN_AT_START = new RegExp(`^\\{\\{ASSET:(${ASSET_VERSION_ID})\\}\\}`, 'i');
const ASSET_TOKEN_GLOBAL = new RegExp(`\\{\\{ASSET:(${ASSET_VERSION_ID})\\}\\}`, 'gi');
const ASSET_TOKEN_MARKER = /\{\{ASSET:/gi;

function assetTokenError(code) {
  const error = new Error(code === 'ASSET_TOKEN_FORMAT'
    ? 'Asset token must contain a canonical UUID version ID'
    : 'Asset token could not be resolved to an available version URL');
  error.code = code;
  return error;
}

function assertSource(source) {
  if (typeof source !== 'string') throw assetTokenError('ASSET_TOKEN_FORMAT');
}

function extractAssetVersionIds(source) {
  assertSource(source);

  const marker = new RegExp(ASSET_TOKEN_MARKER);
  for (const match of source.matchAll(marker)) {
    if (!ASSET_TOKEN_AT_START.test(source.slice(match.index))) {
      throw assetTokenError('ASSET_TOKEN_FORMAT');
    }
  }

  return Array.from(source.matchAll(new RegExp(ASSET_TOKEN_GLOBAL)), match => match[1]);
}

function replaceAssetTokens(source, urlsByVersionId) {
  extractAssetVersionIds(source);

  return source.replace(new RegExp(ASSET_TOKEN_GLOBAL), (_token, assetVersionId) => {
    const url = urlsByVersionId?.get?.(assetVersionId);
    if (typeof url !== 'string' || !url) throw assetTokenError('ASSET_TOKEN_UNRESOLVED');
    return url;
  });
}

function collectSurfaceTokens(candidate) {
  const references = [];
  const seen = new Set();
  const addSurface = (slideId, surface, source) => {
    for (const assetVersionId of extractAssetVersionIds(source ?? '')) {
      const key = `${slideId ?? ''}\u0000${surface}\u0000${assetVersionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ slideId, surface, assetVersionId });
    }
  };

  addSurface(null, 'master_html', candidate?.masterHtml);
  addSurface(null, 'master_css', candidate?.masterCss);
  for (const slide of candidate?.slides || []) {
    addSurface(slide.id, 'slide_html', slide.html);
    addSurface(slide.id, 'slide_css', slide.css);
    addSurface(slide.id, 'slide_javascript', slide.javascript);
  }
  return references;
}

module.exports = {
  ASSET_TOKEN_PATTERN,
  collectSurfaceTokens,
  extractAssetVersionIds,
  replaceAssetTokens,
};
