import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOperationalEventRecorder, EVENT_NAMES, SAFE_FIELDS } = require('../../../services/webinars/observability');

describe('Webinar Studio operational events', () => {
  it('emits only fixed event names and allow-listed fields', () => {
    const logger = { info: vi.fn() };
    const recordOperationalEvent = createOperationalEventRecorder(logger);
    expect(recordOperationalEvent('webinar.save_succeeded', { webinarId: 2, liveVersion: 5, durationMs: 11, html: '<secret>', token: 'nope' }))
      .toEqual({ webinarId: 2, liveVersion: 5, durationMs: 11 });
    expect(logger.info).toHaveBeenCalledWith({ event: 'webinar.save_succeeded', webinarId: 2, liveVersion: 5, durationMs: 11 }, 'webinar operational event');
  });

  it('rejects unknown event names rather than logging a caller supplied name', () => {
    const recordOperationalEvent = createOperationalEventRecorder({ info: vi.fn() });
    expect(() => recordOperationalEvent('webinar.arbitrary', { webinarId: 2 })).toThrow(expect.objectContaining({ code: 'OPERATIONAL_EVENT_INVALID' }));
  });

  it('drops secret-like, wrongly typed, and unbounded allowed-field values', () => {
    const logger = { info: vi.fn() };
    const recordOperationalEvent = createOperationalEventRecorder(logger);
    expect(recordOperationalEvent('webinar.database_failure', {
      webinarId: '2', liveVersion: -1, reasonCode: 'password=secret', durationMs: 10 ** 12, statusCode: 777,
    })).toEqual({});
  });

  it.each([
    'VALIDATION_FAILED', 'VERSION_CONFLICT', 'ACCESS_DENIED', 'DATABASE_FAILURE',
    'SHORTCUT_ACTION_UNKNOWN', 'SHORTCUT_BINDING_INVALID', 'SHORTCUT_BINDING_RESERVED',
    'SHORTCUT_BINDING_DUPLICATE', 'SHORTCUTS_INVALID', 'PREFERENCES_INVALID',
    'PREFERENCE_KEY_UNSAFE', 'PREFERENCE_VALUE_INVALID', 'ANCHOR_CONFLICT',
    'RESTORE_SLIDE_OWNERSHIP_CONFLICT', 'UNSUPPORTED_MEDIA_TYPE', 'CONTENT_LIMIT_EXCEEDED',
  ])('emits the approved route reason code %s in the final logger record', (reasonCode) => {
    const logger = { info: vi.fn() };
    createOperationalEventRecorder(logger)('webinar.validation_rejected', { reasonCode, statusCode: 400 });
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'webinar.validation_rejected', reasonCode, statusCode: 400 },
      'webinar operational event'
    );
  });

  it('never emits unrecognized or source-like reason codes', () => {
    const logger = { info: vi.fn() };
    createOperationalEventRecorder(logger)('webinar.validation_rejected', {
      reasonCode: 'SQLSTATE_42000 password=secret source=<script>', statusCode: 400,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'webinar.validation_rejected', statusCode: 400 },
      'webinar operational event'
    );
  });

  it('does not expose mutable allow-list policy', () => {
    expect(() => EVENT_NAMES.push('webinar.exfiltration')).toThrow();
    expect(() => SAFE_FIELDS.push('token')).toThrow();
    expect(() => createOperationalEventRecorder({ info: vi.fn() })('webinar.exfiltration', {})).toThrow(expect.objectContaining({ code: 'OPERATIONAL_EVENT_INVALID' }));
  });
});
