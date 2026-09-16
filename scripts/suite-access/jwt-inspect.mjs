// Pure helpers for checking whether a dashboard Cognito token will be accepted by the msfg-suite API.
export const STAFF_GROUPS = ['Admin', 'LO', 'Processor', 'Underwriter', 'Closer', 'Manager'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeJwtPayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

export function assessSuiteReadiness(payload, nowSec) {
  const problems = [];
  const groups = payload['cognito:groups'] || [];
  const orgId = payload.org_id;

  if (payload.token_use !== 'id') problems.push(`access token sent (token_use=${payload.token_use}); suite needs the id token`);
  if (orgId == null || String(orgId).trim() === '') problems.push('org_id missing');
  else if (!UUID_RE.test(String(orgId).trim())) problems.push('org_id not a UUID');

  const staff = STAFF_GROUPS.map((g) => g.toLowerCase());
  if (!groups.some((g) => staff.includes(String(g).toLowerCase()))) {
    problems.push(`no staff group (groups=${JSON.stringify(groups)}); suite will treat user as Borrower`);
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
