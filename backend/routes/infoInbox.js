const express = require('express');
const { createInboxService } = require('../services/infoInbox');

function createInfoInboxRouter(service = createInboxService()) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (error) {
      const status = [400, 404, 413].includes(error.status) ? error.status : 503;
      res.status(status).json({ error: status === 503 ? 'Email service unavailable. Please try again.' : error.message });
    }
  };
  router.get('/', handle(req => service.list({ offset: Number(req.query.offset || 0), limit: 100 })));
  router.get('/message', handle(req => service.get(req.query.key)));
  return router;
}
module.exports = { createInfoInboxRouter };
