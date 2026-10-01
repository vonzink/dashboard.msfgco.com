const pinoHttp = require('pino-http');

const SAFE_REQUEST_HEADERS = Object.freeze([
  'accept',
  'content-length',
  'content-type',
  'user-agent',
]);

const SAFE_RESPONSE_HEADERS = Object.freeze([
  'content-length',
  'content-type',
]);
const PUBLIC_WEBINAR_PATH_ROOT = '/api/public/webinars';
const PUBLIC_WEBINAR_PATH_PREFIX = `${PUBLIC_WEBINAR_PATH_ROOT}/`;

function serializeHeaders(headers, allowlist) {
  const safe = {};
  for (const name of allowlist) {
    const value = headers?.[name];
    if (typeof value === 'string' || typeof value === 'number') safe[name] = value;
  }
  return safe;
}

function hasInvalidRequestTargetCharacter(requestTarget) {
  for (const character of requestTarget) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x20 || codePoint === 0x7f || codePoint === 0xa0 || codePoint === 0xfeff) {
      return true;
    }
  }
  return false;
}

function requestPathname(requestOrUrl) {
  const requestTarget = typeof requestOrUrl === 'string'
    ? requestOrUrl
    : typeof requestOrUrl?.originalUrl === 'string'
      ? requestOrUrl.originalUrl
      : requestOrUrl?.url;
  if (typeof requestTarget !== 'string' || requestTarget[0] !== '/') return undefined;

  // Browsers send origin-form request targets. Keep that target byte-for-byte
  // (apart from its query) so policy decisions match Express's raw routing.
  // WHATWG URL parsing is deliberately avoided: it rewrites backslashes and
  // dot segments before our CORS, quota, and logging classifiers see them.
  // Fragments and whitespace/control characters are not valid in origin-form;
  // fail them closed instead of assigning ambiguous public-route semantics.
  if (requestTarget.includes('#') || hasInvalidRequestTargetCharacter(requestTarget)) {
    return undefined;
  }
  const queryIndex = requestTarget.indexOf('?');
  return queryIndex === -1 ? requestTarget : requestTarget.slice(0, queryIndex);
}

function isPublicWebinarRequest(req) {
  const pathname = requestPathname(req);
  if (typeof pathname !== 'string') return false;
  const normalized = pathname.toLowerCase();
  return normalized === PUBLIC_WEBINAR_PATH_ROOT
    || normalized.startsWith(PUBLIC_WEBINAR_PATH_PREFIX);
}

function hasInvalidPublicWebinarPathCasing(req) {
  const pathname = requestPathname(req);
  return isPublicWebinarRequest(req) && pathname !== pathname.toLowerCase();
}

// One raw-target predicate covers the canonical runtime route plus its
// intentionally supported casing, single-trailing-slash, and query aliases.
function isPublicWebinarRuntimeRequest(req) {
  return req?.method === 'POST'
    && /^\/api\/public\/webinars\/[^/]+\/runtime-events\/?$/i.test(requestPathname(req) || '');
}

function requestLogPathname(req) {
  const pathname = requestPathname(req);
  return isPublicWebinarRequest(req)
    && (hasInvalidPublicWebinarPathCasing(req) || pathname?.toLowerCase() !== PUBLIC_WEBINAR_PATH_ROOT)
    ? `${PUBLIC_WEBINAR_PATH_PREFIX}[redacted]`
    : pathname;
}

function serializeRequest(req) {
  const headers = serializeHeaders(req.headers, SAFE_REQUEST_HEADERS);
  if (isPublicWebinarRuntimeRequest(req)) {
    delete headers['content-type'];
    delete headers['content-encoding'];
  }
  return {
    id: req.id,
    method: req.method,
    url: requestLogPathname(req),
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
    headers,
  };
}

function serializeResponse(res) {
  return {
    statusCode: res.statusCode,
    headers: serializeHeaders(
      typeof res.getHeaders === 'function' ? res.getHeaders() : null,
      SAFE_RESPONSE_HEADERS,
    ),
  };
}

function createSafeHttpLogger(logger) {
  return pinoHttp({
    logger,
    wrapSerializers: false,
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
  });
}

module.exports = {
  SAFE_REQUEST_HEADERS,
  SAFE_RESPONSE_HEADERS,
  createSafeHttpLogger,
  hasInvalidPublicWebinarPathCasing,
  isPublicWebinarRequest,
  isPublicWebinarRuntimeRequest,
  requestPathname,
  serializeRequest,
  serializeResponse,
};
