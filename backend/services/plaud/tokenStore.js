/**
 * services/plaud/tokenStore.js
 *
 * Reads and writes the OAuth token file the official Plaud CLI creates when
 * you run `plaud login`. We deliberately do not run our own login flow: Plaud
 * does not hand out API apps to the public, so the CLI's token file is the
 * only supported way onto their API. The sync job shares it and keeps it
 * fresh by writing back refreshed tokens.
 *
 * File shape (what the Plaud CLI writes):
 *   { access_token, refresh_token, token_type, expires_at }
 * `expires_at` is epoch milliseconds.
 */

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.plaud', 'tokens.json');

/** Resolve which token file to use: explicit arg > env > CLI default. */
function resolveTokenFile(file) {
  return file || process.env.PLAUD_TOKEN_FILE || DEFAULT_TOKEN_FILE;
}

/**
 * Accept the small set of spellings a token file might use and return the
 * canonical snake_case shape, or null if there is no usable access token.
 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const accessToken = raw.access_token ?? raw.accessToken;
  if (!accessToken) return null;

  let expiresAt = raw.expires_at ?? raw.expiresAt ?? null;
  if (typeof expiresAt === 'string') {
    const parsed = Date.parse(expiresAt);
    expiresAt = Number.isNaN(parsed) ? null : parsed;
  }

  return {
    access_token: accessToken,
    refresh_token: raw.refresh_token ?? raw.refreshToken ?? null,
    token_type: raw.token_type ?? raw.tokenType ?? 'Bearer',
    expires_at: expiresAt,
  };
}

/**
 * Load the token set. Returns null when the file does not exist (not logged
 * in yet). Any other read or parse error is thrown so misconfiguration is
 * loud rather than silently treated as "logged out".
 */
async function load(file) {
  const tokenFile = resolveTokenFile(file);
  let text;
  try {
    text = await fs.readFile(tokenFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return normalize(JSON.parse(text));
}

/** Persist a token set. Creates the directory and keeps the file owner-only. */
async function save(file, tokenSet) {
  const tokenFile = resolveTokenFile(file);
  await fs.mkdir(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(tokenFile, JSON.stringify(tokenSet, null, 2), { mode: 0o600 });
}

module.exports = {
  DEFAULT_TOKEN_FILE,
  resolveTokenFile,
  normalize,
  load,
  save,
};
