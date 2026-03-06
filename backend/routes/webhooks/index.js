/**
 * routes/webhooks/index.js
 *
 * Mounts all webhook sub-routers with shared API key auth + logging.
 */
const router = require('express').Router();
const { validateApiKey, logWebhookCall } = require('../../middleware/apiKeyAuth');

router.use(validateApiKey);
router.use(logWebhookCall);

router.use('/tasks',          require('./tasks'));
router.use('/pre-approvals',  require('./preApprovals'));
router.use('/pipeline',       require('./pipeline'));
router.use('/lendingpad',     require('./lendingpad'));

// Bulk operations
router.use('/bulk',           require('./tasks'));  // bulk/tasks lives in tasks sub-router

module.exports = router;
