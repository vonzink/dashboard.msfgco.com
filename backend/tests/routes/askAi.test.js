import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const servicePath = require.resolve('../../services/askAi/askAi.service');
const routePath = require.resolve('../../routes/askAi');
const originalServiceCacheEntry = require.cache[servicePath];

const askAiService = { ask: vi.fn() };

let server;
let baseUrl;

function buildApp(user) {
  // Plant the service mock BEFORE the route file is loaded.
  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true, exports: askAiService,
  };
  delete require.cache[routePath];

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); }); // stand-in for authenticate
  app.use('/api/ask-ai', require('../../routes/askAi'));
  return app;
}

const dbUser = {
  email: 'test@msfgco.com',
  db: { id: 1, email: 'test@msfgco.com', name: 'Test User', role: 'user' },
};

async function post(body) {
  const res = await fetch(`${baseUrl}/api/ask-ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/ask-ai/ask', () => {
  beforeEach(async () => {
    askAiService.ask.mockReset();
    const app = buildApp(dbUser);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (originalServiceCacheEntry) require.cache[servicePath] = originalServiceCacheEntry;
    else delete require.cache[servicePath];
    delete require.cache[routePath];
  });

  it('returns the engine response and passes the user email as identity', async () => {
    const payload = { conversationId: 'c1', answer: 'A', citations: [], disclaimer: 'D' };
    askAiService.ask.mockResolvedValue(payload);

    const { status, body } = await post({ question: 'Where is the pipeline?', pageRoute: 'home' });
    expect(status).toBe(200);
    expect(body).toEqual(payload);
    expect(askAiService.ask).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@msfgco.com',
      question: 'Where is the pipeline?',
      pageRoute: 'home',
    }));
  });

  it('rejects an empty question with 400 before hitting the service', async () => {
    const { status, body } = await post({ question: '  ' });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(askAiService.ask).not.toHaveBeenCalled();
  });

  it('propagates service error status and message', async () => {
    const err = new Error('Ask AI is temporarily unavailable');
    err.status = 502;
    askAiService.ask.mockRejectedValue(err);

    const { status, body } = await post({ question: 'q' });
    expect(status).toBe(502);
    expect(body).toEqual({ error: 'Ask AI is temporarily unavailable' });
  });
});
