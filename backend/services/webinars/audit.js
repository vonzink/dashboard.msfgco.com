const SAFE_METADATA_KEYS = new Set([
  'liveVersion', 'reasonCode', 'statusCode', 'webinarId', 'revisionId', 'slideId',
  'primaryOwnerUserId', 'audienceEnabled', 'enabled', 'archived', 'changeType',
]);
const FORBIDDEN_METADATA_KEYS = new Set(['source', 'html', 'css', 'javascript', 'body', 'token', 'credential', 's3Key']);
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;
const CHANGE_TYPES = new Set(['master_saved', 'slide_saved', 'slide_added', 'slide_duplicated', 'slides_reordered', 'slide_archived', 'revision_restored']);
const REASON_CODES = new Set(['CREATED', 'VALIDATION_FAILED', 'VERSION_CONFLICT', 'ACCESS_DENIED', 'DATABASE_FAILURE', 'ASSET_NOT_READY', 'ARCHIVED', 'OWNER_CHANGED', 'AUDIENCE_ACCESS_CHANGED']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AuditError extends Error {
  constructor(code, message = 'Invalid webinar audit metadata') {
    super(message);
    this.name = 'AuditError';
    this.code = code;
  }
}

function assertSafeAuditMetadata(metadata = {}) {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new AuditError('AUDIT_METADATA_INVALID');
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) throw new AuditError('AUDIT_METADATA_FORBIDDEN');
    if (!SAFE_METADATA_KEYS.has(key) || !validMetadataValue(key, value)) {
      throw new AuditError('AUDIT_METADATA_INVALID');
    }
  }
  return Object.freeze({ ...metadata });
}

function safeInteger(value, minimum = 0, maximum = MAX_SAFE_ID) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validMetadataValue(key, value) {
  switch (key) {
    case 'liveVersion': return safeInteger(value);
    case 'webinarId':
    case 'revisionId':
    case 'primaryOwnerUserId': return safeInteger(value, 1);
    case 'statusCode': return safeInteger(value, 100, 599);
    case 'slideId': return typeof value === 'string' && UUID.test(value);
    case 'audienceEnabled':
    case 'enabled':
    case 'archived': return typeof value === 'boolean';
    case 'changeType': return typeof value === 'string' && CHANGE_TYPES.has(value);
    case 'reasonCode': return typeof value === 'string' && REASON_CODES.has(value);
    default: return false;
  }
}

async function recordAuditEvent(connection, { webinarId = null, actorUserId, eventType, targetType, targetId = null, metadata = {} }) {
  const safeMetadata = assertSafeAuditMetadata(metadata);
  const [result] = await connection.query(
    `INSERT INTO webinar_audit_events
       (webinar_id, actor_user_id, event_type, target_type, target_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [webinarId, actorUserId, eventType, targetType, targetId === null ? null : String(targetId), JSON.stringify(safeMetadata)],
  );
  return { id: Number(result.insertId) };
}

module.exports = { AuditError, assertSafeAuditMetadata, recordAuditEvent };
