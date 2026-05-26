import { describe, it, expect, beforeEach } from 'vitest';
import { encryptToken, decryptToken } from '../../services/calendarSync/tokenCrypto';
import { normalizeOutlookEvent } from '../../services/calendarSync/providers/outlook';
import { normalizeGoogleEvent } from '../../services/calendarSync/providers/google';

describe('calendar sync token crypto', () => {
  beforeEach(() => {
    process.env.CALENDAR_SYNC_ENCRYPTION_KEY = Buffer.alloc(32, 'a').toString('base64');
  });

  it('round trips encrypted tokens', () => {
    const encrypted = encryptToken('secret-token');
    expect(encrypted).not.toBe('secret-token');
    expect(decryptToken(encrypted)).toBe('secret-token');
  });
});

describe('provider event normalization', () => {
  it('normalizes Outlook busy events without private details', () => {
    const event = normalizeOutlookEvent({
      id: 'outlook-1',
      subject: 'Private appointment',
      start: { dateTime: '2026-06-01T09:00:00', timeZone: 'Mountain Standard Time' },
      end: { dateTime: '2026-06-01T10:00:00', timeZone: 'Mountain Standard Time' },
      showAs: 'busy',
    }, { user_id: 7, privacy_default: 'availability_only' });

    expect(event.status).toBe('busy');
    expect(event.note).toBeNull();
    expect(event.start_time).toBe('09:00:00');
    expect(event.end_time).toBe('10:00:00');
    expect(event.source).toBe('outlook');
    expect(event.source_event_id).toBe('outlook-1');
  });

  it('normalizes Google busy events without private details', () => {
    const event = normalizeGoogleEvent({
      id: 'google-1',
      summary: 'Private appointment',
      start: { dateTime: '2026-06-01T09:00:00-06:00' },
      end: { dateTime: '2026-06-01T10:00:00-06:00' },
    }, { user_id: 7, privacy_default: 'availability_only' });

    expect(event.status).toBe('busy');
    expect(event.note).toBeNull();
    expect(event.start_time).toBe('09:00:00');
    expect(event.end_time).toBe('10:00:00');
    expect(event.source).toBe('google');
    expect(event.source_event_id).toBe('google-1');
  });
});
