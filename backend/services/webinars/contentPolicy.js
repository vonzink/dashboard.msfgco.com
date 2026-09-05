const { parseDocument } = require('htmlparser2');
const postcss = require('postcss');
const acorn = require('acorn');
const { LIMITS } = require('./limits');

const ASSET_TOKEN = /^\{\{ASSET:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\}\}$/i;
const ASSET_TOKEN_MARKER = /\{\{ASSET:/ig;
const ANCHOR = /^[a-z][a-z0-9-]{0,189}$/;
const FORBIDDEN_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'form', 'base']);
const RESERVED_ATTRIBUTES = new Set(['data-slide-mount']);
const URL_ATTRIBUTE = /(?:^|:)(?:href|src|action|formaction|poster|background|data|cite|longdesc|profile|codebase|manifest|ping)$/;
const URL_CAPABLE_CSS_FUNCTION = /\b(url|image-set|-webkit-image-set|cross-fade|image|element)\s*\(/ig;

function freezeOrigins(value) {
  return Object.freeze(value);
}

function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (/[^/]\?|[^/]#|\?$|#$/.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    if (raw !== parsed.origin && raw !== `${parsed.origin}/`) return null;
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
  if (/\{\{ASSET:/i.test(normalized)) return issue('ASSET_TOKEN_INVALID', surface);
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

function srcsetCandidates(value) {
  return value.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

function validateHtml(source, surface, resourcePolicy = loadResourcePolicy()) {
  const issues = [];
  const document = parseDocument(source);
  const stack = [...(document.children || [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    const children = node.children || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;

    const name = String(node.name || '').toLowerCase();
    const attributes = node.attribs || {};
    if (FORBIDDEN_ELEMENTS.has(name) || (name === 'meta' && Object.prototype.hasOwnProperty.call(attributes, 'http-equiv'))) {
      issues.push(issue('FORBIDDEN_HTML', surface, { element: name }));
    }
    for (const [attribute, rawValue] of Object.entries(attributes)) {
      const attributeName = attribute.toLowerCase();
      const value = String(rawValue || '');
      if (RESERVED_ATTRIBUTES.has(attributeName)) {
        issues.push(issue('RESERVED_ATTRIBUTE', surface, { attribute: attributeName }));
        continue;
      }
      if (attributeName.startsWith('on') || attributeName === 'srcdoc') {
        issues.push(issue('FORBIDDEN_ATTRIBUTE', surface, { attribute: attributeName }));
        continue;
      }
      if (attributeName === 'style') {
        issues.push(...validateCss(`x{${value}}`, surface, resourcePolicy).issues);
        continue;
      }
      const allowedOrigins = allowedOriginsForElement(name, attributes, resourcePolicy);
      const values = attributeName === 'srcset'
        ? srcsetCandidates(value)
        : URL_ATTRIBUTE.test(attributeName) ? [value] : [];
      for (const candidate of values) {
        const resource = resourceIssue(candidate, surface, resourcePolicy, allowedOrigins);
        if (resource) issues.push(resource);
      }
    }
    if (name === 'style') {
      const css = children.map(child => child.data || '').join('');
      issues.push(...validateCss(css, surface, resourcePolicy).issues);
    }
  }
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
    const inspectValue = (value, allowedOrigins = []) => {
      if (value.includes('\\')) {
        issues.push(issue('CSS_VALUE_UNSUPPORTED', surface));
        return;
      }
      for (const match of value.matchAll(/https?:\/\/[^\s'"()]+/gi)) {
        const resource = validateCssUrl(match[0], surface, resourcePolicy, allowedOrigins);
        if (resource) issues.push(resource);
      }
      for (const match of value.matchAll(URL_CAPABLE_CSS_FUNCTION)) {
        const name = match[1].toLowerCase();
        const argument = value.slice(match.index + match[0].length);
        const safeUrl = name === 'url' && /^\s*['"]?(?:https?:\/\/|#|\{\{ASSET:)/i.test(argument);
        if (!safeUrl) {
          issues.push(issue('CSS_VALUE_UNSUPPORTED', surface));
        }
      }
    };
    root.walkAtRules(rule => {
      if (String(rule.name).toLowerCase() !== 'import') return;
      const match = rule.params.match(/^(?:url\(\s*)?(?:['"])(.*?)['"]\s*\)?/i)
        || rule.params.match(/^url\(\s*(.*?)\s*\)/i);
      if (!match) {
        issues.push(issue('CSS_IMPORT_INVALID', surface));
        return;
      }
      const resource = validateCssUrl(match[1].trim(), surface, resourcePolicy, resourcePolicy.stylesheetOrigins);
      if (resource) issues.push(resource);
      inspectValue(rule.params, resourcePolicy.stylesheetOrigins);
    });
    root.walkDecls(declaration => {
      const parentName = declaration.parent?.type === 'atrule'
        ? String(declaration.parent.name || '').toLowerCase()
        : '';
      const isFontSource = parentName === 'font-face'
        && String(declaration.prop || '').toLowerCase() === 'src';
      const allowedOrigins = isFontSource ? resourcePolicy.fontOrigins : [];
      inspectValue(declaration.value, allowedOrigins);
      const urls = declaration.value.matchAll(/url\(\s*(?:['"]([^'"]*)['"]|([^\s)]+))\s*\)/gi);
      for (const match of urls) {
        const resource = validateCssUrl(match[1] ?? match[2], surface, resourcePolicy, allowedOrigins);
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

function collectStringValues(candidate) {
  const values = [];
  const stack = [candidate];
  const seen = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === 'string') {
      values.push(value);
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const child of Object.values(value)) stack.push(child);
  }
  return values;
}

function assetTokenIssues(candidate, resourcePolicy) {
  const issues = [];
  for (const value of collectStringValues(candidate)) {
    ASSET_TOKEN_MARKER.lastIndex = 0;
    let marker;
    while ((marker = ASSET_TOKEN_MARKER.exec(value)) !== null) {
      const start = marker.index;
      const end = value.indexOf('}}', ASSET_TOKEN_MARKER.lastIndex);
      if (end < 0) {
        issues.push(issue('ASSET_TOKEN_INVALID', 'request'));
        break;
      }
      const token = value.slice(start, end + 2);
      if (!ASSET_TOKEN.test(token)) issues.push(issue('ASSET_TOKEN_INVALID', 'request'));
      else if (!resourcePolicy.assetOrigin) issues.push(issue('ASSET_ORIGIN_NOT_CONFIGURED', 'request'));
      ASSET_TOKEN_MARKER.lastIndex = end + 2;
    }
  }
  return issues;
}

function assertCandidateWithinLimits(candidate, resourcePolicy = loadResourcePolicy()) {
  const issues = [];
  issues.push(...assetTokenIssues(candidate || {}, resourcePolicy));
  for (const [surface, value] of candidateValues(candidate || {})) {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > LIMITS[surface]) {
      issues.push(issue('CONTENT_LIMIT_EXCEEDED', surface));
    }
  }
  if (issues.length) {
    const error = new Error('Webinar content exceeds configured limits');
    error.code = issues[0].code;
    error.issues = issues;
    throw error;
  }
}

module.exports = {
  LIMITS,
  exactHttpsOrigin,
  loadResourcePolicy,
  validateMasterHtml,
  validateSlideHtml,
  validateCss,
  validateJavascript,
  validateAnchor,
  assertCandidateWithinLimits,
};
