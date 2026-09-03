const { parseDocument } = require('htmlparser2');
const postcss = require('postcss');
const acorn = require('acorn');

const LIMITS = Object.freeze({
  master_html: 250 * 1024,
  master_css: 500 * 1024,
  slide_html: 250 * 1024,
  slide_css: 250 * 1024,
  slide_javascript: 500 * 1024,
  request: 2 * 1024 * 1024,
});

const ASSET_TOKEN = /^\{\{ASSET:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\}\}$/i;
const ANCHOR = /^[a-z][a-z0-9-]{0,189}$/;
const FORBIDDEN_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'form', 'base']);

function freezeOrigins(value) {
  return Object.freeze(value);
}

function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function exactHttpsOrigins(value) {
  if (typeof value !== 'string') return freezeOrigins([]);
  return freezeOrigins([...new Set(value.split(',').map(exactHttpsOrigin).filter(Boolean))]);
}

function loadResourcePolicy(env = process.env) {
  return Object.freeze({
    assetOrigin: exactHttpsOrigin(env.WEBINAR_ASSET_CDN_BASE_URL),
    stylesheetOrigins: exactHttpsOrigins(env.WEBINAR_EXTERNAL_STYLE_ORIGINS),
    fontOrigins: exactHttpsOrigins(env.WEBINAR_EXTERNAL_FONT_ORIGINS),
  });
}

function issue(code, surface, extra = {}) {
  return { code, surface, ...extra };
}

function resourceIssue(value, surface, resourcePolicy, allowedOrigins) {
  const token = ASSET_TOKEN.exec(value);
  if (token) {
    return resourcePolicy.assetOrigin ? null : issue('ASSET_ORIGIN_NOT_CONFIGURED', surface);
  }

  const normalized = value.trim();
  if (!normalized || normalized.startsWith('#')) return null;
  if (/^(?:javascript|vbscript):/i.test(normalized)) return issue('EXECUTABLE_URL', surface);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return issue('RESOURCE_NOT_HTTPS', surface);
  }
  if (parsed.protocol !== 'https:') return issue('RESOURCE_NOT_HTTPS', surface);
  const allowed = new Set([resourcePolicy.assetOrigin, ...allowedOrigins].filter(Boolean));
  return allowed.has(parsed.origin) ? null : issue('RESOURCE_ORIGIN_FORBIDDEN', surface);
}

function allowedOriginsForElement(tagName, attributes, resourcePolicy) {
  if (tagName === 'link') {
    const relation = (attributes.rel || '').toLowerCase().split(/\s+/);
    if (relation.includes('stylesheet')) return resourcePolicy.stylesheetOrigins;
    if (attributes.as === 'font') return resourcePolicy.fontOrigins;
  }
  return [];
}

function validateHtml(source, surface, resourcePolicy = loadResourcePolicy()) {
  const issues = [];
  const document = parseDocument(source);
  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
        visit(node.children);
        continue;
      }
      const name = String(node.name || '').toLowerCase();
      const attributes = node.attribs || {};
      if (FORBIDDEN_ELEMENTS.has(name) || (name === 'meta' && Object.prototype.hasOwnProperty.call(attributes, 'http-equiv'))) {
        issues.push(issue('FORBIDDEN_HTML', surface, { element: name }));
      }
      for (const [attribute, rawValue] of Object.entries(attributes)) {
        const attributeName = attribute.toLowerCase();
        const value = String(rawValue || '');
        if (attributeName.startsWith('on') || attributeName === 'srcdoc') {
          issues.push(issue('FORBIDDEN_ATTRIBUTE', surface, { attribute: attributeName }));
          continue;
        }
        if (['src', 'href', 'action', 'poster', 'background', 'data'].includes(attributeName)) {
          const resource = resourceIssue(value, surface, resourcePolicy, allowedOriginsForElement(name, attributes, resourcePolicy));
          if (resource) issues.push(resource);
        }
      }
      visit(node.children);
    }
  };
  visit(document.children);
  return { issues };
}

function validateMasterHtml(source, resourcePolicy = loadResourcePolicy()) {
  const tokenCount = String(source).split('{{SLIDE_CONTENT}}').length - 1;
  const result = validateHtml(source, 'master_html', resourcePolicy);
  if (tokenCount !== 1) result.issues.unshift(issue('MASTER_TOKEN_COUNT', 'master_html'));
  return result;
}

function validateSlideHtml(source, resourcePolicy = loadResourcePolicy()) {
  return validateHtml(source, 'slide_html', resourcePolicy);
}

function validateCssUrl(value, surface, resourcePolicy, allowedOrigins) {
  return resourceIssue(value, surface, resourcePolicy, allowedOrigins);
}

function validateCss(source, surface, resourcePolicy = loadResourcePolicy()) {
  try {
    const root = postcss.parse(source);
    const issues = [];
    root.walkAtRules('import', rule => {
      const match = rule.params.match(/^(?:url\(\s*)?(?:['"])(.*?)['"]\s*\)?/i)
        || rule.params.match(/^url\(\s*(.*?)\s*\)/i);
      if (!match) {
        issues.push(issue('CSS_IMPORT_INVALID', surface));
        return;
      }
      const resource = validateCssUrl(match[1].trim(), surface, resourcePolicy, resourcePolicy.stylesheetOrigins);
      if (resource) issues.push(resource);
    });
    root.walkDecls(declaration => {
      const urls = declaration.value.matchAll(/url\(\s*(?:['"]([^'"]*)['"]|([^\s)]+))\s*\)/gi);
      for (const match of urls) {
        const resource = validateCssUrl(match[1] ?? match[2], surface, resourcePolicy, resourcePolicy.fontOrigins);
        if (resource) issues.push(resource);
      }
    });
    return { issues };
  } catch (error) {
    return { issues: [issue('CSS_SYNTAX', surface, { line: error.line || null, column: error.column || null })] };
  }
}

function validateJavascript(source) {
  try {
    acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: false });
    return { issues: [] };
  } catch (error) {
    return { issues: [issue('JAVASCRIPT_SYNTAX', 'slide_javascript', { line: error.loc?.line || null, column: error.loc?.column || null })] };
  }
}

function validateAnchor(anchor) {
  return ANCHOR.test(anchor) ? { issues: [] } : { issues: [issue('ANCHOR_FORMAT', 'anchor')] };
}

function candidateValues(candidate) {
  const values = [
    ['master_html', candidate.masterHtml],
    ['master_css', candidate.masterCss],
  ];
  for (const slide of candidate.slides || []) {
    values.push(
      ['slide_html', slide.html],
      ['slide_css', slide.css],
      ['slide_javascript', slide.javascript],
    );
  }
  return values;
}

function assertCandidateWithinLimits(candidate) {
  const issues = [];
  for (const [surface, value] of candidateValues(candidate || {})) {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > LIMITS[surface]) {
      issues.push(issue('CONTENT_LIMIT_EXCEEDED', surface));
    }
  }
  if (Buffer.byteLength(JSON.stringify(candidate || {}), 'utf8') > LIMITS.request) {
    issues.push(issue('CONTENT_LIMIT_EXCEEDED', 'request'));
  }
  if (issues.length) {
    const error = new Error('Webinar content exceeds configured limits');
    error.code = 'CONTENT_LIMIT_EXCEEDED';
    error.issues = issues;
    throw error;
  }
}

module.exports = {
  LIMITS,
  loadResourcePolicy,
  validateMasterHtml,
  validateSlideHtml,
  validateCss,
  validateJavascript,
  validateAnchor,
  assertCandidateWithinLimits,
};
