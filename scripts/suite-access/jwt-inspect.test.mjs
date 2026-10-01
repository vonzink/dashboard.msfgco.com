import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeJwtPayload, assessSuiteReadiness } from './jwt-inspect.mjs';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64u({ alg: 'RS256' })}.${b64u(payload)}.sig`;
const NOW = 1_800_000_000;
const good = {
  token_use: 'id',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  'cognito:groups': ['LO'],
  aud: '2t9edrhu5crf8vq3ivigv6jopf',
  exp: NOW + 600,
};

test('decodes payload', () => {
  assert.deepEqual(decodeJwtPayload(jwt(good)), good);
});

test('rejects non-JWT', () => {
  assert.throws(() => decodeJwtPayload('abc'), /not a JWT/);
});

test('good staff id token is ready', () => {
  const r = assessSuiteReadiness(good, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.summary.clientId, '2t9edrhu5crf8vq3ivigv6jopf');
  assert.equal(r.summary.expiresInSec, 600);
});

test('access token is flagged (no org_id stamped on access tokens)', () => {
  const r = assessSuiteReadiness({ ...good, token_use: 'access', aud: undefined, client_id: 'x' }, NOW);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /access token/);
});

test('missing or non-UUID org_id is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, org_id: undefined }, NOW).problems.join(), /org_id missing/);
  assert.match(assessSuiteReadiness({ ...good, org_id: 'nope' }, NOW).problems.join(), /org_id not a UUID/);
});

test('borrower-only or group-less user is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, 'cognito:groups': ['Borrower'] }, NOW).problems.join(), /no staff group/);
  assert.match(assessSuiteReadiness({ ...good, 'cognito:groups': undefined }, NOW).problems.join(), /no staff group/);
});

test('wrong-case group is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, 'cognito:groups': ['admin'] }, NOW).problems.join(), /no staff group/);
});

test('uppercase enum group is accepted', () => {
  assert.equal(assessSuiteReadiness({ ...good, 'cognito:groups': ['UNDERWRITER'] }, NOW).ok, true);
});

test('non-array cognito:groups is treated as no groups', () => {
  assert.match(assessSuiteReadiness({ ...good, 'cognito:groups': 'LO' }, NOW).problems.join(), /no staff group/);
});

test('expired token is flagged', () => {
  assert.match(assessSuiteReadiness({ ...good, exp: NOW - 1 }, NOW).problems.join(), /expired/);
});
