const db = require('../db/connection');
const logger = require('../lib/logger');
const { isAdmin, isValidDbUserId } = require('./userContext');

const ACTIVE_ASSIGNMENT_SQL = 'SELECT 1 FROM webinar_presentations WHERE primary_owner_user_id = ? AND archived_at IS NULL LIMIT 1';

// Modes, from most to least restrictive:
//   disabled  Studio is off for everyone.
//   admins    Only administrators.
//   assigned  Administrators, plus the primary owner of at least one active webinar.
//   everyone  Every mapped Dashboard user can open Studio and read every webinar;
//             editing still belongs to the primary owner and administrators.
const ACCESS_MODES = Object.freeze(['disabled', 'admins', 'assigned', 'everyone']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function accessMode(environment) {
  return environment.WEBINAR_STUDIO_ACCESS || 'disabled';
}

async function ownsActiveWebinar(database, userId) {
  const [rows] = await database.query(ACTIVE_ASSIGNMENT_SQL, [userId]);
  return Array.isArray(rows) && rows.length > 0;
}

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

  function grant(req, next, mode) {
    // Downstream authorization reads this to widen reads (never writes) in
    // everyone mode. It is request-scoped and frozen so nothing can upgrade it.
    req.webinarStudioAccess = Object.freeze({ mode, readAll: mode === 'everyone' });
    return next();
  }

  return function requireWebinarStudioAccess(req, res, next) {
    const mode = accessMode(environment);

    if (mode === 'disabled') return unavailable(res);

    if (!ACCESS_MODES.includes(mode)) {
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

    if (adminCheck(req)) return grant(req, next, mode);
    if (mode === 'admins') return forbidden(res);

    const userId = req.user?.db?.id;
    if (!isValidDbUserId(userId)) return forbidden(res);
    if (mode === 'everyone') return grant(req, next, mode);

    return Promise.resolve(ownsActiveWebinar(database, userId))
      .then(assigned => (assigned ? grant(req, next, mode) : forbidden(res)))
      .catch(next);
  };
}

// In everyone mode, reading is open but writes to shared resources that are
// not owned per webinar (the asset library) stay with editors: administrators
// and primary owners of an active webinar. Other modes already proved that
// before the request got here, so this gate only adds work in everyone mode.
function createWebinarEditorWriteGate({
  database = db,
  adminCheck = isAdmin,
} = {}) {
  function forbidden(res) {
    return res.status(403).json({ error: 'Webinar editor access required' });
  }

  return function requireWebinarEditorForWrites(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const access = req.webinarStudioAccess;
    if (!access) return forbidden(res);
    if (access.mode !== 'everyone') return next();
    if (adminCheck(req)) return next();

    const userId = req.user?.db?.id;
    if (!isValidDbUserId(userId)) return forbidden(res);
    return Promise.resolve(ownsActiveWebinar(database, userId))
      .then(assigned => (assigned ? next() : forbidden(res)))
      .catch(next);
  };
}

const requireWebinarStudioAccess = createWebinarStudioAccess();
const requireWebinarEditorForWrites = createWebinarEditorWriteGate();

module.exports = {
  ACCESS_MODES,
  ACTIVE_ASSIGNMENT_SQL,
  createWebinarEditorWriteGate,
  createWebinarStudioAccess,
  requireWebinarEditorForWrites,
  requireWebinarStudioAccess,
};
