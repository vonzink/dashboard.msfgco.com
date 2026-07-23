# Ask AI — resizable floating panel

Status: DESIGN APPROVED (Zack, 2026-07-23). Scope: piece 1 of 5 in the
"know-everything MSFG + sites + lending bot" vision. This piece is
frontend-only and independent of the others.

## Goal
Let the user drag-resize (stretch) the Ask AI / Team Chat floating panel, and
have it remember the chosen size — so long answers, and later LOE drafting,
have room to breathe.

## Current state (what exists)
- `.chat-float-panel` (`css/chat.css:850`): `position: fixed`, fixed
  `width: 400px; height: 520px`, anchored bottom-right via CSS `bottom/right`,
  `overflow: hidden`. A `@media` block (~`css/chat.css:1097`) gives the mobile
  layout.
- `js/chat.js` owns the panel open/close and a **custom pointer-drag** on the
  FAB (`bindFloatPanel`, `_placeFab`, `_positionPanel`). FAB position persists
  as viewport fractions in `localStorage` key `msfg_chat_fab_pos`. When the FAB
  has been moved, `_positionPanel()` sets inline `left/top` on the panel; when
  it hasn't, the panel uses its default CSS bottom-right corner.
- `js/ask-ai.js` owns only tabs + the ask flow — untouched by this piece.

## Design

### Interaction
- A **resize grip at the panel's top-left corner** (a small diagonal handle,
  visually consistent with the FAB drag affordance). Pointer-drag it to resize.
- **The bottom-right corner stays fixed during a resize.** Implementation: on
  each pointer move, compute the new width/height from the drag delta; when the
  panel is inline-positioned (FAB moved), also update `left/top` so that
  `right = left + width` and `bottom = top + height` stay put. In the default
  (CSS-anchored) state, bottom/right are already fixed by CSS, so only
  width/height change.
- Custom pointer logic (mirrors the existing FAB drag: `setPointerCapture`, a
  small move threshold, `is-resizing` class), NOT native CSS `resize` — native
  can't clamp, can't persist, and fights the bottom-right anchor.

### Constraints
- **Min:** 320 × 420 px. **Max:** 92vw × 92vh. Never past the viewport edges
  (same margin `m` the FAB code already uses).
- Resize is disabled on mobile (pointer grip hidden via the existing `@media`
  breakpoint); the full-width mobile layout is unchanged.

### Persistence
- Save `{ w, h }` to `localStorage` key `msfg_chat_panel_size` on resize end.
- On panel open / init, restore the saved size, **re-clamped to the current
  viewport** (so a size saved on a big monitor doesn't overflow a laptop).
- After restoring size, the existing `_positionPanel()` still runs so the panel
  stays anchored to the FAB.

### Files touched
- `css/chat.css` — the grip element styles and `is-resizing` cursor/selection
  guards; mobile `@media` hides the grip. Sizing is driven by JS setting inline
  `width`/`height` on `.chat-float-panel` (same mechanism `_positionPanel`
  already uses for inline `left`/`top`), so no CSS width/height change beyond
  keeping the `400px/520px` rule as the pre-resize default.
- `js/chat.js` — resize pointer handlers + clamp + persist/restore, added
  next to the existing FAB-drag code; hook restore into the panel-open path.
- No backend, no `ask-ai.js`, no other JS.

## Non-goals (YAGNI)
- No maximize/full-screen toggle (explicitly declined).
- No per-tab independent sizes (one size for the whole panel).
- No resize on mobile.

## Testing / verification
- Manual in the browser preview: drag the grip → panel grows up-left, bottom-
  right stays put; hits min/max clamps; reload → size restored; move the FAB
  then resize → still anchored and bottom-right-fixed; shrink the window below
  the saved size → panel re-clamps; mobile width → grip hidden, layout intact.
- No automated FE test harness exists for this widget; verification is the
  preview workflow (screenshots of before/after + a resize).
