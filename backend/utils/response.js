/**
 * utils/response.js
 *
 * Standardized API response helpers for mutation endpoints.
 * GET endpoints that return raw data are left as-is.
 */

const ok      = (res, data)                => res.json(data);
const created = (res, data)                => res.status(201).json(data);
const deleted = (res, msg)                 => res.json({ success: true, message: msg || 'Deleted' });
const fail    = (res, msg, status)         => res.status(status || 400).json({ error: msg });

module.exports = { ok, created, deleted, fail };
