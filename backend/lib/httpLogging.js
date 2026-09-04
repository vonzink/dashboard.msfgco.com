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

function serializeHeaders(headers, allowlist) {
  const safe = {};
  for (const name of allowlist) {
    const value = headers?.[name];
    if (typeof value === 'string' || typeof value === 'number') safe[name] = value;
  }
  return safe;
}

function requestPathname(requestOrUrl) {
  const url = typeof requestOrUrl === 'string'
    ? requestOrUrl
    : typeof requestOrUrl?.originalUrl === 'string'
      ? requestOrUrl.originalUrl
      : requestOrUrl?.url;
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url, 'http://request.invalid').pathname;
  } catch {
    return url.split('?', 1)[0];
  }
}

function isPublicWebinarRuntimeRequest(req) {
  return req?.method === 'POST'
    && /^\/api\/public\/webinars\/[^/]+\/runtime-events\/?$/.test(requestPathname(req) || '');
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
  isPublicWebinarRuntimeRequest,
  requestPathname,
  serializeRequest,
  serializeResponse,
};
