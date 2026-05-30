const { decryptToken, encryptToken } = require('../tokenCrypto');
const { getOutlookConfig } = require('../config');
const { getSyncWindow } = require('../window');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const IMPORTABLE_SHOW_AS = new Set(['busy', 'tentative', 'outOfOffice', 'workingElsewhere']);

function dateParts(value) {
  const text = String(value || '');
  const [date, rawTime = ''] = text.split('T');
  return {
    date: date || null,
    time: rawTime ? rawTime.slice(0, 8) : null,
  };
}

function outlookStatus(showAs) {
  if (showAs === 'outOfOffice') return 'out';
  if (showAs === 'workingElsewhere') return 'remote';
  if (showAs === 'tentative') return 'meeting_event';
  return 'busy';
}

function isImportableEvent(event) {
  if (!event || event.isCancelled) return false;
  return IMPORTABLE_SHOW_AS.has(event.showAs || 'busy');
}

function normalizeOutlookEvent(event, connection) {
  const start = dateParts(event.start?.dateTime);
  const end = dateParts(event.end?.dateTime);
  const visibility = connection.privacy_default || 'availability_only';
  const shared = visibility === 'shared_details';

  return {
    user_id: connection.user_id,
    status: outlookStatus(event.showAs || 'busy'),
    start_date: start.date,
    end_date: end.date || start.date,
    start_time: event.isAllDay ? null : start.time,
    end_time: event.isAllDay ? null : end.time,
    timezone: event.start?.timeZone || 'America/Denver',
    note: shared ? (event.subject || null) : null,
    visibility,
    source: 'outlook',
    source_provider: 'outlook',
    source_event_id: event.id,
  };
}

function normalizeOutlookEvents(events, connection) {
  return (events || [])
    .filter(isImportableEvent)
    .map((event) => normalizeOutlookEvent(event, connection))
    .filter((event) => event.start_date && event.end_date && event.source_event_id);
}

function buildAuthorizationUrl(state) {
  const config = getOutlookConfig();
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function tokenRequest(params) {
  const config = getOutlookConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    ...params,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Outlook token request failed');
  }
  return payload;
}

function expiresAt(expiresIn) {
  return new Date(Date.now() + Math.max(Number(expiresIn || 3600) - 60, 60) * 1000);
}

async function exchangeCodeForTokens(code) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
  });
}

async function refreshTokens(connection) {
  const refreshToken = decryptToken(connection.encrypted_refresh_token);
  const payload = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  return {
    encrypted_access_token: encryptToken(payload.access_token),
    encrypted_refresh_token: encryptToken(payload.refresh_token || refreshToken),
    access_token_expires_at: expiresAt(payload.expires_in),
    scopes: payload.scope || connection.scopes || null,
  };
}

function tokenExpired(connection) {
  if (!connection.access_token_expires_at) return true;
  return new Date(connection.access_token_expires_at).getTime() <= Date.now() + 60 * 1000;
}

async function accessTokenFor(connection) {
  if (!connection.encrypted_access_token) {
    throw new Error('Outlook connection is missing an access token');
  }

  if (tokenExpired(connection) && connection.encrypted_refresh_token) {
    const refreshed = await refreshTokens(connection);
    Object.assign(connection, refreshed);
  }

  return decryptToken(connection.encrypted_access_token);
}

async function graphRequest(connection, pathOrUrl, options = {}) {
  const accessToken = await accessTokenFor(connection);
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      prefer: 'outlook.timezone="America/Denver"',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Outlook Graph request failed');
  }
  return payload;
}

async function getAccountEmail(connection) {
  const me = await graphRequest(connection, '/me?$select=mail,userPrincipalName');
  return me.mail || me.userPrincipalName || connection.provider_account_email || null;
}

async function listEvents(connection, syncWindow = getSyncWindow()) {
  const params = new URLSearchParams({
    startDateTime: syncWindow.startDateTime,
    endDateTime: syncWindow.endDateTime,
    '$select': 'id,subject,start,end,showAs,isCancelled,isAllDay,sensitivity,lastModifiedDateTime,webLink',
    '$top': '50',
  });
  let url = `/me/calendarView?${params.toString()}`;
  const events = [];

  while (url) {
    const payload = await graphRequest(connection, url);
    events.push(...(payload.value || []));
    url = payload['@odata.nextLink'] || '';
  }

  return normalizeOutlookEvents(events, connection);
}

function showAsForEntry(entry) {
  if (entry.status === 'out') return 'outOfOffice';
  if (entry.status === 'remote') return 'workingElsewhere';
  return 'busy';
}

function outlookEventPayload(entry) {
  const isAllDay = !entry.start_time && !entry.end_time;
  const startDateTime = isAllDay
    ? `${entry.start_date}T00:00:00`
    : `${entry.start_date}T${entry.start_time || '00:00:00'}`;
  const endDateTime = isAllDay
    ? `${entry.end_date}T23:59:59`
    : `${entry.end_date}T${entry.end_time || entry.start_time || '23:59:59'}`;

  return {
    subject: entry.note || 'MSFG Schedule',
    isAllDay,
    showAs: showAsForEntry(entry),
    sensitivity: entry.visibility === 'availability_only' ? 'private' : 'normal',
    categories: ['MSFG Schedule'],
    start: { dateTime: startDateTime, timeZone: entry.timezone || 'America/Denver' },
    end: { dateTime: endDateTime, timeZone: entry.timezone || 'America/Denver' },
  };
}

async function createEvent(connection, entry) {
  const payload = await graphRequest(connection, '/me/events', {
    method: 'POST',
    body: JSON.stringify(outlookEventPayload(entry)),
  });
  return {
    provider_event_id: payload.id,
    provider_etag: payload['@odata.etag'] || null,
  };
}

async function updateEvent(connection, providerEventId, entry) {
  const payload = await graphRequest(connection, `/me/events/${encodeURIComponent(providerEventId)}`, {
    method: 'PATCH',
    body: JSON.stringify(outlookEventPayload(entry)),
  });
  return {
    provider_event_id: payload.id || providerEventId,
    provider_etag: payload['@odata.etag'] || null,
  };
}

module.exports = {
  buildAuthorizationUrl,
  createEvent,
  exchangeCodeForTokens,
  getAccountEmail,
  listEvents,
  normalizeOutlookEvent,
  normalizeOutlookEvents,
  refreshTokens,
  updateEvent,
};
