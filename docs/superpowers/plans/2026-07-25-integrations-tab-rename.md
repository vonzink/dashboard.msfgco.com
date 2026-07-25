# Integrations Tab Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the admin panel's "Monday.com" tab to "Integrations" and restructure the panel so Monday.com is one collapsible-free group among several, with an empty Suite group ready for the Suite sync work.

**Architecture:** Pure frontend. The tab's `data-tab` value changes from `monday` to `integrations`, the panel id follows, and the six existing `.monday-section` blocks get wrapped in an `.integration-group` section without being re-indented (so the diff stays reviewable). A hash shim keeps the old `#monday` deep link working. No backend, no API, no database.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework, no build step beyond `build.js` content-hashing), FontAwesome icons, `data-theme` light/dark theming.

**Source spec:** `docs/superpowers/specs/2026-07-25-suite-integrations-preapprovals-design.md` §6

---

## Testing note — read before starting

**There is no frontend test harness in this repo.** `vitest` is installed only under `backend/`
(`backend/package.json` → `"test": "vitest run"`), and there are no `*.test.js` files outside
`backend/`. Adding a DOM test harness for a tab rename is not justified.

So the verification steps in this plan are **browser-driven and concrete**: start the preview,
read the accessibility tree, check the console, click the tab, assert on what is actually
rendered. Every task has a verification step with an exact expected result. Do not skip them
and do not substitute "looks fine".

**Do not bump the `?v=` query string** on the `<script>` tag at
`Calculators/Admin Settings/admin-settings.html:1231`. `build.js` content-hashes everything
under `js/**` and `css/**` and rewrites the HTML references at deploy time, so the manual
cache-buster is obsolete for this file. Changing it adds diff noise and nothing else.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `Calculators/Admin Settings/admin-settings.html` | Modify | Tab button label/`data-tab`; panel id; group wrappers |
| `Calculators/Admin Settings/admin-styles.css` | Modify | New `.integration-group*` styles |
| `js/admin/admin-settings.js` | Modify | Tab dispatch, hash deep-link + shim, `loadIntegrationsTab()` |
| `js/action-dispatcher.js` | Modify | Update the `#monday` deep link to `#integrations` |

Four files, four tasks, one commit each. Tasks 1–4 are ordered so the page is never broken
between commits: the tab keeps working after every single task.

---

### Task 1: Add the `.integration-group` styles

Styles come first so the markup in Task 2 has something to land on. Adding unused CSS
cannot break the page, which makes this the safest possible first commit.

**Files:**
- Modify: `Calculators/Admin Settings/admin-styles.css` (append after the existing
  `.monday-section` block, which ends at line 378)

- [ ] **Step 1: Append the group styles**

Insert immediately after the `.monday-section:last-child` rule (currently line 374–378) and
before the `/* ── Monday Tab: Sticky Header Strip … ── */` comment on line 380:

```css
/* ── Integrations Tab: per-service groups ── */
/* NOTE: never add `overflow`, `transform`, `filter`, or `contain` to
   .integration-group — .monday-header-strip inside it is `position: sticky`,
   and any of those properties would create a new containing block and break it. */
.integration-group {
  display: block;
  margin-bottom: 32px;
}

.integration-group:last-child {
  margin-bottom: 0;
}

.integration-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--border-color, #e5e5e5);
}

.integration-group-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #104547;
}

.integration-group-title i {
  margin-right: 6px;
}

.integration-group-status {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 999px;
  background: #f1f1f1;
  color: #666;
  white-space: nowrap;
}

.integration-group-status.is-active {
  background: #e8f5e9;
  color: #2e7d32;
}

.integration-group-empty {
  font-size: 13px;
  color: #666;
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--border-color, #ddd);
  border-radius: 8px;
}

.integration-group-empty code {
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 2: Verify the CSS parses**

Run:

```bash
node -e "const c=require('fs').readFileSync('Calculators/Admin Settings/admin-styles.css','utf8');const o=(c.match(/{/g)||[]).length,x=(c.match(/}/g)||[]).length;console.log('open',o,'close',x, o===x?'BALANCED':'UNBALANCED');process.exit(o===x?0:1)"
```

Expected: `open <n> close <n> BALANCED` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add "Calculators/Admin Settings/admin-styles.css"
git commit -m "style(admin): add .integration-group styles for the Integrations tab"
```

---

### Task 2: Rename the tab button and panel, wrap the Monday sections

**Files:**
- Modify: `Calculators/Admin Settings/admin-settings.html:40-42` (tab button)
- Modify: `Calculators/Admin Settings/admin-settings.html:1038-1041` (panel open)
- Modify: `Calculators/Admin Settings/admin-settings.html:1229` (panel close)

> **After this task the tab will not respond to clicks.** The JS still dispatches on
> `data-tab="monday"` and looks up `panel-monday`. Task 3 fixes that. This is expected and
> is why Task 2 and Task 3 are adjacent — do not stop between them.

- [ ] **Step 1: Rename the tab button**

Replace lines 40–42:

```html
    <button class="admin-tab" data-tab="monday">
      <i class="fas fa-sync-alt"></i> Monday.com
    </button>
```

with:

```html
    <button class="admin-tab" data-tab="integrations">
      <i class="fas fa-plug"></i> Integrations
    </button>
```

- [ ] **Step 2: Rename the panel and open the Monday group**

Replace lines 1038–1041:

```html
  <!-- ================================================
       TAB: Monday.com Integration
  ================================================ -->
  <div class="admin-panel" id="panel-monday">
```

with:

```html
  <!-- ================================================
       TAB: Integrations
  ================================================ -->
  <div class="admin-panel" id="panel-integrations">

  <!-- ── Monday.com ────────────────────────────────── -->
  <section class="integration-group" id="integrationMonday">
    <div class="integration-group-head">
      <h3 class="integration-group-title"><i class="fas fa-table"></i> Monday.com</h3>
      <span class="integration-group-status is-active">Active</span>
    </div>
```

**Do not re-indent the existing content on lines 1043–1228.** HTML does not care about
indentation, and re-indenting 186 lines would bury this small change in a diff nobody can
review. The wrapper opens above them and closes below them; that is the whole change.

- [ ] **Step 3: Close the Monday group and add the Suite group**

Replace line 1229, which is the `</div>` closing `#panel-monday`:

```html
  </div>
```

with:

```html
  </section>

  <!-- ── Suite ─────────────────────────────────────── -->
  <section class="integration-group" id="integrationSuite">
    <div class="integration-group-head">
      <h3 class="integration-group-title"><i class="fas fa-landmark"></i> Suite</h3>
      <span class="integration-group-status" id="suiteGroupStatus">Not configured</span>
    </div>
    <p class="integration-group-empty">
      Suite (<code>los.msfgco.com</code>) will supply Pre-Approvals for enabled loan
      officers. Connection settings and per-LO toggles arrive with the Suite sync.
    </p>
  </section>

  </div>
```

- [ ] **Step 4: Verify the tag structure is still balanced**

Run:

```bash
node -e "
const h=require('fs').readFileSync('Calculators/Admin Settings/admin-settings.html','utf8');
const div=(h.match(/<div\b/g)||[]).length, cdiv=(h.match(/<\/div>/g)||[]).length;
const sec=(h.match(/<section\b/g)||[]).length, csec=(h.match(/<\/section>/g)||[]).length;
console.log('div',div,cdiv, 'section',sec,csec);
console.log('panel-monday remaining:', (h.match(/panel-monday/g)||[]).length);
console.log('panel-integrations:', (h.match(/panel-integrations/g)||[]).length);
const ok = div===cdiv && sec===csec && !/panel-monday/.test(h) && /panel-integrations/.test(h);
console.log(ok?'OK':'MISMATCH'); process.exit(ok?0:1)"
```

Expected: `div` counts equal, `section` counts equal, `panel-monday remaining: 0`,
`panel-integrations: 1`, `OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add "Calculators/Admin Settings/admin-settings.html"
git commit -m "feat(admin): rename Monday.com tab to Integrations, group by service"
```

---

### Task 3: Point the JS at the new tab name and add the hash shim

**Files:**
- Modify: `js/admin/admin-settings.js:74` (tab dispatch)
- Modify: `js/admin/admin-settings.js:3039` (add `loadIntegrationsTab`)
- Modify: `js/admin/admin-settings.js:3896-3907` (hash deep link + shim)

- [ ] **Step 1: Update the tab-switch dispatch**

At line 74, replace:

```js
      if (tabName === 'monday') loadMondayTab();
```

with:

```js
      if (tabName === 'integrations') loadIntegrationsTab();
```

- [ ] **Step 2: Add `loadIntegrationsTab`**

The Monday block starts at line 3032 with the banner comment and `loadMondayTab()` at 3039.
Change the banner and add the new entry point immediately above `loadMondayTab`.

Replace:

```js
     MONDAY.COM TAB
```

with:

```js
     INTEGRATIONS TAB — MONDAY.COM SECTION
```

Then insert this function immediately before the existing `function loadMondayTab() {`
on line 3039:

```js
  /**
   * Entry point for the Integrations tab. Each integration owns a loader;
   * add new ones here as they are built (Suite lands with the Suite sync).
   */
  function loadIntegrationsTab() {
    loadMondayTab();
  }

```

Leave every `monday*` identifier inside the block alone. They are genuinely Monday-specific
and renaming them is churn with no benefit.

- [ ] **Step 3: Update the hash deep link and add the back-compat shim**

At lines 3895–3898, replace:

```js
      // Hash-based deep linking
      var hash = window.location.hash;
      if (hash === '#monday') {
        document.querySelector('[data-tab="monday"]').click();
```

with:

```js
      // Hash-based deep linking. '#monday' is the pre-rename hash — keep honouring it
      // so existing bookmarks and any stale cached HTML still land on the right tab.
      var hash = window.location.hash;
      if (hash === '#integrations' || hash === '#monday') {
        document.querySelector('[data-tab="integrations"]').click();
```

- [ ] **Step 4: Verify the file parses and the old references are gone**

Run:

```bash
node --check js/admin/admin-settings.js && echo "SYNTAX OK"
grep -n "data-tab=\"monday\"\|tabName === 'monday'\|panel-monday" js/admin/admin-settings.js && echo "STALE REFS FOUND" || echo "NO STALE REFS"
grep -c "loadIntegrationsTab" js/admin/admin-settings.js
```

Expected: `SYNTAX OK`; `NO STALE REFS`; `loadIntegrationsTab` count is `2` (the definition
and the call site).

- [ ] **Step 5: Commit**

```bash
git add js/admin/admin-settings.js
git commit -m "feat(admin): dispatch Integrations tab, keep #monday hash working"
```

---

### Task 4: Update the deep link in the action dispatcher

**Files:**
- Modify: `js/action-dispatcher.js:107`

- [ ] **Step 1: Update the hash**

At line 107, replace:

```js
      Utils.openPopup('Calculators/Admin Settings/admin-settings.html#monday', 'MSFGAdminSettings'),
```

with:

```js
      Utils.openPopup('Calculators/Admin Settings/admin-settings.html#integrations', 'MSFGAdminSettings'),
```

Leave line 32 (`#investors`) and line 85 (no hash) alone.

- [ ] **Step 2: Verify**

```bash
node --check js/action-dispatcher.js && echo "SYNTAX OK"
grep -n "admin-settings.html#" js/action-dispatcher.js
```

Expected: `SYNTAX OK`, and exactly two hash links — `#investors` and `#integrations`. No
`#monday`.

- [ ] **Step 3: Check for unrelated in-flight changes before staging**

`js/action-dispatcher.js` had uncommitted changes from unrelated announcements work when this
plan was written. Interactive staging (`git add -p`) is not available in this harness, so
check what is actually in the diff first:

```bash
git diff --stat js/action-dispatcher.js
git diff -U0 js/action-dispatcher.js | grep -c '^@@'
```

Expected if the announcements work has since been committed: exactly `1` hunk — the
`#integrations` change. Proceed to Step 4.

**If the count is greater than 1**, the file still carries unrelated work. Stop and report
the other hunks to the user rather than committing them. Do not `git add` the whole file, and
do not attempt to revert or stash someone else's in-flight work.

- [ ] **Step 4: Commit**

```bash
git add js/action-dispatcher.js
git commit -m "fix(admin): point the integrations deep link at #integrations"
```

---

### Task 5: Verify in the browser

No code changes. This is the real test for this plan.

- [ ] **Step 1: Start the preview**

Use the `preview_start` tool with the dev-server entry from `.claude/launch.json`. If no
entry exists, create one that serves the repo root as a static site — the admin page is
plain HTML/CSS/JS and needs no bundler. Do **not** run a server with `Bash`.

The admin page requires an authenticated admin session: `admin-settings.js` calls `/me` on
load and replaces the body with "Admin access required" otherwise. If the preview has no
session, verification falls back to Step 5 only.

- [ ] **Step 2: Open the tab by deep link and confirm the rename**

Navigate to `Calculators/Admin Settings/admin-settings.html#integrations`, then use
`read_page`.

Expected: a tab button reading **Integrations**; no tab reading "Monday.com"; the
`#panel-integrations` panel is active; a **Monday.com** group heading with an "Active" pill;
a **Suite** group heading with a "Not configured" pill and the dashed placeholder paragraph.

- [ ] **Step 3: Confirm the Monday sections still function**

Still inside the tab, confirm via `read_page` that all six Monday sections rendered: API
Token, Boards, Column Mappings, Display Configuration, Webhooks, Sync Controls — and that
"API Token" shows a real status string rather than the initial `Checking...`, which proves
`loadMondayTab()` ran through `loadIntegrationsTab()`.

Then `read_console_messages`. Expected: no errors. A `TypeError` mentioning
`panel-monday` or `Cannot read properties of null` means Task 2 and Task 3 are out of sync.

- [ ] **Step 4: Confirm the `#monday` shim**

Navigate to the same page with `#monday`. Expected: the Integrations tab activates exactly
as in Step 2. This is the regression guard for existing bookmarks.

- [ ] **Step 5: Confirm the sticky header and both themes**

Scroll the panel down and screenshot. Expected: the Monday setup-flow strip
(`.monday-header-strip`, `position: sticky`) stays pinned at the top of the scroll area. If
it scrolls away, something added `overflow` or `transform` to `.integration-group` — see the
warning comment in Task 1.

Then `resize_window` with `colorScheme: 'dark'` and screenshot again. Expected: the group
headings, pills, and dashed placeholder are all legible. The `#104547` heading colour is
inherited from the existing `h3` convention in this file, so it should match the Monday
section headings exactly — if those are legible in dark mode, these are too.

- [ ] **Step 6: Report**

Attach the light and dark screenshots. State plainly whether every expectation above was met.
If any was not, fix it and re-verify rather than reporting a partial pass.

---

## Deploy

Not part of this plan — deploying is the user's call. When they ask:

```bash
./deploy.sh
```

Frontend only. `build.js` content-hashes the changed `js/**` and `css/**` files and rewrites
the HTML references, so no manual cache-buster is needed. Hard-refresh (Cmd+Shift+R) after.

---

## Self-Review

**Spec coverage (§6 of the design doc):**

| §6 requirement | Task |
|---|---|
| `data-tab="monday"` → `integrations`, label → Integrations, icon → `fa-plug` | 2 |
| `id="panel-monday"` → `panel-integrations` | 2 |
| Wrap the six `.monday-section` blocks under a Monday sub-heading | 2 |
| Add an empty Suite sub-heading | 2 |
| Setup-flow strip stays inside the Monday sub-section | 2 (it sits at 1044, inside the wrapper) |
| `<title>` unchanged | Not a task — no change needed, correct per spec |
| `admin-settings.js:74` dispatch → `loadIntegrationsTab()` | 3 |
| Banner comment renamed, `monday*` identifiers kept | 3 |
| `action-dispatcher.js:107` → `#integrations` | 4 |
| `#monday` back-compat shim | 3 |
| Verification: tab label, Monday sections load, `#monday` resolves | 5 |

No gaps.

**Placeholder scan:** every code step contains the literal before/after text. Every
verification step has a runnable command and a stated expected result. No "TBD", no "add
error handling", no "similar to Task N".

**Type/name consistency:** `loadIntegrationsTab` is defined in Task 3 Step 2 and called in
Task 3 Step 1 — same spelling, and Step 4 asserts the count is exactly 2. `panel-integrations`
appears in Task 2 (markup) and Task 3 (nothing looks it up by id — the generic
`'panel-' + tab.dataset.tab` lookup at line 65 resolves it from `data-tab="integrations"`,
which is why both must change in the same pair of tasks). `.integration-group`,
`.integration-group-head`, `.integration-group-title`, `.integration-group-status`,
`.integration-group-empty`, and `.is-active` are all defined in Task 1 and every one is used
in Task 2. `#suiteGroupStatus` is markup-only for now; the Suite sync plan wires it.

**One deliberate omission:** no unit tests, because this repo has no frontend test harness
(see the testing note at the top). Task 5 is the compensating verification and is not
optional.
