import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertSafeAuditMetadata, recordAuditEvent } = require('../../../services/webinars/audit');

describe('Webinar Studio audit records', () => {
  it('accepts only safe scalar allow-listed metadata', async () => {
    const connection = { query: vi.fn().mockResolvedValue([{ insertId: 12 }]) };
    await expect(recordAuditEvent(connection, {
      webinarId: 2, actorUserId: 7, eventType: 'webinar_created', targetType: 'webinar', targetId: '2', metadata: { liveVersion: 1, reasonCode: 'CREATED' },
    })).resolves.toEqual({ id: 12 });
    expect(connection.query.mock.calls[0][1]).toEqual([2, 7, 'webinar_created', 'webinar', '2', JSON.stringify({ liveVersion: 1, reasonCode: 'CREATED' })]);
  });

  it.each(['source', 'html', 'css', 'javascript', 'body', 'token', 'credential', 's3Key'])('rejects sensitive %s metadata', key => {
    expect(() => assertSafeAuditMetadata({ [key]: 'do not store' })).toThrow(expect.objectContaining({ code: 'AUDIT_METADATA_FORBIDDEN' }));
  });

  it('rejects nested and non-allow-listed metadata', () => {
    expect(() => assertSafeAuditMetadata({ reasonCode: { nested: true } })).toThrow(expect.objectContaining({ code: 'AUDIT_METADATA_INVALID' }));
    expect(() => assertSafeAuditMetadata({ arbitrary: 'no' })).toThrow(expect.objectContaining({ code: 'AUDIT_METADATA_INVALID' }));
  });

  it.each([
    [{ reasonCode: 'api_key=super-secret' }],
    [{ liveVersion: '5' }],
    [{ liveVersion: Number.MAX_SAFE_INTEGER + 1 }],
    [{ durationMs: 10 ** 12 }],
    [{ statusCode: 999 }],
    [{ slideId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
  ])('rejects leaky or unbounded values in otherwise allowed metadata', metadata => {
    expect(() => assertSafeAuditMetadata(metadata)).toThrow(expect.objectContaining({ code: 'AUDIT_METADATA_INVALID' }));
  });
});
