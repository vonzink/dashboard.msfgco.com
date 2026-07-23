# Ask AI — internal-open Assistant mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Dashboard | Assistant` toggle to the Ask AI panel that routes the "Assistant" mode to a separate internal-open `msfg-internal` brain, keeping the dashboard-help assistant unchanged.

**Architecture:** Frontend sends an optional `mode` (`dashboard` | `open`) with each ask. The backend `askAi.service.js` resolves a per-mode brain slug + public token (shared base URL + origin) and proxies to `/api/ai/public/<slug>/ask`. Each mode keeps its own conversation thread in the UI. Wiring ships first behind a gate (Assistant returns a graceful 503 until its token is set); the `msfg-internal` brain is provisioned separately (ops).

**Tech Stack:** Node/Express + Zod + Vitest (backend); vanilla JS + CSS (frontend); rag-brain engine (ops).

Spec: `docs/superpowers/specs/2026-07-23-ask-ai-assistant-mode-design.md`.

---

## File structure

- `backend/validation/schemas/askAi.js` — add `mode` enum to the request schema.
- `backend/services/askAi/askAi.service.js` — resolve brain (slug+token) per mode.
- `backend/routes/askAi.js` — forward `mode` from body to the service.
- `backend/tests/services/askAi.service.test.js` — mode-routing tests (extend).
- `backend/tests/validation/askAi.schema.test.js` — schema `mode` tests (create).
- `index.html` — the mode pill inside `#askAiPane`.
- `js/ask-ai.js` — mode state, per-mode threads, per-mode intro/placeholder, send `mode`.
- `css/chat.css` — pill styles.
- Ops (no repo file) — provision the `msfg-internal` brain + env + restart.

> ⚠️ **Precondition for Task 6 (index.html):** the repo currently has *uncommitted, unrelated* announcements edits in `index.html` (+ `js/announcements.js`, `js/announcement-editor.js`, `css/announcements.css`). Commit or stash those before editing `index.html`, so this feature's diff stays clean.

---

## Task 1: `mode` accepted by the validation schema (TDD)

**Files:**
- Create: `backend/tests/validation/askAi.schema.test.js`
- Modify: `backend/validation/schemas/askAi.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/validation/askAi.schema.test.js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { askAiQuestion } = require('../../validation/schemas/askAi');

describe('askAiQuestion.mode', () => {
  it('defaults to dashboard when omitted', () => {
    expect(askAiQuestion.parse({ question: 'q' }).mode).toBe('dashboard');
  });

  it('accepts the open mode', () => {
    expect(askAiQuestion.parse({ question: 'q', mode: 'open' }).mode).toBe('open');
  });

  it('rejects an unknown mode', () => {
    expect(() => askAiQuestion.parse({ question: 'q', mode: 'nope' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/validation/askAi.schema.test.js`
Expected: FAIL — `mode` is `undefined` (defaults test) / unknown mode does not throw.

- [ ] **Step 3: Add the `mode` field to the schema**

In `backend/validation/schemas/askAi.js`, add the field inside the `z.object({...})`, after `pageRoute`:

```javascript
  pageRoute: z.string().trim().max(200).optional().nullable(),
  // Which brain answers: dashboard help (default) or the internal-open assistant.
  mode: z.enum(['dashboard', 'open']).default('dashboard'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/validation/askAi.schema.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/validation/schemas/askAi.js backend/tests/validation/askAi.schema.test.js
git commit -m "feat(ask-ai): accept a mode param (dashboard|open) in the ask schema"
```

---

## Task 2: Service resolves the brain per mode (TDD)

**Files:**
- Modify: `backend/services/askAi/askAi.service.js`
- Test: `backend/tests/services/askAi.service.test.js`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe('askAi.service ask()', ...)` block)

```javascript
  it('routes mode=open to the internal brain with its own token', async () => {
    vi.stubEnv('RAG_BRAIN_OPEN_SLUG', 'msfg-internal');
    vi.stubEnv('RAG_BRAIN_OPEN_TOKEN', 'open-tok');
    fetchMock.mockResolvedValue(fetchResponse(200, okPayload));

    await service.ask({ email: 'z@x.com', question: 'gift funds on 5% down?', mode: 'open' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://los.example.com/rag/api/ai/public/msfg-internal/ask');
    expect(opts.headers['X-Public-Brain-Token']).toBe('open-tok');
    expect(opts.headers.Origin).toBe('https://dashboard.msfgco.com');
  });

  it('defaults to the dashboard brain when mode is omitted or "dashboard"', async () => {
    fetchMock.mockResolvedValue(fetchResponse(200, okPayload));

    await service.ask({ email: 'z@x.com', question: 'q' });                      // omitted
    await service.ask({ email: 'z@x.com', question: 'q', mode: 'dashboard' });   // explicit

    expect(fetchMock.mock.calls[0][0]).toBe('https://los.example.com/rag/api/ai/public/msfg-dashboard/ask');
    expect(fetchMock.mock.calls[1][0]).toBe('https://los.example.com/rag/api/ai/public/msfg-dashboard/ask');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).toBe('q');
  });

  it('mode=open with no open token → 503 and never calls fetch', async () => {
    // RAG_BRAIN_OPEN_TOKEN intentionally not stubbed
    await expect(service.ask({ email: 'z@x.com', question: 'q', mode: 'open' }))
      .rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses RAG_BRAIN_OPEN_SLUG default (msfg-internal) when slug env is unset but token is set', async () => {
    vi.stubEnv('RAG_BRAIN_OPEN_TOKEN', 'open-tok');   // no RAG_BRAIN_OPEN_SLUG
    fetchMock.mockResolvedValue(fetchResponse(200, okPayload));
    await service.ask({ email: 'z@x.com', question: 'q', mode: 'open' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://los.example.com/rag/api/ai/public/msfg-internal/ask');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/services/askAi.service.test.js`
Expected: FAIL — `mode=open` still hits `msfg-dashboard` with `tok-123`.

- [ ] **Step 3: Implement per-mode resolution**

In `backend/services/askAi/askAi.service.js`, add the brain table above `ask` and change the resolution at the top of `ask`. Replace the current header block:

```javascript
// Per-mode brain resolution. Base URL + origin are shared (same engine, same
// allowed domain); only the brain slug + public token differ.
const BRAINS = {
  dashboard: { slugEnv: 'RAG_BRAIN_SLUG',      slugDefault: 'msfg-dashboard', tokenEnv: 'RAG_BRAIN_PUBLIC_TOKEN' },
  open:      { slugEnv: 'RAG_BRAIN_OPEN_SLUG', slugDefault: 'msfg-internal',  tokenEnv: 'RAG_BRAIN_OPEN_TOKEN' },
};

async function ask({ email, question, conversationId, pageRoute, mode }) {
  const baseUrl = process.env.RAG_BRAIN_BASE_URL;
  const origin = process.env.RAG_BRAIN_ORIGIN || 'https://dashboard.msfgco.com';
  const brain = BRAINS[mode] || BRAINS.dashboard;
  const slug = process.env[brain.slugEnv] || brain.slugDefault;
  const token = process.env[brain.tokenEnv];

  if (!baseUrl || !token) {
    throw serviceError('Ask AI is not configured on the server yet', 503);
  }
```

Everything below (building `body`, the `fetch(`${baseUrl...}/api/ai/public/${slug}/ask`)` call, status handling) is unchanged — it already uses the local `slug`, `token`, `origin`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/services/askAi.service.test.js`
Expected: PASS — all prior tests plus the 4 new ones. (The existing "503 when env is not configured" test stubs `RAG_BRAIN_BASE_URL=''`, still 503.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/askAi/askAi.service.js backend/tests/services/askAi.service.test.js
git commit -m "feat(ask-ai): resolve the brain per mode (dashboard vs internal-open)"
```

---

## Task 3: Route forwards `mode` to the service

**Files:**
- Modify: `backend/routes/askAi.js`

- [ ] **Step 1: Forward `mode` from the validated body**

In `backend/routes/askAi.js`, change the destructure + call:

```javascript
    const { question, conversationId, pageRoute, mode } = req.body;
    ok(res, await askAi.ask({ email, question, conversationId, pageRoute, mode }));
```

(`mode` is already validated + defaulted to `'dashboard'` by the schema from Task 1.)

- [ ] **Step 2: Run the full backend suite to verify nothing regressed**

Run: `cd backend && npm test`
Expected: PASS — whole suite green (schema + service + everything else).

- [ ] **Step 3: Commit**

```bash
git add backend/routes/askAi.js
git commit -m "feat(ask-ai): pass mode from the route into the ask service"
```

---

## Task 4: Pill styles (CSS)

**Files:**
- Modify: `css/chat.css`

- [ ] **Step 1: Add the mode-pill styles** (append after the `ASK AI PANE` section header block, near the existing `.ask-ai-pane` rules)

```css
/* Dashboard | Assistant mode pill (top of the Ask AI pane) */
.ask-ai-modes {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem 0;
    flex-shrink: 0;
}

.ask-ai-mode-btn {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
}

.ask-ai-mode-btn:hover {
    color: var(--text-primary);
}

.ask-ai-mode-btn.is-active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--green-bright);
}
```

- [ ] **Step 2: Commit**

```bash
git add css/chat.css
git commit -m "feat(ask-ai): mode-pill styles"
```

---

## Task 5: `ask-ai.js` — mode state, per-mode threads, send `mode`

**Files:**
- Modify: `js/ask-ai.js`

- [ ] **Step 1: Add mode state + thread storage to the `AskAI` object**

Replace the top fields:

```javascript
  const AskAI = {
    mode: 'dashboard',
    threads: { dashboard: { conversationId: null }, open: { conversationId: null } },
    pending: false,
```

- [ ] **Step 2: Bind the mode buttons + restore the saved mode in `init()`**

Change `init()` to:

```javascript
    init() {
      const panel = document.getElementById('chatFloatPanel');
      if (!panel || !document.getElementById('askAiPane')) return;
      this.bindTabs();
      this.bindModes();
      this.bindForm();
      this.restoreTab();
      this.appendIntro();
      this.restoreMode();
    },

    bindModes() {
      document.querySelectorAll('.ask-ai-mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.setMode(btn.getAttribute('data-mode')));
      });
    },

    restoreMode() {
      const saved = Utils.getStorage('msfg_askai_mode', 'dashboard');
      if (saved === 'open') this.setMode('open');
    },

    setMode(mode) {
      if (mode !== 'dashboard' && mode !== 'open') return;
      if (mode === this.mode) return;
      const list = document.getElementById('askAiMessages');
      if (list) this.threads[this.mode].messagesHTML = list.innerHTML;  // save outgoing
      this.mode = mode;
      Utils.setStorage('msfg_askai_mode', mode);

      document.querySelectorAll('.ask-ai-mode-btn').forEach((b) => {
        const on = b.getAttribute('data-mode') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      if (list) {
        const saved = this.threads[mode].messagesHTML;
        if (saved != null) {
          list.innerHTML = saved;                       // restore incoming thread
        } else {
          list.innerHTML = '';
          this.appendIntro();                           // first visit to this mode
        }
        list.scrollTop = list.scrollHeight;
      }

      const input = document.getElementById('askAiInput');
      if (input) {
        input.placeholder = mode === 'open'
          ? 'Ask a mortgage question or brainstorm…'
          : 'Ask about the dashboard...';
        if (document.getElementById('chatFloatPanel').classList.contains('is-open')) input.focus();
      }
    },
```

- [ ] **Step 3: Make `appendIntro()` mode-aware**

```javascript
    appendIntro() {
      const list = document.getElementById('askAiMessages');
      if (!list || list.children.length) return;
      const text = this.mode === 'open'
        ? 'Internal assistant — think out loud about loans, scenarios, and MSFG knowledge. Answers lean on our guides; double-check specific numbers.'
        : 'Hi! Ask me how to do anything in the dashboard — or where to find it.';
      const el = document.createElement('div');
      el.className = 'ask-ai-msg ask-ai-msg-assistant';
      el.innerHTML = '<div class="ask-ai-bubble">' + esc(text) + '</div>';
      list.appendChild(el);
    },
```

- [ ] **Step 4: Route `reset()` and `send()` through the current mode's thread**

`reset()`:

```javascript
    reset() {
      this.threads[this.mode].conversationId = null;
      const list = document.getElementById('askAiMessages');
      if (list) list.innerHTML = '';
      this.appendIntro();
    },
```

In `send()`, replace the body-building + conversationId lines:

```javascript
        const body = { question, mode: this.mode };
        const pageRoute = this.currentPageRoute();
        if (pageRoute) body.pageRoute = pageRoute;
        const thread = this.threads[this.mode];
        if (thread.conversationId) body.conversationId = thread.conversationId;
        const resp = await ServerAPI.post('/ask-ai/ask', body);
        thread.conversationId = resp.conversationId || thread.conversationId;
        this.appendAnswer(resp);
```

- [ ] **Step 5: Commit**

```bash
git add js/ask-ai.js
git commit -m "feat(ask-ai): per-mode threads + send mode; mode-aware intro/placeholder"
```

---

## Task 6: Pill markup (index.html)

> Do this only after the uncommitted announcements edits are committed/stashed (see precondition note).

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the pill inside `#askAiPane`, before `#askAiMessages`**

Change:

```html
      <div class="ask-ai-pane" id="askAiPane">
        <div class="ask-ai-messages" id="askAiMessages" aria-live="polite"></div>
```

to:

```html
      <div class="ask-ai-pane" id="askAiPane">
        <div class="ask-ai-modes" role="tablist" aria-label="Assistant mode">
          <button type="button" class="ask-ai-mode-btn is-active" data-mode="dashboard" role="tab" aria-selected="true">Dashboard</button>
          <button type="button" class="ask-ai-mode-btn" data-mode="open" role="tab" aria-selected="false">Assistant</button>
        </div>
        <div class="ask-ai-messages" id="askAiMessages" aria-live="polite"></div>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(ask-ai): Dashboard | Assistant mode pill markup"
```

---

## Task 7: Browser verification (no automated FE harness)

- [ ] **Step 1: Serve + open the dashboard preview** (per the repo's `.claude/launch.json` dev config, same as the resizable-panel piece).

- [ ] **Step 2: Open the Ask AI panel and verify:**
  - The `Dashboard | Assistant` pill shows; Dashboard active by default.
  - Click **Assistant** → intro text + input placeholder change; the Dashboard thread's messages disappear (separate thread).
  - Type a question in Assistant, then toggle back to Dashboard → Dashboard thread intact; toggle to Assistant → your Assistant message still there (threads don't cross).
  - `read_network_requests`: the `POST /api/ask-ai/ask` body includes `"mode":"open"` in Assistant and `"mode":"dashboard"` in Dashboard.
  - With the `msfg-internal` token unset server-side, Assistant answers surface the graceful "not set up yet" error (503) while Dashboard still answers — confirms the gate.

- [ ] **Step 3: Screenshot** both modes for the PR/hand-off.

---

## Task 8: Provision the `msfg-internal` brain (ops — the "turn it on" half)

> Not repo code. Do with Zack in the rag-brain console (piece-5 learning) or scripted. Engine on the suite box (52.2.71.106, container `rag-brain`, admin API on 127.0.0.1:8091, `X-Admin-Api-Key` from the container env). See `~/.claude/.../memory/ask-ai-rag-brain.md` for the on-box admin-API pattern.

- [ ] **Step 1:** Create the `msfg-internal` brain (clone the mortgage/lending pack as its base), `answerProvider=anthropic`.
- [ ] **Step 2:** Ingest the lending corpus; confirm docs are **PUBLIC** visibility (the public ask route only serves PUBLIC) and `test-retrieval` returns evidence for a few scenario questions (no model spend).
- [ ] **Step 3:** Enable public web access on the brain: `publicEnabled=true`, add `dashboard.msfgco.com` to allowed domains, mint a public token.
- [ ] **Step 4:** Set the open posture — strip the public/consumer guardrails; keep one guidance line: *"State specific numbers (rates, DTI, payments, caps) only when grounded in the guides; otherwise flag them as estimates to verify."*
- [ ] **Step 5:** On the EC2 backend box, set `RAG_BRAIN_OPEN_TOKEN=<token>` and `RAG_BRAIN_OPEN_SLUG=msfg-internal` in `/home/ubuntu/msfg-backend/backend/.env`; `pm2 restart msfg-backend`. (Also add both to the local `backend/.env` for parity.)
- [ ] **Step 6:** Re-run Task 7's 503-gate check — Assistant now answers from `msfg-internal`.

---

## Self-review notes
- Spec coverage: UX pill + per-mode thread (T4–T6), backend mode routing (T1–T3), graceful gate (T2 503), provisioning (T8), tests (T1–T3), verification (T7). All spec sections covered.
- The dashboard path is byte-for-byte unchanged when `mode` is omitted or `dashboard` (same env, same URL) — the existing service tests still assert this.
- Naming (`open` mode, `msfg-internal` slug, "Assistant" label) matches the spec; change in one place each if Zack renames.
