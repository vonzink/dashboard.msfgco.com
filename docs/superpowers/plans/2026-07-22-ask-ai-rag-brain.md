# Ask AI (rag-brain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom-right Team Chat bubble with a two-tab panel — Ask AI (default) + Team Chat — where Ask AI proxies questions through the dashboard backend to a new `msfg-dashboard` brain on the prod rag-brain engine.

**Architecture:** Browser → `POST /api/ask-ai/ask` (Cognito-authed Express route) → `askAi.service` → engine `POST {RAG_BRAIN_BASE_URL}/api/ai/public/msfg-dashboard/ask` with `X-Public-Brain-Token` held server-side. Frontend renders answer + citations + disclaimer + "Take me there" deep links. Team Chat code is untouched; it just moves under a tab.

**Tech Stack:** Vanilla JS SPA, Express, Zod, vitest, Node global `fetch` (Node ≥18; local is v24). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-07-22-ask-ai-rag-brain-design.md`

**Codebase facts the engineer must know (verified 2026-07-22):**
- `backend/validation/schemas.js` exports `validate(schema)` — Express middleware that `safeParse`s `req.body`, 400s on failure, sets `req.body = result.data` on success. Split schema files (e.g. `./schemas/checklists`) are required at the top and **spread** into `module.exports`. NEVER re-destructure individual schema names in the gateway — that exact mistake once crashed prod at boot.
- `authenticate` (backend/middleware/auth.js) sets `req.user = { sub, username, email, groups, claims }` plus `req.user.db = { id, email, name, role }` when the user exists in MySQL. `requireNonExternal` (backend/middleware/userContext.js) blocks External users; Team Chat is mounted with it, so Ask AI is too.
- Response helpers: `const { ok, fail } = require('../utils/response')` — `ok(res, data)`, `fail(res, msg, status)`.
- Frontend API client: `ServerAPI.post('/ask-ai/ask', body)` — endpoint is relative to `CONFIG.api.baseUrl` which already includes `/api`. It attaches the bearer token, refreshes on 401, and throws `Error` whose `.message` is the server's `{error}` field.
- FAB/panel: `index.html:731-763` (`#chatFab`, `#chatFloatPanel`), open/close logic in `js/chat.js` `bindFloatPanel()` (~line 305) keyed off `.is-open` — none of that changes. The unread badge `#chatFabBadge` exists in HTML but **no JS ever updates it** (inert, `display:none`). We still honor it defensively when picking the initial tab.
- Module init: `js/app.js` ~line 125 has a `modules` array of `['Name', () => X.init()]` pairs.
- Backend tests: vitest, CommonJS modules mocked by planting `require.cache` entries (see `backend/tests/routes/scheduleSync.test.js`). Run with `cd backend && npx vitest run <file>`.
- Frontend build: `deploy.sh` runs `build.js` which content-hashes `js/**` — a new plain script file needs no special handling (only `scanner-*.js` ES modules are carved out).

**File map:**

| File | Action | Responsibility |
|---|---|---|
| `backend/validation/schemas/askAi.js` | Create | Zod schema for the ask request |
| `backend/validation/schemas.js` | Modify | Require + spread the new schema file |
| `backend/services/askAi/askAi.service.js` | Create | Engine HTTP call, error mapping, env config |
| `backend/routes/askAi.js` | Create | Thin orchestrator: validate → service → respond |
| `backend/server.js` | Modify | Mount `/api/ask-ai` |
| `backend/tests/validation/askAi.test.js` | Create | Schema tests |
| `backend/tests/services/askAi.service.test.js` | Create | Service tests (fetch stubbed) |
| `backend/tests/routes/askAi.test.js` | Create | Route tests (service mocked) |
| `index.html` | Modify | Tabbed panel markup, FAB icon, script tag |
| `css/chat.css` | Modify | Tab + Ask AI pane styles (append) |
| `js/ask-ai.js` | Create | Ask AI tab: tabs controller, ask flow, rendering |
| `js/app.js` | Modify | Register `AskAI.init()` |
| `docs/ask-ai-corpus/*.md` | Create | Brain corpus (17 guides) |
| `scripts/sync-ask-ai-corpus.sh` | Create | `aws s3 sync` corpus → S3 |

---

### Task 1: Validation schema

**Files:**
- Create: `backend/validation/schemas/askAi.js`
- Modify: `backend/validation/schemas.js` (require + spread)
- Test: `backend/tests/validation/askAi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/validation/askAi.test.js
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { askAiQuestion } = require('../../validation/schemas');

describe('askAiQuestion schema', () => {
  it('accepts a plain question and trims it', () => {
    const r = askAiQuestion.safeParse({ question: '  Where are funded loans?  ' });
    expect(r.success).toBe(true);
    expect(r.data.question).toBe('Where are funded loans?');
  });

  it('rejects a missing or blank question', () => {
    expect(askAiQuestion.safeParse({}).success).toBe(false);
    expect(askAiQuestion.safeParse({ question: '   ' }).success).toBe(false);
  });

  it('caps question at 2000 chars (engine limit)', () => {
    expect(askAiQuestion.safeParse({ question: 'x'.repeat(2000) }).success).toBe(true);
    expect(askAiQuestion.safeParse({ question: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('accepts optional conversationId and pageRoute', () => {
    const r = askAiQuestion.safeParse({
      question: 'q', conversationId: 'e5e48b02-aaaa', pageRoute: 'pipeline',
    });
    expect(r.success).toBe(true);
    expect(r.data.conversationId).toBe('e5e48b02-aaaa');
    expect(r.data.pageRoute).toBe('pipeline');
  });

  it('rejects unexpected junk types', () => {
    expect(askAiQuestion.safeParse({ question: 42 }).success).toBe(false);
    expect(askAiQuestion.safeParse({ question: 'q', conversationId: 12 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/validation/askAi.test.js`
Expected: FAIL — `askAiQuestion` is undefined (not exported yet).

- [ ] **Step 3: Create the schema file**

```js
// backend/validation/schemas/askAi.js
// Zod schemas for the Ask AI feature (rag-brain proxy).
//
// Consumed by backend/validation/schemas.js via spread re-export — do NOT
// destructure individual names there (boot-crash failure mode).

const { z } = require('zod');

const askAiQuestion = z.object({
  // 2000 = the engine's message limit (rag-brain website-integration contract).
  question: z.string().trim().min(1).max(2000),
  // Engine-issued UUID echoed back to continue a thread.
  conversationId: z.string().trim().min(1).max(64).optional().nullable(),
  // Current SPA section id, for page-aware answers.
  pageRoute: z.string().trim().max(200).optional().nullable(),
});

module.exports = { askAiQuestion };
```

- [ ] **Step 4: Wire into the gateway**

In `backend/validation/schemas.js`, find the existing split-file require (search for `require('./schemas/checklists')`) and add below it:

```js
const askAiSchemas = require('./schemas/askAi');
```

Then in the `module.exports = { ... }` object at the bottom, next to the existing `...checklistSchemas,` spread, add:

```js
  ...askAiSchemas,
```

Do NOT add `askAiQuestion` anywhere else in the file. The spread is the whole wiring.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/validation/askAi.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full backend suite to prove no regression**

Run: `cd backend && npm test`
Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add backend/validation/schemas/askAi.js backend/validation/schemas.js backend/tests/validation/askAi.test.js
git commit -m "Ask AI: validation schema for /api/ask-ai/ask"
```

---

### Task 2: Engine proxy service

**Files:**
- Create: `backend/services/askAi/askAi.service.js`
- Test: `backend/tests/services/askAi.service.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/services/askAi.service.test.js
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/services/askAi.service.test.js`
Expected: FAIL — cannot resolve `../../services/askAi/askAi.service`.

- [ ] **Step 3: Write the service**

```js
// backend/services/askAi/askAi.service.js
//
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/services/askAi.service.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/askAi/askAi.service.js backend/tests/services/askAi.service.test.js
git commit -m "Ask AI: rag-brain engine proxy service with error mapping"
```

---

### Task 3: Route + mount

**Files:**
- Create: `backend/routes/askAi.js`
- Modify: `backend/server.js` (two lines)
- Test: `backend/tests/routes/askAi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/routes/askAi.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/askAi.test.js`
Expected: FAIL — cannot resolve `../../routes/askAi`.

- [ ] **Step 3: Write the route**

```js
// backend/routes/askAi.js
//
// Ask AI HTTP route — thin orchestrator per house style:
// validate → service → respond. All engine I/O lives in
// backend/services/askAi/askAi.service.js.

const express = require('express');
const router = express.Router();

const { ok, fail } = require('../utils/response');
const { askAiQuestion, validate } = require('../validation/schemas');
const askAi = require('../services/askAi/askAi.service');

router.post('/ask', validate(askAiQuestion), async (req, res, next) => {
  try {
    // ID tokens carry email at the top level; DB lookup fills req.user.db.
    const email = req.user?.db?.email || req.user?.email || req.user?.claims?.email;
    if (!email) return fail(res, 'User identity unavailable', 401);

    const { question, conversationId, pageRoute } = req.body;
    ok(res, await askAi.ask({ email, question, conversationId, pageRoute }));
  } catch (err) {
    if (err.status) return fail(res, err.message, err.status);
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount in server.js**

In `backend/server.js`:

1. With the other route requires (after `const checklistsRoutes = require('./routes/checklists');`):

```js
const askAiRoutes = require('./routes/askAi');
```

2. In the "Routes blocked for External users" mount block (after the `/api/checklists` line):

```js
app.use('/api/ask-ai', authenticate, requireNonExternal, askAiRoutes);
```

(`requireNonExternal` matches Team Chat's mount — the panel's other tab. The
global `/api/` rate limiters already cover the new route.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/routes/askAi.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Boot check + full suite**

```bash
cd backend && node --check server.js && node --check routes/askAi.js && npm test
```
Expected: syntax OK, all tests pass. (Boot-time `require` of the new files is
exercised by the route test; a full `npm start` needs DB/env and is covered in
Task 8.)

- [ ] **Step 7: Commit**

```bash
git add backend/routes/askAi.js backend/server.js backend/tests/routes/askAi.test.js
git commit -m "Ask AI: /api/ask-ai/ask route mounted behind Cognito auth"
```

---

### Task 4: Panel markup + CSS (tabs, Ask AI pane)

**Files:**
- Modify: `index.html:731-763` (FAB + panel block), plus one `<script>` tag near line 1489
- Modify: `css/chat.css` (append after the existing floating-panel section, ~line 935)

No JS behavior yet — this task is pure structure/style. Team Chat keeps every
existing element id, so `chat.js` continues to work unmodified.

- [ ] **Step 1: Replace the FAB + panel markup**

In `index.html`, replace the block from `<!-- Floating Chat FAB + Panel -->`
through the closing `</div>` of `#chatFloatPanel` (currently lines 731-763)
with:

```html
    <!-- Floating Ask AI / Team Chat FAB + Panel -->
    <button type="button" class="chat-fab" id="chatFab" title="Ask AI / Team Chat" aria-label="Toggle assistant panel">
      <i class="fas fa-robot" id="chatFabIcon"></i>
      <span class="chat-fab-badge" id="chatFabBadge" style="display:none;">0</span>
    </button>

    <div class="chat-float-panel tab-ask" id="chatFloatPanel" aria-hidden="true">
      <div class="chat-float-header">
        <div class="fab-tabs" role="tablist" aria-label="Assistant panel tabs">
          <button type="button" class="fab-tab is-active" id="fabTabAsk" role="tab" aria-selected="true">
            <i class="fas fa-robot"></i> Ask AI
          </button>
          <button type="button" class="fab-tab" id="fabTabChat" role="tab" aria-selected="false">
            <i class="fas fa-comments"></i> Team Chat
          </button>
        </div>
        <div class="chat-float-actions">
          <button type="button" class="btn btn-sm btn-outline" id="chatManageTagsBtn" title="Manage Tags">
            <i class="fas fa-tags"></i>
          </button>
          <button type="button" class="chat-float-close" id="chatFloatClose" title="Close" aria-label="Close panel">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <!-- Ask AI tab pane -->
      <div class="ask-ai-pane" id="askAiPane">
        <div class="ask-ai-messages" id="askAiMessages" aria-live="polite"></div>
        <form class="ask-ai-input-row" id="askAiForm">
          <input type="text" id="askAiInput" class="chat-input" placeholder="Ask about the dashboard..." maxlength="2000" autocomplete="off" />
          <button type="submit" class="btn btn-primary" id="askAiSendBtn" title="Ask"><i class="fas fa-paper-plane"></i></button>
        </form>
        <div class="ask-ai-footer">
          <button type="button" class="ask-ai-new-btn" id="askAiNewBtn"><i class="fas fa-rotate-left"></i> New conversation</button>
        </div>
      </div>

      <!-- Team Chat tab pane — everything inside .chat-container is UNCHANGED -->
      <div class="chat-container">
        <div class="chat-tag-filter-bar" id="chatTagFilter"></div>
        <div class="chat-messages" id="chatMessages" aria-live="polite"></div>
        <div class="chat-tag-picker-bar">
          <span class="chat-tag-picker-label"><i class="fas fa-tags"></i> Attach tags:</span>
          <div class="chat-tag-picker" id="chatTagPicker"></div>
        </div>
        <div class="chat-edit-bar" id="chatEditBar"></div>
        <div class="chat-pending-files" id="chatPendingFiles"></div>
        <form class="chat-input-row" id="chatForm">
          <button type="button" class="chat-attach-btn" id="chatAttachBtn" title="Attach file"><i class="fas fa-paperclip"></i></button>
          <input type="file" id="chatFileInput" multiple style="display:none;" />
          <input type="text" id="chatInput" class="chat-input" placeholder="Type a message..." maxlength="1000" autocomplete="off" />
          <button type="submit" class="btn btn-primary" id="chatSendBtn"><i class="fas fa-paper-plane"></i> Send</button>
        </form>
      </div>
    </div>
```

- [ ] **Step 2: Add the script tag**

Next to the existing `<script src="js/chat.js?v=20260410"></script>` (line
~1489), add directly after it:

```html
  <script src="js/ask-ai.js?v=20260722"></script>
```

(The file doesn't exist until Task 5 — a 404 in the interim is fine locally;
Tasks 4+5 deploy together.)

- [ ] **Step 3: Append the CSS**

Append to `css/chat.css`, after the "FLOATING CHAT PANEL" section and before
the mobile `@media` block (~line 928) — or at end of file if simpler, since
these selectors don't conflict:

```css
/* ========================================
   FAB PANEL TABS  (Ask AI | Team Chat)
======================================== */
.fab-tabs {
    display: flex;
    gap: 0.25rem;
}

.fab-tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
}

.fab-tab:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
}

.fab-tab.is-active {
    color: var(--text-primary);
    background: var(--bg-secondary);
    border-color: var(--border-color);
}

.fab-tab.is-active i {
    color: var(--green-bright);
}

/* Tab pane switching — the panel carries .tab-ask or .tab-chat */
.chat-float-panel.tab-ask .chat-container { display: none; }
.chat-float-panel.tab-ask #chatManageTagsBtn { display: none; }
.chat-float-panel.tab-chat .ask-ai-pane { display: none; }

/* ========================================
   ASK AI PANE
======================================== */
.ask-ai-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.ask-ai-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
}

.ask-ai-msg { display: flex; }
.ask-ai-msg-user { justify-content: flex-end; }
.ask-ai-msg-assistant { justify-content: flex-start; }

.ask-ai-bubble {
    max-width: 85%;
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius-lg);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.875rem;
    line-height: 1.45;
    overflow-wrap: break-word;
}

.ask-ai-msg-user .ask-ai-bubble {
    background: var(--gradient-brand);
    color: white;
}

.ask-ai-bubble p { margin: 0 0 0.5rem; }
.ask-ai-bubble p:last-child { margin-bottom: 0; }

.ask-ai-goto {
    margin-top: 0.5rem;
}

.ask-ai-escalation {
    margin-top: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius-md);
    background: rgba(255, 165, 0, 0.12);
    color: var(--text-primary);
    font-size: 0.8rem;
}

.ask-ai-citations {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-muted);
}

.ask-ai-citations summary { cursor: pointer; }

.ask-ai-citations ul {
    margin: 0.25rem 0 0;
    padding-left: 1.1rem;
}

.ask-ai-disclaimer {
    margin-top: 0.5rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
}

.ask-ai-typing {
    color: var(--text-muted);
    font-style: italic;
}

.ask-ai-error .ask-ai-bubble {
    background: rgba(220, 53, 69, 0.12);
    color: var(--status-danger);
}

.ask-ai-input-row {
    display: flex;
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
}

.ask-ai-input-row .chat-input { flex: 1; }

.ask-ai-footer {
    display: flex;
    justify-content: flex-end;
    padding: 0 var(--spacing-md) var(--spacing-sm);
    flex-shrink: 0;
}

.ask-ai-new-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 0.72rem;
    cursor: pointer;
    padding: 0.15rem 0.3rem;
}

.ask-ai-new-btn:hover { color: var(--text-primary); }
```

- [ ] **Step 4: Static sanity check**

Open the page (no JS module yet): panel still opens/closes via the FAB
(chat.js handles that), Ask AI pane shows by default (`tab-ask` class in
markup), Team Chat pane hidden. Run whichever local preview the session has
available; at minimum verify no HTML parse errors:

```bash
node -e "const s=require('fs').readFileSync('index.html','utf8'); const open=(s.match(/<div/g)||[]).length, close=(s.match(/<\/div>/g)||[]).length; console.log('div open/close:', open, close); process.exit(open===close?0:1)"
```
Expected: equal counts, exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html css/chat.css
git commit -m "Ask AI: two-tab FAB panel markup and styles (Team Chat markup unchanged)"
```

---

### Task 5: `js/ask-ai.js` module

**Files:**
- Create: `js/ask-ai.js`
- Modify: `js/app.js` (register init, ~line 127)

- [ ] **Step 1: Write the module**

```js
// js/ask-ai.js
// Ask AI tab of the floating assistant panel.
//
// Owns: tab switching between Ask AI / Team Chat panes, the ask flow
// (POST /api/ask-ai/ask via ServerAPI), and rendering of answers per the
// rag-brain public-assistant contract (answer, citations, disclaimer,
// humanEscalationRequired, recommendedPage, conversationId).
//
// Does NOT own: panel open/close (chat.js bindFloatPanel) or anything
// inside .chat-container (chat.js).

(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const AskAI = {
    conversationId: null,
    pending: false,

    init() {
      const panel = document.getElementById('chatFloatPanel');
      if (!panel || !document.getElementById('askAiPane')) return;
      this.bindTabs();
      this.bindForm();
      this.restoreTab();
      this.appendIntro();
    },

    // ── Tabs ────────────────────────────────────
    bindTabs() {
      const askTab = document.getElementById('fabTabAsk');
      const chatTab = document.getElementById('fabTabChat');
      if (askTab) askTab.addEventListener('click', () => this.setTab('ask'));
      if (chatTab) chatTab.addEventListener('click', () => this.setTab('chat'));
    },

    setTab(tab) {
      const panel = document.getElementById('chatFloatPanel');
      const askTab = document.getElementById('fabTabAsk');
      const chatTab = document.getElementById('fabTabChat');
      if (!panel || !askTab || !chatTab) return;

      panel.classList.toggle('tab-ask', tab === 'ask');
      panel.classList.toggle('tab-chat', tab === 'chat');
      askTab.classList.toggle('is-active', tab === 'ask');
      chatTab.classList.toggle('is-active', tab === 'chat');
      askTab.setAttribute('aria-selected', tab === 'ask' ? 'true' : 'false');
      chatTab.setAttribute('aria-selected', tab === 'chat' ? 'true' : 'false');
      Utils.setStorage('msfg_fab_tab', tab);

      if (tab === 'ask') {
        const input = document.getElementById('askAiInput');
        if (input && panel.classList.contains('is-open')) input.focus();
      }
    },

    restoreTab() {
      // Unread team-chat badge wins: the red dot promised chat content.
      // (Badge is currently never shown by chat.js — this is future-proofing.)
      const badge = document.getElementById('chatFabBadge');
      const badgeVisible = badge && badge.style.display !== 'none';
      const saved = Utils.getStorage('msfg_fab_tab', 'ask');
      this.setTab(badgeVisible ? 'chat' : (saved === 'chat' ? 'chat' : 'ask'));
    },

    // ── Ask flow ────────────────────────────────
    bindForm() {
      const form = document.getElementById('askAiForm');
      const newBtn = document.getElementById('askAiNewBtn');
      if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
      if (newBtn) newBtn.addEventListener('click', () => this.reset());
    },

    reset() {
      this.conversationId = null;
      const list = document.getElementById('askAiMessages');
      if (list) list.innerHTML = '';
      this.appendIntro();
    },

    appendIntro() {
      const list = document.getElementById('askAiMessages');
      if (!list || list.children.length) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant';
      el.innerHTML = '<div class="ask-ai-bubble">Hi! Ask me how to do anything in the dashboard — or where to find it.</div>';
      list.appendChild(el);
    },

    currentPageRoute() {
      const active = document.querySelector('.content-section.active, section.active, .section.active');
      if (active && active.id) return active.id;
      return (window.location.hash || '').replace('#', '') || 'home';
    },

    async send() {
      if (this.pending) return;
      const input = document.getElementById('askAiInput');
      const question = ((input && input.value) || '').trim();
      if (!question) return;
      input.value = '';

      this.appendUser(question);
      this.setPending(true);
      try {
        const body = { question, pageRoute: this.currentPageRoute() };
        if (this.conversationId) body.conversationId = this.conversationId;
        const resp = await ServerAPI.post('/ask-ai/ask', body);
        this.conversationId = resp.conversationId || this.conversationId;
        this.appendAnswer(resp);
      } catch (err) {
        this.appendError((err && err.message) || 'Something went wrong. Try again.');
      } finally {
        this.setPending(false);
      }
    },

    setPending(on) {
      this.pending = on;
      const btn = document.getElementById('askAiSendBtn');
      if (btn) btn.disabled = on;

      const list = document.getElementById('askAiMessages');
      if (!list) return;
      let typing = document.getElementById('askAiTyping');
      if (on) {
        if (!typing) {
          typing = document.createElement('div');
          typing.id = 'askAiTyping';
          typing.className = 'ask-ai-msg ask-ai-msg-assistant ask-ai-typing';
          typing.innerHTML = '<div class="ask-ai-bubble">Thinking…</div>';
          list.appendChild(typing);
        }
        list.scrollTop = list.scrollHeight;
      } else if (typing) {
        typing.remove();
      }
    },

    // ── Rendering ───────────────────────────────
    appendUser(text) {
      const list = document.getElementById('askAiMessages');
      if (!list) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-user';
      el.innerHTML = '<div class="ask-ai-bubble">' + esc(text) + '</div>';
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    },

    appendError(message) {
      const list = document.getElementById('askAiMessages');
      if (!list) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant ask-ai-error';
      el.innerHTML = '<div class="ask-ai-bubble">' + esc(message) + '</div>';
      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    },

    appendAnswer(resp) {
      const list = document.getElementById('askAiMessages');
      if (!list) return;
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant';

      const paragraphs = String(resp.answer || 'No answer returned.')
        .split(/\n{2,}/)
        .map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>')
        .join('');

      let html = '<div class="ask-ai-bubble">' + paragraphs;

      if (resp.humanEscalationRequired) {
        html += '<div class="ask-ai-escalation"><i class="fas fa-user-friends"></i> Worth confirming with a teammate — I\'m not fully sure on this one.</div>';
      }
      if (resp.recommendedPage) {
        html += '<button type="button" class="btn btn-sm btn-primary ask-ai-goto" data-page="' + esc(resp.recommendedPage) + '"><i class="fas fa-arrow-right"></i> Take me there</button>';
      }
      if (Array.isArray(resp.citations) && resp.citations.length) {
        const items = resp.citations.map((c) => {
          const parts = [c.source_name, c.document_name, c.section]
            .filter(Boolean)
            .map((v) => esc(String(v).replace(/\n/g, ' ')));
          return parts.length ? '<li>' + parts.join(' — ') + '</li>' : '';
        }).filter(Boolean).join('');
        if (items) {
          html += '<details class="ask-ai-citations"><summary>Sources</summary><ul>' + items + '</ul></details>';
        }
      }
      if (resp.disclaimer) {
        html += '<div class="ask-ai-disclaimer">' + esc(resp.disclaimer) + '</div>';
      }
      html += '</div>';
      el.innerHTML = html;

      const goto = el.querySelector('.ask-ai-goto');
      if (goto) goto.addEventListener('click', () => this.goTo(goto.getAttribute('data-page')));

      list.appendChild(el);
      list.scrollTop = list.scrollHeight;
    },

    goTo(page) {
      const id = String(page || '').replace(/^#/, '').trim();
      if (!id) return;
      // Corpus docs name sections by their SPA section id, so recommendedPage
      // should match a nav link. Fall back to a hash change.
      const link = document.querySelector('[data-section-link="' + id + '"]');
      if (link) link.click();
      else window.location.hash = id;
    },
  };

  window.AskAI = AskAI;
})();
```

- [ ] **Step 2: Register init in app.js**

In `js/app.js`, in the `modules` array (~line 127), directly after the
`['Chat', () => Chat.init()],` entry, add:

```js
            ['AskAI',          () => typeof AskAI !== 'undefined' && AskAI.init()],
```

- [ ] **Step 3: Syntax check**

Run: `node --check js/ask-ai.js && node --check js/app.js`
Expected: no output (both parse).

- [ ] **Step 4: Commit**

```bash
git add js/ask-ai.js js/app.js
git commit -m "Ask AI: frontend module — tabs, ask flow, contract rendering"
```

---

### Task 6: Browser verification (local)

**Files:** none (verification only)

- [ ] **Step 1: Start the local stack**

Start the backend (`cd backend && npm run dev`) with local `.env` including
(use real values once Task 8 produces them; before that, leave unset to test
the 503 path):

```
RAG_BRAIN_BASE_URL=
RAG_BRAIN_PUBLIC_TOKEN=
```

Serve the frontend the usual way for this repo (browser-preview tool against
a static server, or however the session normally previews `index.html`).

- [ ] **Step 2: Verify unconfigured behavior**

Open the panel → Ask AI tab → ask "where is the pipeline?".
Expected: red error bubble "Ask AI is not configured on the server yet".
(Proves the whole wire: frontend → route → service → error render.)

- [ ] **Step 3: Verify UI mechanics**

- FAB opens/closes panel; robot icon; `.is-open` styling still works.
- Tab switch Ask AI ↔ Team Chat; manage-tags button only visible on chat tab.
- Team Chat regression pass: send a message, tags bar, attach button all
  behave exactly as before.
- Tab choice persists across page reload (localStorage `msfg_fab_tab`).
- Dark AND light theme (`data-theme` toggle) — bubbles/tabs readable in both.
- Console: no errors.

- [ ] **Step 4: (Once Task 8 env values exist) verify the happy path**

Ask "where do I find funded loans?" → answer bubble with disclaimer, Sources
expandable if citations returned, "Take me there" navigates the SPA when
`recommendedPage` is present, follow-up question reuses the conversation
(check request body has `conversationId`).

- [ ] **Step 5: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "Ask AI: verification fixes"
```

---

### Task 7: Corpus — dashboard guides + sync script

**Files:**
- Create: `docs/ask-ai-corpus/00-overview.md` + 16 feature guides (list below)
- Create: `scripts/sync-ask-ai-corpus.sh`

The brain can only answer from what we feed it. These guides are written FOR
retrieval: short sections, explicit feature names, and a consistent
"Dashboard section:" line so the brain can emit `recommendedPage` values that
match SPA section ids.

- [ ] **Step 1: Establish the doc template**

Every guide follows this shape (example: `docs/ask-ai-corpus/pipeline.md`):

```markdown
# Pipeline Tracking

Dashboard section: pipeline

## What it is
The Pipeline section tracks active loans as rows with status dropdowns for
stage, title status, HOI status, payoffs, and appraisal status. Status labels
mirror Monday.com column labels and sync back to Monday.

## How to find it
Click "Pipeline" in the sidebar navigation.

## Common tasks
### Change a loan's stage
Click the stage dropdown on the loan's row and pick the new stage. The change
saves automatically and writes back to Monday.com when a mapping exists.

### Open a loan's checklists
Click the checklist icon on the loan row. Up to 3 checklists per loan open in
a draggable floating panel.

## FAQ
**Q: Why didn't my status change show up in Monday?**
A: Monday write-back requires the dashboard label to exactly match the Monday
column label, and a column mapping must exist for that status field.
```

Rules for all docs:
- First line after the title is always `Dashboard section: <spa-section-id>`
  — pull the real section id from `index.html` (the nav's `data-section-link`
  targets). This is what powers "Take me there".
- Write task-oriented "How to" subsections — that's what people will ask.
- Facts come from reading the feature's JS module and routes — do not invent
  behavior. When unsure, omit rather than guess.
- Keep each doc under ~150 lines; split rather than bloat.

- [ ] **Step 2: Write the 17 docs**

| File | Covers | Primary sources to read |
|---|---|---|
| `00-overview.md` | What the dashboard is, full section list w/ one-liners, login/theme/roles basics | `index.html` nav, `js/app.js`, `js/auth-gate.js` |
| `pipeline.md` | Loan rows, status dropdowns, Monday sync behavior | `js/pipeline.js`, `backend/routes/pipeline.js` |
| `checklists.md` | 3-per-loan checklists, templates (personal/global/file-local), items/subitems, statuses, importance, due dates, call notes, drag-reorder | `js/checklists.js`, `backend/services/checklists/*` |
| `pre-approvals.md` | Monday-synced read-only pre-approvals | `js/pre-approvals.js` |
| `funded-loans.md` | Funded archive, search | `js/funded-loans.js` |
| `goals.md` | Units/volume goals by period | `js/goals.js`, `js/settings-goals.js` |
| `team-chat.md` | Chat tab, tags, attachments, edit | `js/chat.js` |
| `announcements.md` | Cards, links, attachments, dates | `js/announcements.js` |
| `notifications.md` | Notifications/reminders | `backend/routes/notifications.js` |
| `tasks.md` | Tasks (webhook + UI) | `backend/routes/tasks.js` |
| `calendar.md` | Calendar events, recurrence, outlook sync status | `backend/routes/calendarEvents.js` |
| `content-engine.md` | AI social content generation + publish | `js/content-studio.js` |
| `investors.md` | Investor CRUD, logos, lender IDs, clauses | `js/investors.js` |
| `employee-directory.md` | Profiles, contact cards, avatars, signatures, business cards | `js/hr-resources.js` (and admin dir modules) |
| `file-browser.md` | Forms + logos libraries, S3-backed | file browser module in `js/` |
| `scanner.md` | Document scanner page | `scanner.html`, `js/scanner-main.js` |
| `admin.md` | Admin panel: users, files, system | `js/admin/*` |

For each doc: skim the listed sources, write the guide per the template,
verify every "Dashboard section:" id exists in `index.html`.

- [ ] **Step 3: Write the sync script**

```bash
#!/usr/bin/env bash
# scripts/sync-ask-ai-corpus.sh
# Push the Ask AI corpus to the msfg-dashboard brain's S3 source.
# After syncing, open the rag-brain console and hit "Sync now" on the
# msfg-dashboard brain to re-ingest.
set -euo pipefail
cd "$(dirname "$0")/.."

aws s3 sync docs/ask-ai-corpus/ s3://msfg.us/rag-brain-dashboard/ \
  --delete --region us-west-1 --exclude ".DS_Store"

echo ""
echo "Synced docs/ask-ai-corpus/ -> s3://msfg.us/rag-brain-dashboard/"
echo "NEXT: rag-brain console -> msfg-dashboard brain -> Sync now"
```

Run: `chmod +x scripts/sync-ask-ai-corpus.sh`

- [ ] **Step 4: Zack reviews the docs**

STOP — do not sync to S3 until Zack has reviewed `docs/ask-ai-corpus/`
(spec requirement). After approval, run:

```bash
./scripts/sync-ask-ai-corpus.sh
```
Expected: upload lines for 17 files, then the "NEXT" reminder.

- [ ] **Step 5: Commit**

```bash
git add docs/ask-ai-corpus/ scripts/sync-ask-ai-corpus.sh
git commit -m "Ask AI: corpus guides for msfg-dashboard brain + S3 sync script"
```

---

### Task 8: Ops — brain, token, nginx, env, deploy (Zack + engineer together)

**Files:** none in this repo (prod config). Prepare exact commands; Zack runs
the suite-box steps.

- [ ] **Step 1 (Zack): Create the brain on the PROD engine**

In the rag-brain admin console (confirm it's pointed at the suite-box engine —
the brains list must show `mortgage` as active):

- Display name: `MSFG Dashboard`
- Slug: `msfg-dashboard` (lowercase — `Lending` would be rejected)
- Pack: Generate a starter pack
- Source: S3 — bucket `msfg.us`, prefix `rag-brain-dashboard/`, region `us-west-1`
- Answer provider: `anthropic`; Utility provider: `openai`

- [ ] **Step 2 (Zack): Publish + token**

Personality → allowed domains: add `dashboard.msfgco.com` → rotate a public
token. Save the token somewhere safe; it goes into the dashboard backend
`.env` (Step 5). It is stored hashed engine-side and can't be re-read later —
rotate again if lost.

- [ ] **Step 3 (Zack): IAM check + first corpus sync**

On the suite box (`ssh -i /Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem ubuntu@52.2.71.106`):

```bash
# Can the engine's creds read the new prefix? (engine.env carries AWS_* or the box role covers it)
set -a; . /home/ubuntu/apps/rag-brain/engine.env; set +a
aws s3 ls s3://msfg.us/rag-brain-dashboard/ --region us-west-1
```
If AccessDenied: the policy is scoped to `rag-brain/*` — widen it to also
allow `rag-brain-dashboard/*` (same statement, add the second prefix ARN).

Then (after Task 7's corpus is synced to S3) hit "Sync now" on the brain and
verify ingestion:

```bash
curl -s -H "X-Admin-Api-Key: $ADMIN_API_KEY" \
  "http://127.0.0.1:8091/api/ai/admin/ingestion-quality?brain=msfg-dashboard"
```
Expected: `activeDocumentCount` 17, non-zero `embeddedChunkCount`.

- [ ] **Step 4 (Zack): nginx exposure on the suite box**

Add to the `server { server_name los.msfgco.com; ... }` TLS block (the one
with `listen 443`):

```nginx
    # rag-brain public ask API, consumed server-side by dashboard.msfgco.com's
    # backend. Only the public token-gated paths are exposed.
    location /rag/api/ai/public/ {
        proxy_pass http://127.0.0.1:8091/api/ai/public/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 90s;
    }
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Verify from the Mac (expect 401 — proves routing works, token required):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://los.msfgco.com/rag/api/ai/public/msfg-dashboard/ask \
  -H "Content-Type: application/json" -d '{}'
```
Expected: `401` (or `400`) — anything but 404/502.

- [ ] **Step 5: Backend env on the dashboard EC2**

Append to `/home/ubuntu/msfg-backend/backend/.env` (or wherever the live
`.env` sits — check `pm2 describe msfg-backend` for cwd) on
`ubuntu@52.203.186.217`:

```
RAG_BRAIN_BASE_URL=https://los.msfgco.com/rag
RAG_BRAIN_PUBLIC_TOKEN=<token from Step 2>
RAG_BRAIN_SLUG=msfg-dashboard
RAG_BRAIN_ORIGIN=https://dashboard.msfgco.com
```

Also add the same block (with the real token) to the local `backend/.env`.

- [ ] **Step 6: Smoke the engine directly with the real token**

From the Mac:

```bash
curl -s -X POST https://los.msfgco.com/rag/api/ai/public/msfg-dashboard/ask \
  -H "Content-Type: application/json" \
  -H "Origin: https://dashboard.msfgco.com" \
  -H "X-Public-Brain-Token: $RAG_BRAIN_PUBLIC_TOKEN" \
  -d '{"sessionId":"smoke-test","message":"Where do I find funded loans?","surface":"PUBLIC"}' | head -c 600
```
Expected: JSON with `answer`, `conversationId`, `disclaimer`.

- [ ] **Step 7: Deploy**

Pre-flight per known gotcha — check the dashboard EC2 box's git state before
`--backend` (divergent-branch failure mode; also confirm Codex's calendar
work isn't mid-flight on `origin/main`):

```bash
ssh -i /Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem ubuntu@52.203.186.217 \
  "cd /home/ubuntu/msfg-backend && git status -sb && git log --oneline -3"
```

Then:

```bash
./deploy.sh --backend
```

- [ ] **Step 8: Prod E2E**

Hard-refresh `dashboard.msfgco.com` (Cmd+Shift+R). Open the FAB → Ask AI →
ask "where do I find funded loans?" Expected: real answer + disclaimer;
"Take me there" navigates; Team Chat tab still works. Check `pm2 logs
msfg-backend --lines 50` for any Ask AI errors.

- [ ] **Step 9: Update project memory**

Add a memory file noting: the msfg-dashboard brain exists on the suite-box
engine, corpus lives in `docs/ask-ai-corpus/` → `s3://msfg.us/rag-brain-dashboard/`
(sync script + console "Sync now" required after edits), and the four
`RAG_BRAIN_*` env vars on the dashboard EC2.

---

## Plan self-review (done at authoring time)

- **Spec coverage:** two-tab FAB (T4/T5), badge→chat-tab rule (T5 `restoreTab`), backend proxy w/ email sessionId (T2/T3), spread-only schema wiring (T1), 503-when-unconfigured (T2, verified in T6), contract rendering incl. disclaimer/citations/escalation/recommendedPage (T5), conversation continuity (T5), corpus + review gate + S3 sync (T7), brain/token/nginx/IAM/deploy (T8). Team Chat untouched (T4 keeps all ids; T6 regression pass).
- **Known judgment calls:** `requireNonExternal` on the mount (matches Team Chat, the panel's sibling tab — spec said "any logged-in user"; External users are the only exclusion and they can't use Team Chat either). Badge logic is future-proofing since chat.js never shows the badge today.
- **Type consistency:** service takes `{email, question, conversationId, pageRoute}`; route passes exactly that; schema emits `question/conversationId/pageRoute`; frontend sends `question/conversationId/pageRoute`. Engine field mapping (`question`→`message`) happens once, in the service.
