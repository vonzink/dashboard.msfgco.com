# Ask AI — RAG-brain assistant for the MSFG Dashboard

**Date:** 2026-07-22
**Status:** Approved design, pending implementation plan

## Goal

Replace the bottom-right Team Chat bubble with a combined FAB whose panel has two
tabs — **Ask AI** (default) and **Team Chat**. Ask AI answers "how do I use this
site / where do I find X" questions and general internal Q&A, backed by a new
`msfg-dashboard` brain on the existing rag-brain engine.

Purpose (Zack's words): *help navigate the internal site and help answer questions.*

## Decisions made

| Decision | Choice |
|---|---|
| Brain topology | New brain (`msfg-dashboard`) on the **existing** prod engine on the suite box — not a second instance, not the Mortgage brain |
| Corpus | Authored markdown guides about the dashboard, stored at `s3://msfg.us/rag-brain-dashboard/` (distinct from Mortgage's `rag-brain/` prefix) |
| Connection path | **Backend proxy** (Approach A): browser → dashboard backend (Cognito-authed) → engine public-ask endpoint. Token stays server-side |
| Team Chat fate | Kept — same FAB, second tab. No chat functionality removed |
| Answer provider | `anthropic` (matches Mortgage; engine default routing) |

## Architecture

```
Browser (index.html SPA)
  └─ Ask AI tab in chat float panel
       └─ POST /api/ask-ai/ask  (js/api-server.js — Cognito JWT, token refresh)
            └─ backend/routes/askAi.js  (validate → service → respond)
                 └─ backend/services/askAi/askAi.service.js
                      └─ POST {RAG_BRAIN_BASE_URL}/api/ai/public/msfg-dashboard/ask
                           headers: X-Public-Brain-Token, Origin: https://dashboard.msfgco.com
                           (engine on suite box los.msfgco.com / 52.2.71.106,
                            exposed via nginx location → 127.0.0.1:8091)
```

The engine's public-assistant contract (`docs/website-integration.md` in the
rag-brain repo) is the interface: request `{sessionId, conversationId?, message,
pageRoute?, surface:"PUBLIC", facts?}`, response `{conversationId, answer,
citations[], confidence, humanEscalationRequired, disclaimer, recommendedPage?,
links?, nextAction?, traceId}`.

## Components

### 1. Backend proxy (dashboard EC2)

- **Route** `backend/routes/askAi.js` — thin orchestrator, follows checklist
  pattern: validate → service → respond via `backend/utils/response.js` helpers.
  - `POST /api/ask-ai/ask` — body `{question, conversationId?, pageRoute?}`.
  - Auth: standard Cognito middleware (no new roles; any logged-in user).
- **Service** `backend/services/askAi/askAi.service.js`
  - Builds engine request: `sessionId` = authenticated user's email (stable
    per-user threads + attribution), `message` = question (≤2000 chars),
    `surface: "PUBLIC"`, forwards `conversationId`/`pageRoute` when present.
  - Sends `Origin: https://dashboard.msfgco.com` and `X-Public-Brain-Token`.
  - Timeout ~60s (engine's own AI read timeout is 60s). On engine 4xx/5xx or
    timeout, throw service error with `.status` for the central error handler.
  - Returns the engine response body verbatim (frontend consumes the contract
    directly; no reshaping to drift out of sync).
- **Validation** `backend/validation/schemas/askAi.js`, consumed by the gateway
  `backend/validation/schemas.js` via **spread re-export only** (never
  re-destructure individual names — known prod-crash failure mode).
- **Env vars** (backend `.env` on EC2 + local):
  - `RAG_BRAIN_BASE_URL=https://los.msfgco.com/rag` (nginx location; path is
    stripped by nginx so `/rag/api/ai/public/...` → `127.0.0.1:8091/api/ai/public/...`)
  - `RAG_BRAIN_PUBLIC_TOKEN` — per-brain public token (hashed server-side in engine DB)
  - `RAG_BRAIN_SLUG=msfg-dashboard`
  - `RAG_BRAIN_ORIGIN=https://dashboard.msfgco.com`
  - Missing vars → route returns 503 "Ask AI not configured" (server still boots;
    no boot-time hard dependency).
- **Rate limiting**: dashboard's existing global limiter applies; engine also
  rate-limits (10 req/min public default). No new limiter unless abuse appears.

### 2. Frontend (SPA)

- **Markup** (`index.html`): existing `#chatFab` + `#chatFloatPanel` gain a
  two-tab header — `Ask AI` | `Team Chat`. Ask AI is the default tab, except
  when unread team-chat messages exist at open time — then Team Chat opens
  (the badge promised chat content; don't hide it behind a tab). FAB icon
  changes to an AI/sparkle icon; title "Ask AI / Team Chat". Unread chat badge
  behavior unchanged (badge still signals team-chat messages).
- **New module** `js/ask-ai.js` (initialized from `app.js`, dispatched via
  `data-action` attributes per the action-dispatcher pattern):
  - Message list (user/assistant turns), input row, send on Enter.
  - Holds `conversationId` from the last response; sends it back for follow-ups.
    "New conversation" control clears it.
  - Sends current SPA section as `pageRoute` (page-aware answers).
  - Renders per the engine's UI contract:
    - `answer` — rendered as text with minimal safe formatting (no raw HTML).
    - `citations` — collapsed "Sources" line under the answer; skip null fields;
      sanitize newlines.
    - `disclaimer` — small muted text under every answer (always rendered).
    - `humanEscalationRequired` — visible "ask a teammate" style notice.
    - `recommendedPage` — "Take me there →" button that navigates the SPA
      (hash/section navigation), when the value maps to a known route.
  - Loading state (typing indicator), error state with retry.
  - Chat history is session-local (in-memory); reopening the panel in the same
    page session keeps the transcript, reload starts fresh (engine keeps
    server-side conversation state keyed by conversationId if the user continues).
- **CSS**: extend `css/chat.css` (tabs, AI message styling, citations,
  disclaimer). Dark/light theme via existing `data-theme` variables.
- **Team Chat tab**: existing `chat.js` markup/logic moves under its tab pane
  unchanged. `chat.js` keeps ownership of chat; `ask-ai.js` owns its own tab.
  Tab switching lives in a small controller (in `ask-ai.js`) that toggles panes.
- Build: new file is content-hashed by `build.js` automatically (plain script,
  not an ES module — no scanner-style carve-out needed).

### 3. Brain + corpus (rag-brain side)

- **Brain**: slug `msfg-dashboard`, display name "MSFG Dashboard", starter pack,
  S3 source `msfg.us` / `rag-brain-dashboard/` / `us-west-1`, answer provider
  `anthropic`, utility `openai`. Created on the **prod** engine via admin console.
  Published for domain `dashboard.msfgco.com` with a rotated public token.
- **Corpus**: markdown guides authored in this repo under `docs/ask-ai-corpus/`
  (versioned, reviewable), synced to `s3://msfg.us/rag-brain-dashboard/` with
  `aws s3 sync`, then brain "Sync now". Initial set — one doc per feature area:
  pipeline, checklists (incl. templates/notes/subitems), pre-approvals, funded
  loans, goals, team chat, announcements, notifications/reminders, tasks,
  calendar, content engine, investors, employee directory, file browser,
  business cards, admin panel, plus a "getting started / where is everything"
  overview. Generated from the codebase, reviewed by Zack before upload.
- **Suite box exposure** (one-time, Zack runs prepared commands): nginx location
  on `los.msfgco.com` proxying a path (e.g. `/rag/`) to `127.0.0.1:8091`,
  limited to `/api/ai/public/` paths. The endpoint is token-protected by design;
  nginx exposure adds TLS + optional IP allowlist for the dashboard EC2.
- **IAM check**: confirm the engine's S3 read (box role or `AWS_*` in
  engine.env) covers `rag-brain-dashboard/*`; widen if scoped to `rag-brain/*`.

## Error handling

| Failure | Behavior |
|---|---|
| Env vars missing on backend | 503 with clear message; frontend shows "Ask AI isn't configured yet" |
| Engine down / timeout | Service error → central handler → frontend error bubble with retry |
| Engine 401 (bad token) | Logged server-side (Pino) as config error; generic frontend message |
| Engine 400 (validation) | Message surfaced to user (per contract) |
| Low confidence / escalation flag | Answer still shown + escalation notice |

## Testing / verification

- Backend: hit `/api/ask-ai/ask` locally against the prod engine (or curl the
  engine directly first to prove the brain answers) before wiring frontend.
- Frontend: browser preview — open panel, both tabs render, ask a question,
  citations/disclaimer render, "Take me there" navigates, Team Chat unchanged
  (send message, badge, tags).
- Deploy: frontend `./deploy.sh`; backend `./deploy.sh --backend` (check EC2
  git state first per known gotcha). Env vars added to EC2 `.env` before
  backend restart.

## Out of scope (YAGNI)

- Streaming responses (engine contract is request/response).
- Brain picker / mortgage-brain tab (possible later: second slug, same proxy).
- Persisting Ask AI transcripts in the dashboard DB.
- Feeding live dashboard data to the brain (engine "direct tool adapters"
  exist — `RAG_TOOL_SECRET_DASHBOARD_API` — but that's a separate project).
- Admin UI for corpus management (rag-brain console already does this).

## Zack's task list

1. Create + publish the `msfg-dashboard` brain on the prod engine (console
   pointed at suite box, not local): slug lowercase, S3 fields as above.
2. Rotate the public token; put it in backend `.env` (or hand to Claude to set).
3. Run the prepared nginx snippet on the suite box.
4. Review corpus docs before S3 sync; review this spec.
