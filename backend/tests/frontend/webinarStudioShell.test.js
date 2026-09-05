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

describe('Webinar Studio preview wiring', () => {
  function previewWiring({ previewConfig, previewApi } = {}) {
    vi.resetModules();
    const createWebinarStudio = require(studioPath);
    const editorApi = require(resolve(root, 'js/webinar-studio/editor.js'));
    const dom = makeDocument();
    const previewHost = new FakeElement('wsPreviewHost');
    previewHost.children = [];
    previewHost.append = (...nodes) => previewHost.children.push(...nodes);
    const iframe = { src: '', title: '', contentWindow: { postMessage: vi.fn() }, setAttribute: vi.fn(), attributes: {} };
    iframe.setAttribute = (name, value) => { iframe.attributes[name] = String(value); if (name === 'src') iframe.src = String(value); };
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
    const completePreviewApi = previewApi === undefined
      ? { createPreviewController: vi.fn().mockReturnValue(controller) }
      : previewApi;
    const studio = createWebinarStudio({
      document: documentWithHost,
      api,
      stateApi,
      editorApi,
      previewApi: completePreviewApi,
      previewConfig,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 7, activeRole: 'admin', role: 'admin' }),
      openWindow: vi.fn(),
      navigationTarget: new FakeEventTarget(),
    });
    return { studio, previewApi: completePreviewApi, controller, iframe, previewHost, dom, settingsPanel };
  }

  it('builds the canonical preview controller from the published preview module with an exact-origin sandboxed iframe', async () => {
    const test = previewWiring({ previewConfig: { url: 'https://msfgmortgage.com/webinars/first-home-without-mystery/studio-viewer.html?mode=preview', origin: 'https://msfgmortgage.com' } });
    await test.studio.init();
    expect(test.previewHost.children).toContain(test.iframe);
    expect(test.iframe.attributes.sandbox).toBe('allow-scripts');
    expect(test.iframe.src).toBe('https://msfgmortgage.com/webinars/first-home-without-mystery/studio-viewer.html?mode=preview');
    expect(test.previewApi.createPreviewController).toHaveBeenCalledWith(expect.objectContaining({
      iframe: test.iframe,
      allowedOrigin: 'https://msfgmortgage.com',
      onState: expect.any(Function),
    }));
    await test.studio.open();
    test.dom.tabs[2].dataset.wsTab = 'code';
    test.dom.elements.wsSettings.listeners.click({ target: test.dom.tabs[2] });
    expect(test.settingsPanel.replaceChildren).toHaveBeenCalled();
  });

  it('refuses a preview whose URL origin does not match the configured origin', async () => {
    const test = previewWiring({ previewConfig: { url: 'https://evil.example/studio-viewer.html?mode=preview', origin: 'https://msfgmortgage.com' } });
    await test.studio.init();
    expect(test.previewApi.createPreviewController).not.toHaveBeenCalled();
    expect(test.previewHost.children).toHaveLength(0);
  });

  it('explains a missing preview configuration on the Code tab instead of silently doing nothing', async () => {
    const test = previewWiring({ previewConfig: undefined });
    await test.studio.init();
    await test.studio.open();
    expect(test.previewApi.createPreviewController).not.toHaveBeenCalled();
    test.dom.tabs[2].dataset.wsTab = 'code';
    test.dom.elements.wsSettings.listeners.click({ target: test.dom.tabs[2] });
    expect(test.settingsPanel.innerHTML).toMatch(/preview host is not configured/i);
    expect(test.settingsPanel.innerHTML).not.toMatch(/Master HTML and CSS tools will appear here/);
  });

  it('ships every Studio module before the coordinator and hosts the preview frame in the shell', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const order = ['js/api-server.js', 'js/webinar-studio/api.js', 'js/webinar-studio/state.js', 'js/webinar-studio/access-history.js',
      'js/webinar-studio/assets.js', 'js/webinar-studio/preview.js', 'js/webinar-studio/editor.js', 'js/webinar-studio.js'];
    const positions = order.map(file => html.indexOf(`src="${file}`));
    positions.forEach((position, index) => {
      expect(position, order[index]).toBeGreaterThan(-1);
      if (index) expect(position).toBeGreaterThan(positions[index - 1]);
    });
    expect(html).toContain('id="wsPreviewHost"');
    expect(html).toContain('id="wsWorkspaceContent"');
    expect(html).not.toContain('WebinarStudioEditorPreview');
  });
});
