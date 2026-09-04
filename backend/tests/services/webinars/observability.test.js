import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CONTROLLED_REASON_CODE_DEFINITIONS,
  CONTROLLED_REASON_CODES,
  EVENT_NAMES,
  SAFE_FIELDS,
  createOperationalEventRecorder,
  getControlledReasonCodeDefinition,
} = require('../../../services/webinars/observability');

const EXPECTED_CONTROLLED_REASON_CODES = [
  'ACCESS_DENIED',
  'ADMIN_ACCESS_REQUIRED',
  'ANCHOR_CONFLICT',
  'ANCHOR_FORMAT',
  'ASSET_AVAILABLE',
  'ASSET_INSPECTION_REJECTED',
  'ASSET_LIBRARY_NOT_READY',
  'ASSET_NOT_AVAILABLE',
  'ASSET_NOT_FOUND',
  'ASSET_ORIGIN_NOT_CONFIGURED',
  'ASSET_REFERENCE_INVALID',
  'ASSET_SCANNER_FAILURE',
  'ASSET_SCAN_PENDING',
  'ASSET_SCAN_REJECTED',
  'ASSET_TOKEN_INVALID',
  'ASSET_TOKEN_FORMAT',
  'AUDIT_METADATA_FORBIDDEN',
  'AUDIT_METADATA_INVALID',
  'CONTENT_LIMIT_EXCEEDED',
  'CONTENT_VALIDATION_FAILED',
  'CSS_IMPORT_INVALID',
  'CSS_SYNTAX',
  'CSS_VALUE_UNSUPPORTED',
  'DATABASE_FAILURE',
  'EXECUTABLE_URL',
  'FORBIDDEN_ATTRIBUTE',
  'FORBIDDEN_HTML',
  'JAVASCRIPT_SYNTAX',
  'MALFORMED_JSON',
  'MASTER_TOKEN_COUNT',
  'NOTE_BODY_EMPTY',
  'NOTE_BODY_TOO_LONG',
  'NOTE_NOT_FOUND',
  'OPERATIONAL_EVENT_INVALID',
  'OWNER_NOT_ACTIVE',
  'PREFERENCES_INVALID',
  'PREFERENCE_KEY_UNSAFE',
  'PREFERENCE_VALUE_INVALID',
  'PUBLIC_DELIVERY_FAILURE',
  'PUBLIC_RUNTIME_ERROR',
  'RESOURCE_NOT_HTTPS',
  'RESOURCE_ORIGIN_FORBIDDEN',
  'SETTINGS_DATA_CORRUPT',
  'RESTORE_SLIDE_OWNERSHIP_CONFLICT',
  'REVISION_NOT_FOUND',
  'REVISION_POLICY_INCOMPATIBLE',
  'REVISION_SNAPSHOT_INVALID',
  'SHORTCUTS_INVALID',
  'SHORTCUT_ACTION_UNKNOWN',
  'SHORTCUT_BINDING_DUPLICATE',
  'SHORTCUT_BINDING_INVALID',
  'SHORTCUT_BINDING_RESERVED',
  'SLIDE_NOT_FOUND',
  'SLIDE_SET_MISMATCH',
  'TARGET_SECONDS_RANGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_FAILED',
  'VERSION_CONFLICT',
  'WEBINAR_ACCESS_DENIED',
  'WEBINAR_NOT_FOUND',
];

describe('Webinar Studio operational events', () => {
  it('defines one exhaustive, immutable Task 2-6 controlled reason-code contract', () => {
    expect(CONTROLLED_REASON_CODES).toEqual(EXPECTED_CONTROLLED_REASON_CODES);
    expect(Object.keys(CONTROLLED_REASON_CODE_DEFINITIONS)).toEqual(EXPECTED_CONTROLLED_REASON_CODES);
    expect(Object.isFrozen(CONTROLLED_REASON_CODE_DEFINITIONS)).toBe(true);
    expect(Object.values(CONTROLLED_REASON_CODE_DEFINITIONS).every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(CONTROLLED_REASON_CODES)).toBe(true);
    expect(() => CONTROLLED_REASON_CODES.push('SOURCE_PASSWORD')).toThrow();
  });

  it.each(EXPECTED_CONTROLLED_REASON_CODES)('retains controlled reason code %s in the final logger record', (reasonCode) => {
    const logger = { info: vi.fn() };
    createOperationalEventRecorder(logger)('webinar.validation_rejected', {
      reasonCode,
      statusCode: 400,
      source: '<script>',
      body: 'password=secret',
    });
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'webinar.validation_rejected', reasonCode, statusCode: 400 },
      'webinar operational event',
    );
  });

  it('maps externally controlled route errors to canonical status and event classifications', () => {
    expect(getControlledReasonCodeDefinition('CONTENT_VALIDATION_FAILED')).toEqual({
      httpStatus: 400,
      eventName: 'webinar.validation_rejected',
    });
    expect(getControlledReasonCodeDefinition('ADMIN_ACCESS_REQUIRED')).toEqual({
      httpStatus: 403,
      eventName: 'webinar.authorization_denied',
    });
    expect(getControlledReasonCodeDefinition('ANCHOR_CONFLICT')).toEqual({
      httpStatus: 409,
      eventName: 'webinar.version_conflict',
    });
    expect(getControlledReasonCodeDefinition('DATABASE_FAILURE')).toEqual({
      httpStatus: 500,
      eventName: 'webinar.database_failure',
    });
    expect(getControlledReasonCodeDefinition('REVISION_SNAPSHOT_INVALID')).toEqual({
      httpStatus: null,
      eventName: null,
    });
    expect(getControlledReasonCodeDefinition('REVISION_POLICY_INCOMPATIBLE')).toEqual({
      httpStatus: 409,
      eventName: 'webinar.validation_rejected',
    });
  });

  it('emits only fixed event names and allow-listed fields', () => {
    const logger = { info: vi.fn() };
    const recordOperationalEvent = createOperationalEventRecorder(logger);
    expect(recordOperationalEvent('webinar.save_succeeded', {
      webinarId: 2,
      liveVersion: 5,
      durationMs: 11,
      html: '<secret>',
      token: 'nope',
    })).toEqual({ webinarId: 2, liveVersion: 5, durationMs: 11 });
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'webinar.save_succeeded', webinarId: 2, liveVersion: 5, durationMs: 11 },
      'webinar operational event',
    );
  });

  it('rejects unknown event names rather than logging a caller supplied name', () => {
    const recordOperationalEvent = createOperationalEventRecorder({ info: vi.fn() });
    expect(() => recordOperationalEvent('webinar.arbitrary', { webinarId: 2 }))
      .toThrow(expect.objectContaining({ code: 'OPERATIONAL_EVENT_INVALID' }));
  });

  it.each([
    'SQLSTATE_42000',
    'ER_ACCESS_DENIED password=secret',
    'SOURCE_<script>',
    '',
  ])('drops arbitrary, source-like, and secret-like reason code %j', (reasonCode) => {
    const logger = { info: vi.fn() };
    expect(createOperationalEventRecorder(logger)('webinar.database_failure', {
      webinarId: 2,
      statusCode: 500,
      reasonCode,
    })).toEqual({ webinarId: 2, statusCode: 500 });
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'webinar.database_failure', webinarId: 2, statusCode: 500 },
      'webinar operational event',
    );
  });

  it('drops wrongly typed and unbounded allowed-field values', () => {
    const logger = { info: vi.fn() };
    expect(createOperationalEventRecorder(logger)('webinar.database_failure', {
      webinarId: '2', liveVersion: -1, durationMs: 10 ** 12, statusCode: 777,
    })).toEqual({});
  });

  it('does not expose mutable event or field allow-list policy', () => {
    expect(() => EVENT_NAMES.push('webinar.exfiltration')).toThrow();
    expect(() => SAFE_FIELDS.push('token')).toThrow();
    expect(() => createOperationalEventRecorder({ info: vi.fn() })('webinar.exfiltration', {}))
      .toThrow(expect.objectContaining({ code: 'OPERATIONAL_EVENT_INVALID' }));
  });
});
