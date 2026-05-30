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
  vi.unstubAllGlobals();
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

describe('Outlook provider adapter', () => {
  beforeEach(() => {
    vi.stubEnv('OUTLOOK_CLIENT_ID', 'client-id');
    vi.stubEnv('OUTLOOK_TENANT_ID', 'tenant-id');
    vi.stubEnv('OUTLOOK_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('OUTLOOK_REDIRECT_URI', 'https://api.msfgco.com/api/schedule/sync/outlook/callback');
  });

  it('builds an Outlook authorization URL with state and delegated scopes', () => {
    const { buildAuthorizationUrl } = require('../../services/calendarSync/providers/outlook');
    const url = new URL(buildAuthorizationUrl('state-123'));

    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/tenant-id/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.msfgco.com/api/schedule/sync/outlook/callback');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')).toContain('Calendars.ReadWrite');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });

  it('filters Outlook free and cancelled events', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      { id: 'busy-1', showAs: 'busy', isCancelled: false, start: { dateTime: '2026-06-01T09:00:00' }, end: { dateTime: '2026-06-01T10:00:00' } },
      { id: 'free-1', showAs: 'free', isCancelled: false, start: { dateTime: '2026-06-01T11:00:00' }, end: { dateTime: '2026-06-01T12:00:00' } },
      { id: 'cancelled-1', showAs: 'busy', isCancelled: true, start: { dateTime: '2026-06-01T13:00:00' }, end: { dateTime: '2026-06-01T14:00:00' } },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'availability_only' });

    expect(events.map((event) => event.source_event_id)).toEqual(['busy-1']);
  });

  it('maps Outlook availability states to MSFG statuses', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      { id: 'ooo', showAs: 'oof', start: { dateTime: '2026-06-01T09:00:00' }, end: { dateTime: '2026-06-01T10:00:00' } },
      { id: 'elsewhere', showAs: 'workingElsewhere', start: { dateTime: '2026-06-01T11:00:00' }, end: { dateTime: '2026-06-01T12:00:00' } },
      { id: 'tentative', showAs: 'tentative', start: { dateTime: '2026-06-01T13:00:00' }, end: { dateTime: '2026-06-01T14:00:00' } },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'availability_only' });

    expect(events.map((event) => event.status)).toEqual(['out', 'remote', 'meeting_event']);
    expect(events.every((event) => event.note === null)).toBe(true);
  });

  it('normalizes Graph oof events as out availability', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      { id: 'oof-1', showAs: 'oof', isCancelled: false, start: { dateTime: '2026-06-01T09:00:00' }, end: { dateTime: '2026-06-01T10:00:00' } },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'availability_only' });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      status: 'out',
      source_event_id: 'oof-1',
    }));
  });

  it('converts all-day Graph exclusive end dates to inclusive MSFG end dates', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      {
        id: 'all-day-1',
        showAs: 'busy',
        isAllDay: true,
        start: { dateTime: '2026-06-01T00:00:00' },
        end: { dateTime: '2026-06-02T00:00:00' },
      },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'availability_only' });

    expect(events[0]).toEqual(expect.objectContaining({
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: null,
      end_time: null,
    }));
  });

  it('suppresses private Outlook subjects even when shared details are enabled', () => {
    const { normalizeOutlookEvents } = require('../../services/calendarSync/providers/outlook');
    const events = normalizeOutlookEvents([
      { id: 'private-1', subject: 'Private detail', sensitivity: 'private', showAs: 'busy', start: { dateTime: '2026-06-01T09:00:00' }, end: { dateTime: '2026-06-01T10:00:00' } },
      { id: 'normal-1', subject: 'Shareable detail', sensitivity: 'normal', showAs: 'busy', start: { dateTime: '2026-06-01T11:00:00' }, end: { dateTime: '2026-06-01T12:00:00' } },
    ], { user_id: 7, provider: 'outlook', privacy_default: 'shared_details' });

    expect(events.map((event) => event.note)).toEqual([null, 'Shareable detail']);
  });

  it('exports all-day entries with Graph exclusive next-day midnight end dates', () => {
    const { outlookEventPayload } = require('../../services/calendarSync/providers/outlook');
    const payload = outlookEventPayload({
      status: 'out',
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: null,
      end_time: null,
      timezone: 'America/Denver',
      visibility: 'availability_only',
    });

    expect(payload.isAllDay).toBe(true);
    expect(payload.showAs).toBe('oof');
    expect(payload.start.dateTime).toBe('2026-06-01T00:00:00');
    expect(payload.end.dateTime).toBe('2026-06-02T00:00:00');
  });

  it('persists refreshed token fields before continuing Graph requests', async () => {
    vi.stubEnv('CALENDAR_SYNC_ENCRYPTION_KEY', Buffer.alloc(32, 'a').toString('base64'));
    const { getAccountEmail } = require('../../services/calendarSync/providers/outlook');
    const calls = [];
    const persistRefreshedTokens = vi.fn(async () => {
      calls.push('persist');
    });
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/oauth2/v2.0/token')) {
        calls.push('refresh');
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            scope: 'offline_access User.Read Calendars.ReadWrite',
          }),
        };
      }

      calls.push('graph');
      return {
        ok: true,
        json: async () => ({ mail: 'user@msfg.us' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const email = await getAccountEmail({
      user_id: 7,
      provider: 'outlook',
      provider_account_email: null,
      encrypted_access_token: encryptToken('old-access-token'),
      encrypted_refresh_token: encryptToken('old-refresh-token'),
      access_token_expires_at: new Date(Date.now() - 60_000),
      persistRefreshedTokens,
    });

    expect(email).toBe('user@msfg.us');
    expect(persistRefreshedTokens).toHaveBeenCalledTimes(1);
    const refreshed = persistRefreshedTokens.mock.calls[0][0];
    expect(decryptToken(refreshed.encrypted_access_token)).toBe('new-access-token');
    expect(decryptToken(refreshed.encrypted_refresh_token)).toBe('new-refresh-token');
    expect(refreshed.scopes).toBe('offline_access User.Read Calendars.ReadWrite');
    expect(calls).toEqual(['refresh', 'persist', 'graph']);
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe('Bearer new-access-token');
  });
});
