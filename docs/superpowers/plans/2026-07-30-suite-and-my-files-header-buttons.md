# Suite + My Files Header Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header's single **Alerts** button with two buttons — **Suite** (an external link to `https://suite.msfgco.com`) and **My Files** (a placeholder that will become the S3 file manager in Phase 5) — without orphaning the notifications feature that Alerts is currently the only entry point to.

**Architecture:** Pure frontend. Two files change: the header markup in `index.html` and one new action in `js/action-dispatcher.js`, plus the Ask AI corpus that documents these actions. No backend, no API, no database, no CSS. `My Files` deliberately ships as a `comingSoon()` toast in this phase because `Calculators/My Files/my-files.html` does not exist until Phase 5 — wiring it to `openPopup` now would open a 404.

**Tech Stack:** Vanilla HTML/JS (no framework), FontAwesome icons, the existing `[data-action]` global click dispatcher.

**Source spec:** `docs/superpowers/specs/2026-07-30-my-files-s3-storage-design.md` §5.5, Phase 1 of §8

---

## Read before starting

**Check the working tree first.** As of writing, `index.html` and `js/action-dispatcher.js`
both have uncommitted modifications from unrelated announcements work. This plan edits both.
Confirm those changes are committed, stashed, or explicitly safe to build on before Task 1.
Do not fold unrelated changes into these commits.

**There is no frontend test harness.** `vitest` exists only under `backend/`
(`backend/package.json` → `"test": "vitest run"`), and there are no `*.test.js` files outside
`backend/`. Adding a DOM harness for a two-button header change is not justified. Every task
below therefore ends with a concrete browser verification: what to click and what must
happen. Do not substitute "looks fine".

**Do not add or bump `?v=` query strings.** `build.js` content-hashes everything under
`js/**` and `css/**` and rewrites the HTML references at deploy time. Manual cache-busters on
those paths are obsolete and only add diff noise.

**Notifications must never become unreachable.** Task 2 adds the new entry point *before*
Task 3 removes the old one. Keep that order. Between commits there will briefly be two ways
to open the notifications modal, which is correct and intentional.

**Mobile is unaffected.** Verified: `open-notifications` appears only in `index.html`,
`js/action-dispatcher.js`, and `docs/ask-ai-corpus/site-links-and-actions.md`. Nothing under
`mobile/` references it, so the Capacitor shell needs no change.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `js/action-dispatcher.js` | Modify | New `open-my-files` action; `open-notifications` unchanged |
| `index.html` | Modify | Notifications item in the Tools dropdown; Alerts button replaced by Suite + My Files |
| `docs/ask-ai-corpus/site-links-and-actions.md` | Modify | Keep the Ask AI corpus truthful about header actions |

Three files, four tasks, one commit each. The page is fully functional after every task.

---

### Task 1: Register the `open-my-files` action

Additive only — a new key in the `ACTIONS` map cannot affect existing behaviour. Doing this
first means the button added in Task 3 has a handler the moment it exists, so there is never
a console warning from the dispatcher's unknown-action branch (`js/action-dispatcher.js:161-164`).

**Files:**
- Modify: `js/action-dispatcher.js`

- [ ] **Step 1: Add the action to the Tools section**

The `ACTIONS` map has a `// Tools` section starting at line 75. Insert `open-my-files`
immediately after the `open-logos-browser` entry (lines 90-91) and before `open-content-studio`:

```js
    'open-my-files': () => comingSoon('My Files'),
```

`comingSoon` is already defined at line 8 and is the established pattern for unbuilt features
(`open-401k`, `open-training`, `open-brand-guidelines` all use it).

Leave `open-notifications` at lines 14-15 exactly as it is. It is still needed — only its
entry point moves.

- [ ] **Step 2: Verify**

Open the dashboard. In the console, run:

```js
document.querySelector('[data-action="open-settings"]').dataset.action
```

That confirms the dispatcher is loaded. There is no visible change yet; the assertion for
this task is simply that the page still loads with **no new console errors or warnings**, and
that clicking Alerts, Settings, and Logos still opens their respective UIs.

- [ ] **Step 3: Commit**

```
feat(nav): register open-my-files action as a placeholder
```

---

### Task 2: Add Notifications to the Tools dropdown

The header's Alerts button is currently the **only** way to reach
`ModalsManager.showNotificationsModal()` (`js/modals.js:161`). This task gives it a permanent
home before Task 3 takes the button away.

The Tools dropdown (`index.html:286-313`) is the destination. Its top group is "Calculators",
followed by a divider and a standalone Processing item at line 298, then the "More.." submenu.
Notifications goes in as a sibling of Processing — a general utility rather than a calculator.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Insert the dropdown item**

Immediately after the Processing button on line 298 and before the `<div class="dropdown-submenu">`
that opens on line 300, insert:

```html
            <button type="button" class="dropdown-item" data-action="open-notifications"><i class="fas fa-bell"></i> Notifications</button>
```

Match the surrounding indentation (12 spaces). Reuse `fa-bell` — the same icon the header
button uses today — so the feature stays visually recognisable after it moves.

- [ ] **Step 2: Verify**

1. Reload the dashboard.
2. Click **Tools** in the main nav. The dropdown must show, in order: the three Calculators
   items, a divider, **Processing**, **Notifications**, then **More..**.
3. Click **Notifications**. The notifications modal must open, and its existing list must
   load (the modal calls `loadNotificationsList()` on open).
4. Close it. Click the header **Alerts** button. The same modal must open. Both entry points
   working simultaneously is the expected state at this point.
5. Console must be free of new errors.

- [ ] **Step 3: Commit**

```
feat(nav): add Notifications to the Tools dropdown
```

---

### Task 3: Replace the Alerts button with Suite and My Files

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Swap the button**

Replace lines 72-75 in full:

```html
          <button type="button" class="header-util-btn" data-action="open-notifications" title="Notifications">
            <i class="fas fa-bell"></i>
            <span class="util-label">Alerts</span>
          </button>
```

with:

```html
          <a href="https://suite.msfgco.com" target="_blank" rel="noopener" class="header-util-btn" title="Suite">
            <i class="fas fa-layer-group"></i>
            <span class="util-label">Suite</span>
          </a>
          <button type="button" class="header-util-btn" data-action="open-my-files" title="My Files">
            <i class="fas fa-folder"></i>
            <span class="util-label">My Files</span>
          </button>
```

Notes on the markup:

- Suite is an `<a>`, not a `<button>` — it matches the Applications link two lines above
  (line 68), which is the established pattern for external links in this toolbar. It needs no
  `data-action` and no dispatcher entry.
- `rel="noopener"` accompanies `target="_blank"`, consistent with every other external link in
  this file.
- `https://suite.msfgco.com` is the correct user-facing host. Do not use `los.msfgco.com` —
  that is the Suite *partner API*, per
  `docs/superpowers/specs/2026-07-25-suite-integrations-preapprovals-design.md`.
- `fa-layer-group` is a default and can be swapped if a better icon is preferred.
- The header now holds six utility buttons where it held five. If they wrap awkwardly at
  common widths, report it rather than silently editing `css/layout.css` — spacing is out of
  scope for this task.

- [ ] **Step 2: Verify**

1. Reload the dashboard.
2. The utility toolbar must read, left to right: **Rates, Applications, Suite, My Files,
   Settings**, plus **Admin** if signed in as an admin.
3. **Alerts is gone from the header.**
4. Click **Suite**. A new tab must open to `https://suite.msfgco.com`. The dashboard tab must
   remain on the dashboard.
5. Click **My Files**. A toast reading `My Files — Coming Soon` must appear. No navigation,
   no console error, no 404.
6. Open **Tools → Notifications**. The modal must still open. This is now the only entry
   point, so it is the critical assertion of this task.
7. Check the console for the dispatcher's `No handler registered for action:` warning. It
   must not appear.
8. Verify at a narrow viewport (around 1280px) that the six buttons still lay out sensibly.

- [ ] **Step 3: Commit**

```
feat(header): replace Alerts with Suite and My Files buttons
```

---

### Task 4: Update the Ask AI corpus

`docs/ask-ai-corpus/site-links-and-actions.md:228` currently documents
`- Alerts: action=open-notifications`. That corpus feeds the Ask AI RAG index, so leaving it
stale means Ask AI will confidently tell users to click a button that no longer exists.

**Files:**
- Modify: `docs/ask-ai-corpus/site-links-and-actions.md`

- [ ] **Step 1: Correct the entry**

Replace the `Alerts` line at 228 with entries reflecting the new reality. Match the
surrounding formatting exactly — read the lines above and below before editing, as the file
uses a consistent `- Label: action=name` / `- Label: url` convention:

- `Suite` → external link to `https://suite.msfgco.com`
- `My Files` → `action=open-my-files`
- `Notifications` → `action=open-notifications`, noting it now lives under the Tools menu
  rather than the header

- [ ] **Step 2: Verify**

Re-read the edited section and confirm every action name matches a real key in the `ACTIONS`
map in `js/action-dispatcher.js`. There is no automated check for this, so it is a manual
cross-reference against lines 10-152 of that file.

Do not run the corpus sync (`scripts/sync-ask-ai-corpus.sh`) as part of this task — that is a
deploy-time step and touches the live index.

- [ ] **Step 3: Commit**

```
docs(ask-ai): update corpus for Suite, My Files, and relocated Notifications
```

---

## Done when

- The header shows Suite and My Files; Alerts is gone.
- Suite opens `https://suite.msfgco.com` in a new tab.
- My Files shows a coming-soon toast with no console error.
- Notifications opens from Tools and still loads its list.
- The Ask AI corpus describes the new layout accurately.
- No unrelated announcements work is included in any of the four commits.

## Not in this phase

- Any S3 work, bucket creation, or IAM change — that is Phase 2, which is gated on the
  credential remediation in §4.1 of the spec.
- The actual `Calculators/My Files/` popup — Phase 5.
- Header spacing or responsive tuning beyond confirming nothing is visibly broken.
