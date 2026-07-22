import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../services/askAi/askAi.service');

const okPayload = {
  conversationId: 'conv-1',
  answer: 'Open the Pipeline section from the sidebar.',
  citations: [{ source_name: 'Dashboard Guide', document_name: 'pipeline.md', section: null }],
  confidence: 0.9,
  humanEscalationRequired: false,
  disclaimer: 'Internal guidance only.',
  recommendedPage: 'pipeline',
};

function fetchResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('askAi.service ask()', () => {
  let fetchMock;

  beforeEach(() => {
    vi.stubEnv('RAG_BRAIN_BASE_URL', 'https://los.example.com/rag');
    vi.stubEnv('RAG_BRAIN_PUBLIC_TOKEN', 'tok-123');
    vi.stubEnv('RAG_BRAIN_SLUG', 'msfg-dashboard');
    vi.stubEnv('RAG_BRAIN_ORIGIN', 'https://dashboard.msfgco.com');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('POSTs the engine contract and returns the response verbatim', async () => {
    fetchMock.mockResolvedValue(fetchResponse(200, okPayload));
    const out = await service.ask({
      email: 'z@msfgco.com', question: 'Where is the pipeline?', pageRoute: 'home',
    });
    expect(out).toEqual(okPayload);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://los.example.com/rag/api/ai/public/msfg-dashboard/ask');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Public-Brain-Token']).toBe('tok-123');
    expect(opts.headers.Origin).toBe('https://dashboard.msfgco.com');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      sessionId: 'z@msfgco.com',
      message: 'Where is the pipeline?',
      surface: 'PUBLIC',
      pageRoute: 'home',
    });
    expect(body.conversationId).toBeUndefined();
  });

  it('forwards conversationId when present', async () => {
    fetchMock.mockResolvedValue(fetchResponse(200, okPayload));
    await service.ask({
      email: 'z@msfgco.com', question: 'follow-up', conversationId: 'conv-1',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.conversationId).toBe('conv-1');
  });

  it('throws 503 when env is not configured (and never calls fetch)', async () => {
    vi.stubEnv('RAG_BRAIN_BASE_URL', '');
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes engine 400 validation messages through as 400', async () => {
    fetchMock.mockResolvedValue(fetchResponse(400, { error: 'message is required' }));
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 400, message: 'message is required' });
  });

  it('maps engine 401/403 (bad token/origin) to a generic 502', async () => {
    fetchMock.mockResolvedValue(fetchResponse(401, { error: 'invalid token' }));
    const err = await service.ask({ email: 'z@x.com', question: 'q' }).catch(e => e);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('token'); // no config detail leaks to users
  });

  it('maps engine 429 to 429', async () => {
    fetchMock.mockResolvedValue(fetchResponse(429, { error: 'rate limited' }));
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 429 });
  });

  it('maps engine 5xx and network failures to 502', async () => {
    fetchMock.mockResolvedValue(fetchResponse(500, { error: 'boom' }));
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 502 });

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 502 });
  });

  it('maps a malformed-JSON 200 response to 502', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 502 });
  });

  it('maps a fetch timeout (TimeoutError) to 502', async () => {
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    fetchMock.mockRejectedValue(timeoutErr);
    await expect(service.ask({ email: 'z@x.com', question: 'q' }))
      .rejects.toMatchObject({ status: 502 });
  });
});
