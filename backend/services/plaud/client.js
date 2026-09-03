/**
 * services/plaud/client.js
 *
 * Thin client for the Plaud developer API — the same endpoints the official
 * Plaud MCP server and CLI use. Only the read calls the sync job needs are
 * wrapped here:
 *
 *   GET /open/third-party/users/current   → who is logged in
 *   GET /open/third-party/files/          → page of recordings (newest first)
 *   GET /open/third-party/files/{id}      → one recording incl. presigned_url
 *
 * Auth is a Bearer token from the CLI's token file (see tokenStore.js). When
 * the token is about to expire, or the API answers 401, we refresh once using
 * the refresh endpoint — which takes only the refresh token, no client secret.
 */

const { Readable } = require('stream');
const { URLSearchParams } = require('url');
const tokenStore = require('./tokenStore');

const DEFAULT_API_BASE = 'https://platform.plaud.ai/developer/api';
const DEFAULT_REFRESH_URL = `${DEFAULT_API_BASE}/oauth/third-party/access-token/refresh`;

/** Refresh this long before the recorded expiry so a call never lands on a dead token. */
const REFRESH_SKEW_MS = 60 * 1000;

/** Plaud rejects page sizes below this. */
const MIN_PAGE_SIZE = 10;
const DEFAULT_PAGE_SIZE = 50;

class PlaudAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlaudAuthError';
  }
}

class PlaudApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'PlaudApiError';
    this.status = status;
    this.body = body;
  }
}

/** Plaud reports durations in milliseconds. Coerce anything odd to null. */
function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Turn a raw list entry into the small shape the sync job cares about.
 * Field names mirror what the API returns today, with a couple of fallbacks
 * so a renamed field degrades to null instead of crashing the run.
 */
function normalizeRecording(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.file_id ?? raw.fileId;
  if (!id) return null;
  return {
    id: String(id),
    name: raw.name ?? raw.title ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    startAt: raw.start_at ?? raw.startAt ?? null,
    durationMs: toInt(raw.duration ?? raw.duration_ms ?? raw.durationMs),
    deviceSerial: raw.serial_number ?? raw.serialNumber ?? null,
  };
}

/** The list endpoint wraps its rows; accept the known wrappers or a bare array. */
function extractList(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const key of ['data', 'data_list', 'items', 'files', 'results']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

class PlaudClient {
  /**
   * @param {object} [options]
   * @param {string} [options.tokenFile]   Path to the CLI token file
   * @param {string} [options.apiBase]
   * @param {string} [options.refreshUrl]
   * @param {Function} [options.fetchImpl] Injected for tests; defaults to global fetch
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.tokenFile = tokenStore.resolveTokenFile(options.tokenFile);
    this.apiBase = (options.apiBase || process.env.PLAUD_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
    this.refreshUrl = options.refreshUrl || process.env.PLAUD_REFRESH_URL || DEFAULT_REFRESH_URL;
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.logger = options.logger || null;

    if (typeof this.fetch !== 'function') {
      throw new Error('PlaudClient needs a fetch implementation (Node 18+ has one built in)');
    }
  }

  // ── Auth ──────────────────────────────────────────────────────

  /** Return a usable access token, refreshing first if it is about to expire. */
  async getAccessToken() {
    const tokenSet = await tokenStore.load(this.tokenFile);
    if (!tokenSet) {
      throw new PlaudAuthError(
        `No Plaud token file at ${this.tokenFile}. Run \`plaud login\` on this machine first.`
      );
    }

    const expiring = tokenSet.expires_at && Date.now() > tokenSet.expires_at - REFRESH_SKEW_MS;
    if (!expiring) return tokenSet.access_token;

    if (!tokenSet.refresh_token) {
      throw new PlaudAuthError('Plaud access token expired and no refresh token is stored. Run `plaud login` again.');
    }
    const refreshed = await this.refresh(tokenSet.refresh_token);
    return refreshed.access_token;
  }

  /** Exchange a refresh token for a new token set and persist it. */
  async refresh(refreshToken) {
    const res = await this.fetch(this.refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      const body = await safeText(res);
      throw new PlaudAuthError(`Plaud token refresh failed (${res.status}). Run \`plaud login\` again. ${body}`.trim());
    }

    const data = await res.json();
    const tokenSet = {
      access_token: data.access_token,
      // Plaud may or may not rotate the refresh token. Keep the old one if not.
      refresh_token: data.refresh_token ?? refreshToken,
      token_type: data.token_type ?? 'Bearer',
      expires_at: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
    };
    await tokenStore.save(this.tokenFile, tokenSet);
    this.logger?.info?.('Plaud access token refreshed');
    return tokenSet;
  }

  // ── HTTP ──────────────────────────────────────────────────────

  /**
   * Authenticated JSON request. A 401 triggers exactly one refresh + retry;
   * a second 401 means the login itself is dead and the user must re-login.
   */
  async request(apiPath, init = {}, { retryOnAuth = true } = {}) {
    const token = await this.getAccessToken();
    const res = await this.fetch(`${this.apiBase}${apiPath}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 && retryOnAuth) {
      const tokenSet = await tokenStore.load(this.tokenFile);
      if (tokenSet?.refresh_token) {
        await this.refresh(tokenSet.refresh_token);
        return this.request(apiPath, init, { retryOnAuth: false });
      }
    }

    if (!res.ok) {
      const body = await safeText(res);
      throw new PlaudApiError(`Plaud API ${init.method || 'GET'} ${apiPath} failed (${res.status})`, {
        status: res.status,
        body,
      });
    }
    return res.json();
  }

  // ── Endpoints ─────────────────────────────────────────────────

  /** @returns {Promise<{id:string,email:string,nickname:string}>} */
  getCurrentUser() {
    return this.request('/open/third-party/users/current');
  }

  /**
   * One page of recordings, newest first.
   * @returns {Promise<Array<ReturnType<typeof normalizeRecording>>>}
   */
  async listFiles({ page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const size = Math.max(MIN_PAGE_SIZE, Number(pageSize) || DEFAULT_PAGE_SIZE);
    const body = await this.request(`/open/third-party/files/?page=${Number(page) || 1}&page_size=${size}`);
    return extractList(body).map(normalizeRecording).filter(Boolean);
  }

  /** Full record for one recording, including the 24h `presigned_url` for its audio. */
  getFile(fileId) {
    return this.request(`/open/third-party/files/${encodeURIComponent(fileId)}`);
  }

  /**
   * Open the audio behind a presigned URL as a Node Readable stream.
   * The URL is already signed, so no Authorization header goes with it.
   */
  async openAudioStream(url) {
    const res = await this.fetch(url);
    if (!res.ok || !res.body) {
      throw new PlaudApiError(`Audio download failed (${res.status})`, { status: res.status });
    }
    const length = Number(res.headers?.get?.('content-length'));
    const stream = typeof res.body.pipe === 'function' ? res.body : Readable.fromWeb(res.body);
    return { stream, contentLength: Number.isFinite(length) ? length : null };
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

module.exports = {
  PlaudClient,
  PlaudAuthError,
  PlaudApiError,
  normalizeRecording,
  extractList,
  DEFAULT_API_BASE,
  DEFAULT_REFRESH_URL,
};
