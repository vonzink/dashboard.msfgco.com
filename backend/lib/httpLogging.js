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
const PUBLIC_SLIDE_EDIT_PATH_ROOT = '/api/public/webinar-slide-edits';

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

// Saved slide edits for the static decks on the webinar site: public reads
// plus password-guarded writes, on their own path with their own CORS policy.
function isPublicSlideEditRequest(req) {
  const pathname = requestPathname(req);
  return pathname === PUBLIC_SLIDE_EDIT_PATH_ROOT
    || (typeof pathname === 'string' && pathname.startsWith(`${PUBLIC_SLIDE_EDIT_PATH_ROOT}/`));
}

function serializeRequest(req) {
  const headers = serializeHeaders(req.headers, SAFE_REQUEST_HEADERS);
  return {
    id: req.id,
    method: req.method,
    url: requestPathname(req),
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
  isPublicSlideEditRequest,
  requestPathname,
  serializeRequest,
  serializeResponse,
};
