# Colored-Pill Status Dropdown (Loan Status first) — Design Spec

- **Date:** 2026-06-03
- **Status:** Approved design, pre-implementation
- **Topic:** Make the dashboard status dropdown resemble Monday.com — a custom **colored-pill dropdown** matching Monday's label colors + order. Roll out to **Loan Status (stage)** first.

## Problem / context

Status dropdowns are plain `<select>`s. The user wants them to look like Monday's colored status pills (grid of colored labels). Feasibility confirmed via `diagnose-label-colors.js`: each status column's `settings_str` carries everything per label index:
- `labels` `{idx: name}`
- `labels_colors` `{idx: {color: "#hex", border, var_name}}`
- `labels_positions_v2` `{idx: position}`

So we can render pills matching Monday's exact color and order. A native `<select>` can't show colored pills cross-browser, so a small custom component is required.

This builds on the existing dynamic-labels feature (`labels_json` on `monday_column_mappings`, `GET /monday/status-labels`, `pipeline.js` `statusSelect`). Two-way sync is unchanged (the migration-wipe + stage write fixes already landed).

## Goal

In the pipeline **loan-detail modal**, render the **Loan Status (stage)** field as a custom colored-pill dropdown: cell shows the current value as a colored pill; clicking opens a Monday-style grid of colored pills; picking one writes it (existing save path).

## Non-goals (this iteration)

- Other status fields (rolled out one-by-one later — component is generic).
- Inline pipeline-table cells; pre-approvals / funded.
- Editing Monday colors/labels from the dashboard.

## Architecture

### Backend — capture colors + order
- Extend `refreshStatusLabels` (`backend/services/monday/statusLabels.js`): parse `labels` + `labels_colors` + `labels_positions_v2`; build an array of `{name, color}` **sorted by position** (drop empty names). Store as `labels_json`.
- **Shape change:** `labels_json` becomes `[{name, color}]` (was `[name]`). `getStatusLabelsBySection` returns `{ board_id: { field: [{name,color}] } }`.
- Default color when a label has no `labels_colors` entry: `#c4c4c4` (neutral grey).

### Backward-compat
- `pipeline.js` `statusSelect` (the existing `<select>`s for non-pill fields) currently treats labels as strings. Update it to accept the new shape: `presets.map(l => typeof l === 'string' ? l : l.name)`. Keeps every other dropdown working unchanged.

### Frontend — pill dropdown component (`js/pipeline.js` + CSS)
- `_statusPill(field, currentVal, item)` returns the **cell**: a `<button class="status-pill">` with `background` = the current value's color (looked up by name in the loan's-board labels), white text; `data-field`, `data-item-id`. Unset/legacy value → neutral grey pill with the raw text or "—".
- On click: build/show a **panel** (`.status-pill-panel`) anchored to the cell — a CSS-grid of `.status-pill-option` buttons (one per label, its color), ~3–4 columns (Monday-style). Click an option → `_onStatusChange`/`_saveField(item.id, field, name)` (existing write path) → close panel → re-render the cell pill.
- Close on click-outside and `Esc`. Only one panel open at a time.
- Color lookup: `colorOf(field, name)` = find `{name,color}` in `this._statusLabelsByBoard[item.source_board_id][field]`; fallback grey.

### Wire Loan Status (stage)
- Replace the stage `<select>` in the loan-detail "Current Stage" bar (`pa-detail-stage-bar`, ~`js/pipeline.js:431-440`) with `_statusPill('stage', item.stage, item)`. Other fields keep `statusSelect`.

## Data flow
```
refresh-status-labels (box) -> settings_str (labels+colors+positions) -> labels_json [{name,color}] (DB)
dashboard load -> GET /monday/status-labels -> _statusLabelsByBoard {board:{field:[{name,color}]}}
open loan -> stage rendered as colored pill (color = match item.stage in board labels)
click pill -> grid panel -> pick -> _saveField('stage', name) -> PATCH -> Monday status2 write (unchanged)
```

## Edge cases
- Board not synced / no labels for field → fall back to the plain `<select>` (existing behavior) so nothing is worse than today.
- Current value not in the label set (legacy) → neutral grey pill showing the stored text; still selectable to a valid pill.
- Label missing a color → neutral grey.
- Panel must render above other modal content (z-index) and not get clipped by the modal's overflow.

## Testing
- **Backend (vitest):** update `statusLabels.test.js` — `refreshStatusLabels` writes `[{name,color}]` ordered by `labels_positions_v2`; missing color → grey; `getStatusLabelsBySection` returns the object shape. Add the `statusSelect`-compat assumption only as a frontend note.
- **Frontend:** `node --check`; manual browser smoke (the user tests): Loan Status shows colored pills matching Monday; picking one writes to Monday (status2) and reads back.

## Files
- `backend/services/monday/statusLabels.js` — colors + order in `labels_json`; return shape.
- `backend/tests/services/statusLabels.test.js` — update for the new shape.
- `js/pipeline.js` — `_statusPill` + panel + `colorOf`; wire stage; `statusSelect` shape-compat.
- CSS — `.status-pill`, `.status-pill-panel`, `.status-pill-option` (a new block in an existing pipeline/detail stylesheet).
- Deploy `--backend-only` + frontend; re-run `refresh-status-labels.js` on the box to populate colors.

## Open questions
None blocking. Follow-ups: roll the pill dropdown out to the other status fields and the inline table.
