const SAFE_METADATA_KEYS = new Set([
  'liveVersion', 'reasonCode', 'statusCode', 'webinarId', 'revisionId', 'slideId',
  'primaryOwnerUserId', 'audienceEnabled', 'enabled', 'archived', 'changeType',
]);
const FORBIDDEN_METADATA_KEYS = new Set(['source', 'html', 'css', 'javascript', 'body', 'token', 'credential', 's3Key']);

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
    if (!SAFE_METADATA_KEYS.has(key) || !['string', 'number', 'boolean'].includes(typeof value) || !Number.isFinite(value) && typeof value === 'number') {
      throw new AuditError('AUDIT_METADATA_INVALID');
    }
  }
  return Object.freeze({ ...metadata });
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
