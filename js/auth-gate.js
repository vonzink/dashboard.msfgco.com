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
  const token = localStorage.getItem(TOKEN_KEY);

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

    // Always go to root login (works even from nested routes)
    window.location.replace("/login.html");
  }
})();