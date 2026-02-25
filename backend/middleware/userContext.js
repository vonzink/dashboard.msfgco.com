function getDbUser(req) {
  return req.user?.db || null;
}

function getUserId(req) {
  return req.user?.db?.id || null;
}

function isAdmin(req) {
  const role = String(req.user?.db?.role || '').toLowerCase();
  return role === 'admin';
}

function requireDbUser(req, res, next) {
  if (!req.user?.db) {
    return res.status(401).json({ error: 'User mapping not found' });
  }
  return next();
}

/**
 * Express middleware: reject with 403 if user is not an admin.
 * Use on routes that require admin access.
 *
 *   router.post('/', requireAdmin, handler);
 */
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

module.exports = {
  getDbUser,
  getUserId,
  isAdmin,
  requireAdmin,
  requireDbUser,
};
