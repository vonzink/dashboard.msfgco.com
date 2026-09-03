import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOperationalEventRecorder } = require('../../../services/webinars/observability');

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
});
