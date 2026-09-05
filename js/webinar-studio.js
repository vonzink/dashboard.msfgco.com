(function initializeWebinarStudio(root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) module.exports = factory;
  if (!root || !root.document) return;

  const start = () => {
    if (!root.WebinarStudioAPI || !root.WebinarStudioState) return;
    root.WebinarStudio = factory({
      document: root.document,
      api: root.WebinarStudioAPI,
      accessHistoryApi: root.WebinarStudioAccessHistory,
      assetsApi: root.WebinarStudioAssets,
      editorApi: root.WebinarStudioEditor,
      presenterApi: root.WebinarStudioPresenter,
      previewApi: root.WebinarStudioPreview,
      previewConfig: root.CONFIG?.webinarStudio?.preview,
      stateApi: root.WebinarStudioState,
      confirm: (message, options) => root.Utils?.confirm
        ? root.Utils.confirm(message, options)
        : Promise.resolve(root.confirm(message)),
      currentUser: () => root.CONFIG?.currentUser || {},
      openWindow: (...args) => root.open(...args),
      navigationTarget: root,
    });
    root.WebinarStudio.init();
  };

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}(typeof window !== 'undefined' ? window : null, function createWebinarStudio(dependencies) {
  'use strict';

  const document = dependencies.document;
  const api = dependencies.api;
  const accessHistoryApi = dependencies.accessHistoryApi;
  const assetsApi = dependencies.assetsApi;
  const editorApi = dependencies.editorApi;
  const presenterApi = dependencies.presenterApi;
  const previewApi = dependencies.previewApi;
  const previewConfig = dependencies.previewConfig;
  const stateApi = dependencies.stateApi;
  const confirmAction = dependencies.confirm;
  const currentUser = dependencies.currentUser;
  const openWindow = dependencies.openWindow;
  const navigationTarget = dependencies.navigationTarget;

  const SETTINGS_COPY = Object.freeze({
    presenter: 'Presenter controls and personal shortcuts will appear here.',
    access: 'Ownership and audience access will appear here.',
    code: 'Master HTML and CSS tools will appear here.',
    assets: 'Shared webinar assets will appear here.',
    history: 'Saved versions and restore controls will appear here.',
  });
  const PREVIEW_UNAVAILABLE_COPY = 'The slide preview host is not configured for this environment, so code editing is unavailable here.';
  const LOADING_COPY = 'Loading the selected webinar…';

  const model = {
    initialized: false,
    access: 'idle',
    accessMessage: '',
    webinars: [],
    selectedWebinarId: null,
    studioState: null,
    loadingWebinar: false,
    mode: 'empty',
    owners: [],
    formError: '',
    launchButton: null,
    bodyOverflow: '',
    settingsTab: 'presenter',
    resourcePolicy: {},
    resolvedAssets: {},
  };

  let elements = {};
  let accessHistoryController = null;
  let assetController = null;
  let editorController = null;
  let presenterController = null;
  let previewController = null;
  let editorContextGeneration = 0;
  let initializationPromise = null;
  let accessPromise = null;
  let lifecycleGeneration = 0;
  let requestGeneration = 0;
  let bindings = [];

  function beginRequest(webinarId = null) {
    return {
      lifecycleGeneration,
      requestGeneration: ++requestGeneration,
      webinarId: webinarId === null ? null : Number(webinarId),
    };
  }

  function requestIsCurrent(request, { requireSelected = false } = {}) {
    if (!model.initialized
      || request.lifecycleGeneration !== lifecycleGeneration
      || request.requestGeneration !== requestGeneration) return false;
    return !requireSelected || Number(model.selectedWebinarId) === request.webinarId;
  }

  function invalidateRequests() {
    lifecycleGeneration += 1;
    requestGeneration += 1;
  }

  function invalidateEditorContext() {
    editorContextGeneration += 1;
    editorController?.invalidateInsertionTarget?.();
    editorController?.setContext?.({
      webinarId: Number(model.studioState?.webinar?.id) || null,
      generation: editorContextGeneration,
    });
  }

  function setPanelCopy(html) {
    if (!elements.settingsPanel) return;
    elements.settingsPanel.replaceChildren?.();
    elements.settingsPanel.innerHTML = html;
  }

  /* The canonical preview controller is built once from the published preview
     module, bound to a sandboxed iframe whose URL origin must equal the
     configured origin exactly. An explicit controller dependency wins (tests). */
  function ensurePreviewController() {
    if (previewController) return previewController;
    if (dependencies.editorPreview?.boot) {
      previewController = dependencies.editorPreview;
      return previewController;
    }
    if (!previewApi?.createPreviewController || !elements.previewHost) return null;
    const url = String(previewConfig?.url || '');
    const origin = String(previewConfig?.origin || '');
    let parsedOrigin;
    try { parsedOrigin = new URL(url).origin; } catch { return null; }
    if (!origin || parsedOrigin !== origin || !/^https:\/\//.test(origin)) return null;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', 'Slide preview');
    iframe.setAttribute('data-ws-preview-frame', '');
    iframe.setAttribute('src', url);
    elements.previewHost.append(iframe);
    try {
      previewController = previewApi.createPreviewController({
        iframe,
        allowedOrigin: origin,
        onState: () => {},
      });
    } catch {
      previewController = null;
    }
    return previewController;
  }

  function listen(target, type, handler) {
    target?.addEventListener?.(type, handler);
    bindings.push([target, type, handler]);
  }

  function element(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function isAdmin() {
    const user = currentUser() || {};
    const role = String(user.activeRole || user.role || '').toLowerCase();
    return role === 'admin';
  }

  function errorStatus(error) {
    const numeric = Number(error?.status || error?.statusCode || error?.response?.status);
    if (numeric === 403 || numeric === 404) return numeric;
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '');
    if (code === 'WEBINAR_STUDIO_DISABLED' || message === 'Webinar Studio unavailable') return 404;
    if (code === 'WEBINAR_STUDIO_ACCESS_REQUIRED' || message === 'Webinar Studio access required') return 403;
    return 500;
  }

  function accessMessageFor(error) {
    const status = errorStatus(error);
    if (status === 404) return 'Webinar Studio is not enabled.';
    if (status === 403) return 'You do not have access to Webinar Studio.';
    return 'Webinar Studio could not load. Try again.';
  }

  function setLauncherAvailable(available) {
    if (!elements.launcher) return;
    elements.launcher.hidden = !available;
    elements.launcher.disabled = !available;
    elements.launcher.setAttribute('aria-disabled', String(!available));
  }

  function normalizeSummaries(value) {
    if (!Array.isArray(value)) throw new TypeError('Webinar list response must be an array');
    return value.filter(item => item && Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0)
      .map(item => ({
        id: Number(item.id),
        slug: String(item.slug || ''),
        title: String(item.title || 'Untitled webinar'),
        liveVersion: Number(item.liveVersion || 1),
        audienceEnabled: item.audienceEnabled === true,
      }));
  }

  function bindElements() {
    elements = {
      launcher: element('webinarStudioLauncher'),
      modal: element('webinarStudioModal'),
      close: element('wsClose'),
      deckList: element('wsDeckList'),
      deckSelect: element('wsDeckSelect'),
      workspace: element('wsWorkspace'),
      workspaceContent: element('wsWorkspaceContent'),
      previewHost: element('wsPreviewHost'),
      status: element('wsStatus'),
      newWebinar: element('wsNewWebinar'),
      settings: element('wsSettings'),
      settingsPanel: element('wsSettingsPanel'),
      launchAudience: element('wsLaunchAudience'),
      launchPresenter: element('wsLaunchPresenter'),
    };
  }

  async function ensureAccess() {
    if (model.access === 'ready') return true;
    if (accessPromise) return accessPromise;
    const request = beginRequest();
    model.access = 'loading';
    model.accessMessage = '';
    setLauncherAvailable(false);
    render();
    const pendingAccess = (async () => {
      try {
        const response = await api.listWebinars();
        if (!requestIsCurrent(request)) return false;
        model.webinars = normalizeSummaries(response);
        model.access = 'ready';
        setLauncherAvailable(true);
        render();
        return true;
      } catch (error) {
        if (!requestIsCurrent(request)) return false;
        model.access = errorStatus(error) === 404 ? 'disabled'
          : errorStatus(error) === 403 ? 'forbidden' : 'error';
        model.accessMessage = accessMessageFor(error);
        model.webinars = [];
        model.studioState = null;
        model.resourcePolicy = {};
        model.resolvedAssets = {};
        invalidateEditorContext();
        setLauncherAvailable(false);
        render();
        return false;
      }
    })();
    accessPromise = pendingAccess;
    void pendingAccess.then(
      () => { if (accessPromise === pendingAccess) accessPromise = null; },
      () => { if (accessPromise === pendingAccess) accessPromise = null; },
    );
    return accessPromise;
  }

  function init() {
    if (initializationPromise) return initializationPromise;
    bindElements();
    if (!elements.modal || !elements.launcher || !elements.workspace) {
      initializationPromise = Promise.resolve(false);
      return initializationPromise;
    }
    if (!model.initialized) {
      model.initialized = true;
      if (accessHistoryApi?.createAccessHistory) {
        accessHistoryController = accessHistoryApi.createAccessHistory({
          api,
          confirm: confirmAction,
          document,
        });
      }
      if (assetsApi?.createAssetLibrary) {
        assetController = assetsApi.createAssetLibrary({ api, document });
      }
      const preview = ensurePreviewController();
      if (presenterApi?.createPresenterController) {
        presenterController = presenterApi.createPresenterController({
          document,
          api,
          confirm: confirmAction,
          preview,
          bridge: dependencies.bridge || null,
          keyTarget: document,
          setIntervalImpl: dependencies.setIntervalImpl,
          clearIntervalImpl: dependencies.clearIntervalImpl,
        });
      }
      if (editorApi?.createEditor && preview) {
        editorController = editorApi.createEditor({
          root: elements.settingsPanel,
          document,
          api,
          stateApi,
          getState: () => model.studioState,
          setState: nextState => { model.studioState = nextState; },
          preview,
          getAssets: () => model.resolvedAssets,
          getResourcePolicy: () => model.resourcePolicy,
          confirm: confirmAction,
          copyText: dependencies.copyText,
          onReload: () => reloadSelectedWebinar(model.selectedWebinarId),
          setTimeoutImpl: dependencies.setTimeoutImpl,
          clearTimeoutImpl: dependencies.clearTimeoutImpl,
        });
      }
      setLauncherAvailable(false);
      listen(elements.close, 'click', () => close());
      listen(elements.newWebinar, 'click', () => openNewWebinar());
      listen(elements.deckSelect, 'change', event => {
        const id = Number(event.target.value);
        if (id) selectWebinar(id);
      });
      listen(elements.deckList, 'click', event => {
        const button = event.target.closest?.('[data-ws-webinar-id]');
        const id = Number(button?.dataset?.wsWebinarId);
        if (id) selectWebinar(id);
      });
      listen(elements.workspace, 'submit', event => {
        if (event.target?.id !== 'wsNewWebinarForm') return;
        event.preventDefault();
        createWebinar({
          title: element('wsNewTitle')?.value,
          slug: element('wsNewSlug')?.value,
          primaryOwnerUserId: Number(element('wsNewOwner')?.value),
        });
      });
      listen(elements.workspace, 'click', event => {
        if (event.target.closest?.('[data-ws-cancel-new]')) cancelNewWebinar();
      });
      listen(elements.settings, 'click', event => {
        const tab = event.target.closest?.('[data-ws-tab]');
        if (tab) activateSettingsTab(tab.dataset.wsTab);
      });
      listen(elements.settings, 'keydown', handleSettingsKeydown);
      listen(elements.launchAudience, 'click', () => launch('audience'));
      listen(elements.launchPresenter, 'click', () => launch('presenter'));
      listen(elements.modal, 'click', event => {
        if (event.target === elements.modal) close();
      });
      listen(document, 'keydown', event => {
        if (event.key === 'Escape' && !elements.modal.hidden) close();
      });
      listen(navigationTarget, 'beforeunload', event => {
        if (!model.studioState || !stateApi.hasUnsavedChanges(model.studioState)) return;
        event.preventDefault();
        event.returnValue = '';
      });
    }
    initializationPromise = ensureAccess();
    return initializationPromise;
  }

  async function open() {
    if (!model.initialized) init();
    if (!elements.modal || !elements.workspace) return false;
    const openLifecycleGeneration = lifecycleGeneration;
    model.launchButton = document.activeElement || elements.launcher;
    elements.modal.hidden = false;
    elements.modal.classList.add('active');
    elements.modal.setAttribute('aria-hidden', 'false');
    document.body?.classList?.add('ws-modal-open');
    if (document.body?.style) {
      model.bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    render();

    const allowed = await ensureAccess();
    if (!allowed
      || !model.initialized
      || openLifecycleGeneration !== lifecycleGeneration
      || elements.modal.hidden) return false;
    if (!model.studioState && model.webinars.length && model.mode !== 'new') {
      await selectWebinar(model.webinars[0].id, { skipConfirmation: true });
    }
    if (!model.initialized
      || openLifecycleGeneration !== lifecycleGeneration
      || elements.modal.hidden) return false;
    elements.close?.focus();
    return true;
  }

  async function mayDiscardChanges() {
    if (!model.studioState || !stateApi.hasUnsavedChanges(model.studioState)) return true;
    return confirmAction('You have unsaved changes. Leave them behind?', {
      title: 'Unsaved changes',
      confirmText: 'Leave without saving',
      cancelText: 'Keep editing',
      variant: 'warning',
    });
  }

  async function close() {
    if (!elements.modal || elements.modal.hidden) return true;
    if (!await mayDiscardChanges()) return false;
    invalidateRequests();
    invalidateEditorContext();
    accessPromise = null;
    deactivateSettingsControllers();
    elements.modal.classList.remove('active');
    elements.modal.hidden = true;
    elements.modal.setAttribute('aria-hidden', 'true');
    document.body?.classList?.remove('ws-modal-open');
    if (document.body?.style) document.body.style.overflow = model.bodyOverflow;
    const restoreTarget = model.launchButton || elements.launcher;
    restoreTarget?.focus?.();
    return true;
  }

  async function selectWebinar(id, options = {}) {
    const webinarId = Number(id);
    if (!Number.isSafeInteger(webinarId) || webinarId <= 0) return false;
    if (model.selectedWebinarId === webinarId && model.studioState) return true;
    const request = beginRequest(webinarId);
    if (!options.skipConfirmation) {
      const mayDiscard = await mayDiscardChanges();
      if (!requestIsCurrent(request) || !mayDiscard) return false;
    }

    invalidateEditorContext();
    model.selectedWebinarId = webinarId;
    model.loadingWebinar = true;
    model.mode = 'deck';
    model.formError = '';
    render();
    try {
      const documentResponse = await api.getWebinar(webinarId);
      if (!requestIsCurrent(request, { requireSelected: true })) return false;
      if (Number(documentResponse?.id) !== webinarId) throw new TypeError('Webinar response id did not match the request');
      model.studioState = stateApi.createStudioState(documentResponse);
      model.resourcePolicy = documentResponse.resourcePolicy || {};
      model.resolvedAssets = documentResponse.assets || {};
      model.selectedWebinarId = webinarId;
      model.loadingWebinar = false;
      render();
      return true;
    } catch {
      if (!requestIsCurrent(request, { requireSelected: true })) return false;
      model.loadingWebinar = false;
      model.studioState = null;
      model.resourcePolicy = {};
      model.resolvedAssets = {};
      model.selectedWebinarId = null;
      model.accessMessage = 'This webinar could not load. Choose another webinar or try again.';
      model.mode = 'deck-error';
      render();
      return false;
    }
  }

  async function reloadSelectedWebinar(initiatingWebinarId = model.selectedWebinarId) {
    const webinarId = Number(initiatingWebinarId);
    if (!Number.isSafeInteger(webinarId) || webinarId <= 0) return false;
    if (Number(model.selectedWebinarId) !== webinarId) return false;
    invalidateEditorContext();
    const request = beginRequest(webinarId);
    try {
      const documentResponse = await api.getWebinar(webinarId);
      if (!requestIsCurrent(request, { requireSelected: true })) return false;
      if (Number(documentResponse?.id) !== webinarId) {
        throw new TypeError('Webinar response id did not match the request');
      }
      const nextState = stateApi.createStudioState(documentResponse);
      model.studioState = nextState;
      model.resourcePolicy = documentResponse.resourcePolicy || {};
      model.resolvedAssets = documentResponse.assets || {};
      model.webinars = model.webinars.map(webinar => webinar.id === webinarId ? {
        id: webinarId,
        slug: nextState.webinar.slug,
        title: nextState.webinar.title,
        liveVersion: nextState.liveVersion,
        audienceEnabled: nextState.webinar.audienceEnabled,
      } : webinar);
      model.mode = 'deck';
      render();
      return true;
    } catch (error) {
      if (!requestIsCurrent(request, { requireSelected: true })) return false;
      throw error;
    }
  }

  async function refreshAfterArchive(initiatingWebinarId = model.selectedWebinarId) {
    const webinarId = Number(initiatingWebinarId);
    if (!Number.isSafeInteger(webinarId) || webinarId <= 0) return false;
    if (Number(model.selectedWebinarId) !== webinarId) return false;
    invalidateEditorContext();
    const request = beginRequest(webinarId);
    try {
      const response = await api.listWebinars();
      if (!requestIsCurrent(request, { requireSelected: true })) return false;
      model.webinars = normalizeSummaries(response);
      model.selectedWebinarId = null;
      model.studioState = null;
      model.resourcePolicy = {};
      model.resolvedAssets = {};
      model.mode = 'empty';
      render();
      if (model.webinars.length) {
        await selectWebinar(model.webinars[0].id, { skipConfirmation: true });
      }
      return true;
    } catch (error) {
      if (!requestIsCurrent(request, { requireSelected: true })) return false;
      throw error;
    }
  }

  function renderDecks() {
    if (!elements.deckList || !elements.deckSelect) return;
    elements.deckList.innerHTML = model.webinars.map(webinar => `
      <button type="button" class="ws-deck-button" data-ws-webinar-id="${webinar.id}" aria-current="${model.selectedWebinarId === webinar.id}">
        <strong>${escapeHtml(webinar.title)}</strong>
        <span>Live v${webinar.liveVersion}${webinar.audienceEnabled ? ' · Public' : ' · Audience off'}</span>
      </button>`).join('');
    elements.deckSelect.innerHTML = model.webinars.length
      ? model.webinars.map(webinar => `<option value="${webinar.id}"${model.selectedWebinarId === webinar.id ? ' selected' : ''}>${escapeHtml(webinar.title)}</option>`).join('')
      : '<option value="">No webinars available</option>';
  }

  function workspaceContent() {
    return elements.workspaceContent || elements.workspace;
  }

  function renderState(title, message, icon = 'fa-circle-info') {
    workspaceContent().innerHTML = `<div class="ws-state"><i class="fas ${icon}" aria-hidden="true"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
  }

  function renderNewForm() {
    const owners = model.owners.map(owner => `<option value="${Number(owner.id)}">${escapeHtml(owner.name || owner.email || `User ${owner.id}`)}</option>`).join('');
    workspaceContent().innerHTML = `
      <form id="wsNewWebinarForm" class="ws-new-form" novalidate>
        <h3>Create webinar</h3>
        <p>Start with one private opening slide. Audience access stays off until you turn it on.</p>
        <div class="ws-field"><label for="wsNewTitle">Title</label><input id="wsNewTitle" name="title" required maxlength="160" autocomplete="off"></div>
        <div class="ws-field"><label for="wsNewSlug">Web address</label><input id="wsNewSlug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="first-time-homebuyer" autocomplete="off"></div>
        <div class="ws-field"><label for="wsNewOwner">Primary owner</label><select id="wsNewOwner" name="primaryOwnerUserId" required><option value="">Choose an active user</option>${owners}</select></div>
        <p class="ws-form-error" role="alert">${escapeHtml(model.formError)}</p>
        <div class="ws-form-actions"><button type="button" class="ws-form-cancel" data-ws-cancel-new>Cancel</button><button type="submit" class="ws-form-create">Create webinar</button></div>
      </form>`;
  }

  function renderWorkspace() {
    if (model.access === 'loading' || model.access === 'idle') {
      renderState('Checking access', 'Checking your Studio access...', 'fa-spinner fa-spin');
      return;
    }
    if (model.access !== 'ready') {
      renderState('Studio unavailable', model.accessMessage, 'fa-lock');
      return;
    }
    if (model.mode === 'new') {
      renderNewForm();
      return;
    }
    if (model.loadingWebinar) {
      renderState('Loading webinar', 'Loading the live deck...', 'fa-spinner fa-spin');
      return;
    }
    if (model.mode === 'deck-error') {
      renderState('Webinar unavailable', model.accessMessage, 'fa-triangle-exclamation');
      return;
    }
    if (model.studioState) {
      const webinar = model.studioState.webinar;
      workspaceContent().innerHTML = `
        <section class="ws-workspace-intro">
          <h3>${escapeHtml(webinar.title)}</h3>
          <p>The editing workspace is ready. Slide controls and live preview load here as Studio tools come online.</p>
          <div class="ws-version-line"><span class="ws-live-dot" aria-hidden="true"></span><strong>Live version ${model.studioState.liveVersion}</strong><span>${webinar.audienceEnabled ? 'Audience enabled' : 'Audience off'}</span></div>
        </section>`;
      return;
    }
    if (!model.webinars.length) {
      renderState(
        isAdmin() ? 'No webinars yet' : 'No webinars are assigned to you',
        isAdmin() ? 'Create the first webinar to begin.' : 'An administrator can assign you as the primary owner.',
        'fa-chalkboard',
      );
      return;
    }
    renderState('Choose a webinar', 'Select a webinar to begin.', 'fa-chalkboard');
  }

  function deactivateSettingsControllers() {
    accessHistoryController?.deactivate?.();
    assetController?.deactivate?.();
    presenterController?.deactivate?.();
  }

  function renderSettings() {
    if (elements.newWebinar) elements.newWebinar.hidden = model.access !== 'ready' || !isAdmin();
    // While a different webinar loads, the previous deck's state is still in
    // memory but must not be presented as editable or launchable.
    const selected = model.loadingWebinar ? null : model.studioState?.webinar;
    if (elements.launchPresenter) elements.launchPresenter.disabled = !selected;
    if (elements.launchAudience) elements.launchAudience.disabled = !selected || !selected.audienceEnabled;
    if (elements.settingsPanel && !selected) {
      deactivateSettingsControllers();
      setPanelCopy(`<p>${model.loadingWebinar ? LOADING_COPY : 'Select a webinar to manage presenter settings.'}</p>`);
    } else if (elements.settingsPanel) {
      renderSettingsTab();
    }
  }

  function render() {
    if (!elements.workspace) return;
    renderDecks();
    renderWorkspace();
    renderSettings();
    if (elements.status) {
      elements.status.textContent = model.studioState
        ? `Live version ${model.studioState.liveVersion} · ${model.studioState.webinar.audienceEnabled ? 'Audience enabled' : 'Audience off'}`
        : model.access === 'loading' ? 'Checking access' : model.access === 'ready' ? 'Private workspace' : 'Unavailable';
    }
  }

  async function openNewWebinar() {
    if (!isAdmin() || model.access !== 'ready') return false;
    const request = beginRequest();
    const mayDiscard = await mayDiscardChanges();
    if (!requestIsCurrent(request) || !mayDiscard) return false;
    invalidateEditorContext();
    model.mode = 'new';
    model.formError = '';
    try {
      const users = await api.listUsers();
      if (!requestIsCurrent(request) || model.mode !== 'new') return false;
      model.owners = Array.isArray(users)
        ? users.filter(user => Number.isSafeInteger(Number(user?.id)) && Number(user.id) > 0)
        : [];
    } catch {
      if (!requestIsCurrent(request) || model.mode !== 'new') return false;
      model.owners = [];
      model.formError = 'Active users could not load. Try again before creating a webinar.';
    }
    render();
    return true;
  }

  function validateNewWebinar(input) {
    const title = String(input?.title || '').trim();
    const slug = String(input?.slug || '').trim();
    const primaryOwnerUserId = Number(input?.primaryOwnerUserId);
    if (!title) return { error: 'Enter a webinar title.' };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { error: 'Use lowercase letters, numbers, and single hyphens for the web address.' };
    if (model.webinars.some(webinar => webinar.slug === slug)) return { error: 'That web address is already in use.' };
    if (!model.owners.some(owner => Number(owner.id) === primaryOwnerUserId)) return { error: 'Choose an active primary owner.' };
    return { value: { title, slug, primaryOwnerUserId } };
  }

  async function createWebinar(input) {
    if (!isAdmin() || model.mode !== 'new') return { ok: false, error: 'Admin access required.' };
    const validation = validateNewWebinar(input);
    if (validation.error) {
      model.formError = validation.error;
      render();
      return { ok: false, error: validation.error };
    }
    const request = beginRequest();
    try {
      const result = await api.createWebinar(validation.value);
      if (!requestIsCurrent(request) || model.mode !== 'new') return { ok: false, cancelled: true };
      const webinarId = Number(result?.webinarId);
      if (!Number.isSafeInteger(webinarId) || webinarId <= 0) throw new TypeError('The server did not return a webinar id');
      request.webinarId = webinarId;
      const documentResponse = await api.getWebinar(webinarId);
      if (!requestIsCurrent(request) || model.mode !== 'new') return { ok: false, cancelled: true };
      if (Number(documentResponse?.id) !== webinarId) throw new TypeError('The created webinar could not be verified');
      const nextState = stateApi.createStudioState(documentResponse);
      model.webinars = [{
        id: webinarId,
        slug: nextState.webinar.slug,
        title: nextState.webinar.title,
        liveVersion: nextState.liveVersion,
        audienceEnabled: nextState.webinar.audienceEnabled,
      }, ...model.webinars];
      model.studioState = nextState;
      model.resourcePolicy = documentResponse.resourcePolicy || {};
      model.resolvedAssets = documentResponse.assets || {};
      model.selectedWebinarId = webinarId;
      model.mode = 'deck';
      model.formError = '';
      render();
      return { ok: true, webinarId };
    } catch {
      if (!requestIsCurrent(request) || model.mode !== 'new') return { ok: false, cancelled: true };
      model.formError = 'The webinar could not be created. Check the details and try again.';
      render();
      return { ok: false, error: model.formError };
    }
  }

  function cancelNewWebinar() {
    requestGeneration += 1;
    model.mode = 'deck';
    model.formError = '';
    render();
  }

  function activateSettingsTab(name) {
    if (!Object.hasOwn(SETTINGS_COPY, name)) return;
    model.settingsTab = name;
    elements.settings?.querySelectorAll?.('[data-ws-tab]').forEach(tab => {
      const selected = tab.dataset.wsTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
    renderSettingsTab();
  }

  function renderSettingsTab() {
    if (!elements.settingsPanel) return;
    elements.settingsPanel.setAttribute('data-ws-panel', model.settingsTab);
    if (model.settingsTab !== 'presenter') presenterController?.deactivate?.();
    if (presenterController && model.settingsTab === 'presenter') {
      accessHistoryController?.deactivate?.();
      assetController?.deactivate?.();
      const webinarId = Number(model.studioState.webinar.id);
      void presenterController.renderPresenterPanel({
        root: elements.settingsPanel,
        webinarId,
        getState: () => model.studioState,
        getAssets: () => model.resolvedAssets,
        getResourcePolicy: () => model.resourcePolicy,
        currentUser: currentUser() || {},
      });
      return;
    }
    if (accessHistoryController && (model.settingsTab === 'access' || model.settingsTab === 'history')) {
      assetController?.deactivate?.();
      const webinarId = Number(model.studioState.webinar.id);
      const context = {
        root: elements.settingsPanel,
        webinarId,
        state: model.studioState,
        getState: () => model.studioState,
        isAdmin: isAdmin(),
        currentUser: currentUser() || {},
        hasUnsavedChanges: () => Boolean(model.studioState && stateApi.hasUnsavedChanges(model.studioState)),
        reload: () => reloadSelectedWebinar(webinarId),
        onArchived: () => refreshAfterArchive(webinarId),
      };
      if (model.settingsTab === 'access') {
        void accessHistoryController.renderAccessPanel(context);
      } else {
        void accessHistoryController.renderHistoryPanel(context);
      }
      return;
    }
    accessHistoryController?.deactivate?.();
    if (editorController && model.settingsTab === 'code') {
      assetController?.deactivate?.();
      editorController.setContext?.({
        webinarId: Number(model.studioState.webinar.id),
        generation: editorContextGeneration,
      });
      editorController.render(model.studioState);
      return;
    }
    if (assetController && model.settingsTab === 'assets') {
      const webinarId = Number(model.studioState.webinar.id);
      void assetController.renderAssetCatalog({
        root: elements.settingsPanel,
        isAdmin: isAdmin(),
        currentUser: currentUser() || {},
        getEditorTarget: () => editorController?.getAssetInsertionTarget?.({
          webinarId,
          generation: editorContextGeneration,
        }) || null,
      });
      return;
    }
    assetController?.deactivate?.();
    if (model.settingsTab === 'code' && editorApi?.createEditor && !editorController) {
      setPanelCopy(`<p>${PREVIEW_UNAVAILABLE_COPY}</p>`);
      return;
    }
    setPanelCopy(`<p>${SETTINGS_COPY[model.settingsTab]}</p>`);
  }

  function handleSettingsKeydown(event) {
    const tab = event.target.closest?.('[data-ws-tab]');
    if (!tab) return;
    const tabs = Array.from(elements.settings?.querySelectorAll?.('[data-ws-tab]') || []);
    const currentIndex = tabs.indexOf(tab);
    if (currentIndex < 0) return;
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    activateSettingsTab(nextTab.dataset.wsTab);
    nextTab.focus();
  }

  function destroy() {
    invalidateRequests();
    invalidateEditorContext();
    accessPromise = null;
    accessHistoryController?.destroy?.();
    accessHistoryController = null;
    assetController?.destroy?.();
    assetController = null;
    presenterController?.destroy?.();
    presenterController = null;
    // The editor owns the preview controller's teardown; destroy it directly
    // only when no editor was ever built on top of it.
    if (editorController) editorController.destroy?.();
    else previewController?.destroy?.();
    editorController = null;
    previewController = null;
    for (const [target, type, handler] of bindings) {
      target?.removeEventListener?.(type, handler);
    }
    bindings = [];
    model.initialized = false;
    initializationPromise = null;
  }

  function launch(mode) {
    const webinar = model.studioState?.webinar;
    if (!webinar) return;
    if (mode === 'audience' && !webinar.audienceEnabled) return;
    const suffix = mode === 'presenter' ? '/studio-viewer.html?mode=presenter' : '/';
    openWindow(`/webinars/${encodeURIComponent(webinar.slug)}${suffix}`, `MSFGWebinar${mode}`, 'noopener');
  }

  return Object.freeze({
    init,
    open,
    close,
    selectWebinar,
    render,
    openNewWebinar,
    createWebinar,
    destroy,
  });
}));
