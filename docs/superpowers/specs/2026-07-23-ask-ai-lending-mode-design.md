# Ask AI — Lending mode (piece 2/5)

Status: DESIGN, pending Zack's spec review. Part of the "know-everything MSFG
bot" roadmap. Architecture decided earlier: **separate brain, one window,
mode toggle now → auto-route later.**

## Goal
Let a signed-in dashboard user switch the Ask AI panel into a **Lending** mode
that answers mortgage/lending questions from MSFG's lending knowledge, without
losing the existing dashboard-help assistant. Same window, a sub-toggle.

## UX (frontend)
- A segmented pill at the top of the Ask AI pane: **`[ Dashboard | Lending ]`**.
  Default `Dashboard`. Last choice remembered in `localStorage`
  (`msfg_askai_mode`). Team Chat tab is untouched.
- **Separate thread per mode.** Dashboard and Lending each keep their own
  `conversationId` and message history for the session. Toggling swaps the
  visible thread so the two never mix. Implementation: keep per-mode state
  (`{ conversationId, messagesHTML }`) and swap the messages container on toggle.
- Per-mode intro line + input placeholder:
  - Dashboard: existing "Ask me how to do anything in the dashboard…".
  - Lending: "Ask me mortgage & lending questions — answered from MSFG's
    lending guides. Educational, not a commitment to lend."
- Existing answer rendering (citations, disclaimer, escalation) is reused as-is.
  "Take me there" simply won't appear for Lending (the mortgage brain returns
  no dashboard section slugs) — no code change needed.
- Files: `index.html` (pill markup in `#askAiPane`), `js/ask-ai.js` (mode state,
  per-mode threads, send `mode`), `css/chat.css` (pill styles).

## Backend (mode routing)
- `POST /api/ask-ai/ask` request gains optional `mode` (`dashboard` | `lending`,
  default `dashboard`). Add to the `askAiQuestion` validation schema (enum).
- `askAi.service.js` resolves the brain per mode; base URL + origin are shared
  (same engine, same allowed domain):
  - `dashboard` → `RAG_BRAIN_SLUG` (msfg-dashboard) + `RAG_BRAIN_PUBLIC_TOKEN`.
  - `lending`  → `RAG_BRAIN_LENDING_SLUG` (default `mortgage`) +
    `RAG_BRAIN_LENDING_TOKEN`.
- If the selected mode's token is unset → graceful **503** ("the lending
  assistant isn't set up yet"); the other mode keeps working. Response body is
  still returned verbatim.
- TDD (`backend/tests/services/askAi.service.test.js`): `mode=lending` hits
  `/api/ai/public/mortgage/ask` with the lending token; `mode=dashboard` (and
  omitted) hits the dashboard brain; unconfigured lending → 503; origin/token
  headers correct per mode.

## Lending posture & guardrails — NEEDS SIGN-OFF
Zack chose the **more-permissive** posture: Lending mode should *engage* with
specific scenario questions ("can I use gift funds on a 5%-down conventional?",
"max DTI for FHA?") and give guideline-grounded answers, instead of deflecting
everything as the brain does today.

**Non-negotiable rails kept even in permissive mode** (these stay unless Zack
explicitly overrides each, in writing, with compliance aware):
1. **No fabricated numbers.** Keep the engine's calculation guardrail — the bot
   must not invent a rate, payment, APR, or a specific approval number. Those
   route to the calculators / a human LO. (LLMs hallucinate math; a wrong
   payment to a borrower is both harmful and a liability.)
2. **Standing disclaimer** on lending answers: informational/educational, **not
   a commitment to lend**, subject to underwriting, not a substitute for a
   licensed loan officer.
3. **Escalate real decisions.** "Am I approved / will I qualify / what's my
   rate" → grounded general explanation **plus** a hand-off to a licensed LO,
   not a yes/no.
4. Answers grounded in the lending corpus (RAG), not free-form regulatory or
   legal claims.

"More permissive" = remove the blanket deflection so it answers the *how does X
work* and *what do the guidelines say about my scenario* questions helpfully —
while the four rails above hold.

**Open decision A — which brain to loosen:**
- **Option A1 (recommended): a dedicated `msfg-lending` brain for the dashboard**
  — clone the `mortgage` pack with the permissive-but-railed rules. Keeps the
  shared `mortgage` brain (which may serve other surfaces — suite/staging)
  unchanged, so we don't loosen guardrails for consumers we don't control.
- **Option A2: loosen the shared `mortgage` brain in place** — less setup, but
  the guardrail change hits every surface that already points at `mortgage`.

**Compliance sign-off:** loosening lending guardrails is a business/compliance
decision, not just an engineering one. Recommend Zack (and whoever owns MSFG
compliance) sign off on the exact allowed/deflected boundary before it goes
live. This spec proposes the boundary above as the starting point.

## Provisioning prerequisite (rag-brain console — piece-5 learning moment)
1. Pick the brain per Open Decision A. If A1, create `msfg-lending` (clone the
   mortgage pack), ingest the lending corpus, set answerProvider=anthropic.
2. Confirm it has **PUBLIC** corpus ingested (retrieval returns evidence).
3. Enable public web access: publicEnabled=true, allowedDomains includes
   `dashboard.msfgco.com`, mint a public token.
4. Tune rules.hard / guardrails / classifier to the signed-off permissive
   boundary (keep the four rails).
5. Set `RAG_BRAIN_LENDING_TOKEN` + `RAG_BRAIN_LENDING_SLUG` in the EC2 backend
   `.env`; `pm2 restart`. (Walk-through in the console, or scripted — Zack's
   call.)

## Testing / verification
- Backend: vitest for the mode-routing + unconfigured-503 cases (TDD).
- Frontend: harness verification (toggle swaps thread + placeholder + intro,
  sends `mode`), same isolated-harness pattern as the resizable-panel piece.
- Engine: `test-retrieval` against the lending brain for a few scenario
  questions (no model spend) to confirm grounding before wiring the token.
- End-to-end: Zack's browser pass (two-turn in each mode; confirm threads don't
  cross; confirm the four rails hold on a "will I qualify" probe).

## Sequencing
The **wiring** (frontend sub-toggle + per-mode thread, backend `mode` routing,
tests) is independent of the compliance/brain decision and can be built + merged
first, gated so Lending shows a graceful "not set up yet" until the token is
configured. The **brain provisioning + guardrail tuning** (Open Decision A +
sign-off) is the second half and is what actually turns Lending on. This keeps
the compliance-sensitive work behind an explicit gate and lets the reviewable
code land early.

## Non-goals (YAGNI / later pieces)
- LOE generation (piece 4) — Lending mode here is Q&A only.
- Auto-routing between Dashboard/Lending (later; the toggle is explicit for now).
- Multi-site knowledge (piece 3).
