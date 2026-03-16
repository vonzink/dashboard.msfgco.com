function getDbUser(req) {
  return req.user?.db || null;
}

function getUserId(req) {
  return req.user?.db?.id || null;
}

/**
 * Get the user's effective active role.
 * Checks the X-Active-Role header and validates it against the user's
 * actual Cognito groups. Falls back to the DB role if the header is
 * missing or invalid.
 */
function getActiveRole(req) {
  const requested = req.headers['x-active-role'];
  if (requested) {
    const groups = req.user?.groups || [];
    if (groups.includes(requested)) {
      return requested.toLowerCase();
    }
  }
  return String(req.user?.db?.role || '').toLowerCase();
}

function isAdmin(req) {
  return getActiveRole(req) === 'admin';
}

function getUserRole(req) {
  return getActiveRole(req);
}

function hasRole(req, ...roles) {
  return roles.includes(getActiveRole(req));
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

/**
 * Express middleware: reject with 403 if user has External role.
 * External users can only access announcements, calendar, and notifications.
 */
function requireNonExternal(req, res, next) {
  if (getActiveRole(req) === 'external') {
    return res.status(403).json({ error: 'External users do not have access to this resource' });
  }
  return next();
}

/**
 * Check whether the current user owns a record or is an admin.
 *
 * @param {object} req        - Express request (must have req.user.db set)
 * @param {object} record     - The DB record to check ownership of
 * @param {string} ownerField - The field on `record` that holds the owner's user ID (default: 'user_id')
 * @returns {boolean} true if the user owns the record OR is an admin
 *
 * Example:
 *   if (!checkOwnership(req, item)) return res.status(403).json({ error: 'Access denied' });
 */
function checkOwnership(req, record, ownerField = 'user_id') {
  if (isAdmin(req)) return true;
  const userId = getUserId(req);
  if (!userId || !record) return false;
  return record[ownerField] === userId;
}

module.exports = {
  getDbUser,
  getUserId,
  getUserRole,
  hasRole,
  isAdmin,
  checkOwnership,
  requireAdmin,
  requireProcessorOrAdmin,
  requireManagerOrAdmin,
  requireNonExternal,
  requireDbUser,
};
