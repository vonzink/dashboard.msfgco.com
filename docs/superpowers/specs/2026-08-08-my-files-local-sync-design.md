# My Files — Local Folder Sync (browser-based)

**Date:** 2026-08-08
**Status:** Approved (Zack, 2026-08-08)
**Approach decision:** Browser folder sync via the File System Access API. A desktop
sync agent was considered and deferred; the sync engine is written transport-agnostic
(pure differ) so an agent could reuse it later.

## Goal

Users link a local folder to their My Files storage. The dashboard keeps the two in
sync automatically — add, remove, and edit files on either side and the other side
follows. Users open synced files with their native apps straight from the local
folder; edits sync back.

## Architecture

- **Engine:** classic scripts under `js/` (no ES modules — avoids the build.js
  unbundled-module carve-out that the scanner island needs). They are hashed
  normally by `build.js`: its HTML rewriter runs over `Calculators/**/*.html` too,
  and its regex matches `src="/js/…"`, rewriting to `/js/<base>.<hash>.js`. So
  `Calculators/My Files/my-files.html` must reference them **root-absolute**
  (`/js/file-sync.js`), not relative (`../../js/…`, which the regex ignores).
  No `?v=` needed — hashing handles cache-busting.
- **Loaded by both** the main SPA (`index.html`) and the My Files popup. Leader
  election via the Web Locks API (lock name `msfg-file-sync-leader`): whichever tab
  holds the lock runs sync; other tabs display status. Status fan-out via
  `BroadcastChannel('msfg-file-sync')`.
- **Folder handle** from `showDirectoryPicker({mode:'readwrite'})`, persisted in
  IndexedDB. If permission decays to `prompt`, a "Resume sync" button re-requests it
  (user-gesture requirement). Feature detection: browsers without the API
  (Safari/Firefox) never see the sync UI — manual My Files behavior is unchanged.
- **State** in IndexedDB db `msfg-file-sync`:
  - `config` store — dir handle, enabled flag, paused flag, last-sync time.
  - `snapshot` store — one row per file from the last successful sync:
    `path → {size, mtimeMs, etag}`.

## Sync algorithm (three-way diff)

Each cycle:

1. Scan local tree (recursive handle walk) → `{path, size, mtimeMs}` per file.
2. Fetch remote tree via new `GET /api/my-files/snapshot` → `{path, size, etag,
   lastModified}` per file.
3. The **differ** (pure function, no I/O: `(snapshot, local, remote) → actions`)
   classifies each path added/modified/deleted per side:
   - local change = size or mtime differs from snapshot
   - remote change = etag differs from snapshot
4. Execute actions against **existing endpoints**:
   - local add/modify → existing 3-step presigned upload (`/upload-url` → PUT →
     `/upload-complete`)
   - remote add/modify → `/download-url` → fetch → write via handle
   - local delete → `DELETE /?path=` (soft delete → dashboard trash, 30-day recovery)
   - remote delete → local `removeEntry` (recovery path is the dashboard trash)
   - **conflict** (both changed): remote keeps the canonical name; local version is
     uploaded as `Name (conflict YYYY-MM-DD HHMM).ext`. Never silently overwrite.
5. On success, snapshot rows are updated per-file (not wholesale) so a partial
   failure resumes cleanly.

**MD5** (vendored SparkMD5 3.0.2 at `vendor/spark-md5/spark-md5.min.js`, a build
passthrough; Web Crypto has no MD5) is computed only for initial
merge and conflict adjudication, compared to the S3 ETag (valid: all uploads are
single-PUT, so ETag == MD5). Routine change detection never hashes.

**Cadence:** remote poll ~30 s; local rescan ~10 s (use `FileSystemObserver` when
available, else poll); immediate cycle on window focus and after popup UI operations.
Upload/download concurrency 3; exponential backoff on 429/5xx to respect the
per-user 1200 req/15 min limiter.

**Initial merge** (linking a non-empty folder or re-linking): only-local → upload;
only-remote → download; both present → MD5 vs ETag; identical → adopt silently,
different → conflict copy. Nothing is clobbered on first link.

## Backend additions

One endpoint: `GET /api/my-files/snapshot` in `backend/routes/userFiles.js` +
`snapshot()` in `backend/services/userFiles.js` wrapping the existing
`listAllUnderPrefix()`. Returns the full recursive file listing (excludes `.trash`,
excludes folder marker objects). Everything else — auth, quota, audit, trash,
rate limits — is reused untouched.

## Safety guards

- **Mass-delete guard:** if a cycle would remotely delete >25 files or >50% of the
  tree (unlinked folder, ejected drive), sync pauses with a banner requiring
  explicit "yes, delete remotely" / "re-download instead" confirmation.
- **Skip list, never fatal:** dotfiles (`.DS_Store` etc.), `Thumbs.db`, names the
  backend path validator rejects (backslash, control chars, >255-char segments),
  files >5 GB (single-PUT cap). Skipped items are listed in the UI panel.
- **Quota:** upload 409 (quota exceeded) pauses uploads with a clear message;
  downloads continue.
- Case-sensitivity collisions (S3 vs macOS default) surface as skipped items —
  no rename heuristics.
- Renames/moves are delete+add. No rename detection (YAGNI).
- **Folders propagate implicitly** via file paths. Empty folders do not sync in
  either direction (remote folder markers are excluded from the snapshot; empty
  local directories produce no actions). Local parent dirs are created as needed
  when writing downloads.

## UI (all in the My Files popup)

- Header button **"Local sync"** → setup flow: support check → pick folder →
  initial merge → enabled.
- Status pill: Synced ✓ / Syncing… / Paused / Needs attention.
- Panel: recent activity, conflicts, skipped items, Pause / Resume, Disconnect
  (forgets handle + snapshot; touches no files).
- Main SPA runs the engine headless; no new chrome there.

## Testing

- Differ is pure and dependency-free → Node unit tests in `backend/tests/`
  (UMD-style export so `require()` works).
- `/snapshot` endpoint test beside the existing userFiles service tests.
- Manual browser verification for File System Access plumbing (Chrome).

## Out of scope

Desktop agent, rename detection, multipart (>5 GB) uploads, Safari/Firefox sync,
selective/partial-tree sync, syncing the trash.
