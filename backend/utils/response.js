/**
 * utils/response.js
 *
 * ─── CONVENTION ────────────────────────────────────────────────────────
 * All new routes SHOULD use these helpers for response shaping:
 *
 *   ok(res, data)              — 200 + JSON body
 *   created(res, data)         — 201 + JSON body  (POST creating a resource)
 *   deleted(res, msg?)         — 200 + { success: true, message }
 *   fail(res, msg, status?)    — error response with { error: msg }
 *
 * Why a convention?
 *   • Consistent error shape ({ error: '...' }) means the frontend can rely
 *     on err.message everywhere instead of guessing the field name.
 *   • Status codes baked in — fewer per-route bugs.
 *   • Easy to grep for routes that bypass the standard.
 *
 * Existing routes still using res.json(...) directly are tech debt and
 * should be migrated when they're next touched. New routes that bypass
 * these helpers should be rejected in review.
 * ───────────────────────────────────────────────────────────────────────
 */

const ok      = (res, data)                => res.json(data);
const created = (res, data)                => res.status(201).json(data);
const deleted = (res, msg)                 => res.json({ success: true, message: msg || 'Deleted' });
const fail    = (res, msg, status)         => res.status(status || 400).json({ error: msg });

module.exports = { ok, created, deleted, fail };
