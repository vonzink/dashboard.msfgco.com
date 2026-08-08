/**
 * Persistent state for My Files local sync.
 *
 * Two stores: `config` (the directory handle and the enabled/paused flags) and
 * `snapshot` (one row per synced file, the baseline the differ compares
 * against). Directory handles survive a reload only in IndexedDB — they cannot
 * be serialised to localStorage.
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

  /** Run work against one store, resolving once the transaction commits. */
  function tx(storeName, mode, work) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try {
        request = work(store);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }));
  }

  const store = {
    getConfig(key) {
      return tx(CONFIG_STORE, 'readonly', (s) => s.get(key));
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
     * fails halfway still leaves the completed files correctly recorded.
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
