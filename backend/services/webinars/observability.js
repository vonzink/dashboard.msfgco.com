const logger = require('../../lib/logger');

const EVENT_NAMES = new Set([
  'webinar.save_succeeded', 'webinar.validation_rejected', 'webinar.version_conflict',
  'webinar.authorization_denied', 'webinar.database_failure', 'webinar.restore_succeeded',
  'webinar.public_delivery_failure', 'webinar.public_runtime_error', 'webinar.asset_scan_pending',
  'webinar.asset_scan_rejected', 'webinar.asset_inspection_rejected', 'webinar.asset_available',
  'webinar.asset_scanner_failure',
]);
const SAFE_FIELDS = new Set(['webinarId', 'slideId', 'revisionId', 'actorUserId', 'liveVersion', 'statusCode', 'reasonCode', 'durationMs', 'assetVersionId']);

class OperationalEventError extends Error {
  constructor(code) {
    super('Invalid webinar operational event');
    this.name = 'OperationalEventError';
    this.code = code;
  }
}

function createOperationalEventRecorder(targetLogger = logger) {
  return function recordOperationalEvent(name, fields = {}) {
    if (!EVENT_NAMES.has(name)) throw new OperationalEventError('OPERATIONAL_EVENT_INVALID');
    const safe = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (SAFE_FIELDS.has(key) && ['string', 'number'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value))) safe[key] = value;
    }
    targetLogger.info({ event: name, ...safe }, 'webinar operational event');
    return safe;
  };
}

const recordOperationalEvent = createOperationalEventRecorder();

module.exports = { EVENT_NAMES, SAFE_FIELDS, OperationalEventError, createOperationalEventRecorder, recordOperationalEvent };
