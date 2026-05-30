import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { encryptToken, decryptToken } from '../../services/calendarSync/tokenCrypto';
import { normalizeOutlookEvent } from '../../services/calendarSync/providers/outlook';
import { normalizeGoogleEvent } from '../../services/calendarSync/providers/google';

const require = createRequire(import.meta.url);

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

describe('calendar sync configuration', () => {
  beforeEach(() => {
    process.env.OUTLOOK_CLIENT_ID = 'client-id';
    process.env.OUTLOOK_TENANT_ID = 'tenant-id';
    process.env.OUTLOOK_CLIENT_SECRET = 'client-secret';
    process.env.OUTLOOK_REDIRECT_URI = 'https://api.msfgco.com/api/schedule/sync/outlook/callback';
    process.env.GOOGLE_CALENDAR_SYNC_ENABLED = 'false';
  });

  it('builds Outlook config from environment variables', () => {
    const { getOutlookConfig, isProviderEnabled } = require('../../services/calendarSync/config');
    expect(getOutlookConfig()).toEqual(expect.objectContaining({
      clientId: 'client-id',
      tenantId: 'tenant-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://api.msfgco.com/api/schedule/sync/outlook/callback',
    }));
    expect(isProviderEnabled('outlook')).toBe(true);
    expect(isProviderEnabled('google')).toBe(false);
  });

  it('computes the default import window', () => {
    const { getSyncWindow } = require('../../services/calendarSync/window');
    const window = getSyncWindow(new Date('2026-05-27T12:00:00.000Z'));
    expect(window.startDate).toBe('2026-04-27');
    expect(window.endDate).toBe('2026-11-23');
    expect(window.startDateTime).toBe('2026-04-27T00:00:00.000Z');
    expect(window.endDateTime).toBe('2026-11-23T23:59:59.999Z');
  });
});
