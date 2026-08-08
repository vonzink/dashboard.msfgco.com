/**
 * File System Access API adapter for My Files local sync.
 *
 * Every path in and out of this module is a forward-slash relative path, the
 * same shape the backend uses, so the differ never sees platform differences.
 */
(function (root) {
  'use strict';

  // S3 single-PUT limit. The backend presigns a plain PutObject, so a larger
  // file cannot be uploaded at all — skip it loudly rather than fail a cycle.
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

  const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);

  /**
   * Names the backend's normalizeSegments() rejects outright, mirrored here so
   * the client skips them with an explanation instead of eating a 400
   * mid-cycle. Hidden files are skipped too: they are editor and OS bookkeeping
   * the user did not put there.
   */
  function skipReason(name) {
    if (SKIP_NAMES.has(name)) return 'system file';
    if (name.startsWith('.')) return 'hidden file';
    if (name.includes('\\')) return 'name contains a backslash';
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) return 'name contains control characters';
    if (name.length > 255) return 'name longer than 255 characters';
    return null;
  }

  function isSupported() {
    return typeof root.showDirectoryPicker === 'function'
      && typeof root.indexedDB !== 'undefined';
  }

  /** Ask for a folder. Must be called from a user gesture. */
  function pickDirectory() {
    return root.showDirectoryPicker({ mode: 'readwrite', id: 'msfg-my-files' });
  }

  /** 'granted' | 'prompt' | 'denied' */
  function permissionState(handle) {
    return handle.queryPermission({ mode: 'readwrite' });
  }

  /** Re-request readwrite access. Must be called from a user gesture. */
  function requestPermission(handle) {
    return handle.requestPermission({ mode: 'readwrite' });
  }

  /**
   * Recursive scan.
   *
   * @param {FileSystemDirectoryHandle} rootHandle
   * @returns {Promise<{files: Object, skipped: Array<{path: string, reason: string}>}>}
   *          files is keyed by path → {size, mtimeMs}
   */
  async function scan(rootHandle) {
    const files = {};
    const skipped = [];

    async function walk(dirHandle, prefix) {
      for await (const [name, handle] of dirHandle.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        const reason = skipReason(name);
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
      return await handle.getFile();
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
