(function initializeWebinarStudioAccessHistory(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioAccessHistory = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioAccessHistoryApi() {
  'use strict';

  const MAX_LABEL_LENGTH = 255;

  function required(value, message) {
    if (!value) throw new TypeError(message);
    return value;
  }

  function createNode(document, tagName, attributes = {}, content = null) {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'class') node.className = value;
      else if (name === 'checked') node.checked = Boolean(value);
      else if (name === 'disabled') node.disabled = Boolean(value);
      else if (name === 'value') node.value = String(value);
      else node.setAttribute(name, String(value));
    }
    if (content !== null) node.textContent = String(content);
    return node;
  }

  function append(parent, ...children) {
    parent.append(...children.filter(Boolean));
    return parent;
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function boundedLabel(value, fallback) {
    const label = typeof value === 'string' ? value.trim() : '';
    return (label || fallback).slice(0, MAX_LABEL_LENGTH);
  }

  function normalizeDirectory(value) {
    if (!Array.isArray(value)) throw new TypeError('Active user directory must be an array');
    const seen = new Set();
    return value.reduce((users, row) => {
      const id = positiveInteger(row?.id);
      if (!id || seen.has(id) || row?.is_active === 0 || row?.isActive === false) return users;
      seen.add(id);
      users.push({
        id,
        name: boundedLabel(row.name, `User ${id}`),
        email: boundedLabel(row.email, ''),
      });
      return users;
    }, []);
  }

  function normalizeHistory(value) {
    if (!Array.isArray(value)) throw new TypeError('Revision history must be an array');
    return value.reduce((items, row) => {
      const id = positiveInteger(row?.id);
      const version = positiveInteger(row?.version);
      const createdAt = new Date(row?.createdAt);
      if (!id || !version || !Number.isFinite(createdAt.getTime())) return items;
      items.push({
        id,
        version,
        changeType: boundedLabel(row.changeType, 'saved_revision'),
        changeSummary: boundedLabel(row.changeSummary, 'Saved revision'),
        createdAt,
        actorName: boundedLabel(row.createdBy?.name, 'Unknown user'),
      });
      return items;
    }, []);
  }

  function createAccessHistory({ api, confirm, document } = {}) {
    required(api, 'Access and history API is required');
    required(typeof confirm === 'function', 'Confirmation function is required');
    required(document && typeof document.createElement === 'function', 'Access and history document is required');

    let context = null;
    let directory = [];
    let history = [];
    let search = '';
    let errorMessage = '';
    let activePanel = null;
    let renderGeneration = 0;

    function assertContext(next) {
      required(next?.root && typeof next.root.replaceChildren === 'function', 'Access and history root is required');
      required(positiveInteger(next.webinarId || next.state?.webinar?.id), 'A webinar id is required');
      required(next.state?.webinar, 'Webinar state is required');
      required(typeof next.reload === 'function', 'A full webinar reload function is required');
      required(typeof next.hasUnsavedChanges === 'function', 'An unsaved-change check is required');
      return next;
    }

    function webinarId() {
      return positiveInteger(context?.webinarId || context?.state?.webinar?.id);
    }

    function isAdmin() {
      return context?.isAdmin === true;
    }

    function currentState() {
      return (typeof context?.getState === 'function' ? context.getState() : null) || context?.state;
    }

    function ownerDisplay() {
      const ownerId = positiveInteger(currentState().webinar.primaryOwnerUserId);
      const directoryOwner = directory.find(user => user.id === ownerId);
      if (directoryOwner) return directoryOwner;
      if (positiveInteger(context.currentUser?.id) === ownerId) {
        return {
          id: ownerId,
          name: boundedLabel(context.currentUser?.name, `User ${ownerId}`),
          email: boundedLabel(context.currentUser?.email, ''),
        };
      }
      return { id: ownerId, name: `User ${ownerId}`, email: '' };
    }

    function renderError() {
      if (!errorMessage) return null;
      return createNode(document, 'p', { class: 'ws-form-error', role: 'alert' }, errorMessage);
    }

    function operationError(error, action) {
      const status = Number(error?.status || error?.statusCode || error?.response?.status);
      if (status === 409) return 'This webinar changed. Reload it before restoring a version.';
      if (status === 403) return 'The server denied this action. Your access may have changed.';
      if (status === 404) return 'This webinar is no longer available.';
      return `${action} could not be completed. Try again.`;
    }

    function renderAccess() {
      if (!context || activePanel !== 'access') return;
      const root = context.root;
      const owner = ownerDisplay();
      const heading = createNode(document, 'div', { class: 'ws-settings-section' });
      append(
        heading,
        createNode(document, 'h3', {}, 'Users & Access'),
        createNode(document, 'p', {}, 'The primary owner can edit this webinar. Active administrators can edit every webinar and manage access.'),
        createNode(document, 'p', { class: 'ws-owner-summary' }, `Primary owner: ${owner.name}${owner.email ? ` · ${owner.email}` : ''}`),
      );

      if (!isAdmin()) {
        append(heading, createNode(document, 'p', {}, 'Only an administrator can replace the primary owner, change public availability, or archive this webinar.'));
        root.replaceChildren(...[heading, renderError()].filter(Boolean));
        return;
      }

      const ownerSection = createNode(document, 'section', { class: 'ws-settings-section' });
      const searchInput = createNode(document, 'input', {
        type: 'search',
        'data-owner-search': '',
        'aria-label': 'Search active users by name or email',
        placeholder: 'Search active users',
        value: search,
      });
      searchInput.addEventListener('input', event => {
        search = String(event.target.value || '').trim().toLowerCase();
        renderAccess();
      });
      const results = createNode(document, 'div', { class: 'ws-owner-results', 'data-owner-results': '' });
      const visibleUsers = directory.filter(user => !search
        || user.name.toLowerCase().includes(search)
        || user.email.toLowerCase().includes(search));
      if (!visibleUsers.length) {
        append(results, createNode(document, 'p', {}, directory.length ? 'No active users match that search.' : 'No active users are available.'));
      } else {
        visibleUsers.forEach(user => {
          const button = createNode(document, 'button', {
            type: 'button',
            'data-change-owner': user.id,
            disabled: user.id === owner.id,
          }, user.id === owner.id ? `${user.name} · Current owner` : `${user.name}${user.email ? ` · ${user.email}` : ''}`);
          button.addEventListener('click', () => { void changeOwner(user.id); });
          append(results, button);
        });
      }
      append(
        ownerSection,
        createNode(document, 'h4', {}, 'Replace primary owner'),
        createNode(document, 'p', {}, 'Choose from the authenticated active-user directory.'),
        searchInput,
        results,
      );

      const audienceSection = createNode(document, 'section', { class: 'ws-settings-section' });
      const audienceToggle = createNode(document, 'input', {
        type: 'checkbox',
        'data-audience-toggle': '',
        checked: currentState().webinar.audienceEnabled === true,
        'aria-label': 'Allow public audience access',
      });
      audienceToggle.addEventListener('change', event => { void setAudienceEnabled(event.target.checked); });
      append(
        audienceSection,
        createNode(document, 'h4', {}, 'Audience access'),
        append(createNode(document, 'label'), audienceToggle, createNode(document, 'span', {}, ' Allow public audience access')),
        createNode(document, 'p', {}, 'This controls public availability. It does not publish a draft; only saved live content can appear to the audience.'),
      );

      const archiveSection = createNode(document, 'section', { class: 'ws-settings-section' });
      const archive = createNode(document, 'button', { type: 'button', 'data-archive-webinar': '', class: 'ws-form-cancel' }, 'Archive webinar');
      archive.addEventListener('click', () => { void archiveWebinar(); });
      append(
        archiveSection,
        createNode(document, 'h4', {}, 'Archive'),
        createNode(document, 'p', {}, 'Archiving removes this webinar from Studio and turns off audience access.'),
        archive,
      );

      root.replaceChildren(...[
        heading,
        ownerSection,
        audienceSection,
        archiveSection,
        renderError(),
      ].filter(Boolean));
    }

    function renderHistory() {
      if (!context || activePanel !== 'history') return;
      const root = context.root;
      const container = createNode(document, 'section', { class: 'ws-settings-section' });
      append(
        container,
        createNode(document, 'h3', {}, 'History'),
        createNode(document, 'p', {}, 'Restore a saved live version. History shows change details only; private source and presenter data stay out of this list.'),
      );
      if (!history.length) {
        append(container, createNode(document, 'p', {}, 'No saved revisions are available.'));
      } else {
        const list = createNode(document, 'ol', { class: 'ws-history-list' });
        history.forEach(revision => {
          const item = createNode(document, 'li', { 'data-revision-id': revision.id });
          const time = revision.createdAt.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          const restore = createNode(document, 'button', { type: 'button', 'data-restore-revision': revision.id }, `Restore version ${revision.version}`);
          restore.addEventListener('click', () => { void restoreRevision(revision.id); });
          append(
            item,
            createNode(document, 'strong', {}, `Version ${revision.version}`),
            createNode(document, 'span', {}, revision.changeSummary),
            createNode(document, 'small', {}, `${revision.actorName} · ${time}`),
            restore,
          );
          append(list, item);
        });
        append(container, list);
      }
      root.replaceChildren(...[container, renderError()].filter(Boolean));
    }

    function rerender() {
      if (activePanel === 'access') renderAccess();
      if (activePanel === 'history') renderHistory();
    }

    async function confirmReloadDiscard(action) {
      if (!context.hasUnsavedChanges()) return true;
      return confirm(`Discard unsaved changes and ${action}?`, {
        title: 'Discard unsaved changes?',
        confirmText: 'Discard and continue',
        cancelText: 'Keep editing',
        variant: 'warning',
      });
    }

    async function renderAccessPanel(nextContext) {
      context = assertContext(nextContext);
      activePanel = 'access';
      errorMessage = '';
      search = '';
      directory = [];
      renderAccess();
      if (!isAdmin()) return;
      const generation = ++renderGeneration;
      try {
        const users = normalizeDirectory(await api.listUsers());
        if (generation !== renderGeneration || activePanel !== 'access') return;
        directory = users;
      } catch (error) {
        if (generation !== renderGeneration || activePanel !== 'access') return;
        errorMessage = operationError(error, 'The active-user directory');
      }
      renderAccess();
    }

    async function renderHistoryPanel(nextContext) {
      context = assertContext(nextContext);
      activePanel = 'history';
      errorMessage = '';
      history = [];
      renderHistory();
      const generation = ++renderGeneration;
      try {
        const revisions = normalizeHistory(await api.getHistory(webinarId()));
        if (generation !== renderGeneration || activePanel !== 'history') return;
        history = revisions;
      } catch (error) {
        if (generation !== renderGeneration || activePanel !== 'history') return;
        errorMessage = operationError(error, 'Revision history');
      }
      renderHistory();
    }

    async function changeOwner(userId) {
      const targetId = positiveInteger(userId);
      if (!context || !isAdmin() || !targetId || !directory.some(user => user.id === targetId)) {
        errorMessage = 'Choose an active user from the directory.';
        rerender();
        return { ok: false, error: errorMessage };
      }
      if (!await confirmReloadDiscard('replace the primary owner')) return { ok: false, cancelled: true };
      errorMessage = '';
      try {
        await api.changeOwner(webinarId(), { primaryOwnerUserId: targetId });
        await context.reload();
        return { ok: true };
      } catch (error) {
        errorMessage = operationError(error, 'The owner change');
        rerender();
        return { ok: false, error: errorMessage };
      }
    }

    async function setAudienceEnabled(enabled) {
      if (!context || !isAdmin()) {
        errorMessage = 'The server requires administrator access for this action.';
        rerender();
        return { ok: false, error: errorMessage };
      }
      if (!await confirmReloadDiscard('change audience access')) return { ok: false, cancelled: true };
      errorMessage = '';
      try {
        await api.changeAudienceAccess(webinarId(), { enabled: Boolean(enabled) });
        await context.reload();
        return { ok: true };
      } catch (error) {
        errorMessage = operationError(error, 'The audience access change');
        rerender();
        return { ok: false, error: errorMessage };
      }
    }

    async function archiveWebinar() {
      if (!context || !isAdmin()) {
        errorMessage = 'The server requires administrator access for this action.';
        rerender();
        return { ok: false, error: errorMessage };
      }
      if (!await confirmReloadDiscard('archive this webinar')) return { ok: false, cancelled: true };
      const title = boundedLabel(currentState().webinar.title, 'this webinar');
      const approved = await confirm(`Archive “${title}”?`, {
        title: 'Archive webinar',
        confirmText: 'Archive webinar',
        cancelText: 'Keep webinar',
        variant: 'danger',
      });
      if (!approved) return { ok: false, cancelled: true };
      errorMessage = '';
      try {
        await api.archiveWebinar(webinarId());
        if (typeof context.onArchived === 'function') await context.onArchived();
        else await context.reload();
        return { ok: true };
      } catch (error) {
        errorMessage = operationError(error, 'The archive');
        rerender();
        return { ok: false, error: errorMessage };
      }
    }

    async function restoreRevision(revisionId) {
      if (!context) return { ok: false, error: 'Select a webinar first.' };
      const targetId = positiveInteger(revisionId);
      const revision = history.find(item => item.id === targetId);
      if (!revision) {
        errorMessage = 'Choose a revision from this webinar history.';
        rerender();
        return { ok: false, error: errorMessage };
      }
      if (context.hasUnsavedChanges()) {
        const discard = await confirm(`Discard unsaved changes and continue restoring version ${revision.version}?`, {
          title: 'Discard unsaved changes?',
          confirmText: 'Discard and continue',
          cancelText: 'Keep editing',
          variant: 'warning',
        });
        if (!discard) return { ok: false, cancelled: true };
      }
      const approved = await confirm(`Restore version ${revision.version}?`, {
        title: `Restore version ${revision.version}`,
        confirmText: 'Restore version',
        cancelText: 'Keep current version',
        variant: 'warning',
      });
      if (!approved) return { ok: false, cancelled: true };

      const expectedVersion = positiveInteger(currentState().liveVersion);
      if (!expectedVersion) {
        errorMessage = 'Reload this webinar before restoring a version.';
        rerender();
        return { ok: false, error: errorMessage };
      }
      errorMessage = '';
      try {
        await api.restoreRevision(webinarId(), targetId, { expectedVersion });
        await context.reload();
        return { ok: true };
      } catch (error) {
        errorMessage = operationError(error, 'The restore');
        rerender();
        return { ok: false, error: errorMessage };
      }
    }

    function deactivate() {
      renderGeneration += 1;
      activePanel = null;
    }

    function destroy() {
      deactivate();
      context = null;
      directory = [];
      history = [];
      activePanel = null;
      errorMessage = '';
    }

    return Object.freeze({
      archiveWebinar,
      changeOwner,
      deactivate,
      destroy,
      renderAccessPanel,
      renderHistoryPanel,
      restoreRevision,
      setAudienceEnabled,
    });
  }

  return Object.freeze({ createAccessHistory, normalizeDirectory, normalizeHistory });
}));
