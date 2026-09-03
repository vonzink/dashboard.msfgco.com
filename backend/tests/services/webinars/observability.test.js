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

  it('does not expose mutable allow-list policy', () => {
    expect(() => EVENT_NAMES.push('webinar.exfiltration')).toThrow();
    expect(() => SAFE_FIELDS.push('token')).toThrow();
    expect(() => createOperationalEventRecorder({ info: vi.fn() })('webinar.exfiltration', {})).toThrow(expect.objectContaining({ code: 'OPERATIONAL_EVENT_INVALID' }));
  });
});
