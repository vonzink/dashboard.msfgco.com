const logger = require('../../lib/logger');

const EVENT_NAMES = new Set([
  'webinar.save_succeeded', 'webinar.validation_rejected', 'webinar.version_conflict',
  'webinar.authorization_denied', 'webinar.database_failure', 'webinar.restore_succeeded',
  'webinar.public_delivery_failure', 'webinar.public_runtime_error', 'webinar.asset_scan_pending',
  'webinar.asset_scan_rejected', 'webinar.asset_inspection_rejected', 'webinar.asset_available',
  'webinar.asset_scanner_failure',
]);
const SAFE_FIELDS = new Set(['webinarId', 'slideId', 'revisionId', 'actorUserId', 'liveVersion', 'statusCode', 'reasonCode', 'durationMs', 'assetVersionId']);
const REASON_CODES = new Set(['VALIDATION_FAILED', 'VERSION_CONFLICT', 'ACCESS_DENIED', 'DATABASE_FAILURE', 'PUBLIC_DELIVERY_FAILURE', 'PUBLIC_RUNTIME_ERROR', 'ASSET_SCAN_PENDING', 'ASSET_SCAN_REJECTED', 'ASSET_INSPECTION_REJECTED', 'ASSET_AVAILABLE', 'ASSET_SCANNER_FAILURE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      if (SAFE_FIELDS.has(key) && validFieldValue(key, value)) safe[key] = value;
    }
    targetLogger.info({ event: name, ...safe }, 'webinar operational event');
    return safe;
  };
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validFieldValue(key, value) {
  switch (key) {
    case 'webinarId':
    case 'revisionId':
    case 'actorUserId': return positiveId(value);
    case 'liveVersion': return Number.isSafeInteger(value) && value >= 0;
    case 'statusCode': return Number.isSafeInteger(value) && value >= 100 && value <= 599;
    case 'durationMs': return Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000;
    case 'slideId':
    case 'assetVersionId': return typeof value === 'string' && UUID.test(value);
    case 'reasonCode': return typeof value === 'string' && REASON_CODES.has(value);
    default: return false;
  }
}

const recordOperationalEvent = createOperationalEventRecorder();

module.exports = {
  EVENT_NAMES: Object.freeze([...EVENT_NAMES]),
  SAFE_FIELDS: Object.freeze([...SAFE_FIELDS]),
  OperationalEventError,
  createOperationalEventRecorder,
  recordOperationalEvent,
};
