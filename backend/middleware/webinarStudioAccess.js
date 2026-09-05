const db = require('../db/connection');
const logger = require('../lib/logger');
const { isAdmin, isValidDbUserId } = require('./userContext');

const ACTIVE_ASSIGNMENT_SQL = 'SELECT 1 FROM webinar_presentations WHERE primary_owner_user_id = ? AND archived_at IS NULL LIMIT 1';

function createWebinarStudioAccess({
  environment = process.env,
  database = db,
  adminCheck = isAdmin,
  configurationLogger = logger,
} = {}) {
  let invalidModeLogged = false;

  function unavailable(res) {
    return res.status(404).json({ error: 'Webinar Studio unavailable' });
  }

  function forbidden(res) {
    return res.status(403).json({ error: 'Webinar Studio access required' });
  }

  return function requireWebinarStudioAccess(req, res, next) {
    const mode = environment.WEBINAR_STUDIO_ACCESS || 'disabled';

    if (mode === 'disabled') return unavailable(res);

    if (mode !== 'admins' && mode !== 'assigned') {
      if (!invalidModeLogged) {
        invalidModeLogged = true;
        try {
          configurationLogger.error(
            { code: 'INVALID_WEBINAR_STUDIO_ACCESS' },
            'Invalid Webinar Studio access configuration',
          );
        } catch {
          // A failed log sink must not weaken the fail-closed response.
        }
      }
      return unavailable(res);
    }

    if (adminCheck(req)) return next();
    if (mode === 'admins') return forbidden(res);

    const userId = req.user?.db?.id;
    if (!isValidDbUserId(userId)) return forbidden(res);

    return Promise.resolve(database.query(ACTIVE_ASSIGNMENT_SQL, [userId]))
      .then(([rows]) => (Array.isArray(rows) && rows.length > 0 ? next() : forbidden(res)))
      .catch(next);
  };
}

const requireWebinarStudioAccess = createWebinarStudioAccess();

module.exports = {
  ACTIVE_ASSIGNMENT_SQL,
  createWebinarStudioAccess,
  requireWebinarStudioAccess,
};
