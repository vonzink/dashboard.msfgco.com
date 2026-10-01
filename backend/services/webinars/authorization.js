const { getUserId, isAdmin } = require('../../middleware/userContext');

class WebinarAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'WebinarAccessError';
    this.status = status;
    this.code = code;
  }
}

/* The feature gate annotates the request when the configured mode opens
   reads to every Studio user. The annotation never widens edits. */
function canReadAllWebinars(req) {
  return isAdmin(req) || req?.webinarStudioAccess?.readAll === true;
}

function canReadWebinar(req, webinar) {
  return canEditWebinar(req, webinar) || canReadAllWebinars(req);
}

function canEditWebinar(req, webinar) {
  if (isAdmin(req)) return true;
  const userId = getUserId(req);
  return Boolean(userId) && Number(webinar?.primary_owner_user_id) === Number(userId);
}

function assertCanRead(req, webinar) {
  if (!canReadWebinar(req, webinar)) {
    throw new WebinarAccessError(403, 'WEBINAR_ACCESS_DENIED', 'Webinar access denied');
  }
}

function assertCanEdit(req, webinar) {
  if (!canEditWebinar(req, webinar)) {
    throw new WebinarAccessError(403, 'WEBINAR_ACCESS_DENIED', 'Webinar access denied');
  }
}

module.exports = {
  WebinarAccessError,
  canReadAllWebinars,
  canReadWebinar,
  canEditWebinar,
  assertCanRead,
  assertCanEdit,
};
