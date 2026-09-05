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
      bridgeApi: root.WebinarStudioBridge,
      audienceConfig: root.CONFIG?.webinarStudio?.audience,
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
  const bridgeApi = dependencies.bridgeApi;
  const audienceConfig = dependencies.audienceConfig;
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
  const PREVIEW_INVALID_COPY = 'The slide preview configuration is invalid: the preview URL must sit on the configured HTTPS origin. Code editing is unavailable until it is corrected.';
  /* The first candidate is posted only once the host frame has loaded. A host
     that never loads must not hang the editor and presenter forever, so the
     wait is bounded and the preview controller then reports its own startup
     failure through the normal error state. Worst case for a dead host is
     this gate plus the controller's own startup timeout, in sequence. */
  const PREVIEW_FRAME_LOAD_TIMEOUT_MS = 10_000;
  const AUDIENCE_OFF_COPY = 'Audience access is off for this webinar. Turn it on under Users & Access before launching the audience.';
  const AUDIENCE_UNAVAILABLE_COPY = 'The audience host is not configured for this environment, so the audience window cannot be launched here.';
  const LOADING_COPY = 'Loading the selected webinar…';
  const CREATING_COPY = 'Creating a webinar. Select it afterwards to manage presenter settings.';

  const model = {
    initialized: false,
    access: 'idle',
    accessMessage: '',
    notice: '',
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
  let previewFrame = null;
  let previewConfigState = 'unset';
  let previewReadyFor = null;
  let previewSelectionGeneration = 0;
  let audienceBridge = null;
  let audienceBridgeFor = null;
  let audienceBridgeToken = null;
  let previewFrameLoaded = null;
  let cancelPreviewFrameGate = null;
  let injectedPreviewDestroyed = false;
  let controllersBuilt = false;
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

  function invalidateEditorContext({ switching = false } = {}) {
    editorContextGeneration += 1;
    editorController?.invalidateInsertionTarget?.();
    editorController?.setContext?.({
      webinarId: switching ? null : Number(model.studioState?.webinar?.id) || null,
      generation: editorContextGeneration,
    });
  }

  function setPanelCopy(html) {
    if (!elements.settingsPanel) return;
    elements.settingsPanel.replaceChildren?.();
    elements.settingsPanel.innerHTML = html;
  }

  function previewOrigin(value) {
    if (typeof value !== 'string' || value !== value.trim() || value.includes('*')) return null;
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    const localHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) return null;
    return parsed.origin;
  }

  /* The canonical preview controller is built once, after Studio access is
     confirmed, from the published preview module. Its frame carries the
     trusted renderer page on the mortgage-site origin; candidate code executes
     only inside the unique-origin slide frame that page creates, so this outer
     frame is deliberately not sandboxed and exact-origin messaging works.
     An explicit controller dependency wins (fake-DOM harnesses). */
  /* Wraps a preview controller so every boot is bound to the selection that
     was current when it started: the deck id and the selection generation,
     which advances on every select, refresh, and new-webinar flow. A ready
     result only shows the host if that same selection is still current, so a
     candidate from edits discarded on the way to another deck and back cannot
     surface. The first boot waits for the host frame to load. */
  function bindPreview(controller, { waitForFrame = null } = {}) {
    return Object.freeze({
      async boot(candidate) {
        const forWebinar = Number(model.selectedWebinarId) || null;
        const forSelection = previewSelectionGeneration;
        if (waitForFrame) await waitForFrame;
        const state = await controller.boot(candidate);
        if (state?.type === 'ready' && forWebinar !== null && forWebinar === (Number(model.selectedWebinarId) || null)
          && forSelection === previewSelectionGeneration) {
          previewReadyFor = forWebinar;
        }
        updatePreviewHostVisibility();
        return state;
      },
      destroy() {
        controller.destroy?.();
      },
    });
  }

  function frameLoadGate(iframe) {
    if (typeof iframe.addEventListener !== 'function') return { promise: Promise.resolve(), cancel() {} };
    const setTimeoutImpl = dependencies.setTimeoutImpl || globalThis.setTimeout;
    const clearTimeoutImpl = dependencies.clearTimeoutImpl || globalThis.clearTimeout;
    let timer = null;
    let onLoad = null;
    let resolve = null;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    const settle = () => {
      if (timer !== null) clearTimeoutImpl(timer);
      timer = null;
      if (onLoad) iframe.removeEventListener?.('load', onLoad);
      onLoad = null;
    };
    onLoad = () => {
      // A load for the initial about:blank document (readable only while it
      // is same-origin) is not the configured host arriving; keep waiting.
      let blank = false;
      try { blank = iframe.contentDocument?.URL === 'about:blank'; } catch { blank = false; }
      if (blank) return;
      settle();
      resolve();
    };
    iframe.addEventListener('load', onLoad);
    timer = setTimeoutImpl(() => { settle(); resolve(); }, PREVIEW_FRAME_LOAD_TIMEOUT_MS);
    return { promise, cancel: settle };
  }

  function ensurePreviewController() {
    if (previewController) return previewController;
    if (dependencies.editorPreview?.boot) {
      if (injectedPreviewDestroyed) return null;
      previewController = bindPreview(dependencies.editorPreview);
      previewConfigState = 'ready';
      return previewController;
    }
    if (!previewApi?.createPreviewController || !elements.previewHost) return null;
    if (!previewConfig || typeof previewConfig !== 'object') {
      previewConfigState = 'unset';
      return null;
    }
    const url = String(previewConfig.url || '');
    const origin = previewOrigin(previewConfig.origin);
    let parsedOrigin;
    try { parsedOrigin = new URL(url).origin; } catch { parsedOrigin = null; }
    if (!origin || parsedOrigin !== origin) {
      previewConfigState = 'invalid';
      return null;
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Slide preview');
    iframe.setAttribute('data-ws-preview-frame', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    const gate = frameLoadGate(iframe);
    previewFrameLoaded = gate.promise;
    cancelPreviewFrameGate = gate.cancel;
    iframe.setAttribute('src', url);
    elements.previewHost.append(iframe);
    try {
      const controller = previewApi.createPreviewController({
        iframe,
        allowedOrigin: origin,
        onState: () => {},
        windowObject: navigationTarget,
        cryptoImpl: dependencies.cryptoImpl || globalThis.crypto,
      });
      previewController = bindPreview(controller, { waitForFrame: previewFrameLoaded });
      previewFrame = iframe;
      previewConfigState = 'ready';
    } catch {
      iframe.remove?.();
      previewController = null;
      cancelPreviewFrameGate?.();
      cancelPreviewFrameGate = null;
      previewFrameLoaded = null;
      previewConfigState = 'invalid';
    }
    return previewController;
  }

  function updatePreviewHostVisibility() {
    if (!elements.previewHost) return;
    const selected = Number(model.selectedWebinarId) || null;
    const showable = model.access === 'ready' && Boolean(model.studioState) && !model.loadingWebinar
      && model.mode !== 'new' && selected !== null && previewReadyFor === selected;
    elements.previewHost.hidden = !showable;
  }

  function resetPreviewVisibility() {
    previewSelectionGeneration += 1;
    previewReadyFor = null;
    updatePreviewHostVisibility();
  }

  /* ---- audience bridge ----
     The presenter receives one facade for its lifetime. The real bridge is
     built lazily, per webinar, on the first launch, and dropped whenever the
     selection changes or the Studio is torn down, so acknowledgements can
     only ever reach the presenter for the webinar they belong to. */
  function audienceOrigin() {
    if (!audienceConfig || typeof audienceConfig !== 'object') return null;
    return previewOrigin(audienceConfig.origin);
  }

  function audienceUrlFor(webinar, origin) {
    return `${origin}/webinars/${encodeURIComponent(String(webinar.slug))}/studio-viewer.html`;
  }

  function selectedWebinarId() {
    return Number(model.studioState?.webinar?.id) || null;
  }

  function dropAudienceBridge() {
    const bridge = audienceBridge;
    audienceBridge = null;
    audienceBridgeFor = null;
    audienceBridgeToken = null;
    try { bridge?.destroy?.(); } catch { /* the bridge is already gone */ }
  }

  function ensureAudienceBridge() {
    const webinar = model.studioState?.webinar;
    const webinarId = selectedWebinarId();
    if (!webinar || webinarId === null) return null;
    if (audienceBridge && audienceBridgeFor === webinarId) return audienceBridge;
    dropAudienceBridge();
    const origin = audienceOrigin();
    if (!origin || !bridgeApi?.createAudienceBridge) return null;
    const forWebinar = webinarId;
    // Callbacks are accepted only from the bridge instance currently held for
    // the selected webinar, never from a replaced instance for the same deck.
    const token = {};
    const current = () => audienceBridgeToken === token && audienceBridgeFor === forWebinar && selectedWebinarId() === forWebinar;
    try {
      audienceBridge = bridgeApi.createAudienceBridge({
        audienceUrl: audienceUrlFor(webinar, origin),
        allowedOrigin: origin,
        onState: message => {
          if (!current()) return;
          presenterController?.applyAudienceState?.(message);
        },
        onStatus: status => {
          if (!current()) return;
          presenterController?.setConnection?.(status);
        },
        windowObject: navigationTarget,
        openWindow: (url, name) => openWindow(url, name),
        cryptoImpl: dependencies.cryptoImpl || globalThis.crypto,
        setTimeoutImpl: dependencies.setTimeoutImpl,
        clearTimeoutImpl: dependencies.clearTimeoutImpl,
        setIntervalImpl: dependencies.setIntervalImpl,
        clearIntervalImpl: dependencies.clearIntervalImpl,
      });
      audienceBridgeFor = forWebinar;
      audienceBridgeToken = token;
    } catch {
      audienceBridge = null;
      audienceBridgeFor = null;
      audienceBridgeToken = null;
    }
    return audienceBridge;
  }

  /* The deck list and status line describe the selected webinar from its
     summary, so a live version the editor just advanced must flow back into
     that summary and the status line without a full re-render. */
  function syncSelectedSummary() {
    const current = model.studioState;
    const webinarId = Number(current?.webinar?.id) || null;
    if (webinarId === null) return;
    const summary = model.webinars.find(webinar => webinar.id === webinarId);
    if (summary && summary.liveVersion === current.liveVersion && summary.title === current.webinar.title
      && summary.audienceEnabled === current.webinar.audienceEnabled) return;
    model.webinars = model.webinars.map(webinar => webinar.id === webinarId ? {
      id: webinarId,
      slug: current.webinar.slug,
      title: current.webinar.title,
      liveVersion: current.liveVersion,
      audienceEnabled: current.webinar.audienceEnabled,
    } : webinar);
    renderDecks();
    renderStatusLine();
  }

  function notify(copy) {
    model.notice = copy;
    renderStatusLine();
  }

  function launchAudience({ reconnect = false } = {}) {
    const webinar = model.studioState?.webinar;
    if (!webinar || model.loadingWebinar || model.mode === 'new') return false;
    if (webinar.audienceEnabled !== true) {
      dropAudienceBridge();
      notify(AUDIENCE_OFF_COPY);
      presenterController?.setConnection?.('idle');
      return false;
    }
    const bridge = ensureAudienceBridge();
    if (!bridge) {
      notify(AUDIENCE_UNAVAILABLE_COPY);
      return false;
    }
    model.notice = '';
    renderStatusLine();
    // A disconnected link is re-established through reconnect so a foreign
    // page in the audience window is replaced promptly rather than waited on.
    const useReconnect = reconnect || bridge.status() === 'disconnected';
    return useReconnect ? bridge.reconnect() === true : bridge.connect() === true;
  }

  const audienceLink = Object.freeze({
    connect: () => launchAudience(),
    reconnect: () => launchAudience({ reconnect: true }),
    sendControl(type, payload = {}) {
      if (!audienceBridge || audienceBridgeFor !== selectedWebinarId()) return false;
      try { return audienceBridge.sendControl(type, payload) === true; } catch { return false; }
    },
    status() {
      if (!audienceBridge || audienceBridgeFor !== selectedWebinarId()) return 'idle';
      try { return audienceBridge.status(); } catch { return 'idle'; }
    },
  });

  /* Studio controllers are built once, only after access is confirmed, so an
     unauthorized Dashboard session never loads the preview host. */
  function ensureStudioControllers() {
    if (controllersBuilt || !model.initialized) return;
    controllersBuilt = true;
    const preview = ensurePreviewController();
    if (presenterApi?.createPresenterController) {
      presenterController = presenterApi.createPresenterController({
        document,
        api,
        confirm: confirmAction,
        preview,
        bridge: dependencies.bridge || audienceLink,
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
        setState: nextState => { model.studioState = nextState; syncSelectedSummary(); },
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
      listen(elements.launchAudience, 'click', () => { launchAudience(); });
      listen(elements.launchPresenter, 'click', () => { activateSettingsTab('presenter'); });
      listen(elements.modal, 'click', event => {
        if (event.target === elements.modal) close();
      });
      listen(document, 'keydown', event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !elements.modal.hidden) close();
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
    ensureStudioControllers();
    render();
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

  function audienceLinkActive() {
    const status = audienceLink.status();
    return status === 'connected' || status === 'connecting';
  }

  /* Only awaited while a link is active, so selection timing is unchanged
     for the common case of no audience. */
  function mayDisconnectAudience() {
    if (!audienceLinkActive()) return true;
    return confirmAction('The audience window is connected. Continuing disconnects it; the audience keeps its current slide until you reconnect.', {
      title: 'Audience connected',
      confirmText: 'Disconnect and continue',
      cancelText: 'Stay connected',
      variant: 'warning',
    });
  }

  /* Escape reaches this while a close prompt is open; re-entering would
     replace that prompt with a fresh one on every press. */
  let closing = false;

  async function close() {
    if (!elements.modal || elements.modal.hidden) return true;
    if (closing) return false;
    closing = true;
    // Observe, without invalidating, the request generation: a selection
    // started while a prompt was open wins and this close is stale.
    const seenGeneration = requestGeneration;
    try {
      if (!await mayDiscardChanges()) return false;
      if (audienceLinkActive() && !await mayDisconnectAudience()) return false;
      if (requestGeneration !== seenGeneration) return false;
    } finally {
      closing = false;
    }
    invalidateRequests();
    invalidateEditorContext();
    accessPromise = null;
    deactivateSettingsControllers();
    dropAudienceBridge();
    model.notice = '';
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
      if (audienceLinkActive()) {
        const mayDisconnect = await mayDisconnectAudience();
        if (!requestIsCurrent(request) || !mayDisconnect) return false;
      }
    }

    invalidateEditorContext({ switching: true });
    resetPreviewVisibility();
    dropAudienceBridge();
    model.notice = '';
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
      model.notice = '';
      if (nextState.webinar.audienceEnabled !== true) dropAudienceBridge();
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
    resetPreviewVisibility();
    dropAudienceBridge();
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
          <p>Edit in the Code tab; the live preview renders below as you type and stays private until you Save Live.</p>
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
    const selected = model.loadingWebinar || model.mode === 'new' ? null : model.studioState?.webinar;
    if (elements.launchPresenter) elements.launchPresenter.disabled = !selected;
    if (elements.launchAudience) elements.launchAudience.disabled = !selected || !selected.audienceEnabled;
    if (elements.settingsPanel && !selected) {
      deactivateSettingsControllers();
      const copy = model.loadingWebinar ? LOADING_COPY : model.mode === 'new' ? CREATING_COPY : 'Select a webinar to manage presenter settings.';
      setPanelCopy(`<p>${copy}</p>`);
    } else if (elements.settingsPanel) {
      renderSettingsTab();
    }
  }

  function render() {
    if (!elements.workspace) return;
    renderDecks();
    renderWorkspace();
    updatePreviewHostVisibility();
    renderSettings();
    renderStatusLine();
  }

  function renderStatusLine() {
    if (!elements.status) return;
    if (model.notice) {
      elements.status.textContent = model.notice;
      return;
    }
    elements.status.textContent = model.studioState
      ? `Live version ${model.studioState.liveVersion} · ${model.studioState.webinar.audienceEnabled ? 'Audience enabled' : 'Audience off'}`
      : model.access === 'loading' ? 'Checking access' : model.access === 'ready' ? 'Private workspace' : 'Unavailable';
  }

  async function openNewWebinar() {
    if (!isAdmin() || model.access !== 'ready') return false;
    const request = beginRequest();
    const mayDiscard = await mayDiscardChanges();
    if (!requestIsCurrent(request) || !mayDiscard) return false;
    if (audienceLinkActive()) {
      const mayDisconnect = await mayDisconnectAudience();
      if (!requestIsCurrent(request) || !mayDisconnect) return false;
    }
    dropAudienceBridge();
    model.notice = '';
    invalidateEditorContext();
    resetPreviewVisibility();
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
    renderSettings();
  }

  function settingsSelectionWithdrawn() {
    return !model.studioState || model.loadingWebinar || model.mode === 'new';
  }

  function renderSettingsTab() {
    if (!elements.settingsPanel) return;
    elements.settingsPanel.setAttribute('data-ws-panel', model.settingsTab);
    if (settingsSelectionWithdrawn()) {
      deactivateSettingsControllers();
      const copy = model.loadingWebinar ? LOADING_COPY : model.mode === 'new' ? CREATING_COPY : 'Select a webinar to manage presenter settings.';
      setPanelCopy(`<p>${copy}</p>`);
      return;
    }
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
      setPanelCopy(`<p>${previewConfigState === 'invalid' ? PREVIEW_INVALID_COPY : PREVIEW_UNAVAILABLE_COPY}</p>`);
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
    dropAudienceBridge();
    model.notice = '';
    presenterController?.destroy?.();
    presenterController = null;
    // The editor owns the preview controller's teardown; destroy it directly
    // only when no editor was ever built on top of it.
    if (editorController) editorController.destroy?.();
    else previewController?.destroy?.();
    if (dependencies.editorPreview?.boot && previewController) injectedPreviewDestroyed = true;
    editorController = null;
    previewController = null;
    previewFrame?.remove?.();
    previewFrame = null;
    cancelPreviewFrameGate?.();
    cancelPreviewFrameGate = null;
    previewFrameLoaded = null;
    previewReadyFor = null;
    controllersBuilt = false;
    for (const [target, type, handler] of bindings) {
      target?.removeEventListener?.(type, handler);
    }
    bindings = [];
    model.initialized = false;
    initializationPromise = null;
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
