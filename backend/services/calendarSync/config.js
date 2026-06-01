const DEFAULT_RETURN_URL = 'https://dashboard.msfgco.com/Calculators/Company%20Calendar/calendar.html';

const OUTLOOK_SCOPES = ['offline_access', 'User.Read', 'Calendars.ReadWrite'];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getOutlookConfig() {
  return {
    provider: 'outlook',
    clientId: requiredEnv('OUTLOOK_CLIENT_ID'),
    tenantId: requiredEnv('OUTLOOK_TENANT_ID'),
    clientSecret: requiredEnv('OUTLOOK_CLIENT_SECRET'),
    redirectUri: requiredEnv('OUTLOOK_REDIRECT_URI'),
    scopes: OUTLOOK_SCOPES,
    authorizeUrl: `https://login.microsoftonline.com/${requiredEnv('OUTLOOK_TENANT_ID')}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${requiredEnv('OUTLOOK_TENANT_ID')}/oauth2/v2.0/token`,
  };
}

function getReturnUrl(params = {}) {
  const base = process.env.CALENDAR_SYNC_RETURN_URL || DEFAULT_RETURN_URL;
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
}

function isProviderEnabled(provider) {
  if (provider === 'outlook') return true;
  if (provider === 'google') return process.env.GOOGLE_CALENDAR_SYNC_ENABLED === 'true';
  return false;
}

module.exports = {
  OUTLOOK_SCOPES,
  getOutlookConfig,
  getReturnUrl,
  isProviderEnabled,
};
