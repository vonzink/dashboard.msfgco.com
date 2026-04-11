// Investor Routes — aggregates sub-routers
// Route ordering: /tags and /note-tags MUST come before /:key (parameterized)
const express = require('express');
const router = express.Router();
const { requireDbUser } = require('../../middleware/userContext');

router.use(requireDbUser);

// Static paths first (before /:key catches them)
router.use('/', require('./tags'));

// Core CRUD (includes /:key, so must come after static paths)
router.use('/', require('./core'));

// Nested resources under /:id
router.use('/', require('./logos'));
router.use('/', require('./documents'));
router.use('/', require('./details'));
router.use('/', require('./notes'));

module.exports = router;
