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

function getUserRole(req) {
  return String(req.user?.db?.role || '').toLowerCase();
}

function hasRole(req, ...roles) {
  return roles.includes(getUserRole(req));
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

/**
 * Express middleware: reject with 403 if user is not a processor, manager, or admin.
 * Use on processing routes that need write access.
 */
function requireProcessorOrAdmin(req, res, next) {
  if (!hasRole(req, 'admin', 'processor', 'manager')) {
    return res.status(403).json({ error: 'Processor, manager, or admin access required' });
  }
  return next();
}

/**
 * Express middleware: reject with 403 if user is not a manager or admin.
 * Use on routes that managers need access to (profiles, documents, notes).
 */
function requireManagerOrAdmin(req, res, next) {
  if (!hasRole(req, 'admin', 'manager')) {
    return res.status(403).json({ error: 'Manager or admin access required' });
  }
  return next();
}

module.exports = {
  getDbUser,
  getUserId,
  getUserRole,
  hasRole,
  isAdmin,
  requireAdmin,
  requireProcessorOrAdmin,
  requireManagerOrAdmin,
  requireDbUser,
};
