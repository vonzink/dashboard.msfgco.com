// Ask AI HTTP route — thin orchestrator per house style:
// validate → service → respond. All engine I/O lives in
// backend/services/askAi/askAi.service.js.

const express = require('express');
const router = express.Router();

const { ok, fail } = require('../utils/response');
const { askAiQuestion, validate } = require('../validation/schemas');
const askAi = require('../services/askAi/askAi.service');

router.post('/ask', validate(askAiQuestion), async (req, res, next) => {
  try {
    // ID tokens carry email at the top level; DB lookup fills req.user.db.
    const email = req.user?.db?.email || req.user?.email || req.user?.claims?.email;
    if (!email) return fail(res, 'User identity unavailable', 401);

    const { question, conversationId, pageRoute } = req.body;
    ok(res, await askAi.ask({ email, question, conversationId, pageRoute }));
  } catch (err) {
    if (err.status) return fail(res, err.message, err.status);
    next(err);
  }
});

module.exports = router;
