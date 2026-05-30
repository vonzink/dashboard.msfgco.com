import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { encryptToken, decryptToken } from '../../services/calendarSync/tokenCrypto';
import { normalizeOutlookEvent } from '../../services/calendarSync/providers/outlook';
import { normalizeGoogleEvent } from '../../services/calendarSync/providers/google';

const require = createRequire(import.meta.url);
const dbConnectionModulePath = require.resolve('../../db/connection');
const oauthStateModulePath = require.resolve('../../services/calendarSync/oauthState');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function loadOAuthStateWithDb(mockDb) {
  const originalConnectionModule = require.cache[dbConnectionModulePath];
  delete require.cache[oauthStateModulePath];
  require.cache[dbConnectionModulePath] = {
    id: dbConnectionModulePath,
    filename: dbConnectionModulePath,
    loaded: true,
    exports: mockDb,
  };

  return {
    oauthState: require('../../services/calendarSync/oauthState'),
    restore() {
      delete require.cache[oauthStateModulePath];
      if (originalConnectionModule) {
        require.cache[dbConnectionModulePath] = originalConnectionModule;
      } else {
        delete require.cache[dbConnectionModulePath];
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('calendar sync token crypto', () => {
  beforeEach(() => {
    vi.stubEnv('CALENDAR_SYNC_ENCRYPTION_KEY', Buffer.alloc(32, 'a').toString('base64'));
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
    vi.stubEnv('OUTLOOK_CLIENT_ID', 'client-id');
    vi.stubEnv('OUTLOOK_TENANT_ID', 'tenant-id');
    vi.stubEnv('OUTLOOK_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('OUTLOOK_REDIRECT_URI', 'https://api.msfgco.com/api/schedule/sync/outlook/callback');
    vi.stubEnv('GOOGLE_CALENDAR_SYNC_ENABLED', 'false');
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
    expect(window.startDateTime).toBe('2026-04-27T06:00:00.000Z');
    expect(window.endDateTime).toBe('2026-11-24T06:59:59.999Z');
  });

  it('uses the Mountain local calendar date near UTC day rollover', () => {
    const { getSyncWindow } = require('../../services/calendarSync/window');
    const window = getSyncWindow(new Date('2026-05-28T03:30:00.000Z'));
    expect(window.startDate).toBe('2026-04-27');
    expect(window.endDate).toBe('2026-11-23');
    expect(window.startDateTime).toBe('2026-04-27T06:00:00.000Z');
    expect(window.endDateTime).toBe('2026-11-24T06:59:59.999Z');
  });
});

describe('calendar sync OAuth state', () => {
  it('stores OAuth state with a database UTC expiry', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ affectedRows: 1 }),
    };
    const { oauthState, restore } = loadOAuthStateWithDb(mockDb);

    try {
      await oauthState.storeOAuthState(7, 'outlook', 'state-value');
    } finally {
      restore();
    }

    expect(mockDb.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDb.query.mock.calls[0];
    expect(normalizeSql(sql)).toContain(
      'SET oauth_state = ?, oauth_state_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)'
    );
    expect(params).toEqual(['state-value', 7, 'outlook']);
  });

  it('returns null when guarded OAuth state consumption loses the update race', async () => {
    const connection = { id: 42, user_id: 7, provider: 'outlook' };
    const mockDb = {
      query: vi.fn()
        .mockResolvedValueOnce([[connection]])
        .mockResolvedValueOnce({ affectedRows: 0 }),
    };
    const { oauthState, restore } = loadOAuthStateWithDb(mockDb);
    let consumed;

    try {
      consumed = await oauthState.consumeOAuthState('outlook', 'state-value');
    } finally {
      restore();
    }

    expect(consumed).toBeNull();
    expect(mockDb.query).toHaveBeenCalledTimes(2);
    const [sql, params] = mockDb.query.mock.calls[1];
    expect(normalizeSql(sql)).toContain(
      'WHERE id = ? AND provider = ? AND oauth_state = ? AND oauth_state_expires_at > UTC_TIMESTAMP()'
    );
    expect(params).toEqual([42, 'outlook', 'state-value']);
  });
});
