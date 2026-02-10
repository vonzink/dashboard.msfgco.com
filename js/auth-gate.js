// js/auth-gate.js — Blocks page load until auth is resolved (including token refresh)
(async () => {
  const TOKEN_KEY = "auth_token";
  const RETURN_TO_KEY = "return_to";
  const COGNITO_DOMAIN = "https://us-west-1s6ie2uego.auth.us-west-1.amazoncognito.com";
  const CLIENT_ID = "2t9edrhu5crf8vq3ivigv6jopf";

  const { pathname, search, hash } = window.location;
  const path = pathname || "/";

  const PUBLIC_PAGES = new Set(["/login.html", "/login-callback.html"]);
  const normalizedPath = path.endsWith("/index.html") ? path.replace(/\/index\.html$/, "/") : path;
  const isPublic = PUBLIC_PAGES.has(normalizedPath);

  // ── Hide page body until auth is resolved (prevents flash of protected content) ──
  if (!isPublic) {
    document.documentElement.style.visibility = "hidden";
  }

  // ── Helper: decode JWT payload ──
  function jwtPayload(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch (e) {
      return null;
    }
  }

  // ── Helper: is token expired? ──
  function isExpired(token) {
    const payload = jwtPayload(token);
    if (!payload || !payload.exp) return false; // Can't determine — let server decide
    return (payload.exp * 1000) < Date.now();
  }

  // ── Helper: clear all auth state ──
  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("refresh_token");
    sessionStorage.removeItem("auth_token");
    document.cookie = "auth_token=; path=/; domain=.msfgco.com; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure";
    document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  }

  // ── Helper: set auth token + cookie ──
  function setAuth(token, maxAge) {
    localStorage.setItem(TOKEN_KEY, token);
    var age = maxAge || 3600;
    document.cookie = "auth_token=" + encodeURIComponent(token) + "; path=/; domain=.msfgco.com; max-age=" + age + "; SameSite=Lax; Secure";
  }

  // ── Helper: attempt silent refresh ──
  async function refreshToken() {
    var rt = localStorage.getItem("refresh_token");
    if (!rt) return null;
    try {
      var response = await fetch(COGNITO_DOMAIN + "/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: rt,
        }),
      });
      if (!response.ok) return null;
      var tokens = await response.json();
      if (tokens.access_token) {
        setAuth(tokens.access_token, tokens.expires_in || 3600);
        return tokens.access_token;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ── Resolve current token ──
  const cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
  let token = localStorage.getItem(TOKEN_KEY) || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

  // ── If token is expired, try to refresh it RIGHT NOW (before page renders) ──
  if (token && isExpired(token)) {
    var refreshed = await refreshToken();
    if (refreshed) {
      token = refreshed;
    } else {
      // Refresh failed — clear everything
      clearAuth();
      token = null;
    }
  }

  // ── Routing decisions ──

  // Already authed + on login page → bounce to dashboard
  if (token && isPublic) {
    const returnTo = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    window.location.replace(returnTo || "/");
    return;
  }

  // Not authed + on protected page → go to login
  if (!token && !isPublic) {
    const fullTarget = normalizedPath + (search || "") + (hash || "");
    sessionStorage.setItem(RETURN_TO_KEY, fullTarget);
    window.location.replace("/login.html");
    return;
  }

  // ── All good — show the page ──
  document.documentElement.style.visibility = "";
})();
