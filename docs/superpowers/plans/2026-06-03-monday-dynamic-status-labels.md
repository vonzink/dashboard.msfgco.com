# Dynamic Per-Board Monday Status Labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render pipeline status dropdowns from each loan's board's live Monday labels (cached in the DB), so dropdowns match the board and write-back stops silently failing.

**Architecture:** Add `labels_json` to `monday_column_mappings`; a `statusLabels` service captures each status column's Monday labels into it (`refreshStatusLabels`) and reads them grouped per board (`getStatusLabelsBySection`); a `GET /monday/status-labels` route serves them; `pipeline.js` `statusSelect` uses the loan's-board labels with `STATUS_OPTIONS` as fallback.

**Tech Stack:** Node/Express, MySQL (mysql2/promise), vitest (backend tests), vanilla JS SPA frontend.

**Spec:** `docs/superpowers/specs/2026-06-03-monday-dynamic-status-labels-design.md`

---

## File structure

- Create `backend/db/migrations/085_monday_column_labels.sql` — add `labels_json` column.
- Create `backend/services/monday/statusLabels.js` — `refreshStatusLabels`, `getStatusLabelsBySection`, `parseLabels`.
- Create `backend/tests/services/statusLabels.test.js` — service unit tests.
- Create `backend/tests/routes/monday-status-labels.test.js` — route test.
- Create `backend/scripts/refresh-status-labels.js` — CLI to refresh all active boards.
- Modify `backend/scripts/auto-map-new-columns.js` — refresh labels after mapping.
- Modify `backend/routes/monday.js` — add `GET /status-labels`.
- Modify `js/api-server.js` — add `getStatusLabels(section)`.
- Modify `js/pipeline.js` — load board-label cache; `statusSelect` + stage pill resolve from it.

---

## Task 1: Migration — add `labels_json`

**Files:**
- Create: `backend/db/migrations/085_monday_column_labels.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 085_monday_column_labels.sql
-- Cache each status column's live Monday labels so dropdowns can be per-board.
ALTER TABLE monday_column_mappings
  ADD COLUMN labels_json TEXT NULL AFTER monday_column_title;
```

- [ ] **Step 2: Sanity-check it's the next free number**

Run: `ls backend/db/migrations/ | sort | tail -3`
Expected: `085_monday_column_labels.sql` is the highest. (084 exists; 083 is duplicated pre-existing — do not reuse.)

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/085_monday_column_labels.sql
git commit -m "Monday: migration 085 — labels_json on monday_column_mappings"
```

(Migration applies on next backend boot via the existing runner; verified live in Task 7.)

---

## Task 2: `statusLabels` service

**Files:**
- Create: `backend/services/monday/statusLabels.js`
- Test: `backend/tests/services/statusLabels.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/services/statusLabels.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const clientPath = require.resolve('../../services/monday/client');
const servicePath = require.resolve('../../services/monday/statusLabels');
const originalDb = require.cache[dbPath];
const originalClient = require.cache[clientPath];

const db = { query: vi.fn() };
const client = { mondayQuery: vi.fn() };

function loadService() {
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: client };
  delete require.cache[servicePath];
  return require('../../services/monday/statusLabels');
}

describe('statusLabels service', () => {
  beforeEach(() => { db.query.mockReset(); client.mondayQuery.mockReset(); });
  afterEach(() => {
    delete require.cache[servicePath];
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
    if (originalClient) require.cache[clientPath] = originalClient; else delete require.cache[clientPath];
  });

  it('parseLabels handles object and array shapes and drops empties', () => {
    const { parseLabels } = loadService();
    expect(parseLabels('{"labels":{"0":"","1":"Done","2":"NA"}}')).toEqual(['Done', 'NA']);
    expect(parseLabels('{"labels":[{"name":"A"},{"name":"B"}]}')).toEqual(['A', 'B']);
    expect(parseLabels('not json')).toEqual([]);
  });

  it('getStatusLabelsBySection groups labels by board then field', async () => {
    const { getStatusLabelsBySection } = loadService();
    db.query.mockResolvedValueOnce([[
      { board_id: '1', pipeline_field: 'wvoes', labels_json: '["Please Order","Done"]' },
      { board_id: '1', pipeline_field: 'vvoes', labels_json: '["Needed","Done","NA"]' },
      { board_id: '2', pipeline_field: 'wvoes', labels_json: '["Requested"]' },
      { board_id: '2', pipeline_field: 'stage', labels_json: '[]' },
    ]]);
    const out = await getStatusLabelsBySection('pipeline');
    expect(out).toEqual({
      '1': { wvoes: ['Please Order', 'Done'], vvoes: ['Needed', 'Done', 'NA'] },
      '2': { wvoes: ['Requested'] },
    });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('labels_json IS NOT NULL'), ['pipeline']);
  });

  it('refreshStatusLabels writes parsed labels for status columns only', async () => {
    const { refreshStatusLabels } = loadService();
    client.mondayQuery.mockResolvedValueOnce({ boards: [{ columns: [
      { id: 'status69', type: 'status', settings_str: '{"labels":{"0":"Please Order","1":"Done"}}' },
      { id: 'text9', type: 'text', settings_str: '{}' },
    ] }] });
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const n = await refreshStatusLabels('tok', '1');
    expect(n).toBe(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE monday_column_mappings SET labels_json'),
      ['["Please Order","Done"]', '1', 'status69']
    );
    expect(db.query).toHaveBeenCalledTimes(1); // text column skipped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/services/statusLabels.test.js`
Expected: FAIL — cannot find module `../../services/monday/statusLabels`.

- [ ] **Step 3: Implement the service**

```js
// backend/services/monday/statusLabels.js
// Cache + read per-board Monday status labels (column settings_str -> labels_json).
const db = require('../../db/connection');
const { mondayQuery } = require('./client');

function parseLabels(settingsStr) {
  try {
    const s = JSON.parse(settingsStr || '{}');
    if (!s.labels) return [];
    const arr = Array.isArray(s.labels)
      ? s.labels.map(l => (l && l.name != null ? l.name : String(l)))
      : Object.values(s.labels);
    return arr.filter(l => l && String(l).trim());
  } catch { return []; }
}

// Pull a board's live status-column labels and cache into labels_json.
async function refreshStatusLabels(token, boardId) {
  const data = await mondayQuery(token,
    `query { boards(ids: [${boardId}]) { columns { id type settings_str } } }`);
  const cols = (data.boards && data.boards[0] && data.boards[0].columns) || [];
  let updated = 0;
  for (const c of cols) {
    if (c.type !== 'status') continue;
    const labels = parseLabels(c.settings_str);
    const [res] = await db.query(
      'UPDATE monday_column_mappings SET labels_json = ? WHERE board_id = ? AND monday_column_id = ?',
      [JSON.stringify(labels), String(boardId), c.id]
    );
    if (res && res.affectedRows) updated++;
  }
  return updated;
}

// { board_id: { pipeline_field: [labels] } } for active boards in a section.
async function getStatusLabelsBySection(section) {
  const [rows] = await db.query(
    `SELECT m.board_id, m.pipeline_field, m.labels_json
       FROM monday_column_mappings m
       JOIN monday_boards b ON b.board_id = m.board_id
      WHERE b.is_active = 1 AND b.target_section = ? AND m.labels_json IS NOT NULL`,
    [section]
  );
  const out = {};
  for (const r of rows) {
    let labels;
    try { labels = JSON.parse(r.labels_json); } catch { labels = []; }
    if (!Array.isArray(labels) || labels.length === 0) continue;
    (out[r.board_id] = out[r.board_id] || {})[r.pipeline_field] = labels;
  }
  return out;
}

module.exports = { refreshStatusLabels, getStatusLabelsBySection, parseLabels };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/services/statusLabels.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/monday/statusLabels.js backend/tests/services/statusLabels.test.js
git commit -m "Monday: statusLabels service (capture + read per-board labels)"
```

---

## Task 3: `GET /monday/status-labels` route

**Files:**
- Modify: `backend/routes/monday.js` (add route + import near the other GET routes, e.g. after `/view-config`)
- Test: `backend/tests/routes/monday-status-labels.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/routes/monday-status-labels.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../db/connection');
const clientPath = require.resolve('../../services/monday/client');
const routePath = require.resolve('../../routes/monday');
const originalDb = require.cache[dbPath];
const originalClient = require.cache[clientPath];

const db = { query: vi.fn(), getConnection: vi.fn() };
const client = { mondayQuery: vi.fn() };

describe('GET /monday/status-labels', () => {
  let app;
  beforeEach(() => {
    db.query.mockReset();
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: client };
    delete require.cache[routePath];
    const mondayRoutes = require('../../routes/monday');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { db: { id: 10, role: 'admin' }, groups: ['admin'] }; next(); });
    app.use('/api/monday', mondayRoutes);
  });
  afterEach(() => {
    delete require.cache[routePath];
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
    if (originalClient) require.cache[clientPath] = originalClient; else delete require.cache[clientPath];
  });

  it('returns labels grouped by board then field', async () => {
    db.query.mockResolvedValueOnce([[
      { board_id: '1', pipeline_field: 'wvoes', labels_json: '["Please Order","Done"]' },
    ]]);
    const res = await makeRequest(app, '/api/monday/status-labels?section=pipeline');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ '1': { wvoes: ['Please Order', 'Done'] } });
  });
});

function makeRequest(app, path) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      fetch(`http://127.0.0.1:${server.address().port}${path}`)
        .then(async (res) => { const body = await res.text(); server.close(); resolve({ status: res.status, body }); });
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/routes/monday-status-labels.test.js`
Expected: FAIL — 404 (route not defined) so `res.status` is 404, not 200.

- [ ] **Step 3: Add the import and route to `backend/routes/monday.js`**

Add near the top with the other service requires:

```js
const { getStatusLabelsBySection } = require('../services/monday/statusLabels');
```

Add this route immediately after the `GET /view-config` handler:

```js
// ── GET /status-labels — per-board live Monday status labels (cached) ──
// Query: ?section=pipeline|funded_loans|pre_approvals (default pipeline)
router.get('/status-labels', async (req, res, next) => {
  try {
    const validSections = ['pipeline', 'funded_loans', 'pre_approvals'];
    const section = validSections.includes(req.query.section) ? req.query.section : 'pipeline';
    const labels = await getStatusLabelsBySection(section);
    res.json(labels);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/routes/monday-status-labels.test.js`
Expected: PASS. If the route module fails to load due to an unmocked dependency, add that module to the `require.cache` mocks (mirror `client`); do not change source.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/monday.js backend/tests/routes/monday-status-labels.test.js
git commit -m "Monday: GET /status-labels route (per-board cached labels)"
```

---

## Task 4: refresh script + auto-map hook

**Files:**
- Create: `backend/scripts/refresh-status-labels.js`
- Modify: `backend/scripts/auto-map-new-columns.js` (refresh after mapping)

- [ ] **Step 1: Write the refresh script**

```js
// backend/scripts/refresh-status-labels.js
// Refresh cached Monday status labels (labels_json) for every active board.
//   node backend/scripts/refresh-status-labels.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db/connection');
const { getMondayToken } = require('../services/monday/sync');
const { refreshStatusLabels } = require('../services/monday/statusLabels');

(async () => {
  try {
    const token = await getMondayToken();
    if (!token) { console.log('No Monday token.'); process.exit(1); }
    const [boards] = await db.query('SELECT board_id, board_name FROM monday_boards WHERE is_active = 1');
    for (const b of boards) {
      const n = await refreshStatusLabels(token, b.board_id);
      console.log(`${b.board_name} (${b.board_id}): refreshed ${n} status columns`);
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
```

- [ ] **Step 2: Hook refresh into `auto-map-new-columns.js`**

At the very end of the `try` block, just before `console.log(\`\\nDone! Added ${totalAdded}...\`)`, add a labels refresh so a remap also caches labels:

```js
    // Refresh cached status labels for all boards we just (re)mapped
    try {
      const { refreshStatusLabels } = require('../services/monday/statusLabels');
      for (const b of boards) await refreshStatusLabels(token, b.board_id);
      console.log('Refreshed status labels for all active boards.');
    } catch (e) { console.error('Label refresh failed:', e.message); }
```

- [ ] **Step 3: Verify both files parse**

Run: `node --check backend/scripts/refresh-status-labels.js && node --check backend/scripts/auto-map-new-columns.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/refresh-status-labels.js backend/scripts/auto-map-new-columns.js
git commit -m "Monday: refresh-status-labels script + refresh on auto-map"
```

---

## Task 5: frontend API client

**Files:**
- Modify: `js/api-server.js` (add next to `getMondayViewConfig` / `getMondayUpdates`-style methods)

- [ ] **Step 1: Add the method**

```js
    getStatusLabels(section = 'pipeline') {
        return this.get('/monday/status-labels?section=' + encodeURIComponent(section));
    },
```

- [ ] **Step 2: Verify parse**

Run: `node --check js/api-server.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add js/api-server.js
git commit -m "Pipeline: ServerAPI.getStatusLabels client method"
```

---

## Task 6: dynamic dropdowns in `js/pipeline.js`

**Files:**
- Modify: `js/pipeline.js` — label cache load; `statusSelect` + stage-pill option resolution.

- [ ] **Step 1: Add a board-label cache + loader**

Add a property in the Pipeline object near `STATUS_OPTIONS`:

```js
  _statusLabelsByBoard: null,
```

Add a loader method (place near `loadConfig`):

```js
  async _loadStatusLabels() {
    try {
      this._statusLabelsByBoard = await ServerAPI.getStatusLabels('pipeline');
    } catch (e) {
      this._statusLabelsByBoard = null; // fall back to STATUS_OPTIONS
    }
  },
```

Call it once during initial load. In `loadConfig()` (which already `Promise.all`s config + prefs), add `this._loadStatusLabels()` to that `Promise.all` so it loads in parallel:

```js
      const [config, prefs] = await Promise.all([
        ServerAPI.getMondayViewConfig(),
        API._loadDisplayPrefs(),
        this._loadStatusLabels(),
      ]);
```

(Order preserved — the third promise's result is ignored; it populates `this._statusLabelsByBoard`.)

- [ ] **Step 2: Resolve options from the loan's board in `statusSelect`**

In `statusSelect(field, label, currentVal)`, replace the first line:

```js
      const presets = this.STATUS_OPTIONS[field] || [];
```

with a board-aware lookup (`item` is in scope — `statusSelect` is defined inside the detail render where `item` exists):

```js
      const boardLabels = this._statusLabelsByBoard && item.source_board_id
        ? this._statusLabelsByBoard[item.source_board_id] : null;
      const presets = (boardLabels && boardLabels[field]) || this.STATUS_OPTIONS[field] || [];
```

- [ ] **Step 3: Resolve the stage pill the same way**

The stage pill (just below `statusSelect`) sets `const stagePresets = this.STATUS_OPTIONS.stage || [];`. Replace with:

```js
    const _bl = this._statusLabelsByBoard && item.source_board_id ? this._statusLabelsByBoard[item.source_board_id] : null;
    const stagePresets = (_bl && _bl.stage) || this.STATUS_OPTIONS.stage || [];
```

- [ ] **Step 4: Verify `source_board_id` reaches the row**

Run: `rg -n "source_board_id" backend/routes/pipeline.js | head`
Expected: pipeline GET returns `SELECT * FROM pipeline` (so `source_board_id` is included). If a column projection is used instead, add `source_board_id` to it. No code change expected.

- [ ] **Step 5: Verify parse**

Run: `node --check js/pipeline.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add js/pipeline.js
git commit -m "Pipeline: status dropdowns use per-board live Monday labels (fallback STATUS_OPTIONS)"
```

---

## Task 7: deploy + live verification

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npx vitest run`
Expected: all pass (new service + route tests included).

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Deploy backend (runs migration 085, ships service/route/script) + frontend**

Run: `./deploy.sh --backend`
Expected: `EXIT=0`, `Backend deployed and restarted`, no `divergent`/`error` lines. (Migration 085 applies on PM2 restart.)

- [ ] **Step 4: Populate labels on the box**

Run: `ssh -i /Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem ubuntu@52.203.186.217 'cd msfg-backend && node backend/scripts/refresh-status-labels.js'`
Expected: per-board lines like `Ashley Active Pipeline (3946783498): refreshed N status columns` with N>0.

- [ ] **Step 5: Verify the endpoint returns per-board labels**

Run: `ssh -i /Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem ubuntu@52.203.186.217 'cd msfg-backend && node backend/scripts/diagnose-wvoe-monday.js 2>&1 | grep -A2 mappings'`
Expected: `wvoes`/`vvoes` still mapped (sanity), and a follow-up DB check shows `labels_json` populated.

- [ ] **Step 6: Browser smoke test**

Hard-refresh the dashboard. Open a loan on the **Ashley** board and one on the **Kim** board; confirm each status dropdown (e.g. `appraisal_status`, `stage`) shows that board's labels (Ashley ~40 appraisal options, Kim 3). Change WVOE → confirm it still syncs to Monday. Confirm a loan with no board labels falls back to the old options.

---

## Notes for the executor
- Frontend has no unit harness; Tasks 5–6 verify via `node --check` + the browser smoke test (Task 7 Step 6) per project convention.
- Do NOT reintroduce the delete-all behavior in `POST /monday/mappings` (already made non-destructive).
- `statusSelect` already injects a custom `<option>` for an out-of-set `currentVal`, so legacy values keep displaying.
