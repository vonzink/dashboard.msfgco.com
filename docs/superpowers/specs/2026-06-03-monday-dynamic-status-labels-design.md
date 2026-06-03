# Dynamic Per-Board Monday Status Labels — Design Spec

- **Date:** 2026-06-03
- **Status:** Approved design, pre-implementation
- **Topic:** Replace hardcoded `STATUS_OPTIONS` dropdowns with each board's **live Monday status labels**, served from a DB cache, so dropdowns match the specific board a loan belongs to.

## Problem

`js/pipeline.js` hardcodes one `STATUS_OPTIONS` list per status field. Write-back to Monday (`{label: value}`) only succeeds when the value is an **exact existing label on that loan's board**. But the live boards **disagree**: e.g. `appraisal_status` has ~40 labels on "Ashley Active Pipeline" (`3946783498`) vs 3 on "Kim Active Pipline" (`8225994434`); `stage`, `cd_status`, `hoi_status`, `payoffs`, `closing_docs`, `mini_set_status` also diverge. A single hardcoded list cannot match both boards, and labels drift over time as admins edit Monday. (Confirmed via `backend/scripts/dump-status-labels.js`.)

Already shipped (2026-06-03, separate commit): `POST /monday/mappings` is now non-destructive (merge/upsert), so saving mappings can't wipe auto-added columns. This spec does NOT re-cover that.

## Goal

For the **pipeline loan-detail modal**, render each status dropdown from the **live Monday labels of that loan's board** (`source_board_id`), falling back to the hardcoded `STATUS_OPTIONS` when no live labels exist. Labels come from a DB cache (no Monday call on modal open).

## Non-goals (v1)

- Inline status dropdowns in the pipeline **table** (rows mix boards) — fast-follow.
- Pre-approvals / funded-loans sections.
- Live per-open Monday fetch (we cache in DB; rejected for latency/rate-limits).
- Editing Monday labels from the dashboard.

## Architecture

### 1. Store labels — DB

New column on `monday_column_mappings` (created in `004_monday_pipeline_columns.sql`):
```sql
ALTER TABLE monday_column_mappings ADD COLUMN labels_json TEXT NULL AFTER monday_column_title;
```
A new sequential migration (`backend/db/migrations/<next>_monday_column_labels.sql`). `labels_json` holds the JSON array of that status column's current Monday labels (empty/NULL for non-status columns).

### 2. Capture labels — backend service

New `refreshStatusLabels(token, boardId)` in `backend/services/monday/` (own module or appended to `sync.js`):
- Query Monday `boards(ids:[board]){columns{id type settings_str}}`.
- For each `type === 'status'` column, parse `settings_str.labels` (filter empties).
- `UPDATE monday_column_mappings SET labels_json = ? WHERE board_id = ? AND monday_column_id = ?`.

Single owner of label capture (decoupled from the 3 mapping-insert sites). Invoked:
- At the end of `auto-map-new-columns.js` (so a remap also refreshes labels).
- New `backend/scripts/refresh-status-labels.js` (manual/cron).
- Optionally after a full board sync.

### 3. Serve — backend route

`GET /api/monday/status-labels?section=pipeline` (auth: same as `GET /monday/view-config`):
```json
{ "3946783498": { "wvoes": ["Please Order", ...], "stage": [...] },
  "8225994434": { "wvoes": [...], ... } }
```
Reads `labels_json` from `monday_column_mappings` for active boards in the section; groups by `board_id` → `pipeline_field` → labels[]. No Monday call.

### 4. Dynamic dropdowns — frontend (`js/pipeline.js`)

- New `_statusLabelsByBoard` cache + `_loadStatusLabels()` (one fetch, memoized; refresh on pipeline load).
- `statusSelect(field, label, currentVal)` resolves options as:
  `this._statusLabelsByBoard?.[item.source_board_id]?.[field] ?? this.STATUS_OPTIONS[field] ?? []`
- `item.source_board_id` must be available on the pipeline row (verify it's selected/returned by the pipeline API; add to the projection if missing).
- `statusSelect` already injects a custom `<option>` for a `currentVal` not in the list, so legacy/out-of-set values still display and don't silently change.

### Data flow
```
sync / auto-map / refresh script
  → refreshStatusLabels(board) → Monday settings_str → labels_json in DB
dashboard loads pipeline
  → GET /monday/status-labels?section=pipeline → { board: { field: [labels] } } cached
open loan detail (item.source_board_id)
  → statusSelect uses board's live labels (fallback STATUS_OPTIONS)
```

## Edge cases / fallback
- Board not yet refreshed / field has no `labels_json` → fall back to `STATUS_OPTIONS[field]`.
- Loan with no `source_board_id` (manual/local rows) → `STATUS_OPTIONS`.
- Non-status fields (text/date) unaffected.
- `send_to_compliance` is a Monday **button** column (not status) — excluded; leave as-is.

## Testing
- **Backend:** `refreshStatusLabels` writes correct `labels_json`; `GET /status-labels` returns per-board field→labels; non-status columns excluded.
- **Frontend:** open a loan on each board → dropdowns show that board's labels; a loan with no labels → falls back to `STATUS_OPTIONS`; changing a status writes back successfully (value is a valid board label).
- Manual: confirm `wvoes`/`vvoes` still correct (already-consistent baseline).

## Files touched
- `backend/db/migrations/<next>_monday_column_labels.sql` (new)
- `backend/services/monday/sync.js` (or new module) — `refreshStatusLabels`
- `backend/scripts/refresh-status-labels.js` (new); `auto-map-new-columns.js` (call refresh)
- `backend/routes/monday.js` — `GET /status-labels`
- `js/api-server.js` — `getStatusLabels(section)`
- `js/pipeline.js` — label cache + `statusSelect` resolution; ensure `source_board_id` present

## Open questions
None blocking. Fast-follows: inline-table dropdowns; a scheduled label refresh cadence; extend to pre-approvals/funded.
