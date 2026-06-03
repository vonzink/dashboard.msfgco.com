# Monday.com Updates Feed in Loan Detail — Design Spec

- **Date:** 2026-06-03
- **Status:** Approved design, pre-implementation
- **Topic:** Replace the low-value "Loan Notes" box in the pipeline loan-detail modal with a live, threaded Monday.com **Updates feed** (read + post in one panel).

## Problem

The pipeline loan-detail modal currently shows a **"Loan Notes"** box ([js/pipeline.js:496-503](../../../js/pipeline.js)) that writes free text to the Monday.com `notes` **column**. It is low-value. Separately, there is a **write-only** "Post Comment to Monday.com" box ([js/pipeline.js:504-508](../../../js/pipeline.js)) that posts to the Monday item's **Updates feed** (the threaded activity log) via `createItemUpdate` — but the dashboard cannot *display* that feed. The useful content (the conversation in the screenshot: borrower changes, payoff conditions, "Note on WVOEs – Please Order") lives in Monday Updates and is invisible here.

Monday stores the Updates feed (with replies and full history) server-side, so we can **fetch and display** it — no new storage is required.

## Goal

In the **pipeline** loan-detail modal, replace the "Loan Notes" box with a single **"Monday.com Updates"** panel that:
1. Displays the Monday item's Updates feed (author, timestamp, body) with **replies threaded** underneath each update.
2. Lets the user **post** a new top-level update (reusing the existing endpoint), then refreshes the feed.

## Non-goals (v1)

- Posting **replies** (only top-level posting; replies are display-only).
- Editing the Monday `notes` **column** (that box is removed; the column still syncs Monday→dashboard for display elsewhere and is unaffected as data).
- Pre-approvals and funded-loans sections (pipeline only).
- Local caching / webhook-driven refresh (live fetch on open; see Approach A).
- Real-time updates / polling.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Fetch strategy | **A — live fetch on modal open** (one Monday API call per open). C (60s in-memory cache) is a trivial later add if rapid re-opens become an issue. |
| Layout | **Unified panel** — replace "Loan Notes", fold the existing post box in. |
| Replies | **Shown, threaded** (read-only). |
| Scope | **Pipeline only.** |
| Notes-column box | **Removed.** |

## Architecture

Thin route → service, matching the existing post path ([backend/routes/pipeline.js:491-511](../../../backend/routes/pipeline.js)).

### Backend

**1. Service function** — add `getItemUpdates(token, itemId)` next to `createItemUpdate` in [backend/services/monday/writer.js](../../../backend/services/monday/writer.js). It is a *query* (uses `mondayQuery`/the shared request helper), kept here so the read+write of "updates" live together.

GraphQL:
```graphql
query ($itemId: ID!) {
  items(ids: [$itemId]) {
    updates(limit: 50) {
      id
      text_body
      created_at
      creator { id name photo_thumb }
      replies {
        id
        text_body
        created_at
        creator { id name photo_thumb }
      }
    }
  }
}
```
Returns a normalized array (newest first), each item:
```
{ id, text, createdAt, author: { name, photo }, replies: [ { id, text, createdAt, author } ] }
```
Notes:
- Request **`text_body`** (plain text), NOT `body`. Monday `body` is HTML — see Security.
- `limit: 50` top-level updates for v1; pagination is a later concern.

**2. Route** — add `GET /api/pipeline/:id/monday-updates` in [backend/routes/pipeline.js](../../../backend/routes/pipeline.js), mirroring the `POST /:id/monday-comment` handler:
- Look up `monday_item_id` for the pipeline row.
- `404` if row not found; **return `{ updates: [], linked: false }` (200)** if the row exists but has no `monday_item_id` (so the UI shows a clean "not linked" state rather than an error).
- `getMondayToken(getUserId(req))`; if no token, return `{ updates: [], tokenMissing: true }` (200) so the UI can prompt to connect Monday instead of erroring.
- On success: `{ updates: [...], linked: true }`.
- Wrap the Monday call so a Monday-side failure returns a 502/`fail` with a friendly message (logged as a warning), not an unhandled 500.

Use existing response conventions (`backend/utils/response.js` `ok`/`fail`) where the surrounding pipeline routes do; match the local style of the file otherwise.

### Frontend

**1. Client method** — add `getMondayUpdates(pipelineId)` to [js/api-server.js:383](../../../js/api-server.js), next to `postMondayComment`:
```js
getMondayUpdates(pipelineId) { return this.get(`/pipeline/${pipelineId}/monday-updates`); }
```

**2. Modal markup** — in the loan-detail render ([js/pipeline.js:496-508](../../../js/pipeline.js)), replace **both** the "Loan Notes" section and the separate "Post Comment to Monday.com" section with one section:

```
[ Monday.com Updates ]                         (icon: fab fa-monday)
  <post box>  textarea + "Post to Monday" button   (only if monday_item_id)
  <feed>      #pipelineMondayUpdatesContainer
                - spinner while loading
                - "No updates yet." when empty
                - "Couldn't load updates — Retry" on error
                - else: list of updates, replies indented
```

- Remove the `pipelineMondayNotes` textarea, its "Save Loan Notes" button, and the `pipelineSaveMondayNotes` handler.
- Keep the existing post textarea/button **ids and `_postMondayComment` handler** ([js/pipeline.js:598](../../../js/pipeline.js)) so the post path is unchanged; on success it calls the new loader instead of just clearing.

**3. Feed loader** — add `_loadMondayUpdates(pipelineId)`, mirroring `_loadNotes` ([js/pipeline.js:643](../../../js/pipeline.js)):
- Render into `#pipelineMondayUpdatesContainer`, reusing `pa-notes-list` styling for visual consistency.
- Each update: avatar (`creator.photo`, fallback initial), author name, timestamp, escaped text (preserve line breaks).
- Replies rendered in an indented sub-list under their parent.
- Called from `_openDetail` (where `_loadNotes(id)` is called, [js/pipeline.js:548](../../../js/pipeline.js)) and after a successful post.

### Data flow

```
open modal (item has monday_item_id)
  → ServerAPI.getMondayUpdates(id)
  → GET /api/pipeline/:id/monday-updates
  → getMondayToken + monday_item_id → getItemUpdates(token, itemId) → Monday GraphQL
  → normalized JSON → render threaded feed
post comment → POST /:id/monday-comment (existing) → on success → _loadMondayUpdates(id)
```

## Security

- **XSS:** Monday update `body` is HTML. We **never** request or render `body`. We request `text_body`, and the frontend **escapes** it (existing `esc()` helper) before injecting, converting newlines to `<br>` only after escaping. Avatar `photo_thumb` URLs are set via `src` (not innerHTML) and treated as untrusted (no JS-URL risk on `<img src>`).
- **AuthZ:** the route reuses the same auth/ownership context as the surrounding pipeline routes; a user can only read updates for items they can already see in their pipeline. (Confirm parity with `POST /:id/monday-comment`, which today checks only existence — match it, and note any IDOR gap for a follow-up rather than silently widening access.)
- **Token:** per-user Monday token via `getMondayToken`; absence yields a friendly UI state, not a crash.

## Error / empty / loading states

| Condition | Behavior |
|---|---|
| Loading | spinner ("Loading updates…") |
| Item not linked (`linked:false`) | "Not linked to Monday.com" (no post box) |
| No token (`tokenMissing:true`) | "Connect Monday.com to see updates" |
| Monday API error | "Couldn't load updates — Retry" (button re-calls loader); warning logged backend-side |
| Empty feed | "No updates yet." (post box still shown) |

## Date format

Timestamps use the project-wide **MM/DD/YY** convention (+ time), consistent with announcements/checklists.

## Files touched

- `backend/services/monday/writer.js` — add `getItemUpdates` + export.
- `backend/routes/pipeline.js` — add `GET /:id/monday-updates`.
- `js/api-server.js` — add `getMondayUpdates`.
- `js/pipeline.js` — replace notes/post sections with unified panel; add `_loadMondayUpdates`; remove `pipelineMondayNotes` save handler; call loader on open + after post.
- (tests) `backend/tests/routes/` — route tests if a pipeline test harness exists.

## Testing

- **Backend:** route returns `linked:false` for an item with no `monday_item_id`; `tokenMissing:true` when token absent; normalized shape on success (mock `getItemUpdates`); friendly failure (not 500) when the Monday call throws.
- **Frontend:** manual preview smoke — open a pipeline item with a `monday_item_id`, confirm the feed renders with replies, post a comment, confirm it appears after refresh; confirm the old "Loan Notes" box is gone.

## Open questions

None blocking. Possible follow-ups: posting replies (parent_id), pagination beyond 50, 60s in-memory cache (Approach C), extending to pre-approvals/funded.
