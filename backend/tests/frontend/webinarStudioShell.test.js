import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(process.cwd(), '..');
const studioPath = resolve(root, 'js/webinar-studio.js');
const stateApi = require(resolve(root, 'js/webinar-studio/state.js'));

const slideId = '11111111-1111-4111-8111-111111111111';

function privateDocument(overrides = {}) {
  return {
    id: 12,
    slug: 'first-home',
    title: 'Your first home, without the mystery.',
    primaryOwnerUserId: 7,
    audienceEnabled: false,
    liveVersion: 3,
    masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
    masterCss: '',
    slides: [{
      id: slideId,
      title: 'Opening',
      anchor: 'opening',
      targetSeconds: 60,
      speakerNotes: '',
      html: '<section>Welcome</section>',
      css: '',
      javascript: '',
    }],
    ...overrides,
  };
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.attributes = {};
    this.classList = new FakeClassList();
    this.listeners = {};
    this.focus = vi.fn();
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  removeEventListener(type, callback) {
    if (this.listeners[type] === callback) delete this.listeners[type];
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest(selector) {
    if (selector === '[data-ws-tab]' && this.dataset.wsTab) return this;
    return null;
  }
}

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    return !event.defaultPrevented;
  }
}

function makeDocument() {
  const ids = [
    'webinarStudioLauncher', 'webinarStudioModal', 'wsClose', 'wsDeckList',
    'wsDeckSelect', 'wsWorkspace', 'wsStatus', 'wsNewWebinar', 'wsSettings',
    'wsSettingsPanel', 'wsLaunchAudience', 'wsLaunchPresenter',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements.webinarStudioLauncher.hidden = true;
  elements.webinarStudioLauncher.disabled = true;
  elements.webinarStudioModal.hidden = true;
  const tabs = ['presenter', 'access', 'code', 'assets', 'history'].map(name => {
    const tab = new FakeElement(`ws-tab-${name}`);
    tab.dataset.wsTab = name;
    tab.setAttribute('aria-selected', String(name === 'presenter'));
    tab.setAttribute('tabindex', name === 'presenter' ? '0' : '-1');
    return tab;
  });
  elements.wsSettings.querySelectorAll = selector => selector === '[data-ws-tab]' ? tabs : [];
  const document = {
    activeElement: elements.webinarStudioLauncher,
    body: { classList: new FakeClassList() },
    listeners: {},
    getElementById: id => elements[id] || null,
    addEventListener(type, callback) { this.listeners[type] = callback; },
    removeEventListener(type, callback) {
      if (this.listeners[type] === callback) delete this.listeners[type];
    },
  };
  return { document, elements, tabs };
}

function loadStudio({
  api = {},
  role = 'user',
  confirm = vi.fn().mockResolvedValue(true),
  state = stateApi,
  navigationTarget = new FakeEventTarget(),
} = {}) {
  vi.resetModules();
  const createWebinarStudio = require(studioPath);
  const dom = makeDocument();
  const completeApi = {
    listWebinars: vi.fn().mockResolvedValue([{ id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false }]),
    getWebinar: vi.fn().mockResolvedValue(privateDocument()),
    listUsers: vi.fn().mockResolvedValue([{ id: 7, name: 'Active Owner', email: 'owner@example.test' }]),
    createWebinar: vi.fn().mockResolvedValue({ webinarId: 21, liveVersion: 1 }),
    ...api,
  };
  const studio = createWebinarStudio({
    document: dom.document,
    api: completeApi,
    stateApi: state,
    confirm,
    currentUser: () => ({ id: 7, activeRole: role, role }),
    openWindow: vi.fn(),
    navigationTarget,
  });
  return { studio, api: completeApi, confirm, navigationTarget, ...dom };
}

describe('Webinar Studio shell contracts', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('ships a scoped shell after its API and state dependencies without changing existing Tools actions', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const dispatcher = readFileSync(resolve(root, 'js/action-dispatcher.js'), 'utf8');
    const css = existsSync(resolve(root, 'css/webinar-studio.css'))
      ? readFileSync(resolve(root, 'css/webinar-studio.css'), 'utf8')
      : '';

    expect(html).toContain('data-action="open-webinar-studio"');
    expect(html).toContain('id="webinarStudioModal"');
    expect(html).toContain('id="wsDeckList"');
    expect(html).toContain('id="wsWorkspace"');
    expect(html).toContain('Presenter');
    expect(html).toContain('Users &amp; Access');
    expect(html).toContain('Code');
    expect(html).toContain('Assets');
    expect(html).toContain('History');
    expect(html.indexOf('js/api-server.js')).toBeLessThan(html.indexOf('js/webinar-studio/api.js'));
    expect(html.indexOf('js/webinar-studio/state.js')).toBeLessThan(html.indexOf('js/webinar-studio.js'));
    expect(dispatcher).toContain("'open-webinar-studio'");
    expect(dispatcher).toContain("'open-payment-calculator'");
    expect(css).toContain('#webinarStudioModal');
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).not.toMatch(/(^|[\s,{])\.modal\s*[,{]/);
  });

  it('keeps the launcher unavailable while access loads, then exposes it only after a successful list', async () => {
    let release;
    const pending = new Promise(resolvePromise => { release = resolvePromise; });
    const { studio, elements } = loadStudio({ api: { listWebinars: vi.fn(() => pending) } });

    const initialization = studio.init();
    expect(elements.webinarStudioLauncher.hidden).toBe(true);
    expect(elements.webinarStudioLauncher.disabled).toBe(true);

    release([{ id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false }]);
    await initialization;
    expect(elements.webinarStudioLauncher.hidden).toBe(false);
    expect(elements.webinarStudioLauncher.disabled).toBe(false);
  });

  it.each([
    [404, 'Webinar Studio is not enabled.'],
    [403, 'You do not have access to Webinar Studio.'],
    [500, 'Webinar Studio could not load. Try again.'],
  ])('renders a safe access state for HTTP %s without exposing the launcher', async (status, message) => {
    const error = Object.assign(new Error(status === 404 ? 'Webinar Studio unavailable' : 'request failed with private details'), { status });
    const { studio, elements } = loadStudio({ api: { listWebinars: vi.fn().mockRejectedValue(error) } });

    await studio.open();

    expect(elements.webinarStudioLauncher.hidden).toBe(true);
    expect(elements.webinarStudioLauncher.disabled).toBe(true);
    expect(elements.webinarStudioModal.hidden).toBe(false);
    expect(elements.wsWorkspace.innerHTML).toContain(message);
    expect(elements.wsWorkspace.innerHTML).not.toContain('private details');
  });

  it('renders loading immediately and a useful empty-assignment state after access succeeds', async () => {
    let release;
    const pending = new Promise(resolvePromise => { release = resolvePromise; });
    const { studio, elements } = loadStudio({ api: { listWebinars: vi.fn(() => pending) } });

    const opening = studio.open();
    expect(elements.webinarStudioModal.hidden).toBe(false);
    expect(elements.wsWorkspace.innerHTML).toContain('Checking your Studio access');

    release([]);
    await opening;
    expect(elements.wsWorkspace.innerHTML).toContain('No webinars are assigned to you');
    expect(elements.wsDeckList.innerHTML).not.toContain('undefined');
  });

  it('selects a server document, renders its live version, and confirms dirty navigation', async () => {
    let dirty = false;
    const state = { ...stateApi, hasUnsavedChanges: vi.fn(() => dirty) };
    const confirm = vi.fn().mockResolvedValue(false);
    const getWebinar = vi.fn()
      .mockResolvedValueOnce(privateDocument())
      .mockResolvedValueOnce(privateDocument({ id: 13, slug: 'second', title: 'Second deck' }));
    const { studio, elements } = loadStudio({ api: { getWebinar }, confirm, state });

    await studio.init();
    await studio.open();
    expect(elements.wsWorkspace.innerHTML).toContain('Your first home, without the mystery.');
    expect(elements.wsStatus.textContent).toContain('Live version 3');

    dirty = true;
    await studio.selectWebinar(13);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/unsaved changes/i), expect.any(Object));
    expect(getWebinar).toHaveBeenCalledTimes(1);
  });

  it('requires explicit confirmation before closing dirty work and restores focus to the launcher', async () => {
    let dirty = true;
    const state = { ...stateApi, hasUnsavedChanges: () => dirty };
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { studio, elements, document } = loadStudio({ confirm, state });

    await studio.init();
    document.activeElement = elements.webinarStudioLauncher;
    await studio.open();
    await studio.close();
    expect(elements.webinarStudioModal.hidden).toBe(false);

    dirty = true;
    await studio.close();
    expect(elements.webinarStudioModal.hidden).toBe(true);
    expect(elements.webinarStudioLauncher.focus).toHaveBeenCalledOnce();
  });

  it('creates an admin webinar only with a unique canonical slug and an active server-listed owner', async () => {
    const createdDocument = privateDocument({ id: 21, slug: 'new-class', title: 'New class', liveVersion: 1 });
    const api = {
      getWebinar: vi.fn().mockResolvedValue(createdDocument),
      listUsers: vi.fn().mockResolvedValue([{ id: 7, name: 'Active Owner' }]),
      createWebinar: vi.fn().mockResolvedValue({ webinarId: 21, liveVersion: 1 }),
    };
    const { studio, api: completeApi, elements } = loadStudio({ api, role: 'Admin' });

    await studio.init();
    await studio.openNewWebinar();
    expect(elements.wsWorkspace.innerHTML).toContain('Create webinar');

    await expect(studio.createWebinar({ title: 'New class', slug: 'Invalid Slug', primaryOwnerUserId: 7 }))
      .resolves.toMatchObject({ ok: false });
    await expect(studio.createWebinar({ title: 'New class', slug: 'first-home', primaryOwnerUserId: 7 }))
      .resolves.toMatchObject({ ok: false });
    await expect(studio.createWebinar({ title: 'New class', slug: 'new-class', primaryOwnerUserId: 999 }))
      .resolves.toMatchObject({ ok: false });
    expect(completeApi.createWebinar).not.toHaveBeenCalled();

    await expect(studio.createWebinar({ title: 'New class', slug: 'new-class', primaryOwnerUserId: 7 }))
      .resolves.toEqual({ ok: true, webinarId: 21 });
    expect(completeApi.createWebinar).toHaveBeenCalledWith({
      title: 'New class', slug: 'new-class', primaryOwnerUserId: 7,
    });
    expect(completeApi.getWebinar).toHaveBeenCalledWith(21);
    expect(elements.wsWorkspace.innerHTML).toContain('New class');
    expect(elements.wsStatus.textContent).toContain('Live version 1');
  });

  it('prevents real navigation-target beforeunload events only while dirty and removes the guard on teardown', async () => {
    let dirty = true;
    const state = { ...stateApi, hasUnsavedChanges: () => dirty };
    const { studio, navigationTarget, document } = loadStudio({ state });
    await studio.init();
    await studio.open();

    const dirtyEvent = {
      type: 'beforeunload',
      defaultPrevented: false,
      returnValue: undefined,
      preventDefault() { this.defaultPrevented = true; },
    };
    navigationTarget.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBe('');
    expect(document.listeners.beforeunload).toBeUndefined();

    dirty = false;
    const cleanEvent = {
      type: 'beforeunload',
      defaultPrevented: false,
      returnValue: undefined,
      preventDefault() { this.defaultPrevented = true; },
    };
    navigationTarget.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
    expect(cleanEvent.returnValue).toBeUndefined();

    dirty = true;
    studio.destroy();
    const afterDestroy = {
      type: 'beforeunload',
      defaultPrevented: false,
      returnValue: undefined,
      preventDefault() { this.defaultPrevented = true; },
    };
    navigationTarget.dispatchEvent(afterDestroy);
    expect(afterDestroy.defaultPrevented).toBe(false);
  });

  it('activates clicked settings tabs and supports wrapping arrow, Home, and End keyboard navigation', async () => {
    const { studio, elements, tabs } = loadStudio();
    await studio.init();
    await studio.open();
    const settingsClick = elements.wsSettings.listeners.click;
    const settingsKeydown = elements.wsSettings.listeners.keydown;
    const presenter = tabs[0];
    const code = tabs[2];
    const assets = tabs[3];
    const history = tabs[4];

    settingsClick({ target: code });
    expect(code.getAttribute('aria-selected')).toBe('true');
    expect(code.getAttribute('tabindex')).toBe('0');
    expect(presenter.getAttribute('aria-selected')).toBe('false');
    expect(elements.wsSettingsPanel.innerHTML).toContain('Master HTML and CSS');

    const key = (target, value) => {
      const event = { target, key: value, preventDefault: vi.fn() };
      settingsKeydown(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    };
    key(code, 'ArrowRight');
    expect(assets.focus).toHaveBeenCalledOnce();
    expect(assets.getAttribute('aria-selected')).toBe('true');

    key(assets, 'End');
    expect(history.focus).toHaveBeenCalledOnce();
    key(history, 'ArrowRight');
    expect(presenter.focus).toHaveBeenCalledOnce();
    key(presenter, 'ArrowLeft');
    expect(history.focus).toHaveBeenCalledTimes(2);
    key(history, 'Home');
    expect(presenter.focus).toHaveBeenCalledTimes(2);
    expect(presenter.getAttribute('aria-selected')).toBe('true');
    expect(elements.wsSettingsPanel.innerHTML).toContain('Presenter controls');
  });
});

describe('Webinar Studio keyboard ownership', () => {
  it('does not close the Studio on an Escape that a presenter key capture already consumed', async () => {
    const { studio, elements, document } = loadStudio();
    await studio.open();
    expect(elements.webinarStudioModal.hidden).toBe(false);
    document.listeners.keydown({ key: 'Escape', defaultPrevented: true });
    await Promise.resolve();
    expect(elements.webinarStudioModal.hidden).toBe(false);
    document.listeners.keydown({ key: 'Escape', defaultPrevented: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(elements.webinarStudioModal.hidden).toBe(true);
  });
});

describe('Webinar Studio preview wiring', () => {
  const PRODUCTION_PREVIEW = {
    url: 'https://msfgmortgage.com/webinars/first-home-without-mystery/studio-viewer.html?mode=preview',
    origin: 'https://msfgmortgage.com',
  };

  function previewWiring({ previewConfig, previewApi, useRealPreview = false, presenterApi, timers, bridgeApi, audienceConfig, openWindow = vi.fn() } = {}) {
    vi.resetModules();
    const createWebinarStudio = require(studioPath);
    const realEditorApi = require(resolve(root, 'js/webinar-studio/editor.js'));
    let editorPreview = null;
    const editorApi = {
      ...realEditorApi,
      createEditor(options) { editorPreview = options.preview; return realEditorApi.createEditor(options); },
    };
    const realPreviewApi = require(resolve(root, 'js/webinar-studio/preview.js'));
    const dom = makeDocument();
    const previewHost = new FakeElement('wsPreviewHost');
    previewHost.children = [];
    previewHost.append = (...nodes) => previewHost.children.push(...nodes);
    const iframe = {
      src: '', title: '', attributes: {}, isConnected: true, loadListeners: [],
      contentWindow: { postMessage: vi.fn() },
      setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'src') this.src = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(type, listener) { if (type === 'load') this.loadListeners.push(listener); },
      removeEventListener(type, listener) { if (type === 'load') this.loadListeners = this.loadListeners.filter(entry => entry !== listener); },
      fireLoad() { for (const listener of [...this.loadListeners]) listener({ type: 'load' }); },
      remove() { previewHost.children = previewHost.children.filter(node => node !== this); },
    };
    const settingsPanel = dom.elements.wsSettingsPanel;
    settingsPanel.replaceChildren = vi.fn();
    settingsPanel.querySelectorAll = () => [];
    const documentWithHost = {
      ...dom.document,
      getElementById: id => (id === 'wsPreviewHost' ? previewHost : dom.elements[id] || null),
      createElement: tag => (tag === 'iframe' ? iframe : { tagName: tag.toUpperCase(), append() {}, setAttribute() {}, dataset: {}, children: [] }),
      createDocumentFragment: () => ({ append() {}, children: [] }),
    };
    const controller = { boot: vi.fn().mockResolvedValue({ type: 'ready' }), destroy: vi.fn() };
    const api = {
      listWebinars: vi.fn().mockResolvedValue([{ id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false }]),
      getWebinar: vi.fn().mockResolvedValue(privateDocument()),
    };
    const completePreviewApi = useRealPreview
      ? { createPreviewController: vi.fn(realPreviewApi.createPreviewController) }
      : previewApi === undefined
        ? { createPreviewController: vi.fn().mockReturnValue(controller) }
        : previewApi;
    const studio = createWebinarStudio({
      document: documentWithHost,
      api,
      stateApi,
      editorApi,
      previewApi: completePreviewApi,
      previewConfig,
      presenterApi,
      bridgeApi,
      audienceConfig,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 7, activeRole: 'admin', role: 'admin' }),
      openWindow,
      navigationTarget: new FakeEventTarget(),
      ...(timers || {}),
    });
    return { studio, previewApi: completePreviewApi, controller, iframe, previewHost, dom, settingsPanel, api, editorPreviewFor: () => editorPreview };
  }

  function clickCode(test) {
    test.dom.tabs[2].dataset.wsTab = 'code';
    test.dom.elements.wsSettings.listeners.click({ target: test.dom.tabs[2] });
  }

  it('builds the canonical preview controller only after access succeeds, from the published module, in an un-sandboxed exact-origin frame', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW });
    await test.studio.init();
    expect(test.previewHost.children).toHaveLength(0);
    expect(test.previewApi.createPreviewController).not.toHaveBeenCalled();

    await test.studio.open();
    expect(test.previewHost.children).toContain(test.iframe);
    /* The outer frame carries the trusted renderer page on the mortgage-site
       origin. Candidate code executes only inside the inner unique-origin
       slide frame that page creates. A sandbox here would give the host an
       opaque origin and defeat exact-origin messaging. */
    expect(test.iframe.getAttribute('sandbox')).toBeNull();
    expect(test.iframe.src).toBe(PRODUCTION_PREVIEW.url);
    expect(test.previewApi.createPreviewController).toHaveBeenCalledTimes(1);
    expect(test.previewApi.createPreviewController).toHaveBeenCalledWith(expect.objectContaining({
      iframe: test.iframe,
      allowedOrigin: PRODUCTION_PREVIEW.origin,
      onState: expect.any(Function),
    }));
    clickCode(test);
    expect(test.settingsPanel.innerHTML).not.toMatch(/not configured/i);
    const rendered = test.settingsPanel.replaceChildren.mock.calls.some(call => call.length === 1 && call[0] && typeof call[0] === 'object');
    expect(rendered).toBe(true);
  });

  it('accepts the coordinator arguments with the real preview module', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, useRealPreview: true });
    await test.studio.init();
    await test.studio.open();
    expect(test.previewApi.createPreviewController).toHaveBeenCalledTimes(1);
    expect(test.previewApi.createPreviewController.mock.results[0].type).toBe('return');
    expect(typeof test.previewApi.createPreviewController.mock.results[0].value.boot).toBe('function');
    clickCode(test);
    expect(test.settingsPanel.innerHTML).not.toMatch(/not configured|invalid/i);
  });

  it('refuses a preview whose URL origin does not match the configured origin and says the configuration is invalid', async () => {
    const test = previewWiring({ previewConfig: { url: 'https://evil.example/studio-viewer.html?mode=preview', origin: 'https://msfgmortgage.com' } });
    await test.studio.init();
    await test.studio.open();
    expect(test.previewApi.createPreviewController).not.toHaveBeenCalled();
    expect(test.previewHost.children).toHaveLength(0);
    clickCode(test);
    expect(test.settingsPanel.innerHTML).toMatch(/preview configuration is invalid/i);
  });

  it('explains a missing preview configuration on the Code tab instead of silently doing nothing', async () => {
    const test = previewWiring({ previewConfig: undefined });
    await test.studio.init();
    await test.studio.open();
    expect(test.previewApi.createPreviewController).not.toHaveBeenCalled();
    clickCode(test);
    expect(test.settingsPanel.innerHTML).toMatch(/preview host is not configured/i);
    expect(test.settingsPanel.innerHTML).not.toMatch(/Master HTML and CSS tools will appear here/);
  });

  it('waits for the host frame to load before the first boot posts a candidate', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, useRealPreview: true });
    await test.studio.init();
    await test.studio.open();
    const wrapper = test.previewApi.createPreviewController.mock.results[0].value;
    const editorPreview = test.editorPreviewFor();
    const pending = editorPreview.boot({
      master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: '' },
      slide: { id: slideId, anchor: 'opening', title: 'Opening', html: '<section>Welcome</section>', css: '', javascript: '' },
      assets: {},
      resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] },
    });
    await Promise.resolve();
    expect(test.iframe.contentWindow.postMessage).not.toHaveBeenCalled();
    test.iframe.fireLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(test.iframe.contentWindow.postMessage.mock.calls[0][1]).toBe(PRODUCTION_PREVIEW.origin);
    expect(typeof wrapper.boot).toBe('function');
    void pending;
  });

  it('stops waiting on a host frame that never loads after the load timeout so the controller can report the failure', async () => {
    const timeouts = [];
    const timers = {
      setTimeoutImpl: vi.fn((callback, delay) => { timeouts.push({ callback, delay }); return timeouts.length; }),
      clearTimeoutImpl: vi.fn(),
    };
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, timers });
    await test.studio.init();
    await test.studio.open();
    const preview = test.editorPreviewFor();
    let settled = null;
    preview.boot({}).then(state => { settled = state; });
    await Promise.resolve();
    await Promise.resolve();
    expect(test.controller.boot).not.toHaveBeenCalled();
    const loadGate = timeouts.find(entry => entry.delay === 10_000);
    expect(loadGate).toBeDefined();
    loadGate.callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.controller.boot).toHaveBeenCalledTimes(1);
    expect(settled).toEqual({ type: 'ready' });
    /* A late load after the gate opened is harmless and must not boot twice. */
    test.iframe.fireLoad();
    await Promise.resolve();
    expect(test.controller.boot).toHaveBeenCalledTimes(1);
  });

  it('clears the load-gate timer once the host frame loads', async () => {
    const timers = { setTimeoutImpl: vi.fn(() => 41), clearTimeoutImpl: vi.fn() };
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, timers });
    await test.studio.init();
    await test.studio.open();
    test.iframe.fireLoad();
    expect(timers.clearTimeoutImpl).toHaveBeenCalledWith(41);
  });

  it('attributes a ready preview to the deck it was booted for, never to a deck selected while it was in flight', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW });
    await test.studio.init();
    await test.studio.open();
    test.iframe.fireLoad();
    let resolveBoot;
    test.controller.boot.mockImplementation(() => new Promise(resolve => { resolveBoot = resolve; }));
    const preview = test.editorPreviewFor();
    const inFlight = preview.boot({});
    test.api.listWebinars.mockResolvedValue([
      { id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false },
      { id: 13, slug: 'second', title: 'Second deck', liveVersion: 1, audienceEnabled: false },
    ]);
    let resolveWebinar;
    test.api.getWebinar.mockImplementationOnce(() => new Promise(resolve => { resolveWebinar = resolve; }));
    const switching = test.studio.selectWebinar(13);
    await Promise.resolve();
    resolveBoot({ type: 'ready' });
    await inFlight;
    resolveWebinar(privateDocument({ id: 13, slug: 'second', title: 'Second deck' }));
    await switching;
    expect(test.previewHost.hidden).toBe(true);
    test.controller.boot.mockResolvedValue({ type: 'ready' });
    await preview.boot({});
    expect(test.previewHost.hidden).toBe(false);
  });

  it('keeps tab clicks behind the loading, creating, and no-selection guards', async () => {
    const presenterController = { renderPresenterPanel: vi.fn().mockResolvedValue(undefined), deactivate: vi.fn(), destroy: vi.fn() };
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, presenterApi: { createPresenterController: () => presenterController } });
    await test.studio.init();
    await test.studio.open();
    presenterController.renderPresenterPanel.mockClear();
    test.settingsPanel.replaceChildren.mockClear();
    let resolveWebinar;
    test.api.listWebinars.mockResolvedValue([
      { id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false },
      { id: 13, slug: 'second', title: 'Second deck', liveVersion: 1, audienceEnabled: false },
    ]);
    test.api.getWebinar.mockImplementationOnce(() => new Promise(resolve => { resolveWebinar = resolve; }));
    const switching = test.studio.selectWebinar(13);
    await Promise.resolve();
    for (const name of ['presenter', 'code', 'assets', 'access', 'history']) {
      const tab = test.dom.tabs.find(item => item.dataset.wsTab === name);
      test.dom.elements.wsSettings.listeners.click({ target: tab });
      expect(test.settingsPanel.innerHTML).toMatch(/loading the selected webinar/i);
    }
    expect(presenterController.renderPresenterPanel).not.toHaveBeenCalled();
    resolveWebinar(privateDocument({ id: 13, slug: 'second', title: 'Second deck' }));
    await switching;

    await test.studio.openNewWebinar();
    presenterController.renderPresenterPanel.mockClear();
    test.dom.elements.wsSettings.listeners.click({ target: test.dom.tabs[2] });
    expect(test.settingsPanel.innerHTML).toMatch(/creating a webinar/i);
    test.dom.elements.wsSettings.listeners.click({ target: test.dom.tabs[0] });
    expect(presenterController.renderPresenterPanel).not.toHaveBeenCalled();
  });

  it('never throws from a tab click when no webinar is selected', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, presenterApi: { createPresenterController: () => ({ renderPresenterPanel: vi.fn(), deactivate: vi.fn(), destroy: vi.fn() }) } });
    test.api.listWebinars.mockResolvedValue([]);
    await test.studio.init();
    await test.studio.open();
    for (const tab of test.dom.tabs) {
      expect(() => test.dom.elements.wsSettings.listeners.click({ target: tab })).not.toThrow();
      expect(test.settingsPanel.innerHTML).toMatch(/select a webinar/i);
    }
  });

  it('hides the preview host until the current webinar reports a ready preview, and while loading, creating, or switching', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW });
    await test.studio.init();
    expect(test.previewHost.hidden).toBe(true);
    await test.studio.open();
    expect(test.previewHost.hidden).toBe(true);
    test.iframe.fireLoad();
    const preview = test.editorPreviewFor();
    await preview.boot({});
    expect(test.previewHost.hidden).toBe(false);

    test.api.getWebinar.mockResolvedValueOnce(privateDocument({ id: 13, slug: 'second', title: 'Second deck' }));
    test.api.listWebinars.mockResolvedValue([
      { id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false },
      { id: 13, slug: 'second', title: 'Second deck', liveVersion: 1, audienceEnabled: false },
    ]);
    await test.studio.selectWebinar(13);
    expect(test.previewHost.hidden).toBe(true);
    await preview.boot({});
    expect(test.previewHost.hidden).toBe(false);

    await test.studio.openNewWebinar();
    expect(test.previewHost.hidden).toBe(true);
    expect(test.dom.elements.wsLaunchPresenter.disabled).toBe(true);
    expect(test.settingsPanel.innerHTML).toMatch(/select a webinar|creating/i);
  });

  it('does not show a ready preview that was booted before the same deck was reselected', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW });
    await test.studio.init();
    await test.studio.open();
    test.iframe.fireLoad();
    let resolveBoot;
    test.controller.boot.mockImplementation(() => new Promise(resolve => { resolveBoot = resolve; }));
    const preview = test.editorPreviewFor();
    const inFlight = preview.boot({});
    test.api.listWebinars.mockResolvedValue([
      { id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false },
      { id: 13, slug: 'second', title: 'Second deck', liveVersion: 1, audienceEnabled: false },
    ]);
    test.api.getWebinar.mockResolvedValueOnce(privateDocument({ id: 13, slug: 'second', title: 'Second deck' }));
    await test.studio.selectWebinar(13);
    test.api.getWebinar.mockResolvedValueOnce(privateDocument());
    await test.studio.selectWebinar(12);
    expect(test.previewHost.hidden).toBe(true);
    resolveBoot({ type: 'ready' });
    await inFlight;
    /* Same deck id, but a different selection: the candidate belonged to the
       edits discarded on the way out, so it must not surface. */
    expect(test.previewHost.hidden).toBe(true);
    test.controller.boot.mockResolvedValue({ type: 'ready' });
    await preview.boot({});
    expect(test.previewHost.hidden).toBe(false);
  });

  it('cancels the load-gate timer on destroy and when the factory throws', async () => {
    const timers = { setTimeoutImpl: vi.fn(() => 77), clearTimeoutImpl: vi.fn() };
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, timers });
    await test.studio.init();
    await test.studio.open();
    expect(timers.clearTimeoutImpl).not.toHaveBeenCalled();
    test.studio.destroy();
    expect(timers.clearTimeoutImpl).toHaveBeenCalledWith(77);

    const throwing = previewWiring({
      previewConfig: PRODUCTION_PREVIEW,
      previewApi: { createPreviewController: vi.fn(() => { throw new Error('nope'); }) },
      timers: { setTimeoutImpl: vi.fn(() => 78), clearTimeoutImpl: vi.fn() },
    });
    await throwing.studio.init();
    await throwing.studio.open();
    expect(throwing.previewHost.children).toHaveLength(0);
  });

  it('ignores a load reported while the frame still holds the initial about:blank document', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW, useRealPreview: true });
    await test.studio.init();
    await test.studio.open();
    const preview = test.editorPreviewFor();
    const candidate = {
      master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: '' },
      slide: { id: slideId, anchor: 'opening', title: 'Opening', html: '<section>Welcome</section>', css: '', javascript: '' },
      assets: {},
      resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] },
    };
    void preview.boot(candidate);
    test.iframe.contentDocument = { URL: 'about:blank' };
    test.iframe.fireLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.iframe.contentWindow.postMessage).not.toHaveBeenCalled();
    /* The configured-origin document is cross-origin, so contentDocument is null. */
    test.iframe.contentDocument = null;
    test.iframe.fireLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps the status line and deck summary on the live version the editor saved', async () => {
    let editorOptions = null;
    const editorApi = { createEditor: options => { editorOptions = options; return { render: vi.fn(), setContext: vi.fn(), deactivate: vi.fn(), destroy: vi.fn() }; } };
    vi.resetModules();
    const createWebinarStudio = require(studioPath);
    const dom = makeDocument();
    const previewHost = new FakeElement('wsPreviewHost');
    previewHost.children = [];
    previewHost.append = (...nodes) => previewHost.children.push(...nodes);
    const iframe = { attributes: {}, src: '', setAttribute(n, v) { this.attributes[n] = String(v); if (n === 'src') this.src = String(v); }, getAttribute(n) { return this.attributes[n] ?? null; }, addEventListener() {}, removeEventListener() {}, remove() {} };
    const studio = createWebinarStudio({
      document: { ...dom.document, getElementById: id => (id === 'wsPreviewHost' ? previewHost : dom.elements[id] || null), createElement: tag => (tag === 'iframe' ? iframe : { tagName: tag.toUpperCase(), append() {}, setAttribute() {}, dataset: {}, children: [] }) },
      api: {
        listWebinars: vi.fn().mockResolvedValue([{ id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled: false }]),
        getWebinar: vi.fn().mockResolvedValue(privateDocument()),
      },
      stateApi,
      editorApi,
      previewApi: { createPreviewController: vi.fn().mockReturnValue({ boot: vi.fn().mockResolvedValue({ type: 'ready' }), destroy: vi.fn() }) },
      previewConfig: PRODUCTION_PREVIEW,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 7, activeRole: 'admin', role: 'admin' }),
      openWindow: vi.fn(),
      navigationTarget: new FakeEventTarget(),
    });
    await studio.init();
    await studio.open();
    expect(dom.elements.wsStatus.textContent).toMatch(/Live version 3/);
    const saved = stateApi.markSurfaceSaved(editorOptions.getState(), 'master', { liveVersion: 4, updatedAt: '2026-09-05T12:00:00.000Z' });
    editorOptions.setState(saved);
    expect(dom.elements.wsStatus.textContent).toMatch(/Live version 4/);
    expect(dom.elements.wsDeckList.innerHTML).toMatch(/Live v4/);
  });

  it('removes the preview frame on destroy so a later init does not stack frames', async () => {
    const test = previewWiring({ previewConfig: PRODUCTION_PREVIEW });
    await test.studio.init();
    await test.studio.open();
    expect(test.previewHost.children).toHaveLength(1);
    test.studio.destroy();
    expect(test.previewHost.children).toHaveLength(0);
    expect(test.controller.destroy).toHaveBeenCalled();
  });

  it('ships every Studio module before the coordinator, hosts the preview frame in the shell, and configures the production preview host', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const order = ['js/api-server.js', 'js/webinar-studio/api.js', 'js/webinar-studio/state.js', 'js/webinar-studio/access-history.js',
      'js/webinar-studio/assets.js', 'js/webinar-studio/preview.js', 'js/webinar-studio/editor.js', 'js/webinar-studio/presenter.js',
      'js/webinar-studio/bridge.js', 'js/webinar-studio.js'];
    const positions = order.map(file => html.indexOf(`src="${file}`));
    positions.forEach((position, index) => {
      expect(position, order[index]).toBeGreaterThan(-1);
      if (index) expect(position).toBeGreaterThan(positions[index - 1]);
    });
    expect(html).toContain('id="wsPreviewHost"');
    expect(html).toContain('id="wsWorkspaceContent"');
    expect(html).not.toContain('WebinarStudioEditorPreview');
    expect(html).toMatch(/css\/webinar-studio\.css\?v=2026090[5-9]/);

    const config = readFileSync(resolve(root, 'js/config.js'), 'utf8');
    const preview = /webinarStudio:\s*\{\s*preview:\s*\{\s*url:\s*'([^']+)',\s*origin:\s*'([^']+)'/.exec(config);
    expect(preview, 'CONFIG.webinarStudio.preview').not.toBeNull();
    expect(new URL(preview[1]).origin).toBe(preview[2]);
    expect(preview[2]).toBe('https://msfgmortgage.com');
    const audience = /audience:\s*\{\s*origin:\s*'([^']+)'/.exec(config);
    expect(audience, 'CONFIG.webinarStudio.audience').not.toBeNull();
    expect(audience[1]).toBe('https://msfgmortgage.com');
    expect(config).not.toMatch(/webinarStudio[\s\S]{0,400}localhost/);
    expect(html).toContain('data-ws-preview-caption');
  });

  it('keeps the Studio header, deck heading, and launch actions as flex rows', () => {
    const css = readFileSync(resolve(root, 'css/webinar-studio.css'), 'utf8');
    expect(css).toMatch(/#webinarStudioModal \.ws-heading,\s*#webinarStudioModal \.ws-decks-heading,\s*#webinarStudioModal \.ws-launch-actions,\s*#webinarStudioModal \.ws-version-line \{\s*display: flex;\s*align-items: center;/);
    expect(css).toMatch(/#webinarStudioModal \.ws-preview-host \{/);
  });

  it('keeps the settings drawer reachable on phones: the workspace yields space and short landscape viewports get a compact header', () => {
    const css = readFileSync(resolve(root, 'css/webinar-studio.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 899px)'));
    expect(phone).toMatch(/\.ws-workspace \{[^}]*min-height: 1[0-6]0px;[^}]*flex: 1 1 auto;/);
    expect(phone).toMatch(/\.ws-settings \{[^}]*flex: 1 1 auto;[^}]*max-height: 5[0-9]%;/);
    /* A 100% width plus padding overflowed the viewport; the flex column stretches the drawer instead. */
    expect(phone).not.toMatch(/\.ws-settings \{[^}]*width: 100%;/);
    expect(phone).toMatch(/\.ws-settings-tabs \{[^}]*repeat\(auto-fit, minmax\(7rem, 1fr\)\);/);
    expect(phone).not.toMatch(/\.ws-settings-tabs \{[^}]*overflow-x: auto;/);
    const short = css.slice(css.indexOf('@media (max-width: 899px) and (max-height: 500px)'));
    expect(short).toMatch(/\.ws-header \{[^}]*min-height: 5[0-9]px;/);
    expect(short).toMatch(/\.ws-workspace \{[^}]*min-height: (9[0-9]|1[0-1][0-9])px;/);
    expect(short).toMatch(/\.ws-settings \{[^}]*max-height: 6[0-9]%;/);
  });
});

describe('Webinar Studio audience bridge wiring', () => {
  const PRODUCTION_PREVIEW = {
    url: 'https://msfgmortgage.com/webinars/first-home-without-mystery/studio-viewer.html?mode=preview',
    origin: 'https://msfgmortgage.com',
  };
  const AUDIENCE = { origin: 'https://msfgmortgage.com' };

  function bridgeWiring({ audienceConfig = AUDIENCE, audienceEnabled = true, bridgeApi, accessHistoryApi, confirm = vi.fn().mockResolvedValue(true), dirty = false } = {}) {
    const state = { ...stateApi, hasUnsavedChanges: () => dirty };
    let editorOptions = null;
    const editorApi = { createEditor: options => { editorOptions = options; return { render: vi.fn(), setContext: vi.fn(), deactivate: vi.fn(), destroy: vi.fn() }; } };
    const previewHost = new FakeElement('wsPreviewHost');
    previewHost.children = [];
    previewHost.append = (...nodes) => previewHost.children.push(...nodes);
    const iframe = { attributes: {}, src: '', setAttribute(n, v) { this.attributes[n] = String(v); if (n === 'src') this.src = String(v); }, getAttribute(n) { return this.attributes[n] ?? null; }, addEventListener() {}, removeEventListener() {}, remove() {} };
    const previewApi = { createPreviewController: vi.fn().mockReturnValue({ boot: vi.fn().mockResolvedValue({ type: 'ready' }), destroy: vi.fn() }) };
    const bridges = [];
    const completeBridgeApi = bridgeApi || {
      createAudienceBridge: vi.fn(options => {
        let status = 'idle';
        const bridge = {
          options,
          connect: vi.fn(() => { status = 'connecting'; options.onStatus('connecting'); return true; }),
          reconnect: vi.fn(() => { status = 'connecting'; options.onStatus('connecting'); return true; }),
          sendControl: vi.fn(() => status === 'connected'),
          status: vi.fn(() => status),
          destroy: vi.fn(() => { status = 'idle'; }),
          answer() { status = 'connected'; options.onStatus('connected'); options.onState({ type: 'audience-ready', payload: { index: 0, total: 1 } }); },
        };
        bridges.push(bridge);
        return bridge;
      }),
    };
    const presenter = {
      renderPresenterPanel: vi.fn().mockResolvedValue(undefined),
      applyAudienceState: vi.fn(), setConnection: vi.fn(), deactivate: vi.fn(), destroy: vi.fn(),
      options: null,
    };
    const presenterApi = { createPresenterController: vi.fn(options => { presenter.options = options; return presenter; }) };
    vi.resetModules();
    const createWebinarStudio = require(studioPath);
    const dom = makeDocument();
    const api = {
      listWebinars: vi.fn().mockResolvedValue([
        { id: 12, slug: 'first-home', title: 'First Home', liveVersion: 3, audienceEnabled },
        { id: 13, slug: 'second-deck', title: 'Second deck', liveVersion: 1, audienceEnabled: true },
      ]),
      getWebinar: vi.fn(id => Promise.resolve(Number(id) === 13
        ? privateDocument({ id: 13, slug: 'second-deck', title: 'Second deck', audienceEnabled: true })
        : privateDocument({ audienceEnabled }))),
      listUsers: vi.fn().mockResolvedValue([]),
    };
    const openWindow = vi.fn();
    const studio = createWebinarStudio({
      document: { ...dom.document, getElementById: id => (id === 'wsPreviewHost' ? previewHost : dom.elements[id] || null), createElement: tag => (tag === 'iframe' ? iframe : { tagName: tag.toUpperCase(), append() {}, setAttribute() {}, dataset: {}, children: [] }) },
      api,
      stateApi: state,
      presenterApi,
      editorApi,
      previewApi,
      accessHistoryApi,
      bridgeApi: completeBridgeApi,
      audienceConfig,
      previewConfig: PRODUCTION_PREVIEW,
      confirm,
      currentUser: () => ({ id: 7, activeRole: 'admin', role: 'admin' }),
      openWindow,
      navigationTarget: new FakeEventTarget(),
    });
    return { studio, api, bridges, bridgeApi: completeBridgeApi, presenter, presenterApi, openWindow, confirm, editorOptions: () => editorOptions, ...dom };
  }

  async function connected(options = {}) {
    const test = bridgeWiring(options);
    await test.studio.init();
    await test.studio.open();
    test.presenter.options.bridge.connect();
    test.bridges[0].answer();
    expect(test.presenter.options.bridge.status()).toBe('connected');
    return test;
  }

  function accessCapture() {
    const capture = { context: null };
    capture.api = { createAccessHistory: () => ({
      renderAccessPanel: vi.fn(context => { capture.context = context; }), renderHistoryPanel: vi.fn(), deactivate: vi.fn(), destroy: vi.fn(),
    }) };
    return capture;
  }

  it('keeps a live audience when New webinar is cancelled at the discard prompt', async () => {
    const test = await connected({ dirty: true, confirm: vi.fn().mockResolvedValue(false) });
    expect(await test.studio.openNewWebinar()).toBe(false);
    expect(test.bridges[0].destroy).not.toHaveBeenCalled();
    expect(test.presenter.options.bridge.status()).toBe('connected');
  });

  it('asks before a deck switch or New webinar disconnects a connected audience, even with a clean editor', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const test = await connected({ confirm });
    expect(await test.studio.selectWebinar(13)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/audience window is connected/i), expect.anything());
    expect(test.bridges[0].destroy).not.toHaveBeenCalled();
    expect(test.presenter.options.bridge.status()).toBe('connected');
    expect(await test.studio.openNewWebinar()).toBe(false);
    expect(test.bridges[0].destroy).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    expect(await test.studio.selectWebinar(13)).toBe(true);
    expect(test.bridges[0].destroy).toHaveBeenCalled();
  });

  it('drops the audience only once New webinar is confirmed', async () => {
    const test = await connected({ dirty: true, confirm: vi.fn().mockResolvedValue(true) });
    await test.studio.openNewWebinar();
    expect(test.bridges[0].destroy).toHaveBeenCalled();
    expect(test.presenter.options.bridge.status()).toBe('idle');
  });

  it('asks before closing the Studio while the audience is connected, and keeps the link when the user declines', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const test = await connected({ confirm });
    expect(await test.studio.close()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/audience window is connected/i), expect.objectContaining({ title: expect.any(String) }));
    expect(test.bridges[0].destroy).not.toHaveBeenCalled();
    expect(test.elements.webinarStudioModal.hidden).toBe(false);
    confirm.mockResolvedValue(true);
    expect(await test.studio.close()).toBe(true);
    expect(test.bridges[0].destroy).toHaveBeenCalled();
  });

  it('does not re-enter close() while its prompt is open, so a second Escape reaches the prompt instead of spawning another', async () => {
    let resolvePrompt;
    const confirm = vi.fn(() => new Promise(resolve => { resolvePrompt = resolve; }));
    const test = await connected({ confirm });
    const first = test.studio.close();
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await test.studio.close()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    resolvePrompt(false);
    expect(await first).toBe(false);
    expect(test.elements.webinarStudioModal.hidden).toBe(false);
    /* Once the prompt has settled, close() may run again. */
    confirm.mockResolvedValue(true);
    expect(await test.studio.close()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('closes without asking when no audience is connected', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const test = bridgeWiring({ confirm });
    await test.studio.init();
    await test.studio.open();
    expect(await test.studio.close()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('drops a connected audience when a reload shows audience access was turned off', async () => {
    const access = accessCapture();
    const test = await connected({ accessHistoryApi: access.api });
    test.elements.wsSettings.listeners.click({ target: test.tabs[1] });
    test.api.getWebinar.mockResolvedValue(privateDocument({ audienceEnabled: false }));
    await access.context.reload();
    expect(test.bridges[0].destroy).toHaveBeenCalled();
    expect(test.presenter.options.bridge.status()).toBe('idle');
    expect(test.presenter.options.bridge.sendControl('next', {})).toBe(false);
  });

  it('drops the bridge when the selected webinar is archived and nothing remains', async () => {
    const access = accessCapture();
    const test = await connected({ accessHistoryApi: access.api });
    test.elements.wsSettings.listeners.click({ target: test.tabs[1] });
    test.api.listWebinars.mockResolvedValue([]);
    await access.context.onArchived();
    expect(test.bridges[0].destroy).toHaveBeenCalled();
    expect(test.presenter.options.bridge.status()).toBe('idle');
  });

  it('ignores callbacks from a replaced bridge for the same webinar and status from a bridge whose webinar is no longer selected', async () => {
    const test = await connected();
    const first = test.bridges[0];
    test.api.getWebinar.mockResolvedValueOnce(privateDocument({ id: 13, slug: 'second-deck', title: 'Second deck', audienceEnabled: true }));
    await test.studio.selectWebinar(13);
    /* Webinar 13 is selected: status from webinar 12's bridge must not reach the presenter. */
    test.presenter.setConnection.mockClear();
    first.options.onStatus('connected');
    expect(test.presenter.setConnection).not.toHaveBeenCalled();
    test.api.getWebinar.mockResolvedValueOnce(privateDocument({ audienceEnabled: true }));
    await test.studio.selectWebinar(12);
    test.presenter.options.bridge.connect();
    const second = test.bridges[1];
    expect(second).toBeDefined();
    test.presenter.applyAudienceState.mockClear();
    test.presenter.setConnection.mockClear();
    first.options.onState({ type: 'slide-state', payload: { index: 0, total: 1 } });
    first.options.onStatus('connected');
    expect(test.presenter.applyAudienceState).not.toHaveBeenCalled();
    expect(test.presenter.setConnection).not.toHaveBeenCalled();
    second.answer();
    expect(test.presenter.applyAudienceState).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the deck list only when the saved summary actually changed', async () => {
    const test = bridgeWiring();
    await test.studio.init();
    await test.studio.open();
    const editor = test.editorOptions();
    expect(editor).not.toBeNull();
    /* The first sync aligns the list summary with the loaded document. */
    editor.setState(editor.getState());
    const before = test.elements.wsDeckList.innerHTML;
    let rebuilds = 0;
    Object.defineProperty(test.elements.wsDeckList, 'innerHTML', { get: () => before, set: () => { rebuilds += 1; }, configurable: true });
    editor.setState(editor.getState());
    expect(rebuilds).toBe(0);
    editor.setState(stateApi.markSurfaceSaved(editor.getState(), 'master', { liveVersion: 4, updatedAt: '2026-09-05T12:00:00.000Z' }));
    expect(rebuilds).toBe(1);
    expect(test.elements.wsStatus.textContent).toMatch(/Live version 4/);
  });

  it('hands the presenter a bridge facade and builds the real bridge lazily for the selected webinar on launch', async () => {
    const test = bridgeWiring();
    await test.studio.init();
    await test.studio.open();
    const facade = test.presenter.options.bridge;
    expect(typeof facade.connect).toBe('function');
    expect(facade.status()).toBe('idle');
    expect(test.bridgeApi.createAudienceBridge).not.toHaveBeenCalled();

    expect(facade.connect()).toBe(true);
    expect(test.bridgeApi.createAudienceBridge).toHaveBeenCalledTimes(1);
    const options = test.bridges[0].options;
    expect(options.audienceUrl).toBe('https://msfgmortgage.com/webinars/first-home/studio-viewer.html');
    expect(options.allowedOrigin).toBe('https://msfgmortgage.com');
    expect(test.presenter.setConnection).toHaveBeenCalledWith('connecting');
    expect(facade.status()).toBe('connecting');

    test.bridges[0].answer();
    expect(test.presenter.setConnection).toHaveBeenCalledWith('connected');
    expect(test.presenter.applyAudienceState).toHaveBeenCalledWith({ type: 'audience-ready', payload: { index: 0, total: 1 } });
    expect(facade.sendControl('next', {})).toBe(true);
    expect(test.bridges[0].sendControl).toHaveBeenCalledWith('next', {});
    /* The bridge opens the window itself through the coordinator's opener. */
    expect(test.openWindow).not.toHaveBeenCalled();
    /* connect() again reuses the same bridge for the same webinar. */
    facade.connect();
    expect(test.bridgeApi.createAudienceBridge).toHaveBeenCalledTimes(1);
  });

  it('refuses to launch while audience access is off and says so in the status line', async () => {
    const test = bridgeWiring({ audienceEnabled: false });
    await test.studio.init();
    await test.studio.open();
    const facade = test.presenter.options.bridge;
    expect(facade.connect()).toBe(false);
    expect(test.bridgeApi.createAudienceBridge).not.toHaveBeenCalled();
    expect(test.elements.wsStatus.textContent).toMatch(/audience access is off/i);
    expect(test.elements.wsLaunchAudience.disabled).toBe(true);
    expect(facade.sendControl('next', {})).toBe(false);
    expect(facade.status()).toBe('idle');
  });

  it('clears the launch notice once the webinar reloads with audience access on', async () => {
    let accessContext = null;
    const accessHistoryApi = { createAccessHistory: () => ({
      renderAccessPanel: vi.fn(context => { accessContext = context; }),
      renderHistoryPanel: vi.fn(), deactivate: vi.fn(), destroy: vi.fn(),
    }) };
    const test = bridgeWiring({ audienceEnabled: false, accessHistoryApi });
    await test.studio.init();
    await test.studio.open();
    test.presenter.options.bridge.connect();
    expect(test.elements.wsStatus.textContent).toMatch(/audience access is off/i);
    /* The Users & Access tab turns the audience on and reloads in place. */
    test.elements.wsSettings.listeners.click({ target: test.tabs[1] });
    test.api.getWebinar.mockResolvedValue(privateDocument({ audienceEnabled: true }));
    await accessContext.reload();
    expect(test.elements.wsStatus.textContent).toMatch(/Live version 3 · Audience enabled/);
    expect(test.presenter.options.bridge.connect()).toBe(true);
  });

  it('refuses to launch without a valid audience host configuration', async () => {
    for (const audienceConfig of [null, { origin: 'http://msfgmortgage.com' }, { origin: 'https://msfgmortgage.com/path' }]) {
      const test = bridgeWiring({ audienceConfig });
      await test.studio.init();
      await test.studio.open();
      expect(test.presenter.options.bridge.connect()).toBe(false);
      expect(test.bridgeApi.createAudienceBridge).not.toHaveBeenCalled();
      expect(test.elements.wsStatus.textContent).toMatch(/not configured/i);
    }
  });

  it('drops the bridge when the webinar changes and builds a fresh one for the new slug, ignoring late state from the old one', async () => {
    const test = bridgeWiring();
    await test.studio.init();
    await test.studio.open();
    const facade = test.presenter.options.bridge;
    facade.connect();
    test.bridges[0].answer();
    test.presenter.applyAudienceState.mockClear();
    await test.studio.selectWebinar(13);
    expect(test.bridges[0].destroy).toHaveBeenCalled();
    expect(facade.status()).toBe('idle');
    test.bridges[0].options.onState({ type: 'slide-state', payload: { index: 0, total: 1 } });
    expect(test.presenter.applyAudienceState).not.toHaveBeenCalled();
    facade.connect();
    expect(test.bridgeApi.createAudienceBridge).toHaveBeenCalledTimes(2);
    expect(test.bridges[1].options.audienceUrl).toBe('https://msfgmortgage.com/webinars/second-deck/studio-viewer.html');
  });

  it('wires the header launch buttons: Presenter activates the presenter tab and Audience launches through the bridge', async () => {
    const test = bridgeWiring();
    await test.studio.init();
    await test.studio.open();
    test.elements.wsSettings.listeners.click({ target: test.tabs[2] });
    expect(test.tabs[2].getAttribute('aria-selected')).toBe('true');
    test.elements.wsLaunchPresenter.listeners.click({ target: test.elements.wsLaunchPresenter });
    expect(test.tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(test.elements.wsLaunchAudience.disabled).toBe(false);
    test.elements.wsLaunchAudience.listeners.click({ target: test.elements.wsLaunchAudience });
    expect(test.bridgeApi.createAudienceBridge).toHaveBeenCalledTimes(1);
    expect(test.bridges[0].connect).toHaveBeenCalledTimes(1);
    expect(test.openWindow).not.toHaveBeenCalled();
  });

  it('reconnects through the current bridge and destroys it with the Studio', async () => {
    const test = bridgeWiring();
    await test.studio.init();
    await test.studio.open();
    const facade = test.presenter.options.bridge;
    facade.connect();
    expect(facade.reconnect()).toBe(true);
    expect(test.bridges[0].reconnect).toHaveBeenCalledTimes(1);
    test.studio.destroy();
    expect(test.bridges[0].destroy).toHaveBeenCalled();
    expect(facade.status()).toBe('idle');
    expect(facade.sendControl('next', {})).toBe(false);
  });
});
