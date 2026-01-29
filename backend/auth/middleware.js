/**
 * auth/middleware.js
 *
 * Cognito JWT verification using jose.
 * - Verifies RS256 JWTs using the User Pool JWKS endpoint
 * - Attaches req.user (claims) when valid
 * - Returns 401 when missing/invalid (requireAuth)
 * - Allows pass-through when missing/invalid (optionalAuth)
 * - Enforces Cognito groups (requireGroup / requireAnyGroup / requireAllGroups)
 */

const { createRemoteJWKSet, jwtVerify } = require("jose");

// Env
const REGION = process.env.COGNITO_REGION || "us-west-1";
const USER_POOL_ID =
  process.env.COGNITO_USER_POOL_ID || process.env.USER_POOL_ID;
const CLIENT_ID =
  process.env.COGNITO_CLIENT_ID || process.env.APP_CLIENT_ID;

// Cognito issuer + JWKS
const ISSUER =
  process.env.COGNITO_ISSUER ||
  `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URI));

function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function extractToken(req) {
  // 1) Authorization header
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (auth && typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }

  // 2) Cookie
  const cookies = parseCookies(req);
  if (cookies.auth_token) return cookies.auth_token;

  return null;
}

async function verifyCognitoJwt(token) {
  if (!USER_POOL_ID) {
    throw new Error("Missing COGNITO_USER_POOL_ID (or USER_POOL_ID) env var");
  }

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    ...(CLIENT_ID ? { audience: CLIENT_ID } : {}),
  });

  return payload;
}

function buildReqUser(claims) {
  const groups = claims["cognito:groups"] || claims.groups || [];
  return {
    sub: claims.sub,
    username: claims.username || claims["cognito:username"],
    email: claims.email,
    groups: Array.isArray(groups) ? groups : [],
    claims,
  };
}

function requireAuth(options = {}) {
  const publicPaths = Array.isArray(options.publicPaths)
    ? options.publicPaths
    : ["/api/webhooks"];

  return async function authMiddleware(req, res, next) {
    try {
      if (publicPaths.some((p) => req.path === p || req.originalUrl?.startsWith(p))) {
        return next();
      }

      const token = extractToken(req);
      if (!token) return res.status(401).json({ error: "Missing auth token" });

      const claims = await verifyCognitoJwt(token);
      req.user = buildReqUser(claims);

      return next();
    } catch (err) {
      console.error("Auth error:", err?.message || err);
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
}

function optionalAuth() {
  return async function optionalAuthMiddleware(req, _res, next) {
    try {
      const token = extractToken(req);
      if (!token) return next();

      const claims = await verifyCognitoJwt(token);
      req.user = buildReqUser(claims);
      return next();
    } catch (_err) {
      return next();
    }
  };
}

function requireGroup(group) {
  return requireAnyGroup(group);
}

function requireAnyGroup(...allowedGroups) {
  const allowed = allowedGroups.flat().filter(Boolean);

  return function groupMiddleware(req, res, next) {
    const groups = req.user?.groups || [];
    const ok = allowed.length === 0 ? true : allowed.some((g) => groups.includes(g));

    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    return next();
  };
}

function requireAllGroups(...requiredGroups) {
  const required = requiredGroups.flat().filter(Boolean);

  return function groupMiddleware(req, res, next) {
    const groups = req.user?.groups || [];
    const ok = required.length === 0 ? true : required.every((g) => groups.includes(g));

    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!ok) return res.status(403).json({ error: "Forbidden" });

    return next();
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  extractToken,
  requireGroup,
  requireAnyGroup,
  requireAllGroups,
};
