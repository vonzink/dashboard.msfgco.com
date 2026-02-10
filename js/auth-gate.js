// js/auth-gate.js
(() => {
  const TOKEN_KEY = "auth_token";
  const RETURN_TO_KEY = "return_to";

  const { pathname, search, hash } = window.location;
  const path = pathname || "/";

  // Pages that must be accessible without a token
  const PUBLIC_PAGES = new Set([
    "/login.html",
    "/login-callback.html",
  ]);

  // Normalize "/index.html" -> "/"
  const normalizedPath = path.endsWith("/index.html") ? path.replace(/\/index\.html$/, "/") : path;

  const isPublic = PUBLIC_PAGES.has(normalizedPath);

  // Check localStorage first, then shared domain cookie
  const cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
  let token = localStorage.getItem(TOKEN_KEY) || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

  // ── Validate token expiry (JWT exp claim) ──
  // Decode the payload without verifying signature (server does that).
  // This prevents auth loops from expired tokens passing the gate.
  if (token) {
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        const exp = payload.exp;
        if (exp && (exp * 1000) < Date.now()) {
          // Token is expired — try silent refresh before giving up
          const refreshToken = localStorage.getItem("refresh_token");
          if (refreshToken && !isPublic) {
            // Don't clear yet — let the page load and api-server.js will attempt refresh
            // But if we're already in a loop (redirected more than once in 5 seconds), break it
            const lastRedirect = sessionStorage.getItem("last_auth_redirect");
            const now = Date.now();
            if (lastRedirect && (now - parseInt(lastRedirect, 10)) < 5000) {
              // Loop detected — clear everything and go to login
              localStorage.removeItem(TOKEN_KEY);
              localStorage.removeItem("refresh_token");
              document.cookie = "auth_token=; path=/; domain=.msfgco.com; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure";
              document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
              token = null;
            }
            // Otherwise let it through — api-server.js will refresh on first 401
          } else {
            // No refresh token — clear the expired token
            localStorage.removeItem(TOKEN_KEY);
            document.cookie = "auth_token=; path=/; domain=.msfgco.com; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure";
            document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
            token = null;
          }
        }
      }
    } catch (e) {
      // If we can't decode the token, let the server validate it
    }
  }

  // If already authed and sitting on login page, bounce home (or return_to if set)
  if (token && isPublic) {
    const returnTo = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    window.location.replace(returnTo || "/");
    return;
  }

  // If not authed and trying to access a protected page, send to login
  if (!token && !isPublic) {
    // Save the full path the user wanted (including query/hash)
    const fullTarget = `${normalizedPath}${search || ""}${hash || ""}`;
    sessionStorage.setItem(RETURN_TO_KEY, fullTarget);
    // Track redirect time for loop detection
    sessionStorage.setItem("last_auth_redirect", String(Date.now()));

    // Always go to root login (works even from nested routes)
    window.location.replace("/login.html");
  }
})();
