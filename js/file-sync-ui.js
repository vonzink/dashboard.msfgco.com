/**
 * Local-sync UI for the My Files popup: a toolbar pill plus a details panel.
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

  const VERBS = {
    upload: 'Uploaded',
    download: 'Downloaded',
    deleteRemote: 'Removed from My Files',
    deleteLocal: 'Removed locally',
    conflict: 'Conflict',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, label, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
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
    if (!container) return;

    const pill = el('button', 'sync-pill');
    pill.type = 'button';
    const panel = el('div', 'sync-panel');
    panel.hidden = true;

    container.appendChild(pill);
    container.appendChild(panel);

    pill.addEventListener('click', () => { panel.hidden = !panel.hidden; });
    document.addEventListener('click', (event) => {
      if (!panel.hidden && !container.contains(event.target)) panel.hidden = true;
    });

    function renderIdle() {
      panel.appendChild(el(
        'p',
        'sync-note',
        'Pick a folder on this computer and it stays in sync with My Files — '
        + 'add, edit, or delete on either side and the other follows.'
      ));
      const connect = button('sync-action primary', 'Choose folder…', async () => {
        connect.disabled = true;
        try {
          await FileSync.connect();
        } catch (err) {
          // Dismissing the OS folder picker is a normal outcome, not an error.
          if (err && err.name !== 'AbortError') {
            panel.appendChild(el('p', 'sync-error', err.message || 'Could not link that folder.'));
          }
        } finally {
          connect.disabled = false;
        }
      });
      panel.appendChild(connect);
    }

    function renderList(heading, items, toText) {
      if (!items.length) return;
      panel.appendChild(el('h4', 'sync-heading', heading));
      const list = el('ul', 'sync-list');
      items.forEach((item) => list.appendChild(el('li', null, toText(item))));
      panel.appendChild(list);
    }

    function render(state) {
      pill.dataset.status = state.status;
      const suffix = state.dirName && state.status !== 'idle' ? ` · ${state.dirName}` : '';
      pill.textContent = `${LABELS[state.status] || state.status}${suffix}`;

      panel.innerHTML = '';

      if (state.status === 'unsupported') {
        panel.appendChild(el(
          'p',
          'sync-note',
          'Folder sync needs Chrome or Edge on a desktop computer. '
          + 'Everything else in My Files still works here.'
        ));
        return;
      }

      if (state.status === 'idle') {
        renderIdle();
        return;
      }

      if (state.message) {
        panel.appendChild(el(
          'p',
          state.status === 'attention' ? 'sync-error' : 'sync-note',
          state.message
        ));
      }

      if (state.guard) {
        const actions = el('div', 'sync-actions');
        actions.appendChild(button(
          'sync-action danger',
          `Yes, delete ${state.guard.deleteCount} from My Files`,
          () => FileSync.confirmGuard()
        ));
        actions.appendChild(button(
          'sync-action',
          'No, put them back',
          () => FileSync.resolveGuardByRedownload()
        ));
        panel.appendChild(actions);
      }

      if (state.lastSyncAt) {
        panel.appendChild(el('p', 'sync-meta', `Last synced ${relative(state.lastSyncAt)}`));
      }

      renderList('Conflicts', state.conflicts, (c) => `${c.path} — your version saved as ${c.copyPath}`);
      renderList('Skipped', state.skipped.slice(0, 10), (s) => `${s.path} — ${s.reason}`);
      renderList(
        'Recent activity',
        state.activity.slice(0, 8),
        (a) => `${VERBS[a.kind] || a.kind}: ${a.path}${a.detail ? ` (${a.detail})` : ''}`
      );

      const actions = el('div', 'sync-actions');
      if (state.status === 'paused' || state.status === 'attention') {
        actions.appendChild(button('sync-action primary', 'Resume sync', () => FileSync.resume()));
      } else if (!state.guard) {
        actions.appendChild(button('sync-action', 'Pause', () => FileSync.pause()));
      }
      actions.appendChild(button('sync-action', 'Disconnect folder', () => FileSync.disconnect()));
      panel.appendChild(actions);
    }

    FileSync.subscribe(render);
  }

  root.FileSyncUI = { mount };
}(typeof self !== 'undefined' ? self : this));
