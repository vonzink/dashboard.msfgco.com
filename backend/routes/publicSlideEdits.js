const crypto = require('crypto');
const express = require('express');
const { createSlideEditsService, RESERVED_IDS, SlideEditError } = require('../services/webinars/slideEdits');
const { webinarSlug } = require('../validation/schemas/webinars');
const defaultLogger = require('../lib/logger');

// Saved slide edits for the static decks on msfgmortgage.com: per-slide HTML,
// CSS and JS, plus one deck-wide Master CSS and the deck's slide list (added
// and removed slides). Anyone may read them (the deck applies them on load);
// saving and resetting need the shared presenter password, which lives only in
// the server environment.

const PASSWORD_HEADER = 'x-webinar-edit-password';

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function passwordMatches(candidate, expected) {
  if (typeof candidate !== 'string' || !candidate) return false;
  return crypto.timingSafeEqual(sha256(candidate), sha256(expected));
}

function createPublicSlideEditsRouter({
  service,
  logger = defaultLogger,
  getPassword = () => process.env.WEBINAR_EDIT_PASSWORD,
} = {}) {
  const router = express.Router({ caseSensitive: true });
  const edits = service || createSlideEditsService();

  function slugOf(value) {
    const parsed = webinarSlug.safeParse(value);
    return parsed.success && parsed.data === value ? parsed.data : null;
  }

  function fail(req, res, error) {
    if (error instanceof SlideEditError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    try {
      logger.error({ err: error, requestId: req.id, method: req.method }, 'Slide edit request failed');
    } catch {
      // Logging must never change the response.
    }
    return res.status(503).json({ error: 'Slide edits are temporarily unavailable' });
  }

  function requirePassword(req, res, next) {
    const expected = getPassword();
    if (typeof expected !== 'string' || !expected) {
      return res.status(503).json({ error: 'Slide editing is not set up on the server', code: 'EDITING_NOT_CONFIGURED' });
    }
    if (!passwordMatches(req.get(PASSWORD_HEADER), expected)) {
      return res.status(401).json({ error: 'Wrong password', code: 'WRONG_PASSWORD' });
    }
    return next();
  }

  router.use((req, res, next) => {
    res.removeHeader('Set-Cookie');
    res.set({
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    next();
  });

  router.param('slug', (req, res, next, value) => {
    req.slideEditSlug = slugOf(value);
    if (!req.slideEditSlug) return res.status(404).json({ error: 'Webinar not found' });
    return next();
  });

  router.param('slideId', (req, res, next, value) => {
    req.slideEditSlideId = RESERVED_IDS.includes(value) ? value : slugOf(value);
    if (!req.slideEditSlideId) return res.status(404).json({ error: 'Slide not found' });
    return next();
  });

  router.get('/:slug', async (req, res) => {
    try {
      res.json({ slug: req.slideEditSlug, edits: await edits.listBySlug(req.slideEditSlug) });
    } catch (error) {
      fail(req, res, error);
    }
  });

  router.put('/:slug/:slideId', requirePassword, async (req, res) => {
    try {
      res.json(await edits.save(req.slideEditSlug, req.slideEditSlideId, req.body || {}));
    } catch (error) {
      fail(req, res, error);
    }
  });

  router.delete('/:slug/:slideId', requirePassword, async (req, res) => {
    try {
      await edits.remove(req.slideEditSlug, req.slideEditSlideId);
      res.status(204).end();
    } catch (error) {
      fail(req, res, error);
    }
  });

  return router;
}

module.exports = {
  PASSWORD_HEADER,
  createPublicSlideEditsRouter,
};
