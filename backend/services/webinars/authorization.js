const { getUserId, isAdmin } = require('../../middleware/userContext');

class WebinarAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'WebinarAccessError';
    this.status = status;
    this.code = code;
  }
}

function canReadWebinar(req, webinar) {
  return canEditWebinar(req, webinar);
}

function canEditWebinar(req, webinar) {
  if (isAdmin(req)) return true;
  const userId = getUserId(req);
  return Boolean(userId) && Number(webinar?.primary_owner_user_id) === Number(userId);
}

function assertCanEdit(req, webinar) {
  if (!canEditWebinar(req, webinar)) {
    throw new WebinarAccessError(403, 'WEBINAR_ACCESS_DENIED', 'Webinar access denied');
  }
}

module.exports = {
  WebinarAccessError,
  canReadWebinar,
  canEditWebinar,
  assertCanEdit,
};
