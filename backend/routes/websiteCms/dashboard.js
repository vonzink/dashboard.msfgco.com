const express = require('express');
const { createWebsiteCmsRouter } = require('./index');
const { requireDbUser, requireActiveDbUser } = require('../../middleware/userContext');

const REQUIRED_SERVICE_METHODS = [
  'listEntities', 'getEntity', 'saveRevision', 'publishSelection',
  'getPublication', 'rollbackPublication',
];

/**
 * Production composition only: callers must supply the authorized CMS service.
 * No default storage, development actor, or authentication override is provided.
 * Without a service, the caller must leave the route unmounted.
 */
function createDashboardWebsiteCmsRouter({ service } = {}) {
  if (service === undefined || service === null) return null;
  if (!REQUIRED_SERVICE_METHODS.every(method => typeof service[method] === 'function')) {
    throw Error('website_dashboard_service_invalid');
  }

  // Loading existing auth initializes its dependencies; do so only when enabled.
  const { authenticate } = require('../../middleware/auth');
  const staffAuthentication = express.Router();
  staffAuthentication.use(authenticate, requireDbUser, requireActiveDbUser);

  // The service remains responsible for explicit website.edit/publish grants.
  return createWebsiteCmsRouter({ service, authenticate: staffAuthentication });
}

module.exports = { createDashboardWebsiteCmsRouter };
