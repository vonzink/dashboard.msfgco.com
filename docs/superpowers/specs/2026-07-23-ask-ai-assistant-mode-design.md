# Ask AI — internal-open "Assistant" mode (piece 2/5)

Status: DESIGN, pending Zack's spec review. Part of the "know-everything MSFG
bot" roadmap.

## Decisions locked (Zack, 2026-07-23)
- **Separate, dedicated brain** — not loosening the shared `mortgage` brain.
- **Audience is internal employees only.** The dashboard's Ask AI already sits
  behind Cognito + `requireNonExternal`, and the FAB is hidden for external
  users, so this brain never faces a borrower or the public. This is a third
  tier alongside the existing *folder-specific* (scoped analyzers) and *public*
  (tight-guardrail) brains: an **internal-open** brain.
- **Open posture.** Employees brainstorm freely; the consumer-facing rails
  (commitment-to-lend disclaimer, escalate-approval-decisions) are dropped —
  they *are* the licensed LOs. Only one soft rail kept (below).
- **Scope: broad, seeded lending-first.** Architect it as a general open
  internal assistant, but load the lending corpus first and grow the corpus
  over time — no re-architecting to broaden it.

## Goal
Add a second mode to the Ask AI panel — an **open internal assistant** — that
employees use to explore mortgage scenarios, draft language, and brainstorm,
answered from MSFG's knowledge but without the restraints on the public/scoped
brains. Same window, a sub-toggle. Dashboard-help mode stays exactly as is.

## Naming (proposed — trivial to change on review)
- Brain slug: **`msfg-internal`**.
- Request mode values: `dashboard` (default) | `open`.
- Pill labels: **`Dashboard | Assistant`** (or "Open" / "Brainstorm" — Zack's
  pick). "Lending" is fine for v1 too since the corpus starts lending-only.

## UX (frontend)
- A segmented pill at the top of the Ask AI pane: **`[ Dashboard | Assistant ]`**.
  Default `Dashboard`. Last choice remembered in `localStorage`
  (`msfg_askai_mode`). Team Chat tab untouched.
- **Separate thread per mode.** Each mode keeps its own `conversationId` and
  message history for the session; toggling swaps the visible thread so the two
  never mix. State: per-mode `{ conversationId, messagesHTML }`, swap the
  messages container on toggle.
- Per-mode intro + input placeholder:
  - Dashboard: existing "Ask me how to do anything in the dashboard…".
  - Assistant: "Internal assistant — think out loud about loans, scenarios, and
    MSFG knowledge. Answers lean on our guides; double-check specific numbers."
- Existing answer rendering (citations, disclaimer, escalation) reused as-is;
  "Take me there" simply won't appear for Assistant (no dashboard section slugs).
- Files: `index.html` (pill in `#askAiPane`), `js/ask-ai.js` (mode state,
  per-mode threads, send `mode`), `css/chat.css` (pill styles).

## Backend (mode routing)
- `POST /api/ask-ai/ask` gains optional `mode` (`dashboard` | `open`, default
  `dashboard`). Add to the `askAiQuestion` validation schema (enum).
- `askAi.service.js` resolves the brain per mode; base URL + origin shared:
  - `dashboard` → `RAG_BRAIN_SLUG` (msfg-dashboard) + `RAG_BRAIN_PUBLIC_TOKEN`.
  - `open` → `RAG_BRAIN_OPEN_SLUG` (default `msfg-internal`) +
    `RAG_BRAIN_OPEN_TOKEN`.
- Unset `open` token → graceful **503** ("the assistant isn't set up yet");
  Dashboard keeps working. Response body returned verbatim.
- TDD (`backend/tests/services/askAi.service.test.js`): `mode=open` →
  `/api/ai/public/msfg-internal/ask` with the open token; `mode=dashboard` (and
  omitted) → dashboard brain; unconfigured open → 503; headers correct per mode.

## Posture & the one kept rail
Open for internal use. The single soft rail: **honesty about numbers** — if the
assistant states a specific rate / DTI / payment / cap, it should ground it in
the guides or flag it as an estimate, so an LO never quotes a hallucinated
figure to a client. Implemented as a guidance-rule line on the brain, not a hard
deflection. Everything else is open: it engages scenario questions, drafts
language, and brainstorms.

## Provisioning (rag-brain console — piece-5 learning moment)
1. Create the **`msfg-internal`** brain (clone the mortgage/lending pack as the
   base), answerProvider=anthropic.
2. Ingest the lending corpus; confirm it's **PUBLIC**-visibility and retrieval
   returns evidence (the engine's public route only serves PUBLIC).
3. Enable public web access on the brain: publicEnabled=true, allowedDomains
   includes `dashboard.msfgco.com`, mint a public token. (The engine "public"
   flag is the technical transport; the *audience* is still gated to employees
   by the dashboard's own auth.)
4. Set the open posture: strip the public/consumer guardrails, keep the
   honesty-about-numbers guidance line.
5. Set `RAG_BRAIN_OPEN_TOKEN` + `RAG_BRAIN_OPEN_SLUG=msfg-internal` in the EC2
   backend `.env`; `pm2 restart`.
Walk-through in the console (so Zack learns it) or scripted — decide at build.

## Sequencing
The **wiring** (frontend pill + per-mode thread, backend `mode` routing, tests)
is independent of the brain and can ship first, gated so Assistant shows a
graceful "not set up yet" until `RAG_BRAIN_OPEN_TOKEN` is configured. The
**brain provisioning** (create `msfg-internal`, ingest, open posture, token) is
the second half and is what turns Assistant on. Reviewable code lands early;
the brain work is the console/ops half.

## Testing / verification
- Backend: vitest for mode-routing + unconfigured-503 (TDD).
- Frontend: isolated-harness verification (toggle swaps thread + placeholder +
  intro, sends `mode`) — same pattern as the resizable-panel piece.
- Engine: `test-retrieval` against `msfg-internal` for a few scenario questions
  (no model spend) to confirm grounding before wiring the token.
- E2E: Zack's browser pass — two-turn in each mode, threads don't cross,
  Assistant answers scenario questions openly, numbers are grounded/flagged.

## Non-goals (YAGNI / later pieces)
- LOE generation (piece 4) — Assistant mode here is open Q&A / brainstorming,
  not a structured letter generator yet (though the open brain is the natural
  home for it later).
- Auto-routing between Dashboard/Assistant (later; the toggle is explicit now).
- Broadening the corpus beyond lending (incremental; no re-architecting needed).
- Multi-site knowledge (piece 3).
