// js/auth-gate.js — Synchronous auth check (must run before any other script)
//
// This script is INTENTIONALLY synchronous. An async approach (e.g. trying to
// refresh the token here) doesn't actually block other <script> tags from loading
// and firing API calls. Instead, we keep it simple:
//   - Valid token → let the page load
//   - Expired token → clear it and redirect to login
//   - No token → redirect to login
//
// The Cognito hosted UI has its own session cookie (~30 days), so redirecting
// to login is transparent — the user is auto-logged in and redirected back
// with fresh tokens in under a second.
//
// Silent token refresh (using refresh_token) is handled by api-server.js
// on individual 401 responses, NOT here.

(() => {
  var TOKEN_KEY = "auth_token";
  var RETURN_TO_KEY = "return_to";

  var pathname = window.location.pathname || "/";
  var search = window.location.search || "";
  var hash = window.location.hash || "";

  var PUBLIC_PAGES = ["/login.html", "/login-callback.html", "/auth-debug.html"];
  var normalizedPath = pathname.endsWith("/index.html") ? pathname.replace(/\/index\.html$/, "/") : pathname;
  var isPublic = PUBLIC_PAGES.indexOf(normalizedPath) !== -1;

  // ── Read token from localStorage or cookie ──
  var cookieMatch = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
  var token = localStorage.getItem(TOKEN_KEY) || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

  // ── DEBUG: log auth-gate decision ──
  console.log("[auth-gate] path:", normalizedPath, "isPublic:", isPublic, "hasToken:", !!token);

  // ── Check token expiry (decode JWT without verification) ──
  if (token) {
    try {
      var parts = token.split(".");
      if (parts.length === 3) {
        var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        var now = Date.now();
        var expMs = payload.exp ? payload.exp * 1000 : 0;
        console.log("[auth-gate] token exp:", payload.exp, "now:", Math.floor(now/1000), "expired:", expMs < now, "expires_in_sec:", Math.floor((expMs - now)/1000));
        if (payload.exp && expMs < now) {
          // Token is expired — clear everything
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem("refresh_token");
          document.cookie = "auth_token=; path=/; domain=.msfgco.com; expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure";
          document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
          token = null;
          console.log("[auth-gate] EXPIRED — cleared token, will redirect to login");
        }
      }
    } catch (e) {
      console.log("[auth-gate] JWT decode error:", e.message);
      // Can't decode — let the server decide
    }
  }

  // ── Routing decisions ──

  // Already authed + on login page → bounce to dashboard
  if (token && isPublic) {
    var returnTo = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    window.location.replace(returnTo || "/");
    return;
  }

  // Not authed + on protected page → save target and go to login
  if (!token && !isPublic) {
    sessionStorage.setItem(RETURN_TO_KEY, normalizedPath + search + hash);
    window.location.replace("/login.html");
    return;
  }

  // All good — page will render normally
})();
