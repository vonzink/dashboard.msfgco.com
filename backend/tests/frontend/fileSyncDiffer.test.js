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
