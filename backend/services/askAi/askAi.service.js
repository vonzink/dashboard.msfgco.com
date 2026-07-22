// Proxy to the rag-brain engine's public website-assistant endpoint.
// The engine contract (request/response fields) is documented in the
// rag-brain repo: docs/website-integration.md. We return its response
// body verbatim so the frontend consumes the contract directly.
//
// Env (all required except slug/origin which have defaults):
//   RAG_BRAIN_BASE_URL      e.g. https://los.msfgco.com/rag
//   RAG_BRAIN_PUBLIC_TOKEN  per-brain public token (from rag-brain console)
//   RAG_BRAIN_SLUG          default msfg-dashboard
//   RAG_BRAIN_ORIGIN        default https://dashboard.msfgco.com
//                           (must be in the brain's allowed domains)

const logger = require('../../lib/logger');

// Engine's own AI read timeout is 60s; match it so we don't give up first.
const ENGINE_TIMEOUT_MS = 60000;

function serviceError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function ask({ email, question, conversationId, pageRoute }) {
  const baseUrl = process.env.RAG_BRAIN_BASE_URL;
  const token = process.env.RAG_BRAIN_PUBLIC_TOKEN;
  const slug = process.env.RAG_BRAIN_SLUG || 'msfg-dashboard';
  const origin = process.env.RAG_BRAIN_ORIGIN || 'https://dashboard.msfgco.com';

  if (!baseUrl || !token) {
    throw serviceError('Ask AI is not configured on the server yet', 503);
  }

  const body = {
    sessionId: email, // stable per-user thread key; also gives us attribution
    message: question,
    surface: 'PUBLIC',
  };
  if (conversationId) body.conversationId = conversationId;
  if (pageRoute) body.pageRoute = pageRoute;

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/ai/public/${slug}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Public-Brain-Token': token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
  } catch (e) {
    logger.error({ err: e }, 'Ask AI engine unreachable');
    throw serviceError('Ask AI is temporarily unavailable', 502);
  }

  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    throw serviceError(data.error || 'Invalid question', 400);
  }
  if (res.status === 401 || res.status === 403) {
    // Config problem (token rotated / origin not allowlisted) — ops issue,
    // not something the user can fix. Log loud, answer generic.
    logger.error({ status: res.status }, 'Ask AI engine rejected credentials — check RAG_BRAIN_PUBLIC_TOKEN and the brain allowed-domains list');
    throw serviceError('Ask AI is temporarily unavailable', 502);
  }
  if (res.status === 429) {
    throw serviceError('Ask AI is busy — try again in a minute', 429);
  }
  if (!res.ok) {
    logger.error({ status: res.status }, 'Ask AI engine error');
    throw serviceError('Ask AI is temporarily unavailable', 502);
  }

  return res.json();
}

module.exports = { ask };
