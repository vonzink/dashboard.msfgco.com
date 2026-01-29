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

module.exports = {
  getDbUser,
  getUserId,
  isAdmin,
  requireDbUser,
};
