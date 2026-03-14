/**
 * Server-side HTML sanitizer — whitelist approach.
 * Strips dangerous tags, event handlers, and javascript: URLs.
 *
 * For internal dashboard use. For public-facing apps, use a library like DOMPurify/sanitize-html.
 */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';

  let clean = html;

  // 1. Remove dangerous tags and their contents
  const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'style', 'svg', 'math'];
  for (const tag of dangerousTags) {
    clean = clean.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    clean = clean.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '');
  }

  // 2. Remove all on* event handler attributes (onload, onerror, onclick, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 3. Remove javascript: URLs in any attribute
  clean = clean.replace(/\s+(?:href|src|action|formaction|data|background)\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*')/gi, '');

  // 4. Remove srcdoc attributes (can contain arbitrary HTML)
  clean = clean.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 5. Remove data: URLs in src (can execute JS in some contexts)
  clean = clean.replace(/\s+src\s*=\s*(?:"[^"]*data:[^"]*"|'[^']*data:[^']*')/gi, '');

  return clean.trim();
}

module.exports = { sanitizeHtml };
