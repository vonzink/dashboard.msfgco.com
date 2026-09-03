const logger = require('../../lib/logger');

const EVENT_NAMES = new Set([
  'webinar.save_succeeded', 'webinar.validation_rejected', 'webinar.version_conflict',
  'webinar.authorization_denied', 'webinar.database_failure', 'webinar.restore_succeeded',
  'webinar.public_delivery_failure', 'webinar.public_runtime_error', 'webinar.asset_scan_pending',
  'webinar.asset_scan_rejected', 'webinar.asset_inspection_rejected', 'webinar.asset_available',
  'webinar.asset_scanner_failure',
]);
const SAFE_FIELDS = new Set(['webinarId', 'slideId', 'revisionId', 'actorUserId', 'liveVersion', 'statusCode', 'reasonCode', 'durationMs', 'assetVersionId']);

function reasonCodeDefinition(httpStatus = null, eventName = null) {
  return Object.freeze({ httpStatus, eventName });
}

// This is the single closed policy for fixed reason codes produced by the
// foundation's validation, authorization, mutation, note, settings, audit,
// transport, and observability boundaries. A null HTTP classification marks
// an internal/nested code that is safe to record but must not become a route
// response merely because an arbitrary Error happens to carry that string.
const CONTROLLED_REASON_CODE_DEFINITIONS = Object.freeze({
  ACCESS_DENIED: reasonCodeDefinition(403, 'webinar.authorization_denied'),
  ADMIN_ACCESS_REQUIRED: reasonCodeDefinition(403, 'webinar.authorization_denied'),
  ANCHOR_CONFLICT: reasonCodeDefinition(409, 'webinar.version_conflict'),
  ANCHOR_FORMAT: reasonCodeDefinition(),
  ASSET_AVAILABLE: reasonCodeDefinition(),
  ASSET_INSPECTION_REJECTED: reasonCodeDefinition(),
  ASSET_LIBRARY_NOT_READY: reasonCodeDefinition(503, 'webinar.validation_rejected'),
  ASSET_ORIGIN_NOT_CONFIGURED: reasonCodeDefinition(503, 'webinar.validation_rejected'),
  ASSET_SCANNER_FAILURE: reasonCodeDefinition(),
  ASSET_SCAN_PENDING: reasonCodeDefinition(),
  ASSET_SCAN_REJECTED: reasonCodeDefinition(),
  ASSET_TOKEN_INVALID: reasonCodeDefinition(),
  AUDIT_METADATA_FORBIDDEN: reasonCodeDefinition(),
  AUDIT_METADATA_INVALID: reasonCodeDefinition(),
  CONTENT_LIMIT_EXCEEDED: reasonCodeDefinition(413, 'webinar.validation_rejected'),
  CONTENT_VALIDATION_FAILED: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  CSS_IMPORT_INVALID: reasonCodeDefinition(),
  CSS_SYNTAX: reasonCodeDefinition(),
  CSS_VALUE_UNSUPPORTED: reasonCodeDefinition(),
  DATABASE_FAILURE: reasonCodeDefinition(500, 'webinar.database_failure'),
  EXECUTABLE_URL: reasonCodeDefinition(),
  FORBIDDEN_ATTRIBUTE: reasonCodeDefinition(),
  FORBIDDEN_HTML: reasonCodeDefinition(),
  JAVASCRIPT_SYNTAX: reasonCodeDefinition(),
  MALFORMED_JSON: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  MASTER_TOKEN_COUNT: reasonCodeDefinition(),
  NOTE_BODY_EMPTY: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  NOTE_BODY_TOO_LONG: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  NOTE_NOT_FOUND: reasonCodeDefinition(404, 'webinar.validation_rejected'),
  OPERATIONAL_EVENT_INVALID: reasonCodeDefinition(),
  OWNER_NOT_ACTIVE: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  PREFERENCES_INVALID: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  PREFERENCE_KEY_UNSAFE: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  PREFERENCE_VALUE_INVALID: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  PUBLIC_DELIVERY_FAILURE: reasonCodeDefinition(),
  PUBLIC_RUNTIME_ERROR: reasonCodeDefinition(),
  RESOURCE_NOT_HTTPS: reasonCodeDefinition(),
  RESOURCE_ORIGIN_FORBIDDEN: reasonCodeDefinition(),
  SETTINGS_DATA_CORRUPT: reasonCodeDefinition(),
  RESTORE_SLIDE_OWNERSHIP_CONFLICT: reasonCodeDefinition(409, 'webinar.version_conflict'),
  REVISION_NOT_FOUND: reasonCodeDefinition(404, 'webinar.validation_rejected'),
  REVISION_POLICY_INCOMPATIBLE: reasonCodeDefinition(409, 'webinar.validation_rejected'),
  REVISION_SNAPSHOT_INVALID: reasonCodeDefinition(),
  SHORTCUTS_INVALID: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  SHORTCUT_ACTION_UNKNOWN: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  SHORTCUT_BINDING_DUPLICATE: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  SHORTCUT_BINDING_INVALID: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  SHORTCUT_BINDING_RESERVED: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  SLIDE_NOT_FOUND: reasonCodeDefinition(404, 'webinar.validation_rejected'),
  SLIDE_SET_MISMATCH: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  TARGET_SECONDS_RANGE: reasonCodeDefinition(),
  UNSUPPORTED_MEDIA_TYPE: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  VALIDATION_FAILED: reasonCodeDefinition(400, 'webinar.validation_rejected'),
  VERSION_CONFLICT: reasonCodeDefinition(409, 'webinar.version_conflict'),
  WEBINAR_ACCESS_DENIED: reasonCodeDefinition(403, 'webinar.authorization_denied'),
  WEBINAR_NOT_FOUND: reasonCodeDefinition(404, 'webinar.validation_rejected'),
});
const CONTROLLED_REASON_CODES = Object.freeze(Object.keys(CONTROLLED_REASON_CODE_DEFINITIONS));
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

function getControlledReasonCodeDefinition(code) {
  if (typeof code !== 'string'
    || !Object.prototype.hasOwnProperty.call(CONTROLLED_REASON_CODE_DEFINITIONS, code)) {
    return null;
  }
  return CONTROLLED_REASON_CODE_DEFINITIONS[code];
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
    case 'reasonCode': return Boolean(getControlledReasonCodeDefinition(value));
    default: return false;
  }
}

const recordOperationalEvent = createOperationalEventRecorder();

module.exports = {
  CONTROLLED_REASON_CODE_DEFINITIONS,
  CONTROLLED_REASON_CODES,
  EVENT_NAMES: Object.freeze([...EVENT_NAMES]),
  SAFE_FIELDS: Object.freeze([...SAFE_FIELDS]),
  OperationalEventError,
  createOperationalEventRecorder,
  getControlledReasonCodeDefinition,
  recordOperationalEvent,
};
