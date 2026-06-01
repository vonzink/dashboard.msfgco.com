# Checklist — Category/Gate tags + autosave & orphaned-menu fixes

**Date:** 2026-06-01
**Status:** Approved design (pending user review)
**Scope:** `checklist` feature — frontend modules, backend service/route/schema, one migration, CSS.

## Goals

1. **Bug 1 — verify "not autosaving" is closed and make it impossible to regress silently.**
2. **Bug 2 — fix the floating Menu that lingers after the checklist modal is closed.**
3. **Feature — add two tag dimensions to the Menu (Category, Gate) shown as colored pills on each item row, plus filter chips.**
4. Leave the checklist code cleaner than we found it (one schema-reuse bug fixed along the way).

Non-goals (YAGNI): no multi-select tags, no tag management UI, no per-tag analytics, no tag on subitems, no persisted filter state across sessions.

---

## Bug 1 — autosave (silent revert)

### Root-cause analysis (already done)
The full save path was traced end-to-end and is **correct in code**: handler (`actions.js`) → `ServerAPI.updateChecklistItem` (`PUT /checklists/loan-items/:id`) → `validate(loanChecklistItemUpdate)` → `updateItem` → `buildDynamicUpdate` allowlist → `SELECT *` readback. The Zod schema accepts every field the frontend sends; `todayISO()` emits a valid `YYYY-MM-DD`.

The remaining explanation is environmental: the item columns come from migrations **069 (importance) / 070 (due_date) / 076 (assigned_to) / 077 (status+assignment enum expansion)**. Project notes had prod "applied through 073," so writes to `assigned_to` or the new status values (`incomplete`/`issue`/`na`) would have thrown *Unknown column* / enum errors → HTTP 500 → optimistic revert. The old failure toast swallowed the message, so it read as a **silent revert**. Commits `497ae2c` (log Zod rejections) and `716dc1a` (surface server error in toast) were added today while chasing this. User reports it "maybe fixed" — consistent with a recent backend deploy applying 076/077.

### Changes
1. **Eliminate the silent-success path.** In `loanChecklists.service.updateItem`, when `buildDynamicUpdate` returns `null` (no recognized fields in body), respond **400 "No valid fields to update"** instead of returning a 200 echo of the unchanged row. The frontend never sends empty updates, so this is purely defensive and turns any future contract drift into a visible error.
2. **Keep the surfaced-error toast** (already in `716dc1a`) and confirm every `actions.js` mutation handler reverts optimistic state on throw (audit pass — they currently do).
3. **Regression test** (`vitest`): assert the `loanChecklistItemUpdate` schema accepts `{category}`, `{gate}`, `{assigned_to:null}`, valid statuses, and `YYYY-MM-DD` dates; and rejects an unknown field / malformed date. This locks the payload contract that Bug 1 hinged on.
4. **Verify** the round-trip in the preview against a real item (status toggle + assign + new tag) and confirm the row survives a close/reopen.

The new migration (below) ships with this work; `./deploy.sh --backend` re-runs any pending migrations, closing the lag if still open.

---

## Bug 2 — orphaned floating Menu

### Mechanism
The Menu (`#clPinnedPanel`) has `dock` mode (inside `.cl-modal`) and `float` mode (reparented to `document.body` so it escapes the modal's CSS `transform`). `Checklists.close()` already sets the panel `display:none`, and no rogue modal-close handler exists — so the residual is a teardown gap when the panel lives under `document.body`, and/or deploy/cache lag.

### Changes
1. Extract a `_teardownPinnedPanel()` on the pinned mixin that: hides the panel **and re-docks it** (moves it back inside `.cl-modal` before `#clContent`) so nothing can be left parented to `document.body`. Reset `_selectedItemId` and clear selection highlight.
2. Call `_teardownPinnedPanel()` from `close()` (replacing the inline `display:none`).
3. Confirm the panel's own × (`toggle-pinned`) works when the modal is already closed (handler must not depend on `_currentChecklist`).
4. **Reproduce** the exact sequence in the preview (open → detach/float → close modal) and confirm the panel is gone; repeat in dock mode.

---

## Feature — Category & Gate tags

### Dimensions (single-select per dimension)
- **Category:** `assets`, `income`, `reo`, `credit`, `title`
- **Gate** (workflow order): `ptd`, `ptc`, `ptf`, `ctc`

An item carries at most one Category and at most one Gate — same pattern as the existing Priority and Assign-To sections. Clicking the active pill again clears it (toggle off → `null`).

### Data model
Migration `081_item_category_gate.sql`:
```sql
ALTER TABLE loan_checklist_items
  ADD COLUMN category ENUM('assets','income','reo','credit','title') NULL DEFAULT NULL AFTER assigned_to,
  ADD COLUMN gate     ENUM('ptd','ptc','ptf','ctc')                 NULL DEFAULT NULL AFTER category;
ALTER TABLE loan_checklist_items ADD INDEX idx_category (category);
ALTER TABLE loan_checklist_items ADD INDEX idx_gate (gate);
```
Readback is unchanged (`_hydrateInternal` uses `SELECT *`).

### Backend
- `validation/schemas/checklists.js`: add
  ```js
  const checklistCategory = z.enum(['assets','income','reo','credit','title']);
  const checklistGate     = z.enum(['ptd','ptc','ptf','ctc']);
  ```
  and `category: checklistCategory.optional().nullable()`, `gate: checklistGate.optional().nullable()` to `loanChecklistItemUpdate`. Export both enums.
- **Cleanup:** add a dedicated `loanChecklistSubitemUpdate` schema (`name`/`status`/`date`/`sort_order`) and switch `routes/checklists.js:202` off the misused `itemUpdateSchema`.
- `loanChecklists.service.updateItem` allowlist: append `'category'`, `'gate'`.

### Frontend
- **`checklists.js` dispatcher:** add `'set-category'` → `_actionSetCategory`, `'set-gate'` → `_actionSetGate`.
- **`actions.js`:** `_actionSetCategory(id, btn)` and `_actionSetGate(id, btn)` — clones of `_actionSetAssignedTo` (optimistic, revert on throw, `_updateItemInPlace`). Toggle-off when the clicked value equals the current value.
- **`pinned.js` `_itemActionsHtml`:** two new `cl-menu-section` blocks ("Category", "Gate") of pill buttons, `data-cl-action="set-category|set-gate"`, `data-cl-id`, `data-cl-category|data-cl-gate`, active-state class on the current value.
- **`render.js`:**
  - Render up to two pills per row (category, gate) inside `.cl-item` (in `_renderChecklist` and mirrored in `_updateItemInPlace`).
  - Add a **filter-chip bar** above `.cl-items-list`: one chip per Category value + one per Gate value present in the checklist, plus a Clear chip. State held in `this._tagFilter = { category: null, gate: null }`. Clicking a chip toggles that dimension's filter; Category + Gate active = **AND**. Filtering shows/hides `.cl-item` rows client-side (no server call). Filter resets on modal close.
- **`css/checklists.css`:** `.cl-tag-pill` base + per-value modifiers, theme-aware via existing `data-theme` variables.
  - Category palette: assets·teal, income·green, reo·amber, credit·purple, title·blue.
  - Gate palette: ptd·slate, ptc·orange, ptf·red, ctc·green.

### Render/data flow
Menu pill click → `_actionSetCategory/Gate` → optimistic `item.category/gate` + `_updateItemInPlace` → `PUT /loan-items/:id {category|gate}` → on success keep, on throw revert + error toast. Filter chips are pure client-side view state over `_currentChecklist.items`.

---

## Testing
- **vitest** (suite lives in `backend/tests/`): schema contract test in `backend/tests/validation/` (next to `schemas.test.js`); filter-predicate unit test in `backend/tests/frontend/` (next to `checklistFormat.test.js`) — extract the category/gate AND filter as a pure helper so it's testable headless.
- **Preview (browser) verification, per change:** Bug 2 reproduce/confirm; Bug 1 round-trip; feature — set a category + gate, see pills on the row, exercise filter chips, confirm persistence across reopen; check dark + light themes.

## Deployment
`./deploy.sh --backend` after approval and local verification (frontend S3 + CloudFront invalidation, git-pull + PM2 restart on EC2, migrations run on boot). Hard-refresh (Cmd+Shift+R).

## File-touch summary
| File | Change |
|---|---|
| `backend/db/migrations/081_item_category_gate.sql` | new — 2 columns + 2 indexes |
| `backend/validation/schemas/checklists.js` | category/gate enums + item-update fields; new subitem-update schema |
| `backend/routes/checklists.js` | subitem route → `loanChecklistSubitemUpdate` |
| `backend/services/checklists/loanChecklists.service.js` | allowlist += category,gate; 400 on empty update |
| `js/checklists.js` | dispatcher entries for set-category/set-gate; close() → teardown |
| `js/checklists/actions.js` | `_actionSetCategory`, `_actionSetGate` |
| `js/checklists/pinned.js` | `_teardownPinnedPanel`; Category/Gate menu sections |
| `js/checklists/render.js` | row pills + filter-chip bar + filter logic |
| `css/checklists.css` | pill + chip styles |
| `backend/tests/validation/*` | schema contract test |
| `backend/tests/frontend/*` | filter-predicate test |

## Commit plan (atomic, single-purpose)
1. `migration + schema + service` (backend tag plumbing + empty-update 400 + subitem schema fix)
2. `bug2: harden pinned-panel teardown on close`
3. `feature: Category/Gate menu sections + actions + dispatcher`
4. `feature: row pills + filter chips + CSS`
5. `tests: schema contract + filter predicate`
