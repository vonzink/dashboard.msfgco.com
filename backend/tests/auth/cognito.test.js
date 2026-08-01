import { describe, it, expect } from 'vitest';
import { isAcceptedClient } from '../../auth/cognito';

// The app-client allowlist (COGNITO_CLIENT_ID + COGNITO_EXTRA_CLIENT_IDS). Signature and
// issuer verification are jose's job; this covers the check that decides WHICH clients of
// the shared user pool may call this API — including the mortgage suite's client.
const ALLOWED = ['dashboardclient', 'suiteclient'];

describe('isAcceptedClient', () => {
  it('accepts an ID token whose aud is allowed', () => {
    expect(isAcceptedClient({ aud: 'dashboardclient' }, ALLOWED)).toBe(true);
  });

  it('accepts an access token whose client_id is allowed', () => {
    expect(isAcceptedClient({ client_id: 'dashboardclient' }, ALLOWED)).toBe(true);
  });

  it('accepts the mortgage suite client from the extra-ids list', () => {
    expect(isAcceptedClient({ client_id: 'suiteclient' }, ALLOWED)).toBe(true);
    expect(isAcceptedClient({ aud: 'suiteclient' }, ALLOWED)).toBe(true);
  });

  it('rejects an ID token from an unknown client', () => {
    expect(isAcceptedClient({ aud: 'evil' }, ALLOWED)).toBe(false);
  });

  it('rejects an access token from an unknown client (previously slipped through)', () => {
    // Access tokens carry client_id and NO aud. The earlier check only rejected when aud
    // was present, so any client in the pool passed; this is the regression guard.
    expect(isAcceptedClient({ client_id: 'evil', token_use: 'access' }, ALLOWED)).toBe(false);
  });

  it('rejects a token carrying neither aud nor client_id', () => {
    expect(isAcceptedClient({ sub: 'abc' }, ALLOWED)).toBe(false);
    expect(isAcceptedClient({}, ALLOWED)).toBe(false);
  });

  it('skips the check entirely when no client ids are configured', () => {
    expect(isAcceptedClient({ client_id: 'anything' }, [])).toBe(true);
    expect(isAcceptedClient({}, [])).toBe(true);
  });
});
