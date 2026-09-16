// Pure helpers for checking whether a dashboard Cognito token will be accepted by the msfg-suite API.
// Staff group names from msfg-suite CognitoRolesConverter (GROUP_ALIASES keys + Role enum names, excluding BORROWER/REAL_ESTATE_AGENT).
export const STAFF_GROUPS = ['Admin', 'Manager', 'LO', 'Processor', 'PROCESSOR', 'UNDERWRITER', 'CLOSER', 'MANAGER', 'ADMIN', 'PLATFORM_ADMIN'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeJwtPayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export function assessSuiteReadiness(payload, nowSec) {
  const problems = [];
  const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
  const orgId = payload.org_id;

  if (payload.token_use !== 'id') problems.push(`access token sent (token_use=${payload.token_use}); suite needs the id token`);
  if (orgId == null || String(orgId).trim() === '') problems.push('org_id missing');
  else if (!UUID_RE.test(String(orgId).trim())) problems.push('org_id not a UUID');

  if (!groups.some((g) => STAFF_GROUPS.includes(String(g)))) {
    problems.push(`no staff group (groups=${JSON.stringify(groups)}); suite will grant no staff role`);
  }
  if (typeof payload.exp === 'number' && payload.exp <= nowSec) problems.push('token expired');

  return {
    ok: problems.length === 0,
    problems,
    summary: {
      tokenUse: payload.token_use,
      orgId,
      groups,
      clientId: payload.aud || payload.client_id,
      expiresInSec: typeof payload.exp === 'number' ? payload.exp - nowSec : null,
    },
  };
}
