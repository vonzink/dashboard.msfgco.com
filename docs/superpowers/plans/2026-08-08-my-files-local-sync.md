# My Files Local Folder Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user link a local folder to their My Files storage so files added, removed, or edited on either side automatically appear on the other.

**Architecture:** A browser sync engine built from small single-responsibility classic scripts under `js/`. A pure differ compares three trees (last-sync snapshot, local disk, remote S3) and emits an action plan; adapters execute it against the File System Access API on one side and the existing `/api/my-files` endpoints on the other. One new backend endpoint (`GET /api/my-files/snapshot`) returns the full recursive listing so a poll is one request.

**Tech Stack:** Vanilla ES2020 classic scripts (no modules, no bundler), File System Access API, IndexedDB, Web Locks, BroadcastChannel, vendored SparkMD5. Backend: Express + AWS SDK v3. Tests: vitest (`cd backend && npm test`).

**Spec:** `docs/superpowers/specs/2026-08-08-my-files-local-sync-design.md`

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `js/file-sync-differ.js` | Pure function: `(snapshot, local, remote) → {actions, conflicts, guard}`. No I/O. Node-requirable for tests. |
| `js/file-sync-store.js` | IndexedDB: directory handle, enabled/paused flags, per-path snapshot rows. |
| `js/file-sync-local.js` | File System Access adapter: recursive scan, read, write, delete, mkdir -p, skip rules. |
| `js/file-sync-remote.js` | `/api/my-files` client: snapshot, upload (3-step), download, delete. |
| `js/file-sync-hash.js` | MD5 of a `File` via chunked SparkMD5. |
| `js/file-sync.js` | Engine: leader election, scheduling, executes the action plan, broadcasts status. |
| `js/file-sync-ui.js` | Popup UI: button, setup flow, status pill, activity/conflict panel. |
| `vendor/spark-md5/spark-md5.min.js` | Vendored SparkMD5 3.0.2. |
| `backend/tests/services/userFilesSnapshot.test.js` | Tests for the snapshot service function. |
| `backend/tests/frontend/fileSyncDiffer.test.js` | Tests for the differ. |

**Modify:**

| File | Change |
|---|---|
| `backend/services/userFiles.js` | Add `snapshot(userId)`; export it. |
| `backend/routes/userFiles.js` | Add `GET /snapshot`. |
| `Calculators/My Files/my-files.html` | Load sync scripts (root-absolute), add sync UI mount points, refresh on sync events. |
| `index.html` | Load sync scripts so the engine runs headless in the SPA. |
| `css/` or `Calculators/My Files/styles.css` | Styles for the pill and panel. |

**Conventions to follow:**
- Backend services are CommonJS (`module.exports`), routes are thin (`validate → service → respond`), errors carry `.status`.
- Frontend scripts are classic (no `import`/`export`); attach one global per file.
- `my-files.html` references new scripts as `/js/file-sync-*.js` (root-absolute) — `build.js`'s rewriter only matches `src="/js/…"` or `src="js/…"`, never `../../js/…`.

---

### Task 1: Backend — recursive snapshot service function

**Files:**
- Modify: `backend/services/userFiles.js` (add function near `listPath`, ~line 105; add to `module.exports` at end of file)
- Test: `backend/tests/services/userFilesSnapshot.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/userFilesSnapshot.test.js`. This mirrors the module-cache mocking pattern already used by `backend/tests/services/userFiles.test.js` (read that file first — the AWS SDK is externalised by vitest, so `vi.mock` does not intercept the service's `require`; swapping `require.cache` is the working approach).

```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const s3Path = require.resolve('@aws-sdk/client-s3');
const presignerPath = require.resolve('@aws-sdk/s3-request-presigner');
const dbPath = require.resolve('../../db/connection');
const loggerPath = require.resolve('../../lib/logger');
const servicePath = require.resolve('../../services/userFiles');

const originals = {
  [s3Path]: require.cache[s3Path],
  [presignerPath]: require.cache[presignerPath],
  [dbPath]: require.cache[dbPath],
  [loggerPath]: require.cache[loggerPath],
};

const sendMock = vi.fn();
let captured = [];

function makeCommand(name) {
  return class {
    constructor(input) {
      this.name = name;
      this.input = input;
      captured.push({ name, input });
    }
  };
}

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

beforeEach(() => {
  captured = [];
  sendMock.mockReset();

  stub(s3Path, {
    S3Client: class { send(command) { return sendMock(command); } },
    ListObjectsV2Command: makeCommand('ListObjectsV2'),
    GetObjectCommand: makeCommand('GetObject'),
    PutObjectCommand: makeCommand('PutObject'),
    HeadObjectCommand: makeCommand('HeadObject'),
    CopyObjectCommand: makeCommand('CopyObject'),
    DeleteObjectCommand: makeCommand('DeleteObject'),
    DeleteObjectsCommand: makeCommand('DeleteObjects'),
  });
  stub(presignerPath, { getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/url') });
  stub(dbPath, { query: vi.fn().mockResolvedValue([]) });
  stub(loggerPath, { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });

  delete require.cache[servicePath];
});

afterEach(() => {
  for (const [path, original] of Object.entries(originals)) {
    if (original) require.cache[path] = original;
    else delete require.cache[path];
  }
  delete require.cache[servicePath];
});

/** One S3 ListObjectsV2 page. */
function page(contents, nextToken) {
  return {
    Contents: contents,
    IsTruncated: Boolean(nextToken),
    NextContinuationToken: nextToken || undefined,
  };
}

describe('snapshot', () => {
  it('returns every file under the user root with path, size and unquoted etag', async () => {
    sendMock.mockResolvedValueOnce(page([
      { Key: 'users/7/notes.txt', Size: 12, ETag: '"abc123"', LastModified: new Date('2026-01-01T00:00:00Z') },
      { Key: 'users/7/deals/offer.pdf', Size: 900, ETag: '"def456"', LastModified: new Date('2026-01-02T00:00:00Z') },
    ]));

    const { snapshot } = require('../../services/userFiles');
    const result = await snapshot(7);

    expect(result.files).toEqual([
      { path: 'notes.txt', size: 12, etag: 'abc123', lastModified: new Date('2026-01-01T00:00:00Z') },
      { path: 'deals/offer.pdf', size: 900, etag: 'def456', lastModified: new Date('2026-01-02T00:00:00Z') },
    ]);
  });

  it('lists only the requesting user, never a sibling prefix', async () => {
    sendMock.mockResolvedValueOnce(page([]));

    const { snapshot } = require('../../services/userFiles');
    await snapshot(7);

    const list = captured.find((c) => c.name === 'ListObjectsV2');
    expect(list.input.Prefix).toBe('users/7/');
    expect(list.input.Delimiter).toBeUndefined();
  });

  it('excludes trash objects and zero-byte folder markers', async () => {
    sendMock.mockResolvedValueOnce(page([
      { Key: 'users/7/deals/', Size: 0, ETag: '"d41d8"', LastModified: new Date() },
      { Key: 'users/7/.trash/1700000000000/old.txt', Size: 5, ETag: '"old"', LastModified: new Date() },
      { Key: 'users/7/keep.txt', Size: 5, ETag: '"keep"', LastModified: new Date() },
    ]));

    const { snapshot } = require('../../services/userFiles');
    const result = await snapshot(7);

    expect(result.files.map((f) => f.path)).toEqual(['keep.txt']);
  });

  it('follows pagination across pages', async () => {
    sendMock
      .mockResolvedValueOnce(page([{ Key: 'users/7/a.txt', Size: 1, ETag: '"a"', LastModified: new Date() }], 'TOKEN'))
      .mockResolvedValueOnce(page([{ Key: 'users/7/b.txt', Size: 2, ETag: '"b"', LastModified: new Date() }]));

    const { snapshot } = require('../../services/userFiles');
    const result = await snapshot(7);

    expect(result.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/services/userFilesSnapshot.test.js`
Expected: FAIL — `snapshot is not a function`.

- [ ] **Step 3: Implement `snapshot`**

In `backend/services/userFiles.js`, add this after `listPath`'s helper `joinClientPath` (keep it near the other read functions). It reuses the existing private `listAllUnderPrefix` and `userRootPrefix`/`userTrashPrefix` helpers already imported in this file.

```javascript
/**
 * Every file under the user's root, flattened, for the local-sync client.
 *
 * Folder markers (zero-byte keys ending in '/') and the trash are omitted:
 * sync reconstructs folders from file paths, and trash is not a synced tree.
 *
 * @param {number} userId
 * @returns {Promise<{files: Array<{path: string, size: number, etag: string|null, lastModified: Date}>}>}
 */
async function snapshot(userId) {
  const prefix = userRootPrefix(userId);
  const trashPrefix = userTrashPrefix(userId);
  const objects = await listAllUnderPrefix(prefix);

  const files = objects
    .filter((object) => !object.Key.startsWith(trashPrefix))
    .filter((object) => !object.Key.endsWith('/'))
    .map((object) => ({
      path: object.Key.slice(prefix.length),
      size: object.Size,
      etag: object.ETag ? object.ETag.replace(/"/g, '') : null,
      lastModified: object.LastModified,
    }));

  return { files };
}
```

Then add `snapshot,` to the `module.exports` object at the bottom of the file, alongside `listPath`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/services/userFilesSnapshot.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify no regression in the existing suite**

Run: `cd backend && npm test`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/userFiles.js backend/tests/services/userFilesSnapshot.test.js
git commit -m "feat(my-files): add recursive snapshot() to the user files service"
```

---

### Task 2: Backend — `GET /api/my-files/snapshot` route

**Files:**
- Modify: `backend/routes/userFiles.js` (add route after the `GET /list` handler at ~line 51)

- [ ] **Step 1: Read the surrounding conventions**

Read `backend/routes/userFiles.js` lines 1-70. Note: handlers read the user id only from `req.user.db.id` (never from the request), wrap the service call in `try/catch`, and pass service errors through `toHttpError(err)` before `next(err)`. Match that shape exactly.

- [ ] **Step 2: Add the route**

Insert immediately after the `GET /list` handler:

```javascript
/**
 * Full recursive listing for the local-sync client. One request replaces a
 * folder-by-folder crawl; the client diffs this against its own snapshot.
 */
router.get('/snapshot', async (req, res, next) => {
  try {
    const result = await userFiles.snapshot(req.user.db.id);
    res.json(result);
  } catch (err) {
    next(toHttpError(err));
  }
});
```

Route order matters: this must be registered before any parameterised route that could shadow `/snapshot`. In this file `GET /list`, `/download-url`, `/preview-url`, `/usage` and `/trash` are all literal paths, so placing it after `/list` is safe.

- [ ] **Step 3: Verify the server still boots**

Run: `cd backend && node -e "require('./routes/userFiles'); console.log('routes load OK')"`
Expected: `routes load OK` (a `ReferenceError` here is the classic prod-crash failure mode — a name exported but never imported).

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/userFiles.js
git commit -m "feat(my-files): add GET /api/my-files/snapshot endpoint"
```

---

### Task 3: The differ (pure, the heart of the feature)

**Files:**
- Create: `js/file-sync-differ.js`
- Test: `backend/tests/frontend/fileSyncDiffer.test.js`

The differ takes three maps keyed by path and returns an action plan. It performs no I/O, which is why all the tricky logic lives here and is fully unit-tested.

Inputs (all plain objects keyed by relative path):
- `snapshot`: `{ [path]: { size, mtimeMs, etag } }` — state at the last successful sync.
- `local`: `{ [path]: { size, mtimeMs } }` — current disk scan.
- `remote`: `{ [path]: { size, etag } }` — current server snapshot.

Output: `{ actions: Action[], guard: null | {reason, deleteCount, totalRemote} }`

Action shapes:
- `{ type: 'upload', path }` — local is newer/new; send to server.
- `{ type: 'download', path }` — remote is newer/new; write to disk.
- `{ type: 'deleteRemote', path }` — file removed locally.
- `{ type: 'deleteLocal', path }` — file removed remotely.
- `{ type: 'conflict', path }` — both sides changed; caller resolves (hash-compare, then conflict-copy).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/frontend/fileSyncDiffer.test.js`:

```javascript
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// The differ is a browser classic script with a CommonJS tail, so Node can
// require it directly. Keep it dependency-free for exactly this reason.
const { diff, caseCollisions } = require('../../../js/file-sync-differ.js');

const file = (size, mtimeMs, etag) => ({ size, mtimeMs, etag });

describe('diff — first sync (empty snapshot)', () => {
  it('uploads a file that exists only locally', () => {
    const { actions } = diff({}, { 'a.txt': file(10, 100) }, {});
    expect(actions).toEqual([{ type: 'upload', path: 'a.txt' }]);
  });

  it('downloads a file that exists only remotely', () => {
    const { actions } = diff({}, {}, { 'a.txt': file(10, null, 'aaa') });
    expect(actions).toEqual([{ type: 'download', path: 'a.txt' }]);
  });

  it('reports a conflict when a path exists on both sides with no snapshot', () => {
    const { actions } = diff({}, { 'a.txt': file(10, 100) }, { 'a.txt': file(20, null, 'aaa') });
    expect(actions).toEqual([{ type: 'conflict', path: 'a.txt' }]);
  });
});

describe('diff — steady state', () => {
  const snap = { 'a.txt': file(10, 100, 'aaa') };

  it('does nothing when neither side changed', () => {
    const { actions } = diff(snap, { 'a.txt': file(10, 100) }, { 'a.txt': file(10, null, 'aaa') });
    expect(actions).toEqual([]);
  });

  it('uploads when only the local mtime changed', () => {
    const { actions } = diff(snap, { 'a.txt': file(10, 200) }, { 'a.txt': file(10, null, 'aaa') });
    expect(actions).toEqual([{ type: 'upload', path: 'a.txt' }]);
  });

  it('uploads when only the local size changed', () => {
    const { actions } = diff(snap, { 'a.txt': file(99, 100) }, { 'a.txt': file(10, null, 'aaa') });
    expect(actions).toEqual([{ type: 'upload', path: 'a.txt' }]);
  });

  it('downloads when only the remote etag changed', () => {
    const { actions } = diff(snap, { 'a.txt': file(10, 100) }, { 'a.txt': file(10, null, 'bbb') });
    expect(actions).toEqual([{ type: 'download', path: 'a.txt' }]);
  });

  it('conflicts when both sides changed', () => {
    const { actions } = diff(snap, { 'a.txt': file(11, 200) }, { 'a.txt': file(12, null, 'bbb') });
    expect(actions).toEqual([{ type: 'conflict', path: 'a.txt' }]);
  });

  it('deletes remotely when the file is gone locally and remote is unchanged', () => {
    const { actions } = diff(snap, {}, { 'a.txt': file(10, null, 'aaa') });
    expect(actions).toEqual([{ type: 'deleteRemote', path: 'a.txt' }]);
  });

  it('deletes locally when the file is gone remotely and local is unchanged', () => {
    const { actions } = diff(snap, { 'a.txt': file(10, 100) }, {});
    expect(actions).toEqual([{ type: 'deleteLocal', path: 'a.txt' }]);
  });

  it('re-uploads rather than deleting when a file was edited locally but deleted remotely', () => {
    const { actions } = diff(snap, { 'a.txt': file(50, 300) }, {});
    expect(actions).toEqual([{ type: 'upload', path: 'a.txt' }]);
  });

  it('re-downloads rather than deleting when a file was deleted locally but edited remotely', () => {
    const { actions } = diff(snap, {}, { 'a.txt': file(50, null, 'zzz') });
    expect(actions).toEqual([{ type: 'download', path: 'a.txt' }]);
  });

  it('drops the snapshot row when a file vanished from both sides', () => {
    const { actions } = diff(snap, {}, {});
    expect(actions).toEqual([]);
  });
});

describe('diff — mass-delete guard', () => {
  /** n tracked files, all present remotely, none present locally. */
  function vanishedLocally(n) {
    const snapshot = {};
    const remote = {};
    for (let i = 0; i < n; i += 1) {
      snapshot[`f${i}.txt`] = file(1, 1, `e${i}`);
      remote[`f${i}.txt`] = file(1, null, `e${i}`);
    }
    return diff(snapshot, {}, remote);
  }

  it('allows a small deletion batch even when it is the whole tree', () => {
    const { guard, actions } = vanishedLocally(3);
    expect(guard).toBeNull();
    expect(actions).toHaveLength(3);
  });

  it('trips on more than 25 remote deletions', () => {
    const { guard } = vanishedLocally(26);
    expect(guard).toMatchObject({ reason: 'mass-delete', deleteCount: 26 });
  });

  it('trips when a sizeable batch also exceeds half the remote tree', () => {
    const snapshot = {};
    const remote = {};
    const local = {};
    for (let i = 0; i < 12; i += 1) {
      snapshot[`f${i}.txt`] = file(1, 1, `e${i}`);
      remote[`f${i}.txt`] = file(1, null, `e${i}`);
      if (i >= 7) local[`f${i}.txt`] = file(1, 1);
    }
    const { guard } = diff(snapshot, local, remote);
    expect(guard).toMatchObject({ reason: 'mass-delete', deleteCount: 7, totalRemote: 12 });
  });

  it('does not trip when a sizeable batch is still a minority of the tree', () => {
    const snapshot = {};
    const remote = {};
    const local = {};
    for (let i = 0; i < 40; i += 1) {
      snapshot[`f${i}.txt`] = file(1, 1, `e${i}`);
      remote[`f${i}.txt`] = file(1, null, `e${i}`);
      if (i >= 6) local[`f${i}.txt`] = file(1, 1);
    }
    const { guard } = diff(snapshot, local, remote);
    expect(guard).toBeNull();
  });

  it('does not trip on an empty remote tree', () => {
    const { guard } = diff({}, { 'a.txt': file(1, 1) }, {});
    expect(guard).toBeNull();
  });
});

describe('caseCollisions', () => {
  it('reports remote paths that differ only by case', () => {
    const collisions = caseCollisions(['a/Report.pdf', 'a/report.pdf', 'b/one.txt']);
    expect(collisions).toEqual(['a/Report.pdf', 'a/report.pdf']);
  });

  it('returns nothing when every path is distinct case-insensitively', () => {
    expect(caseCollisions(['a.txt', 'b.txt'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/frontend/fileSyncDiffer.test.js`
Expected: FAIL — cannot find module `js/file-sync-differ.js`.

- [ ] **Step 3: Implement the differ**

Create `js/file-sync-differ.js`:

```javascript
/**
 * Three-way diff for My Files local sync. Pure: no I/O, no globals, no
 * dependencies — so it is unit-testable under Node and cheap to reason about.
 *
 * Change detection is asymmetric because the two sides expose different
 * signals: local files carry size + mtime, S3 objects carry an ETag (an MD5,
 * since every upload is a single PUT).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FileSyncDiffer = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A large batch of remote deletions usually means something structural
  // happened (folder unlinked, drive ejected) rather than a user deleting
  // files, so pause instead of propagating. The ratio rule needs a floor:
  // without it, clearing out a 3-file folder is "100% of the tree" and would
  // trip the guard during ordinary use.
  const MAX_REMOTE_DELETES = 25;
  const MAX_REMOTE_DELETE_RATIO = 0.5;
  const MIN_RATIO_DELETES = 5;

  function localChanged(snapshotEntry, localEntry) {
    return snapshotEntry.size !== localEntry.size
      || snapshotEntry.mtimeMs !== localEntry.mtimeMs;
  }

  function remoteChanged(snapshotEntry, remoteEntry) {
    return snapshotEntry.etag !== remoteEntry.etag;
  }

  /**
   * @param {Object} snapshot state at the last successful sync, keyed by path
   * @param {Object} local    current disk scan, keyed by path
   * @param {Object} remote   current server snapshot, keyed by path
   * @returns {{actions: Array, guard: Object|null}}
   */
  function diff(snapshot, local, remote) {
    const actions = [];
    const paths = new Set([
      ...Object.keys(snapshot),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    for (const path of paths) {
      const was = snapshot[path];
      const here = local[path];
      const there = remote[path];

      if (!was) {
        // Untracked path: whichever side has it wins; both sides means we
        // cannot tell which is authoritative, so the caller hash-compares.
        if (here && there) actions.push({ type: 'conflict', path });
        else if (here) actions.push({ type: 'upload', path });
        else if (there) actions.push({ type: 'download', path });
        continue;
      }

      if (here && there) {
        const changedHere = localChanged(was, here);
        const changedThere = remoteChanged(was, there);
        if (changedHere && changedThere) actions.push({ type: 'conflict', path });
        else if (changedHere) actions.push({ type: 'upload', path });
        else if (changedThere) actions.push({ type: 'download', path });
        continue;
      }

      if (here && !there) {
        // Deleted remotely. An edit here outranks that deletion — never
        // discard work the user just did.
        if (localChanged(was, here)) actions.push({ type: 'upload', path });
        else actions.push({ type: 'deleteLocal', path });
        continue;
      }

      if (!here && there) {
        if (remoteChanged(was, there)) actions.push({ type: 'download', path });
        else actions.push({ type: 'deleteRemote', path });
        continue;
      }

      // Gone from both sides: nothing to do; the caller drops the snapshot row.
    }

    const deleteCount = actions.filter((a) => a.type === 'deleteRemote').length;
    const totalRemote = Object.keys(remote).length;
    const tripped = deleteCount > MAX_REMOTE_DELETES
      || (deleteCount >= MIN_RATIO_DELETES && deleteCount > totalRemote * MAX_REMOTE_DELETE_RATIO);

    return {
      actions,
      guard: tripped ? { reason: 'mass-delete', deleteCount, totalRemote } : null,
    };
  }

  /**
   * Paths that differ only by case. macOS and Windows filesystems are
   * case-insensitive by default but S3 is not, so such a pair cannot coexist
   * locally — writing the second would silently clobber the first and the two
   * would then fight every cycle. The caller skips them and says so.
   *
   * @param {string[]} paths
   * @returns {string[]} every path involved in a collision, input order
   */
  function caseCollisions(paths) {
    const byLower = new Map();
    for (const path of paths) {
      const key = path.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, []);
      byLower.get(key).push(path);
    }
    const collided = new Set();
    for (const group of byLower.values()) {
      if (group.length > 1) group.forEach((path) => collided.add(path));
    }
    return paths.filter((path) => collided.has(path));
  }

  return {
    diff,
    caseCollisions,
    MAX_REMOTE_DELETES,
    MAX_REMOTE_DELETE_RATIO,
    MIN_RATIO_DELETES,
  };
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/frontend/fileSyncDiffer.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add js/file-sync-differ.js backend/tests/frontend/fileSyncDiffer.test.js
git commit -m "feat(my-files): add pure three-way sync differ with mass-delete guard"
```

---

### Task 4: IndexedDB store

**Files:**
- Create: `js/file-sync-store.js`

No unit test: this is a thin wrapper over a browser API with no logic worth asserting; it is exercised by the manual browser verification in Task 10.

- [ ] **Step 1: Implement the store**

Create `js/file-sync-store.js`:

```javascript
/**
 * Persistent state for My Files local sync.
 *
 * Two stores: `config` (the directory handle and the enabled/paused flags) and
 * `snapshot` (one row per synced file, the baseline the differ compares against).
 * Directory handles survive a page reload only in IndexedDB — they cannot be
 * serialised to localStorage.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'msfg-file-sync';
  const DB_VERSION = 1;
  const CONFIG_STORE = 'config';
  const SNAPSHOT_STORE = 'snapshot';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CONFIG_STORE)) db.createObjectStore(CONFIG_STORE);
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode, work) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try {
        result = work(store);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(result && result.__request ? result.__request.result : result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }));
  }

  /** Wrap an IDBRequest so tx() resolves with its result after commit. */
  function req(request) {
    return { __request: request };
  }

  const store = {
    getConfig(key) {
      return tx(CONFIG_STORE, 'readonly', (s) => req(s.get(key)));
    },
    setConfig(key, value) {
      return tx(CONFIG_STORE, 'readwrite', (s) => { s.put(value, key); });
    },
    deleteConfig(key) {
      return tx(CONFIG_STORE, 'readwrite', (s) => { s.delete(key); });
    },

    /** The whole snapshot as a plain object keyed by path. */
    getSnapshot() {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
        const cursorRequest = transaction.objectStore(SNAPSHOT_STORE).openCursor();
        const out = {};
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) { resolve(out); return; }
          out[cursor.key] = cursor.value;
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      }));
    },

    /**
     * Update one row. Written per-file rather than wholesale so a cycle that
     * fails halfway leaves the completed files correctly recorded.
     */
    putSnapshotRow(path, entry) {
      return tx(SNAPSHOT_STORE, 'readwrite', (s) => { s.put(entry, path); });
    },
    deleteSnapshotRow(path) {
      return tx(SNAPSHOT_STORE, 'readwrite', (s) => { s.delete(path); });
    },
    clearSnapshot() {
      return tx(SNAPSHOT_STORE, 'readwrite', (s) => { s.clear(); });
    },
  };

  root.FileSyncStore = store;
}(typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/file-sync-store.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add js/file-sync-store.js
git commit -m "feat(my-files): add IndexedDB store for sync handle and snapshot"
```

---

### Task 5: Vendored MD5 + hashing helper

**Files:**
- Create: `vendor/spark-md5/spark-md5.min.js`, `vendor/spark-md5/LICENSE`
- Create: `js/file-sync-hash.js`

MD5 is needed because S3's ETag is an MD5 and Web Crypto does not implement MD5. It is used only for initial-merge adoption and conflict adjudication, never in the routine change-detection path.

- [ ] **Step 1: Vendor SparkMD5**

```bash
mkdir -p vendor/spark-md5
cd "$(mktemp -d)" && npm pack spark-md5@3.0.2 && tar -xzf spark-md5-3.0.2.tgz
cp package/spark-md5.min.js package/LICENSE "$OLDPWD/vendor/spark-md5/"
cd "$OLDPWD"
```

Verify: `ls -la vendor/spark-md5/` shows `spark-md5.min.js` (~10 KB) and `LICENSE`.

- [ ] **Step 2: Implement the hashing helper**

Create `js/file-sync-hash.js`:

```javascript
/**
 * MD5 of a File/Blob, to compare against an S3 ETag.
 *
 * Valid because every My Files upload is a single PUT (the 10 GB quota is set
 * below S3's 5 GB single-PUT cap precisely so multipart is never used), and a
 * single-PUT object's ETag is the MD5 of its bytes.
 *
 * Hashed in chunks so a large file never has to sit in memory whole.
 */
(function (root) {
  'use strict';

  const CHUNK_BYTES = 4 * 1024 * 1024;

  function md5(blob) {
    return new Promise((resolve, reject) => {
      if (!root.SparkMD5) {
        reject(new Error('SparkMD5 not loaded'));
        return;
      }
      const spark = new root.SparkMD5.ArrayBuffer();
      const reader = new FileReader();
      let offset = 0;

      reader.onload = () => {
        spark.append(reader.result);
        offset += CHUNK_BYTES;
        if (offset < blob.size) readNext();
        else resolve(spark.end());
      };
      reader.onerror = () => reject(reader.error);

      function readNext() {
        reader.readAsArrayBuffer(blob.slice(offset, offset + CHUNK_BYTES));
      }

      if (blob.size === 0) resolve(spark.end());
      else readNext();
    });
  }

  root.FileSyncHash = { md5 };
}(typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 3: Syntax check**

Run: `node --check js/file-sync-hash.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add vendor/spark-md5 js/file-sync-hash.js
git commit -m "feat(my-files): vendor SparkMD5 and add chunked file hashing helper"
```

---

### Task 6: Local filesystem adapter

**Files:**
- Create: `js/file-sync-local.js`

- [ ] **Step 1: Implement the adapter**

Create `js/file-sync-local.js`. The skip rules live here because they are filesystem facts (OS metadata files, names the backend's path validator rejects).

```javascript
/**
 * File System Access API adapter for My Files local sync.
 *
 * Every path in and out of this module is a forward-slash relative path, the
 * same shape the backend uses, so the differ never sees platform differences.
 */
(function (root) {
  'use strict';

  // S3 single-PUT limit. The backend presigns a plain PutObject, so a larger
  // file cannot be uploaded at all — skip it loudly rather than failing a cycle.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

  const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);

  /**
   * Names the backend's normalizeSegments() rejects outright. Mirrored here so
   * the client skips them with an explanation instead of eating a 400 mid-cycle.
   */
  function skipReason(name) {
    if (SKIP_NAMES.has(name)) return 'system file';
    if (name.startsWith('.')) return 'hidden file';
    if (name.includes('\\')) return 'name contains a backslash';
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) return 'name contains control characters';
    if (name === '.' || name === '..') return 'reserved name';
    if (name.length > 255) return 'name longer than 255 characters';
    return null;
  }

  function isSupported() {
    return typeof root.showDirectoryPicker === 'function'
      && typeof root.indexedDB !== 'undefined';
  }

  /** Ask for a folder. Must be called from a user gesture. */
  async function pickDirectory() {
    return root.showDirectoryPicker({ mode: 'readwrite', id: 'msfg-my-files' });
  }

  /** 'granted' | 'prompt' | 'denied' */
  async function permissionState(handle) {
    return handle.queryPermission({ mode: 'readwrite' });
  }

  /** Re-request readwrite access. Must be called from a user gesture. */
  async function requestPermission(handle) {
    return handle.requestPermission({ mode: 'readwrite' });
  }

  /**
   * Recursive scan.
   * @returns {Promise<{files: Object, skipped: Array<{path: string, reason: string}>}>}
   *          files is keyed by path → {size, mtimeMs}
   */
  async function scan(rootHandle) {
    const files = {};
    const skipped = [];

    async function walk(dirHandle, prefix) {
      for await (const [name, handle] of dirHandle.entries()) {
        const reason = skipReason(name);
        const path = prefix ? `${prefix}/${name}` : name;
        if (reason) {
          skipped.push({ path, reason });
          continue;
        }
        if (handle.kind === 'directory') {
          await walk(handle, path);
          continue;
        }
        const file = await handle.getFile();
        if (file.size > MAX_UPLOAD_BYTES) {
          skipped.push({ path, reason: 'larger than the 5 GB upload limit' });
          continue;
        }
        files[path] = { size: file.size, mtimeMs: file.lastModified };
      }
    }

    await walk(rootHandle, '');
    return { files, skipped };
  }

  function splitPath(path) {
    const parts = path.split('/');
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
  }

  async function resolveDir(rootHandle, dirs, { create }) {
    let handle = rootHandle;
    for (const dir of dirs) {
      handle = await handle.getDirectoryHandle(dir, { create });
    }
    return handle;
  }

  /** The File at a path, or null if any segment is missing. */
  async function readFile(rootHandle, path) {
    const { dirs, name } = splitPath(path);
    try {
      const dir = await resolveDir(rootHandle, dirs, { create: false });
      const handle = await dir.getFileHandle(name, { create: false });
      return handle.getFile();
    } catch (err) {
      if (err && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  /** Write a Blob, creating parent directories as needed. */
  async function writeFile(rootHandle, path, blob) {
    const { dirs, name } = splitPath(path);
    const dir = await resolveDir(rootHandle, dirs, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    // Re-read: lastModified is set by the OS on close, and the snapshot must
    // record what is actually on disk or the next scan sees a phantom edit.
    return handle.getFile();
  }

  /** Delete a file. A missing file is not an error — the goal state is reached. */
  async function deleteFile(rootHandle, path) {
    const { dirs, name } = splitPath(path);
    try {
      const dir = await resolveDir(rootHandle, dirs, { create: false });
      await dir.removeEntry(name);
    } catch (err) {
      if (err && err.name === 'NotFoundError') return;
      throw err;
    }
  }

  root.FileSyncLocal = {
    isSupported,
    pickDirectory,
    permissionState,
    requestPermission,
    scan,
    readFile,
    writeFile,
    deleteFile,
    skipReason,
    MAX_UPLOAD_BYTES,
  };
}(typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/file-sync-local.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add js/file-sync-local.js
git commit -m "feat(my-files): add File System Access adapter for sync"
```

---

### Task 7: Remote API adapter

**Files:**
- Create: `js/file-sync-remote.js`

- [ ] **Step 1: Read the existing client**

Read `Calculators/My Files/my-files.html` lines 86-130 and 447-540. The upload flow is `POST /upload-url` → presigned `PUT` → `POST /upload-complete`, and auth reads `localStorage.auth_token` → `auth_token` cookie → `sessionStorage`. This adapter reuses the same contract so there is one server-side upload path, not two.

- [ ] **Step 2: Implement the adapter**

Create `js/file-sync-remote.js`:

```javascript
/**
 * /api/my-files client for the sync engine.
 *
 * Deliberately standalone (like the My Files popup's own client) rather than
 * routed through js/api.js, because the engine also runs inside the popup,
 * which does not load the SPA's API layer.
 */
(function (root) {
  'use strict';

  const API_BASE = root.location.protocol === 'https:'
    ? 'https://api.msfgco.com/api'
    : 'http://52.203.186.217:8080/api';

  function getAuthToken() {
    const stored = root.localStorage.getItem('auth_token');
    if (stored) return stored;
    const cookie = document.cookie.split('; ').find((c) => c.startsWith('auth_token='));
    if (cookie) return decodeURIComponent(cookie.split('=').slice(1).join('='));
    return root.sessionStorage.getItem('auth_token');
  }

  async function api(path, options = {}) {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/my-files${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /** Full remote tree keyed by path → {size, etag}. */
  async function snapshot() {
    const result = await api('/snapshot');
    const files = {};
    for (const file of result.files) {
      files[file.path] = { size: file.size, etag: file.etag };
    }
    return files;
  }

  /**
   * Upload via the existing 3-step presigned flow.
   *
   * The returned etag is null unless the bucket's CORS config lists ETag in
   * ExposeHeaders — a cross-origin response hides every other header. Callers
   * must fall back to hashing the file rather than storing null, or the next
   * sync cycle reads the missing etag as a remote change and re-downloads the
   * file it just uploaded.
   *
   * @returns {Promise<{etag: string|null, size: number}>}
   */
  async function upload(path, file) {
    const { url } = await api('/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        path,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      }),
    });

    const putResponse = await fetch(url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!putResponse.ok) {
      const error = new Error(`Upload failed (${putResponse.status})`);
      error.status = putResponse.status;
      throw error;
    }

    const confirmed = await api('/upload-complete', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    const etag = (putResponse.headers.get('ETag') || '').replace(/"/g, '') || null;
    return { etag, size: (confirmed && confirmed.size) || file.size };
  }

  /** Download a file's bytes. */
  async function download(path) {
    const { url } = await api(`/download-url?path=${encodeURIComponent(path)}`);
    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(`Download failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  /** Soft delete — the file lands in the dashboard trash, recoverable for 30 days. */
  function remove(path) {
    return api(`/?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }

  root.FileSyncRemote = { snapshot, upload, download, remove, api };
}(typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 3: Syntax check**

Run: `node --check js/file-sync-remote.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add js/file-sync-remote.js
git commit -m "feat(my-files): add sync API adapter for /api/my-files"
```

---

### Task 8: The sync engine

**Files:**
- Create: `js/file-sync.js`

Depends on the globals from Tasks 3-7: `FileSyncDiffer`, `FileSyncStore`, `FileSyncLocal`, `FileSyncRemote`, `FileSyncHash`.

- [ ] **Step 1: Implement the engine**

Create `js/file-sync.js`:

```javascript
/**
 * My Files local sync engine.
 *
 * Runs in whichever tab wins the Web Locks leader election, so the SPA and the
 * My Files popup can both load this script without syncing twice. Status is
 * broadcast to the other tabs over BroadcastChannel.
 */
(function (root) {
  'use strict';

  const LOCK_NAME = 'msfg-file-sync-leader';
  const CHANNEL_NAME = 'msfg-file-sync';
  const REMOTE_POLL_MS = 30000;
  const LOCAL_POLL_MS = 10000;
  const TRANSFER_CONCURRENCY = 3;
  const MAX_ATTEMPTS = 4;

  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;

  const state = {
    status: 'idle',      // idle | syncing | synced | paused | attention | unsupported
    message: '',
    isLeader: false,
    dirName: null,
    activity: [],        // most recent first, capped
    conflicts: [],
    skipped: [],
    guard: null,
    lastSyncAt: null,
  };

  const listeners = new Set();

  function emit() {
    const snapshotOfState = { ...state, activity: state.activity.slice(0, 20) };
    listeners.forEach((fn) => fn(snapshotOfState));
    if (channel && state.isLeader) channel.postMessage({ type: 'status', state: snapshotOfState });
  }

  if (channel) {
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'status' && !state.isLeader) {
        Object.assign(state, event.data.state, { isLeader: false });
        listeners.forEach((fn) => fn({ ...state }));
      }
    };
  }

  function setStatus(status, message = '') {
    state.status = status;
    state.message = message;
    emit();
  }

  function note(kind, path, detail) {
    state.activity.unshift({ kind, path, detail, at: Date.now() });
    state.activity = state.activity.slice(0, 50);
  }

  /** Run tasks with bounded concurrency, collecting failures instead of aborting. */
  async function pool(items, worker, limit) {
    const queue = items.slice();
    const failures = [];
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          await worker(item);
        } catch (err) {
          failures.push({ item, err });
        }
      }
    });
    await Promise.all(runners);
    return failures;
  }

  /** Retry on 429 and 5xx only — a 4xx will not fix itself. */
  async function withRetry(fn) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const status = err && err.status;
        const retryable = status === 429 || (status >= 500 && status < 600) || status === undefined;
        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
        const backoff = 500 * (2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw lastError;
  }

  function conflictName(path) {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash + 1);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
      + `${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `${dir}${base} (conflict ${stamp})${ext}`;
  }

  const engine = {
    async getDirectoryHandle() {
      return FileSyncStore.getConfig('dirHandle');
    },

    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },

    getState() {
      return { ...state };
    },

    /** Link a folder. Must be called from a user gesture. */
    async connect() {
      const handle = await FileSyncLocal.pickDirectory();
      await FileSyncStore.setConfig('dirHandle', handle);
      await FileSyncStore.setConfig('enabled', true);
      await FileSyncStore.setConfig('paused', false);
      await FileSyncStore.clearSnapshot();
      state.dirName = handle.name;
      state.guard = null;
      await engine.start();
      return handle;
    },

    /** Forget the link. Touches no files on either side. */
    async disconnect() {
      await FileSyncStore.setConfig('enabled', false);
      await FileSyncStore.deleteConfig('dirHandle');
      await FileSyncStore.clearSnapshot();
      state.dirName = null;
      state.guard = null;
      state.conflicts = [];
      setStatus('idle', 'Local sync is off.');
    },

    async pause() {
      await FileSyncStore.setConfig('paused', true);
      setStatus('paused', 'Sync paused.');
    },

    async resume() {
      await FileSyncStore.setConfig('paused', false);
      state.guard = null;
      setStatus('idle');
      engine.syncNow();
    },

    /** Acknowledge a tripped mass-delete guard and let the deletions through. */
    async confirmGuard() {
      state.guard = null;
      await FileSyncStore.setConfig('guardOverrideUntil', Date.now() + 60000);
      await FileSyncStore.setConfig('paused', false);
      setStatus('idle');
      engine.syncNow();
    },

    /** Discard the local view and re-download everything the server has. */
    async resolveGuardByRedownload() {
      await FileSyncStore.clearSnapshot();
      state.guard = null;
      await FileSyncStore.setConfig('paused', false);
      setStatus('idle');
      engine.syncNow();
    },

    /** One full cycle. Safe to call concurrently — extra calls coalesce. */
    syncNow() {
      if (engine._running) {
        engine._queued = true;
        return engine._running;
      }
      engine._running = engine._cycle()
        .catch((err) => {
          setStatus('attention', err.message || 'Sync failed.');
        })
        .finally(() => {
          engine._running = null;
          if (engine._queued) {
            engine._queued = false;
            engine.syncNow();
          }
        });
      return engine._running;
    },

    async _cycle() {
      const enabled = await FileSyncStore.getConfig('enabled');
      const paused = await FileSyncStore.getConfig('paused');
      if (!enabled || paused || !state.isLeader) return;

      const handle = await FileSyncStore.getConfig('dirHandle');
      if (!handle) return;

      const permission = await FileSyncLocal.permissionState(handle);
      if (permission !== 'granted') {
        setStatus('attention', 'Permission to the folder was lost. Click Resume sync.');
        return;
      }

      setStatus('syncing');
      state.dirName = handle.name;

      const [{ files: local, skipped }, remoteAll, snapshot] = await Promise.all([
        FileSyncLocal.scan(handle),
        withRetry(() => FileSyncRemote.snapshot()),
        FileSyncStore.getSnapshot(),
      ]);

      // Two server paths differing only by case cannot both exist on a
      // case-insensitive disk. Drop them from consideration entirely — syncing
      // either one would clobber the other and the pair would fight forever.
      const collisions = FileSyncDiffer.caseCollisions(Object.keys(remoteAll));
      const remote = { ...remoteAll };
      collisions.forEach((path) => { delete remote[path]; });
      state.skipped = skipped.concat(collisions.map((path) => ({
        path,
        reason: 'another file on the server differs only by capitalisation',
      })));

      const { actions, guard } = FileSyncDiffer.diff(snapshot, local, remote);

      const override = await FileSyncStore.getConfig('guardOverrideUntil');
      const overridden = typeof override === 'number' && override > Date.now();
      if (guard && !overridden) {
        state.guard = guard;
        await FileSyncStore.setConfig('paused', true);
        setStatus('attention',
          `${guard.deleteCount} files disappeared from the folder. Sync paused so they are not deleted from the server.`);
        return;
      }

      // Conflicts first: they turn into an upload of a renamed copy plus a
      // download of the server's version, so resolve before the main pass.
      const resolved = [];
      for (const action of actions.filter((a) => a.type === 'conflict')) {
        resolved.push(...await engine._resolveConflict(handle, action.path, remote));
      }

      const plan = actions.filter((a) => a.type !== 'conflict').concat(resolved);

      const failures = await pool(plan, async (action) => {
        await engine._apply(handle, action, remote);
      }, TRANSFER_CONCURRENCY);

      // Drop snapshot rows for paths gone from both sides.
      for (const path of Object.keys(snapshot)) {
        if (!local[path] && !remote[path]) await FileSyncStore.deleteSnapshotRow(path);
      }

      state.lastSyncAt = Date.now();

      // A quota rejection will repeat on every cycle until the user frees
      // space, so say what happened rather than looping silently. Downloads
      // and deletions in this cycle already ran; only uploads are affected.
      const quotaFailure = failures.find((f) => f.err && f.err.status === 409
        && f.err.payload && typeof f.err.payload.bytesRemaining === 'number');
      if (quotaFailure) {
        setStatus('attention',
          'Your My Files storage is full, so new files could not be uploaded. '
          + 'Delete something in My Files, then click Resume sync.');
        await FileSyncStore.setConfig('paused', true);
        return;
      }

      if (failures.length) {
        setStatus('attention', `${failures.length} file(s) failed to sync. Retrying next cycle.`);
      } else {
        setStatus('synced');
      }
    },

    /**
     * Both sides changed. Identical content is adopted silently; otherwise the
     * server's copy stays canonical and the local copy is uploaded beside it
     * under a conflict name, so no version is ever lost.
     */
    async _resolveConflict(handle, path, remote) {
      const file = await FileSyncLocal.readFile(handle, path);
      if (!file) return [{ type: 'download', path }];

      const remoteEntry = remote[path];
      let sameContent = false;
      if (remoteEntry && remoteEntry.etag && file.size === remoteEntry.size) {
        try {
          sameContent = (await FileSyncHash.md5(file)) === remoteEntry.etag;
        } catch (err) {
          sameContent = false;
        }
      }

      if (sameContent) {
        // Same bytes on both sides: just record the agreed state.
        await FileSyncStore.putSnapshotRow(path, {
          size: file.size, mtimeMs: file.lastModified, etag: remoteEntry.etag,
        });
        return [];
      }

      const copyPath = conflictName(path);
      const result = await withRetry(() => FileSyncRemote.upload(copyPath, file));
      await FileSyncStore.putSnapshotRow(copyPath, {
        size: file.size,
        mtimeMs: file.lastModified,
        etag: result.etag || await FileSyncHash.md5(file),
      });
      state.conflicts.unshift({ path, copyPath, at: Date.now() });
      state.conflicts = state.conflicts.slice(0, 20);
      note('conflict', path, `kept the server copy; yours saved as ${copyPath}`);
      // Also write the local copy under the conflict name so both live on disk.
      await FileSyncLocal.writeFile(handle, copyPath, file);
      return [{ type: 'download', path }];
    },

    async _apply(handle, action, remote) {
      const { type, path } = action;

      if (type === 'upload') {
        const file = await FileSyncLocal.readFile(handle, path);
        if (!file) return; // vanished mid-cycle; next cycle sees the truth
        const result = await withRetry(() => FileSyncRemote.upload(path, file));
        await FileSyncStore.putSnapshotRow(path, {
          size: file.size,
          mtimeMs: file.lastModified,
          etag: result.etag || await FileSyncHash.md5(file),
        });
        note('upload', path);
        return;
      }

      if (type === 'download') {
        const blob = await withRetry(() => FileSyncRemote.download(path));
        const written = await FileSyncLocal.writeFile(handle, path, blob);
        // The bytes came from the server, so the server's ETag is the correct
        // baseline — recording anything else makes the next cycle see a
        // phantom remote change and download the same file forever.
        await FileSyncStore.putSnapshotRow(path, {
          size: written.size,
          mtimeMs: written.lastModified,
          etag: (remote[path] && remote[path].etag) || null,
        });
        note('download', path);
        return;
      }

      if (type === 'deleteRemote') {
        await withRetry(() => FileSyncRemote.remove(path));
        await FileSyncStore.deleteSnapshotRow(path);
        note('deleteRemote', path);
        return;
      }

      if (type === 'deleteLocal') {
        await FileSyncLocal.deleteFile(handle, path);
        await FileSyncStore.deleteSnapshotRow(path);
        note('deleteLocal', path);
      }
    },

    /**
     * Begin leader election and scheduling. Idempotent, and safe to call again
     * after connect() — the enabled check must come before the _started guard,
     * or the first (disabled) call would latch _started and connect() could
     * never start the scheduler.
     */
    async start() {
      if (!FileSyncLocal.isSupported()) {
        setStatus('unsupported', 'This browser cannot sync a local folder. Use Chrome or Edge.');
        return;
      }

      const enabled = await FileSyncStore.getConfig('enabled');
      if (!enabled) {
        setStatus('idle');
        return;
      }

      if (engine._started) {
        engine.syncNow();
        return;
      }
      engine._started = true;

      if (!navigator.locks) {
        state.isLeader = true;
        engine._schedule();
        return;
      }

      // Held for the tab's lifetime; the promise never resolves, so the lock is
      // released only when this tab closes and another tab takes over.
      navigator.locks.request(LOCK_NAME, () => new Promise(() => {
        state.isLeader = true;
        engine._schedule();
        emit();
      }));
    },

    _schedule() {
      if (engine._timers) return;
      engine._timers = [
        setInterval(() => engine.syncNow(), REMOTE_POLL_MS),
        setInterval(() => engine.syncNow(), LOCAL_POLL_MS),
      ];
      root.addEventListener('focus', () => engine.syncNow());
      engine.syncNow();
    },

    _running: null,
    _queued: false,
    _started: false,
    _timers: null,
    conflictName,
  };

  root.FileSync = engine;
}(typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/file-sync.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add js/file-sync.js
git commit -m "feat(my-files): add local sync engine with leader election and retry"
```

---

### Task 9: UI + wiring into the pages

**Files:**
- Create: `js/file-sync-ui.js`
- Modify: `Calculators/My Files/my-files.html`
- Modify: `Calculators/My Files/styles.css`
- Modify: `index.html`

- [ ] **Step 1: Implement the UI module**

Create `js/file-sync-ui.js`:

```javascript
/**
 * Local-sync UI for the My Files popup: a header pill plus a details panel.
 * The engine is headless; this is its only chrome.
 */
(function (root) {
  'use strict';

  const LABELS = {
    idle: 'Local sync off',
    syncing: 'Syncing…',
    synced: 'Synced',
    paused: 'Sync paused',
    attention: 'Needs attention',
    unsupported: 'Sync unavailable',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function relative(ts) {
    if (!ts) return '';
    const seconds = Math.round((Date.now() - ts) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
  }

  function mount(container) {
    const pill = el('button', 'sync-pill');
    pill.type = 'button';
    const panel = el('div', 'sync-panel');
    panel.hidden = true;

    container.appendChild(pill);
    container.appendChild(panel);

    pill.addEventListener('click', () => { panel.hidden = !panel.hidden; });

    function render(state) {
      pill.dataset.status = state.status;
      const dirSuffix = state.dirName && state.status !== 'idle' ? ` · ${state.dirName}` : '';
      pill.textContent = `${LABELS[state.status] || state.status}${dirSuffix}`;

      panel.innerHTML = '';

      if (state.status === 'unsupported') {
        panel.appendChild(el('p', 'sync-note',
          'Folder sync needs Chrome or Edge on desktop. Everything else in My Files still works here.'));
        return;
      }

      if (state.status === 'idle') {
        panel.appendChild(el('p', 'sync-note',
          'Pick a folder on this computer and it stays in sync with My Files — add, edit, or delete on either side.'));
        const connect = el('button', 'sync-action primary', 'Choose folder…');
        connect.type = 'button';
        connect.addEventListener('click', async () => {
          connect.disabled = true;
          try {
            await FileSync.connect();
          } catch (err) {
            if (err && err.name !== 'AbortError') {
              panel.appendChild(el('p', 'sync-error', err.message || 'Could not link that folder.'));
            }
          } finally {
            connect.disabled = false;
          }
        });
        panel.appendChild(connect);
        return;
      }

      if (state.message) {
        panel.appendChild(el('p', state.status === 'attention' ? 'sync-error' : 'sync-note', state.message));
      }

      if (state.guard) {
        const actions = el('div', 'sync-actions');
        const confirm = el('button', 'sync-action danger', `Yes, delete ${state.guard.deleteCount} on the server`);
        confirm.type = 'button';
        confirm.addEventListener('click', () => FileSync.confirmGuard());
        const restore = el('button', 'sync-action', 'No, re-download them instead');
        restore.type = 'button';
        restore.addEventListener('click', () => FileSync.resolveGuardByRedownload());
        actions.appendChild(confirm);
        actions.appendChild(restore);
        panel.appendChild(actions);
      }

      if (state.lastSyncAt) {
        panel.appendChild(el('p', 'sync-meta', `Last synced ${relative(state.lastSyncAt)}`));
      }

      if (state.conflicts.length) {
        panel.appendChild(el('h4', 'sync-heading', 'Conflicts'));
        const list = el('ul', 'sync-list');
        state.conflicts.forEach((c) => {
          list.appendChild(el('li', null, `${c.path} — your version saved as ${c.copyPath}`));
        });
        panel.appendChild(list);
      }

      if (state.skipped.length) {
        panel.appendChild(el('h4', 'sync-heading', `Skipped (${state.skipped.length})`));
        const list = el('ul', 'sync-list');
        state.skipped.slice(0, 10).forEach((s) => {
          list.appendChild(el('li', null, `${s.path} — ${s.reason}`));
        });
        panel.appendChild(list);
      }

      if (state.activity.length) {
        panel.appendChild(el('h4', 'sync-heading', 'Recent activity'));
        const list = el('ul', 'sync-list');
        state.activity.slice(0, 8).forEach((a) => {
          const verb = { upload: 'Uploaded', download: 'Downloaded', deleteRemote: 'Removed from server', deleteLocal: 'Removed locally', conflict: 'Conflict' }[a.kind] || a.kind;
          list.appendChild(el('li', null, `${verb}: ${a.path}${a.detail ? ` (${a.detail})` : ''}`));
        });
        panel.appendChild(list);
      }

      const actions = el('div', 'sync-actions');
      if (state.status === 'paused') {
        const resume = el('button', 'sync-action primary', 'Resume sync');
        resume.type = 'button';
        resume.addEventListener('click', () => FileSync.resume());
        actions.appendChild(resume);
      } else if (!state.guard) {
        const pause = el('button', 'sync-action', 'Pause');
        pause.type = 'button';
        pause.addEventListener('click', () => FileSync.pause());
        actions.appendChild(pause);
      }
      const disconnect = el('button', 'sync-action', 'Disconnect folder');
      disconnect.type = 'button';
      disconnect.addEventListener('click', () => FileSync.disconnect());
      actions.appendChild(disconnect);
      panel.appendChild(actions);
    }

    FileSync.subscribe(render);
  }

  root.FileSyncUI = { mount };
}(typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 2: Wire the popup**

In `Calculators/My Files/my-files.html`:

a) Add the mount point at the end of the `.toolbar` div (line 24-30), immediately after the `btnTrash` button on line 29:

```html
    <div id="syncMount" class="sync-mount"></div>
```

b) Immediately before the page's own inline `<script>` (line 84), add the script tags. **Root-absolute paths are required** — `build.js`'s HTML rewriter matches `src="/js/…"` but ignores `../../js/…`, so a relative path would never be rewritten to the hashed filename:

```html
<script src="/vendor/spark-md5/spark-md5.min.js"></script>
<script src="/js/file-sync-differ.js"></script>
<script src="/js/file-sync-store.js"></script>
<script src="/js/file-sync-hash.js"></script>
<script src="/js/file-sync-local.js"></script>
<script src="/js/file-sync-remote.js"></script>
<script src="/js/file-sync.js"></script>
<script src="/js/file-sync-ui.js"></script>
```

c) At the end of the page's existing inline `<script>` (after its `load()` bootstrap), start the engine and refresh the listing when sync changes something:

```javascript
    /* ── Local folder sync ── */
    if (window.FileSync) {
      FileSyncUI.mount(document.getElementById('syncMount'));
      FileSync.start();
      let lastSyncSeen = null;
      FileSync.subscribe((state) => {
        // Re-list when a cycle finishes, so files synced from disk appear
        // without the user having to refresh.
        if (state.status === 'synced' && state.lastSyncAt !== lastSyncSeen) {
          lastSyncSeen = state.lastSyncAt;
          load();
          refreshUsage();
        }
      });
    }
```

- [ ] **Step 3: Wire the SPA (headless)**

In `index.html`, add the same script tags before the closing `</body>` (after the existing app scripts), plus a start call. No UI mount — the SPA only keeps sync running while the dashboard is open:

```html
<script src="/vendor/spark-md5/spark-md5.min.js"></script>
<script src="/js/file-sync-differ.js"></script>
<script src="/js/file-sync-store.js"></script>
<script src="/js/file-sync-hash.js"></script>
<script src="/js/file-sync-local.js"></script>
<script src="/js/file-sync-remote.js"></script>
<script src="/js/file-sync.js"></script>
<script>
  // Headless: the popup owns the sync UI. This just keeps a linked folder in
  // sync while the dashboard is open.
  if (window.FileSync && window.FileSyncLocal && FileSyncLocal.isSupported()) FileSync.start();
</script>
```

- [ ] **Step 4: Add styles**

Append to `Calculators/My Files/styles.css`. This page is light-only and uses the MSFG brand tokens declared at the top of the file (`--msfg-green`, `--msfg-teal`, `--msfg-gray`, `--danger`, `--radius`) — no dark-theme variants and no `--surface`/`--text`/`--accent` tokens exist here, so do not invent them:

```css
/* ── Local folder sync ── */
.sync-mount { position: relative; display: inline-flex; margin-left: auto; }

.sync-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
  font-size: 13px; font-family: inherit;
  border: 1px solid rgba(64, 64, 65, .2);
  background: #fff; color: var(--msfg-gray);
}
.sync-pill::before {
  content: ''; width: 8px; height: 8px; border-radius: 50%;
  background: currentColor; opacity: .75;
}
.sync-pill[data-status="synced"]    { color: #2f7d0f; border-color: var(--msfg-green-border); }
.sync-pill[data-status="syncing"]   { color: var(--msfg-teal); }
.sync-pill[data-status="paused"]    { color: #a16207; }
.sync-pill[data-status="attention"] { color: var(--danger); border-color: rgba(192, 57, 43, .5); }

.sync-panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  width: 340px; max-height: 60vh; overflow-y: auto;
  padding: 14px; border-radius: var(--radius);
  border: 1px solid rgba(64, 64, 65, .15);
  background: #fff; color: var(--msfg-gray);
  box-shadow: 0 10px 30px rgba(16, 69, 71, .18);
}
.sync-heading {
  margin: 12px 0 4px; font-size: 11px; letter-spacing: .04em;
  text-transform: uppercase; color: var(--msfg-teal); opacity: .8;
}
.sync-note, .sync-meta { margin: 0 0 8px; font-size: 13px; line-height: 1.45; }
.sync-meta { opacity: .65; }
.sync-error { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--danger); }
.sync-list { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5; word-break: break-word; }
.sync-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.sync-action {
  padding: 6px 12px; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-family: inherit;
  border: 1px solid rgba(64, 64, 65, .2);
  background: #fff; color: var(--msfg-gray);
}
.sync-action.primary { background: var(--msfg-green); border-color: var(--msfg-green-border); color: var(--msfg-teal); font-weight: 600; }
.sync-action.danger  { background: var(--danger); border-color: var(--danger); color: #fff; }
.sync-action:disabled { opacity: .6; cursor: default; }
```

- [ ] **Step 5: Syntax check and build**

Run: `node --check js/file-sync-ui.js && node build.js`
Expected: `node --check` silent; `build.js complete:` summary with a non-zero hashed-asset count.

- [ ] **Step 6: Verify the build rewrote the new scripts**

Run: `grep -o '/js/file-sync-[a-z]*\.[a-z0-9]*\.js' "dist/Calculators/My Files/my-files.html" | sort -u`
Expected: hashed filenames (e.g. `/js/file-sync-differ.a1b2c3d4.js`), **not** the unhashed `/js/file-sync-differ.js`. If they came through unhashed, the path in the HTML is wrong.

Run: `ls dist/vendor/spark-md5/`
Expected: `spark-md5.min.js` present (vendor is a passthrough, so it stays unhashed).

- [ ] **Step 7: Commit**

```bash
git add js/file-sync-ui.js "Calculators/My Files/my-files.html" "Calculators/My Files/styles.css" index.html
git commit -m "feat(my-files): add local sync UI and wire it into the popup and SPA"
```

---

### Task 10: Browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve the built site**

Add a `.claude/launch.json` entry if none exists for a static server, then use `preview_start`. A minimal config:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dashboard-dist", "runtimeExecutable": "npx", "runtimeArgs": ["-y", "serve", "dist", "-l", "4173"], "port": 4173 }
  ]
}
```

- [ ] **Step 2: Load the My Files popup and confirm no console errors**

Navigate to `http://localhost:4173/Calculators/My%20Files/my-files.html`, then `read_console_messages`.
Expected: no `ReferenceError`/`404` for any `file-sync-*.js` or `spark-md5.min.js`. An auth error from `/api/my-files` is expected without a session and is not a failure of this task.

- [ ] **Step 3: Confirm the globals loaded and the pill rendered**

Run via `javascript_tool`:

```javascript
JSON.stringify({
  differ: typeof FileSyncDiffer,
  store: typeof FileSyncStore,
  local: typeof FileSyncLocal,
  remote: typeof FileSyncRemote,
  hash: typeof FileSyncHash,
  engine: typeof FileSync,
  spark: typeof SparkMD5,
  pill: document.querySelector('.sync-pill')?.textContent,
})
```

Expected: every type is `object` (or `function` for `SparkMD5`), and `pill` is a non-empty label.

- [ ] **Step 4: Screenshot the panel**

Click the pill (`computer` → `left_click`), then screenshot. Confirm the panel shows the "Choose folder…" call to action, sits inside the viewport (it is right-anchored — check it is not clipped at the 1200 px popup width), and matches the page's MSFG green/teal palette. This page is light-only; there is no dark theme to check.

- [ ] **Step 5: Run the full backend suite one more time**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 6: Commit any fixes found**

```bash
git add -A
git commit -m "fix(my-files): address issues found in browser verification"
```

(Skip if nothing needed fixing.)

---

## Deployment note

Frontend-only change plus one additive backend endpoint. Deploy with `./deploy.sh --backend`.

**Check the EC2 box's git state before deploying** — per the project notes, the prod box is sometimes on a feature branch or carries local hotfix commits, and `deploy.sh --backend` runs `git pull origin main` there, which fails on divergence. Confirm the box is clean and on `main` first. The frontend (S3) half is independent and safe.
