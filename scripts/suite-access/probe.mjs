// Read-only probe: does this dashboard token work against the suite API, and does CORS allow the dashboard origin?
import { decodeJwtPayload, assessSuiteReadiness } from './jwt-inspect.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const api = (args.api || 'https://los.msfgco.com').replace(/\/$/, '');
const origin = args.origin || 'https://dashboard.msfgco.com';
const token = process.env.SUITE_PROBE_TOKEN;

if (!token) {
  console.error('Set SUITE_PROBE_TOKEN to a dashboard auth_token (see README.md).');
  process.exit(2);
}

let r;
try {
  r = assessSuiteReadiness(decodeJwtPayload(token), Math.floor(Date.now() / 1000));
} catch (err) {
  console.error('SUITE_PROBE_TOKEN is not a valid JWT (did you copy the whole auth_token?)');
  process.exit(1);
}
console.log('Token summary:', { ...r.summary, orgId: r.summary.orgId ? 'present' : 'missing' });
console.log(r.ok ? 'Readiness: OK' : `Readiness problems:\n - ${r.problems.join('\n - ')}`);

async function call(method, path) {
  try {
    const res = await fetch(api + path, {
      method,
      headers: method === 'OPTIONS'
        ? { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' }
        : { Origin: origin, Authorization: `Bearer ${token}` },
    });
    console.log(`${method} ${path} -> ${res.status}  ACAO=${res.headers.get('access-control-allow-origin') ?? '(none)'}`);
    return res.status;
  } catch (err) {
    console.error(`${method} ${path} -> network error: ${err.cause?.code || err.message}`);
    return null;
  }
}

const preflight = await call('OPTIONS', '/api/board');
const me = await call('GET', '/api/me');
await call('GET', '/api/board?size=1');

if (preflight !== 200) console.log(`CORS: ${origin} not allowed yet (expected before Task 4 deploy).`);
process.exit(r.ok && me === 200 ? 0 : 1);
