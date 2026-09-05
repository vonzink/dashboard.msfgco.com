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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function makeDocument() {
  const ids = [
    'webinarStudioLauncher', 'webinarStudioModal', 'wsClose', 'wsDeckList',
    'wsDeckSelect', 'wsWorkspace', 'wsStatus', 'wsNewWebinar', 'wsSettings',
    'wsLaunchAudience', 'wsLaunchPresenter',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements.webinarStudioLauncher.hidden = true;
  elements.webinarStudioLauncher.disabled = true;
  elements.webinarStudioModal.hidden = true;
  const document = {
    activeElement: elements.webinarStudioLauncher,
    body: { classList: new FakeClassList() },
    listeners: {},
    getElementById: id => elements[id] || null,
    addEventListener(type, callback) { this.listeners[type] = callback; },
  };
  return { document, elements };
}

function loadStudio({
  api = {},
  role = 'user',
  confirm = vi.fn().mockResolvedValue(true),
  state = stateApi,
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
  });
  return { studio, api: completeApi, confirm, ...dom };
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
});
