# Path B (esbuild bundling) — prep & load-order analysis

**Date:** 2026-06-01 · **Status:** Prep — **Path B ON HOLD** (decision 2026-06-01). Revisit as its own focused project.
**Purpose:** De-risk Path B by mapping the load surface, the global-namespace contract, the hard ordering constraints, and the landmines — so B is "wire up a verified config," not "investigate + implement."

> **Current state (2026-06-01).** Path A (content-hash fingerprinting) is **live in prod**. It shipped one regression — it broke the **scanner ES-module island** (`js/scanner-*.js`: 5 ES modules + a Web Worker) because hash-renaming can't rewrite the relative `import`/`new Worker` references that live in JS. **Hotfixed** by carving that island out of hashing (`build.js` → `isUnbundledModule()`), so it passes through un-hashed and keeps its `?v=` versioning (commit `8e237bf`, deployed, verified). **Path B was then put on hold** — A already solved the actual cache-busting bug, leaving B's value as fewer-requests + minification only (no tree-shaking without an ESM migration). When B is picked up: the scanner is the highest-value first target (esbuild bundles its module graph + worker properly and **removes the `isUnbundledModule` carve-out**); the global-script 39→~3 bundling is optional optimization.

---

## TL;DR

- **Path A already fixes the cache-busting bug.** `build.js` + `dist/` (content-hashed files) + `manifest.json` exist and work. So **B's residual value is narrower than the audit framed it**: fewer HTTP requests (index.html: **39 scripts → ~3**) + minification + source maps. **Not** tree-shaking/code-splitting — that's impossible here without an ESM migration (see below).
- **Recommended B approach: ordered concatenation + minify per page — NOT esbuild module bundling.** The codebase is 100% global-namespace scripts (`window.X = X`, zero `import`/`export`). Feeding those to esbuild's module bundler wraps each file in module scope and silently breaks any implicit (non-`window`) cross-file symbol. Concatenating raw file contents in load order, then minifying the concatenation, is **byte-for-byte equivalent to today's sequential `<script>` execution** — anything that works today works bundled.
- **Two landmines must be fixed regardless of B** (they already affect A's fingerprinting): the hardcoded Web Worker path and the dynamic `import()`/injected-script in the scanner.

---

## What A already built (B layers on this)

`build.js` (read-only summary, A owns it — do not edit until A lands):
1. Walks the tree; hashes every `js/**` + `css/**` file → `dist/<base>.<hash>.<ext>`; records `manifest.json` (`"js/utils.js" → "js/utils.<hash>.js"`).
2. Rewrites every HTML `src=`/`href=` for `js|css` paths via the manifest. Regex already handles **relative, absolute (`/js/…`), and `?v=…`** forms.
3. Passthrough copies `vendor/`, `assets/`, `Calculators/`, root statics. **`Calculators/` JS is unmanaged** (keeps its own `?v=`).
4. Wipes `dist/` each run so deletes propagate. `deploy.sh` syncs `dist/` (per A).

**B's integration point:** replace step 1's *per-file hash* with *per-page bundle*, and replace step 2's *1:1 path swap* with *collapse N `<script>` tags → 1 bundle tag*. Everything else (manifest, passthrough, HTML walk, deploy) is reused.

---

## Load surface (entry points)

| Page | `<script src>` | B target |
|---|---|---|
| `index.html` | **39** | main-app bundle (the prize) |
| `Calculators/Company Calendar/calendar.html` | 9 | own bundle |
| `handbook.html` / `guidelines.html` / `announcements-history.html` | 4 each | shared **core** (auth-gate, config, api-server, utils) |
| `Calculators/LendingPad/lendingpad.html` | 4 | own bundle |
| `processing.html` | 3 | core + `processing/processing.js` — **absolute `/js/` paths** |
| `scanner.html` | 2 | auth-gate + `scanner-main.js` — **worker landmine** |
| `mil-levy.html` | 1 | auth-gate only (skip/trivial) |
| `Calculators/FHA Calculator/*` , `Calculators/Admin Settings/admin-settings.html` | 1 each | trivial |
| `login.html`, `login-callback.html`, `auth-debug.html`, `renovation-loans-landing.html`, `Calculators/{Va Prequal, Time Calculator, File Browser}` | **0** | **skip entirely** |

Live order for each page is its current `<script src>` sequence — `index.html`'s 39 are the authoritative ordering (`app.js` even documents it in a header comment, with per-module dependency notes).

---

## The global-namespace reality (why module bundling is the wrong tool)

- **~40 `window.X` namespaces, each defined exactly once** (no collisions): `CONFIG`, `MSFG_CONFIG`, `Utils`, `ServerAPI`, `API`, `EventBus`, `Pipeline`, `PreApprovals`, `Investors`, `FundedLoans`, `GoalsManager`, `Announcements`, `Chat`, `ContentStudio`, `HRResources`, `Programs`, `ModalsManager`, `TableManager`, `ThemeManager`, `UserSettings`, `App`, the `Checklist*` family (7), etc. Pattern: `const X = {…}; window.X = X;` (or IIFE → `window.X = X`).
- Cross-module references resolve through those globals (bare `Utils.foo()` → `window.Utils`).
- **`App.init()` runs on `DOMContentLoaded`** (`app.js:402`). So module *definitions* only need to exist before then — which they always do with parser-inserted scripts. **Call-time order is tolerant**; only a handful of *define-time* reads are hard constraints (next section).
- **Zero `import`/`export` in the codebase.** esbuild therefore cannot build a real module graph → **no tree-shaking, no code-splitting** without first migrating to ESM (a separate, much larger project — the audit's deeper §3 work).
- **Consequence:** if you pass these files to esbuild as module entry points, it wraps each in module scope. Namespaces survive (they're on `window`), but any **implicit global** — a top-level `function foo(){}` or `var x` read cross-file *without* `window.` — silently becomes undefined. Auditing every such symbol is the slow, fragile path.
- **The fast, safe path: concatenate raw file contents in load order, then `esbuild.transform(minify:true)` the concatenation. `bundle: false`.** Identical shared-global-scope semantics to today's sequential scripts. You forfeit tree-shaking (already unavailable) and gain minification + one request.

---

## Hard ordering constraints (define-time / load-time)

Ordered concatenation preserves *all* of these for free — that's the point of choosing it. They matter most if B ever splits into multiple bundles.

1. **`auth-gate.js` MUST be first on every page.** Runs synchronously at load; redirects to `/login.html` when no JWT. Must remain the first executed code, and the bundle must not be `defer`/`async` in a way that delays it past first paint differently than today.
2. **Checklists mixin group, in this order:** `format → dialogs → templates → render → pinned → actions → checklists.js`. `checklists.js:365-371` runs `Object.assign(Checklists, window.ChecklistRender/Pinned/Actions/Templates)` **at load** (`if (window.X)`-guarded, so it degrades to a console.error rather than throwing — but the feature breaks). Keep all 7 in one bundle, this order.
3. **`api.js` after `pre-approvals.js` + `pipeline.js`** (orchestrator delegates to them).
4. **`config.js` → `utils.js`/`api-server.js` → feature modules → `app.js` LAST.** `app.js` orchestrates init.
5. Light pages share the **core 4**: `auth-gate, config, api-server, utils` (handbook/guidelines/announcements-history are exactly these).

---

## Landmines (must handle or it breaks)

1. **Hardcoded Web Worker path** — `scanner-main.js:572`: `new Worker('js/scanner-worker.js')`. The worker file gets content-hashed by A → this string no longer resolves → **404, scanner breaks**. Fix: either exclude `scanner-worker.js` from hashing (keep a stable path) **or** rewrite the string from the manifest at build time. Also grep `scanner-worker.js` for `importScripts(...)` — same problem one level down. **This already affects A's fingerprinting, not just B — fix it in A now.**
2. **Dynamic import + injected script** — `scanner-decoders.js`: `import(/* @vite-ignore */ pdfjsUrl)` and `createElement('script'); s.src = HEIC2ANY_URL`. Runtime/external URLs — must stay **external** (don't bundle the dynamic import; leave the CDN injection alone). The `@vite-ignore` comment shows prior bundler-awareness.
3. **Inline `<script>` blocks** — `index.html` (`footerYear`), `handbook.html`, `guidelines.html` each end with a small inline script that may read globals. They must stay inline and run **after** the bundle. The tag-collapse rewrite must not remove or reorder them.
4. **`processing.html` uses absolute `/js/` paths.** A's regex already handles `/?`; B's tag-collapse rewrite must too.
5. **`Calculators/` is unmanaged by A** (passthrough + own `?v=`). Decide for B: bundle **Company Calendar** (9 scripts — the only non-trivial one) or leave the whole subtree alone for v1.
6. **0-script pages** (login/login-callback/auth-debug/renovation + 3 calculators) — skip.
7. **Source maps.** Concatenated+minified global scripts are painful to debug. Emit `sourcemap: true` per bundle so stack traces map back to original files.

---

## Recommended esbuild strategy (concrete)

- Keep A's `build.js` skeleton (walk, manifest, passthrough, dist-wipe, HTML rewrite for unbundled assets).
- Add a `PAGE_BUNDLES` map: `{ 'index.html': [<39 ordered src paths>], 'Calculators/Company Calendar/calendar.html': [<9>], 'handbook.html': [<4 core>], … }`. Seed it from each page's current `<script src>` order (this doc's inventory).
- Per page bundle: read files in order → join → `esbuild.transform(joined, { loader:'js', minify:true, sourcemap:true })` (or `esbuild.build({ stdin, bundle:false, minify:true, sourcemap:true })`). Hash output → `dist/bundles/<page>.<hash>.js` (+ `.map`). Record in manifest.
- **HTML rewrite for bundled pages:** remove the page's `<script src="js/…">` tags, insert the bundle `<script>` at the position of the **first** removed tag (preserves auth-gate-first and keeps trailing inline scripts in place). Leave vendor (`/vendor/fontawesome/…`) and inline scripts untouched.
- **Optional win:** factor the shared **core** (`auth-gate, config, event-bus, action-dispatcher, api-server, utils, theme`) into one cached-across-pages bundle + a per-page feature bundle (2 tags instead of 1; auth-gate still first in core).
- `npm i -D esbuild`; add root `package.json` (A's plan already calls for one) with a `build` script; `deploy.sh` already runs `node build.js` — **no deploy change.**

---

## Verification checklist (per page, before shipping B)

- [ ] `auth-gate` still runs first and still redirects when logged out
- [ ] `App.init()` runs; each major namespace exists on `window` post-load
- [ ] `window.Checklists` has render/pinned/actions methods (Object.assign succeeded)
- [ ] Scanner: `scanner-worker.js` resolves (scan a doc), pdf.js + heic dynamic loads work
- [ ] `processing.html` (absolute paths) + Company Calendar (9 scripts) load clean
- [ ] Inline scripts (`footerYear`, etc.) still run
- [ ] DevTools: 0 console errors; network shows ~3 bundles, not 39; source maps resolve
- [ ] Login flow (0-script pages) untouched

---

## Coordination with the Path A agent

- **Do not start B implementation until A lands and is verified.** B rewrites `build.js` steps 1–2 and the per-page `<script>` blocks — the exact files A owns. Parallel editing = guaranteed 3-way merge on the most load-order-sensitive files.
- B **reuses** A's manifest + passthrough + deploy wiring; only *hash-per-file → bundle-per-page* and the *tag-collapse rewrite* are new.
- **Hand to A now (independent of B):** the scanner Worker path (#1) and dynamic-import (#2) landmines break fingerprinting too — A should fix them before declaring done.
