const express = require('express');
const db = require('../db/connection');
const { encryptToken } = require('../services/calendarSync/tokenCrypto');
const { consumeOAuthState } = require('../services/calendarSync/oauthState');
const { getReturnUrl, isProviderEnabled } = require('../services/calendarSync/config');
const { runSyncForConnection } = require('../services/calendarSync/syncEngine');
const outlookProvider = require('../services/calendarSync/providers/outlook');

const router = express.Router();

function adapterFor(provider) {
  if (!isProviderEnabled(provider)) return null;
  if (provider === 'outlook') return outlookProvider;
  return null;
}

function tokenExpiry(expiresIn) {
  return new Date(Date.now() + Math.max(Number(expiresIn || 3600) - 60, 60) * 1000);
}

router.get('/:provider/callback', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const adapter = adapterFor(provider);
    if (!adapter) {
      return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'provider_disabled' }));
    }

    if (req.query.error) {
      return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'provider_denied' }));
    }

    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) {
      return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'missing_code' }));
    }

    const connection = await consumeOAuthState(provider, state);
    if (!connection) {
      return res.redirect(getReturnUrl({ sync: 'error', provider, reason: 'invalid_state' }));
    }

    const tokens = await adapter.exchangeCodeForTokens(code);
    const tokenConnection = {
      ...connection,
      encrypted_access_token: encryptToken(tokens.access_token),
      encrypted_refresh_token: encryptToken(tokens.refresh_token),
      access_token_expires_at: tokenExpiry(tokens.expires_in),
      scopes: tokens.scope || null,
    };
    const email = await adapter.getAccountEmail(tokenConnection);

    await db.query(
      `UPDATE calendar_sync_connections
       SET provider_account_email = ?,
           encrypted_access_token = ?,
           encrypted_refresh_token = ?,
           access_token_expires_at = ?,
           scopes = ?,
           sync_enabled = 1,
           sync_status = 'connected',
           sync_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        email,
        tokenConnection.encrypted_access_token,
        tokenConnection.encrypted_refresh_token,
        tokenConnection.access_token_expires_at,
        tokenConnection.scopes,
        connection.id,
      ]
    );

    await runSyncForConnection({ ...tokenConnection, provider_account_email: email }, adapter);
    return res.redirect(getReturnUrl({ sync: 'connected', provider }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
