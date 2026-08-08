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
    status: 'idle', // idle | syncing | synced | paused | attention | unsupported
    message: '',
    isLeader: false,
    dirName: null,
    activity: [], // most recent first
    conflicts: [],
    skipped: [],
    guard: null,
    lastSyncAt: null,
  };

  const listeners = new Set();

  function publicState() {
    return { ...state, activity: state.activity.slice(0, 20) };
  }

  function emit() {
    const snapshotOfState = publicState();
    listeners.forEach((fn) => fn(snapshotOfState));
    if (channel && state.isLeader) channel.postMessage({ type: 'status', state: snapshotOfState });
  }

  if (channel) {
    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'status' && !state.isLeader) {
        Object.assign(state, event.data.state, { isLeader: false });
        listeners.forEach((fn) => fn(publicState()));
      }
    };
  }

  function setStatus(status, message = '') {
    state.status = status;
    state.message = message;
    emit();
  }

  function note(kind, path, detail) {
    state.activity.unshift({
      kind, path, detail, at: Date.now(),
    });
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
        // eslint-disable-next-line no-await-in-loop
        return await fn();
      } catch (err) {
        lastError = err;
        const status = err && err.status;
        const retryable = status === 429
          || (status >= 500 && status < 600)
          || status === undefined;
        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
        const backoff = 500 * (2 ** (attempt - 1));
        // eslint-disable-next-line no-await-in-loop
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
    subscribe(fn) {
      listeners.add(fn);
      fn(publicState());
      return () => listeners.delete(fn);
    },

    getState() {
      return publicState();
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
      state.skipped = [];
      setStatus('idle', 'Local sync is off.');
    },

    async pause() {
      await FileSyncStore.setConfig('paused', true);
      setStatus('paused', 'Sync paused.');
    },

    async resume() {
      const handle = await FileSyncStore.getConfig('dirHandle');
      // Re-granting folder access needs the user gesture that got us here.
      if (handle && await FileSyncLocal.permissionState(handle) !== 'granted') {
        await FileSyncLocal.requestPermission(handle);
      }
      await FileSyncStore.setConfig('paused', false);
      state.guard = null;
      setStatus('idle');
      await engine.start();
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

    /** Discard the local baseline and re-download whatever the server has. */
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
          setStatus('attention', (err && err.message) || 'Sync failed.');
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
        setStatus('attention', 'Access to the folder was lost. Click Resume sync to restore it.');
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
        setStatus(
          'attention',
          `${guard.deleteCount} files disappeared from the folder. `
          + 'Sync paused so they are not deleted from the server.'
        );
        return;
      }

      // Conflicts first: each becomes an upload of a renamed copy plus a
      // download of the server's version, so resolve before the main pass.
      const resolved = [];
      for (const action of actions.filter((a) => a.type === 'conflict')) {
        // eslint-disable-next-line no-await-in-loop
        resolved.push(...await engine._resolveConflict(handle, action.path, remote));
      }

      const plan = actions.filter((a) => a.type !== 'conflict').concat(resolved);

      const failures = await pool(
        plan,
        (action) => engine._apply(handle, action, remote),
        TRANSFER_CONCURRENCY
      );

      // Drop snapshot rows for paths gone from both sides.
      for (const path of Object.keys(snapshot)) {
        // eslint-disable-next-line no-await-in-loop
        if (!local[path] && !remote[path]) await FileSyncStore.deleteSnapshotRow(path);
      }

      state.lastSyncAt = Date.now();

      // A quota rejection repeats every cycle until the user frees space, so
      // say what happened rather than looping silently. Downloads and deletes
      // in this cycle already ran; only uploads are affected.
      const quotaFailure = failures.find((f) => f.err && f.err.status === 409
        && f.err.payload && typeof f.err.payload.bytesRemaining === 'number');
      if (quotaFailure) {
        await FileSyncStore.setConfig('paused', true);
        setStatus(
          'attention',
          'Your My Files storage is full, so new files could not be uploaded. '
          + 'Delete something in My Files, then click Resume sync.'
        );
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
      // Keep the local copy under the conflict name too, so both versions
      // exist on disk and on the server under the same two names.
      const written = await FileSyncLocal.writeFile(handle, copyPath, file);
      await FileSyncStore.putSnapshotRow(copyPath, {
        size: written.size,
        mtimeMs: written.lastModified,
        etag: result.etag || await FileSyncHash.md5(file),
      });
      state.conflicts.unshift({ path, copyPath, at: Date.now() });
      state.conflicts = state.conflicts.slice(0, 20);
      note('conflict', path, `kept the server copy; yours saved as ${copyPath}`);
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

      const handle = await FileSyncStore.getConfig('dirHandle');
      if (handle) state.dirName = handle.name;

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

      // Held for the tab's lifetime: the callback's promise never resolves, so
      // the lock is released only when this tab closes and another takes over.
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
