const express = require('express');
const { z } = require('zod');
const defaultPublicBundle = require('../services/webinars/publicBundle');
const { recordOperationalEvent: defaultRecordOperationalEvent } = require('../services/webinars/observability');
const { webinarSlug } = require('../validation/schemas/webinars');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRONG_SHA256_ETAG = /^"[a-f0-9]{64}"$/;
const CACHE_CONTROL = 'public, max-age=0, must-revalidate, stale-if-error=300';
const runtimeEvent = z.object({
  liveVersion: z.number().int().positive().safe(),
  slideId: z.string().regex(UUID),
  code: z.enum(['SLIDE_STARTUP_TIMEOUT', 'SLIDE_RUNTIME_ERROR']),
}).strict();
const RUNTIME_REASON_BY_CODE = Object.freeze({
  SLIDE_RUNTIME_ERROR: 'SLIDE_RUNTIME_ERROR',
  SLIDE_STARTUP_TIMEOUT: 'SLIDE_STARTUP_TIMEOUT',
});

function ifNoneMatchMatches(header, etag) {
  if (typeof header !== 'string') return false;
  const value = header.trim();
  if (value === '*') return true;
  const validators = [];
  let index = 0;
  while (index < header.length) {
    while (header[index] === ' ' || header[index] === '\t') index += 1;
    if (header.slice(index, index + 2) === 'W/') index += 2;
    if (header[index] !== '"') return false;
    const start = index;
    index += 1;
    while (index < header.length && header[index] !== '"') {
      const code = header.charCodeAt(index);
      if (code < 0x21 || code === 0x7f || code > 0xff) return false;
      index += 1;
    }
    if (header[index] !== '"') return false;
    index += 1;
    validators.push(header.slice(start, index));
    while (header[index] === ' ' || header[index] === '\t') index += 1;
    if (index === header.length) break;
    if (header[index] !== ',') return false;
    index += 1;
    if (index === header.length) return false;
  }
  return validators.includes(etag);
}

function createPublicWebinarsRouter({
  getLiveBundleBySlug = defaultPublicBundle.getLiveBundleBySlug,
  recordOperationalEvent = defaultRecordOperationalEvent,
} = {}) {
  const router = express.Router({ caseSensitive: true });

  function recordOnce(req, name, fields) {
    if (req.publicWebinarOperationalEventRecorded) return;
    req.publicWebinarOperationalEventRecorded = true;
    try {
      recordOperationalEvent(name, fields);
    } catch {
      // Delivery and telemetry must not be made less available by logging.
    }
  }

  function publicFailure(req, res) {
    recordOnce(req, 'webinar.public_delivery_failure', {
      statusCode: 503,
      reasonCode: 'PUBLIC_DELIVERY_FAILURE',
    });
    return res.status(503).json({ error: 'Public webinar is temporarily unavailable' });
  }

  function validCompiledBundle(compiled) {
    if (!(compiled
      && typeof compiled === 'object'
      && compiled.bundle
      && typeof compiled.bundle === 'object'
      && typeof compiled.json === 'string'
      && STRONG_SHA256_ETAG.test(compiled.etag)
      && Array.isArray(compiled.bundle.slides)
      && compiled.bundle.slides.length > 0)) return false;
    try {
      const serialized = JSON.parse(compiled.json);
      return Array.isArray(serialized?.slides) && serialized.slides.length > 0;
    } catch {
      return false;
    }
  }

  async function load(req, res) {
    const parsedSlug = webinarSlug.safeParse(req.params.slug);
    if (!parsedSlug.success || parsedSlug.data !== req.params.slug) {
      res.status(404).json({ error: 'Webinar not found' });
      return null;
    }
    try {
      const compiled = await getLiveBundleBySlug(parsedSlug.data);
      if (compiled === null) {
        res.status(404).json({ error: 'Webinar not found' });
        return null;
      }
      if (!validCompiledBundle(compiled)) {
        publicFailure(req, res);
        return null;
      }
      return compiled;
    } catch {
      publicFailure(req, res);
      return null;
    }
  }

  router.get('/:slug/live', async (req, res) => {
    const compiled = await load(req, res);
    if (!compiled) return;

    res.removeHeader('Set-Cookie');
    res.status(200).set({
      'Cache-Control': CACHE_CONTROL,
      'Content-Type': 'application/json; charset=utf-8',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      ETag: compiled.etag,
    });
    if (ifNoneMatchMatches(req.get('if-none-match'), compiled.etag)) {
      res.status(304).end();
      return;
    }
    res.send(compiled.json);
  });

  router.post('/:slug/runtime-events', async (req, res) => {
    const parsed = runtimeEvent.safeParse(req.body);
    if (!parsed.success) {
      recordOnce(req, 'webinar.validation_rejected', {
        statusCode: 400,
        reasonCode: 'VALIDATION_FAILED',
      });
      res.status(400).json({ error: 'Invalid runtime event', code: 'VALIDATION_FAILED' });
      return;
    }

    const compiled = await load(req, res);
    if (!compiled) return;
    const webinarId = compiled.bundle?.webinar?.id;
    if (!Number.isSafeInteger(webinarId) || webinarId <= 0) {
      publicFailure(req, res);
      return;
    }

    recordOnce(req, 'webinar.public_runtime_error', {
      webinarId,
      slideId: parsed.data.slideId,
      liveVersion: parsed.data.liveVersion,
      statusCode: 204,
      reasonCode: RUNTIME_REASON_BY_CODE[parsed.data.code],
    });
    res.removeHeader('Set-Cookie');
    res.status(204).end();
  });

  return router;
}

module.exports = {
  CACHE_CONTROL,
  createPublicWebinarsRouter,
  ifNoneMatchMatches,
  RUNTIME_REASON_BY_CODE,
  runtimeEvent,
};
