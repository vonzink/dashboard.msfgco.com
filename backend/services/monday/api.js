// Monday.com shared HTTP client — retry, rate limiting, error handling
const logger = require('../../lib/logger');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const COMPLEXITY_PAUSE_THRESHOLD = 100000;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function mondayRequest(token, query, variables = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
          'API-Version': API_VERSION,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');

        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          logger.warn({ status: response.status, attempt, delay }, 'Monday.com API retryable error — backing off');
          await sleep(delay);
          lastError = new Error(`Monday.com API error: HTTP ${response.status} — ${text.substring(0, 200)}`);
          continue;
        }

        throw new Error(`Monday.com API error: HTTP ${response.status} — ${text.substring(0, 200)}`);
      }

      const data = await response.json();

      if (data.errors && data.errors.length > 0) {
        const errMsg = data.errors[0].message;
        if (/complexity budget/i.test(errMsg) && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn({ attempt, delay, error: errMsg }, 'Monday.com complexity budget exhausted — backing off');
          await sleep(delay);
          lastError = new Error(`Monday.com GraphQL error: ${errMsg}`);
          continue;
        }
        throw new Error(`Monday.com GraphQL error: ${errMsg}`);
      }

      // Rate limit awareness: pause if complexity is getting low
      if (data.complexity && data.complexity.after < COMPLEXITY_PAUSE_THRESHOLD) {
        const resetIn = data.complexity.reset_in_x_seconds || 30;
        logger.info({ remaining: data.complexity.after, resetIn }, 'Monday.com complexity low — pausing');
        await sleep(Math.min(resetIn * 1000, 30000));
      }

      return data.data;
    } catch (err) {
      if (err.name === 'TimeoutError' && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn({ attempt, delay }, 'Monday.com API timeout — retrying');
        await sleep(delay);
        lastError = err;
        continue;
      }

      if (attempt >= MAX_RETRIES && lastError) {
        throw lastError;
      }
      throw err;
    }
  }

  throw lastError || new Error('Monday.com API request failed after retries');
}

module.exports = { MONDAY_API_URL, API_VERSION, mondayRequest };
