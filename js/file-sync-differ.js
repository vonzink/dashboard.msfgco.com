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
