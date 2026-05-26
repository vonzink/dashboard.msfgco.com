const { getUserId, hasRole } = require('../../middleware/userContext');

function canManageScheduleEntry(req, entryUserId) {
  if (hasRole(req, 'admin', 'manager')) return true;
  const currentUserId = getUserId(req);
  return Boolean(currentUserId && Number(currentUserId) === Number(entryUserId));
}

module.exports = {
  canManageScheduleEntry,
};
