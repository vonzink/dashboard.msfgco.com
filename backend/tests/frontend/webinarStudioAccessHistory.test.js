import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.type = '';
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      remove: (...values) => values.forEach(value => this.classList.values.delete(value)),
    };
  }
  append(...nodes) { this.children.push(...nodes.filter(Boolean)); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    if (name === 'type') this.type = String(value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener));
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }
  querySelectorAll(selector) {
    const found = [];
    const matches = node => {
      if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      if (attribute) {
        const value = node.getAttribute(attribute[1]);
        return attribute[2] === undefined ? value !== null : value === attribute[2];
      }
      return node.tagName.toLowerCase() === selector.toLowerCase();
    };
    const visit = node => {
      for (const child of node.children || []) {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    if (selector === '[data-ws-tab]' && this.dataset.wsTab) return this;
    return null;
  }
  focus() { this.ownerDocument.activeElement = this; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
}

function text(node) {
  return [node.textContent, ...(node.children || []).map(text)].join(' ');
}

function privateState(overrides = {}) {
  return {
    webinar: {
      id: 12,
      slug: 'first-home',
      title: 'Your first home, without the mystery.',
      primaryOwnerUserId: 7,
      audienceEnabled: false,
    },
    liveVersion: 7,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function harness({ admin = true, dirty = false, api = {}, confirms = [], confirmImpl } = {}) {
  const document = new FakeDocument();
  const root = document.createElement('section');
  const reload = vi.fn().mockResolvedValue(undefined);
  const onArchived = vi.fn().mockResolvedValue(undefined);
  const confirm = vi.fn(confirmImpl);
  if (!confirmImpl) {
    confirms.forEach(result => confirm.mockResolvedValueOnce(result));
    if (!confirms.length) confirm.mockResolvedValue(true);
  }
  const completeApi = {
    listUsers: vi.fn().mockResolvedValue([
      { id: 7, name: 'Seth Angell', email: 'seth@example.test', is_active: 1 },
      { id: 8, name: 'Avery Admin', email: 'avery@example.test', is_active: 1 },
      { id: 9, name: 'Former User', email: 'former@example.test', is_active: 0 },
    ]),
    changeOwner: vi.fn().mockResolvedValue({ primaryOwnerUserId: 8 }),
    changeAudienceAccess: vi.fn().mockResolvedValue({ audienceEnabled: true }),
    archiveWebinar: vi.fn().mockResolvedValue({ webinarId: 12 }),
    getHistory: vi.fn().mockResolvedValue([]),
    restoreRevision: vi.fn().mockResolvedValue({ liveVersion: 8 }),
    ...api,
  };
  const state = privateState();
  const context = {
    root,
    state,
    webinarId: 12,
    isAdmin: admin,
    currentUser: { id: 7, name: 'Seth Angell', email: 'seth@example.test' },
    hasUnsavedChanges: () => dirty,
    reload,
    onArchived,
  };
  const accessHistoryApi = require('../../../js/webinar-studio/access-history.js');
  const controller = accessHistoryApi.createAccessHistory({ api: completeApi, confirm, document });
  return { api: completeApi, confirm, context, controller, onArchived, reload, root };
}

function retargetContext(test, id = 99) {
  const state = privateState({
    webinar: {
      id,
      slug: 'other-webinar',
      title: 'Other webinar',
      primaryOwnerUserId: 8,
      audienceEnabled: false,
    },
    liveVersion: 3,
  });
  return {
    ...test.context,
    state,
    getState: () => state,
    webinarId: id,
    reload: vi.fn().mockResolvedValue(undefined),
    onArchived: vi.fn().mockResolvedValue(undefined),
  };
}

function privateDocumentFor(id, title, liveVersion = 7) {
  return {
    id,
    slug: `webinar-${id}`,
    title,
    primaryOwnerUserId: 7,
    audienceEnabled: false,
    liveVersion,
    masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
    masterCss: '',
    slides: [{
      id: id === 99 ? '99999999-9999-4999-8999-999999999999' : '11111111-1111-4111-8111-111111111111',
      title: 'Opening',
      anchor: 'opening',
      targetSeconds: 60,
      speakerNotes: '',
      html: '<section>Opening</section>',
      css: '',
      javascript: '',
    }],
  };
}

function coordinatorHarness({ api = {} } = {}) {
  const document = new FakeDocument();
  const ids = [
    'webinarStudioLauncher', 'webinarStudioModal', 'wsClose', 'wsDeckList',
    'wsDeckSelect', 'wsWorkspace', 'wsStatus', 'wsNewWebinar', 'wsSettings',
    'wsSettingsPanel', 'wsLaunchAudience', 'wsLaunchPresenter',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement('div', document)]));
  document.getElementById = id => elements[id] || null;
  document.addEventListener = vi.fn();
  document.removeEventListener = vi.fn();
  document.body = new FakeElement('body', document);
  document.activeElement = elements.webinarStudioLauncher;
  elements.webinarStudioModal.hidden = true;
  const tabs = ['presenter', 'access', 'code', 'assets', 'history'].map(name => {
    const tab = new FakeElement('button', document);
    tab.dataset.wsTab = name;
    return tab;
  });
  elements.wsSettings.querySelectorAll = selector => selector === '[data-ws-tab]' ? tabs : [];
  const accessController = {
    contexts: [],
    renderAccessPanel: vi.fn(context => { accessController.contexts.push(context); }),
    renderHistoryPanel: vi.fn(context => { accessController.contexts.push(context); }),
    deactivate: vi.fn(),
    destroy: vi.fn(),
  };
  const completeApi = {
    listWebinars: vi.fn().mockResolvedValue([
      { id: 12, slug: 'webinar-12', title: 'Webinar A', liveVersion: 7, audienceEnabled: false },
      { id: 99, slug: 'webinar-99', title: 'Webinar B', liveVersion: 3, audienceEnabled: false },
    ]),
    getWebinar: vi.fn().mockImplementation(id => Promise.resolve(privateDocumentFor(id, id === 99 ? 'Webinar B' : 'Webinar A', id === 99 ? 3 : 7))),
    ...api,
  };
  const createStudio = require('../../../js/webinar-studio.js');
  const stateApi = require('../../../js/webinar-studio/state.js');
  const studio = createStudio({
    accessHistoryApi: { createAccessHistory: () => accessController },
    api: completeApi,
    confirm: vi.fn().mockResolvedValue(true),
    currentUser: () => ({ id: 1, name: 'Admin', activeRole: 'admin' }),
    document,
    navigationTarget: new FakeElement('window', document),
    openWindow: vi.fn(),
    stateApi,
  });
  return {
    accessController,
    api: completeApi,
    document,
    elements,
    studio,
    tab(name) {
      const target = tabs.find(candidate => candidate.dataset.wsTab === name);
      elements.wsSettings.emit('click', { target });
    },
  };
}

describe('Webinar Studio access and revision history', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows owners who owns the webinar and the administrator boundary without rendering admin controls', async () => {
    const test = harness({ admin: false });

    await test.controller.renderAccessPanel(test.context);

    expect(text(test.root)).toMatch(/Seth Angell/);
    expect(text(test.root)).toMatch(/administrator/i);
    expect(test.root.querySelector('[data-owner-search]')).toBeNull();
    expect(test.root.querySelector('[data-audience-toggle]')).toBeNull();
    expect(test.root.querySelector('[data-archive-webinar]')).toBeNull();
    expect(test.api.listUsers).not.toHaveBeenCalled();
  });

  it('lets administrators search the authenticated active directory and replace the owner only with a listed user', async () => {
    const test = harness();
    await test.controller.renderAccessPanel(test.context);

    const search = test.root.querySelector('[data-owner-search]');
    search.value = 'avery@';
    search.emit('input');
    expect(text(test.root)).toContain('Avery Admin');
    expect(text(test.root)).not.toContain('Former User');

    await expect(test.controller.changeOwner(9)).resolves.toMatchObject({ ok: false });
    expect(test.api.changeOwner).not.toHaveBeenCalled();

    await expect(test.controller.changeOwner(8)).resolves.toEqual({ ok: true });
    expect(test.api.changeOwner).toHaveBeenCalledWith(12, { primaryOwnerUserId: 8 });
    expect(test.reload).toHaveBeenCalledOnce();
  });

  it('keeps audience availability separate from publishing and confirms admin archive by webinar name', async () => {
    const test = harness({ confirms: [true] });
    await test.controller.renderAccessPanel(test.context);

    expect(text(test.root)).toMatch(/public availability/i);
    expect(text(test.root)).toMatch(/does not publish a draft/i);
    await expect(test.controller.setAudienceEnabled(true)).resolves.toEqual({ ok: true });
    expect(test.api.changeAudienceAccess).toHaveBeenCalledWith(12, { enabled: true });
    expect(test.reload).toHaveBeenCalledOnce();

    await expect(test.controller.archiveWebinar()).resolves.toEqual({ ok: true });
    expect(test.confirm.mock.calls.at(-1)[0]).toContain('Your first home, without the mystery.');
    expect(test.api.archiveWebinar).toHaveBeenCalledWith(12);
    expect(test.onArchived).toHaveBeenCalledOnce();
  });

  it('does not run a reload-causing access mutation when the user keeps unsaved editor work', async () => {
    const test = harness({ dirty: true, confirms: [false] });
    await test.controller.renderAccessPanel(test.context);

    await expect(test.controller.setAudienceEnabled(true)).resolves.toMatchObject({ ok: false, cancelled: true });

    expect(test.confirm).toHaveBeenCalledWith(expect.stringMatching(/discard unsaved changes/i), expect.objectContaining({ confirmText: 'Discard and continue' }));
    expect(test.api.changeAudienceAccess).not.toHaveBeenCalled();
    expect(test.reload).not.toHaveBeenCalled();
  });

  it('renders only bounded revision metadata and never renders source, code, notes, or settings from a response', async () => {
    const test = harness({
      api: {
        getHistory: vi.fn().mockResolvedValue([{
          id: 21,
          version: 6,
          changeType: 'slide_saved',
          changeSummary: 'Updated slide',
          createdAt: '2026-09-05T12:34:00.000Z',
          createdBy: { name: 'Avery Admin' },
          snapshot: '<script>CANARY_CODE</script>',
          speakerNotes: 'CANARY_NOTES',
          settings: 'CANARY_SETTINGS',
        }]),
      },
    });

    await test.controller.renderHistoryPanel(test.context);

    expect(text(test.root)).toMatch(/Version 6/);
    expect(text(test.root)).toContain('Updated slide');
    expect(text(test.root)).toContain('Avery Admin');
    expect(text(test.root)).not.toMatch(/CANARY_CODE|CANARY_NOTES|CANARY_SETTINGS|snapshot|speakerNotes/);
  });

  it('restores a named revision against the current version and reloads the complete private document', async () => {
    const test = harness({ confirms: [true], api: { getHistory: vi.fn().mockResolvedValue([{ id: 21, version: 6, changeType: 'slide_saved', changeSummary: 'Updated slide', createdAt: '2026-09-05T12:34:00.000Z', createdBy: { name: 'Avery Admin' } }]) } });
    await test.controller.renderHistoryPanel(test.context);

    await expect(test.controller.restoreRevision(21)).resolves.toEqual({ ok: true });

    expect(test.confirm).toHaveBeenCalledWith(expect.stringMatching(/version 6/i), expect.objectContaining({ confirmText: expect.stringMatching(/restore/i) }));
    expect(test.api.restoreRevision).toHaveBeenCalledWith(12, 21, { expectedVersion: 7 });
    expect(test.reload).toHaveBeenCalledOnce();
  });

  it('reads expectedVersion at restore time instead of using the panel render snapshot', async () => {
    const test = harness({ confirms: [true], api: { getHistory: vi.fn().mockResolvedValue([{ id: 21, version: 6, changeType: 'slide_saved', changeSummary: 'Updated slide', createdAt: '2026-09-05T12:34:00.000Z', createdBy: { name: 'Avery Admin' } }]) } });
    test.context.getState = () => privateState({ liveVersion: 9 });
    await test.controller.renderHistoryPanel(test.context);

    await test.controller.restoreRevision(21);

    expect(test.api.restoreRevision).toHaveBeenCalledWith(12, 21, { expectedVersion: 9 });
  });

  it('requires explicit discard before the named restore confirmation when unsaved work exists', async () => {
    const test = harness({ dirty: true, confirms: [false], api: { getHistory: vi.fn().mockResolvedValue([{ id: 21, version: 6, changeType: 'slide_saved', changeSummary: 'Updated slide', createdAt: '2026-09-05T12:34:00.000Z', createdBy: { name: 'Avery Admin' } }]) } });
    await test.controller.renderHistoryPanel(test.context);

    await expect(test.controller.restoreRevision(21)).resolves.toMatchObject({ ok: false, cancelled: true });

    expect(test.confirm).toHaveBeenCalledWith(expect.stringMatching(/discard unsaved changes.*version 6/i), expect.objectContaining({ confirmText: 'Discard and continue' }));
    expect(test.api.restoreRevision).not.toHaveBeenCalled();
    expect(test.reload).not.toHaveBeenCalled();
  });

  it('surfaces backend-authoritative failures without retrying, reloading, or changing local state', async () => {
    const conflict = Object.assign(new Error('conflict details'), { status: 409, code: 'VERSION_CONFLICT' });
    const test = harness({
      confirms: [true],
      api: {
        getHistory: vi.fn().mockResolvedValue([{ id: 21, version: 6, changeType: 'slide_saved', changeSummary: 'Updated slide', createdAt: '2026-09-05T12:34:00.000Z', createdBy: { name: 'Avery Admin' } }]),
        restoreRevision: vi.fn().mockRejectedValue(conflict),
      },
    });
    await test.controller.renderHistoryPanel(test.context);

    await expect(test.controller.restoreRevision(21)).resolves.toMatchObject({ ok: false });

    expect(test.api.restoreRevision).toHaveBeenCalledOnce();
    expect(test.reload).not.toHaveBeenCalled();
    expect(test.context.state.liveVersion).toBe(7);
    expect(text(test.root)).toMatch(/changed.*reload/i);
  });

  it.each([
    ['owner replacement', 'access', test => test.controller.changeOwner(8), 'changeOwner'],
    ['audience access', 'access', test => test.controller.setAudienceEnabled(true), 'changeAudienceAccess'],
    ['archive', 'access', test => test.controller.archiveWebinar(), 'archiveWebinar'],
    ['revision restore', 'history', test => test.controller.restoreRevision(21), 'restoreRevision'],
  ])('cancels pending %s confirmation instead of retargeting its API call to a newly rendered webinar', async (_label, panel, start, apiMethod) => {
    const confirmation = deferred();
    const test = harness({ dirty: panel === 'access' && apiMethod !== 'archiveWebinar', confirmImpl: () => confirmation.promise });
    if (panel === 'access') await test.controller.renderAccessPanel(test.context);
    else {
      test.api.getHistory.mockResolvedValueOnce([{ id: 21, version: 6, changeType: 'slide_saved', changeSummary: 'Updated slide', createdAt: '2026-09-05T12:34:00.000Z', createdBy: { name: 'Avery Admin' } }]);
      await test.controller.renderHistoryPanel(test.context);
    }

    const operation = start(test);
    const nextContext = retargetContext(test);
    if (panel === 'access') await test.controller.renderAccessPanel(nextContext);
    else await test.controller.renderHistoryPanel(nextContext);
    confirmation.resolve(true);

    await expect(operation).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(test.api[apiMethod]).not.toHaveBeenCalled();
    expect(test.reload).not.toHaveBeenCalled();
    expect(nextContext.reload).not.toHaveBeenCalled();
  });

  it('cancels confirmation when the controller is deactivated or destroyed', async () => {
    const deactivatedConfirmation = deferred();
    const deactivated = harness({ dirty: true, confirmImpl: () => deactivatedConfirmation.promise });
    await deactivated.controller.renderAccessPanel(deactivated.context);
    const audience = deactivated.controller.setAudienceEnabled(true);
    deactivated.controller.deactivate();
    deactivatedConfirmation.resolve(true);
    await expect(audience).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(deactivated.api.changeAudienceAccess).not.toHaveBeenCalled();

    const destroyedConfirmation = deferred();
    const destroyed = harness({ dirty: true, confirmImpl: () => destroyedConfirmation.promise });
    await destroyed.controller.renderAccessPanel(destroyed.context);
    const owner = destroyed.controller.changeOwner(8);
    destroyed.controller.destroy();
    destroyedConfirmation.resolve(true);
    await expect(owner).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(destroyed.api.changeOwner).not.toHaveBeenCalled();
  });

  it('does not reload or render an error into another webinar when the initiating API settles late', async () => {
    const pendingApi = deferred();
    const test = harness({ api: { changeAudienceAccess: vi.fn(() => pendingApi.promise) } });
    await test.controller.renderAccessPanel(test.context);
    const operation = test.controller.setAudienceEnabled(true);
    await Promise.resolve();

    const nextContext = retargetContext(test);
    await test.controller.renderAccessPanel(nextContext);
    pendingApi.resolve({ audienceEnabled: true });

    await expect(operation).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(test.api.changeAudienceAccess).toHaveBeenCalledWith(12, { enabled: true });
    expect(test.reload).not.toHaveBeenCalled();
    expect(nextContext.reload).not.toHaveBeenCalled();
    expect(text(test.root)).toContain('Primary owner: Avery Admin');
    expect(text(test.root)).not.toMatch(/could not be completed|changed.*reload/i);
  });

  it('allows only the latest overlapping access operation to reload its initiating context', async () => {
    const firstApi = deferred();
    const test = harness({
      api: {
        changeAudienceAccess: vi.fn()
          .mockImplementationOnce(() => firstApi.promise)
          .mockResolvedValueOnce({ audienceEnabled: false }),
      },
    });
    await test.controller.renderAccessPanel(test.context);

    const first = test.controller.setAudienceEnabled(true);
    await Promise.resolve();
    const second = test.controller.setAudienceEnabled(false);
    await expect(second).resolves.toEqual({ ok: true });
    firstApi.resolve({ audienceEnabled: true });
    await expect(first).resolves.toMatchObject({ ok: false, cancelled: true });

    expect(test.api.changeAudienceAccess.mock.calls).toEqual([
      [12, { enabled: true }],
      [12, { enabled: false }],
    ]);
    expect(test.reload).toHaveBeenCalledOnce();
  });

  it('integrates access and history panels with the selected Studio lifecycle and tears the controller down', async () => {
    const document = new FakeDocument();
    const ids = [
      'webinarStudioLauncher', 'webinarStudioModal', 'wsClose', 'wsDeckList',
      'wsDeckSelect', 'wsWorkspace', 'wsStatus', 'wsNewWebinar', 'wsSettings',
      'wsSettingsPanel', 'wsLaunchAudience', 'wsLaunchPresenter',
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new FakeElement('div', document)]));
    document.getElementById = id => elements[id] || null;
    document.addEventListener = vi.fn();
    document.removeEventListener = vi.fn();
    document.body = new FakeElement('body', document);
    document.activeElement = elements.webinarStudioLauncher;
    elements.webinarStudioModal.hidden = true;
    const tabs = ['presenter', 'access', 'code', 'assets', 'history'].map(name => {
      const tab = new FakeElement('button', document);
      tab.dataset.wsTab = name;
      return tab;
    });
    elements.wsSettings.querySelectorAll = selector => selector === '[data-ws-tab]' ? tabs : [];
    const accessController = {
      renderAccessPanel: vi.fn().mockResolvedValue(undefined),
      renderHistoryPanel: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn(),
      destroy: vi.fn(),
    };
    const accessHistoryApi = { createAccessHistory: vi.fn(() => accessController) };
    const api = {
      listWebinars: vi.fn().mockResolvedValue([{ id: 12, slug: 'first-home', title: 'First Home', liveVersion: 7, audienceEnabled: false }]),
      getWebinar: vi.fn().mockResolvedValue({
        id: 12,
        slug: 'first-home',
        title: 'First Home',
        primaryOwnerUserId: 7,
        audienceEnabled: false,
        liveVersion: 7,
        masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
        masterCss: '',
        slides: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Opening', anchor: 'opening', targetSeconds: 60, speakerNotes: '', html: '<section>Opening</section>', css: '', javascript: '' }],
      }),
    };
    const navigationTarget = new FakeElement('window', document);
    const createStudio = require('../../../js/webinar-studio.js');
    const stateApi = require('../../../js/webinar-studio/state.js');
    const studio = createStudio({
      accessHistoryApi,
      api,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 1, name: 'Admin', activeRole: 'admin' }),
      document,
      navigationTarget,
      openWindow: vi.fn(),
      stateApi,
    });

    await studio.init();
    await studio.open();
    elements.wsSettings.emit('click', { target: tabs[1] });
    await Promise.resolve();
    expect(accessHistoryApi.createAccessHistory).toHaveBeenCalledOnce();
    expect(accessController.renderAccessPanel).toHaveBeenCalledWith(expect.objectContaining({
      root: elements.wsSettingsPanel,
      webinarId: 12,
      isAdmin: true,
      state: expect.objectContaining({ liveVersion: 7 }),
      reload: expect.any(Function),
    }));

    elements.wsSettings.emit('click', { target: tabs[4] });
    await Promise.resolve();
    expect(accessController.renderHistoryPanel).toHaveBeenCalledWith(expect.objectContaining({ webinarId: 12 }));
    accessController.deactivate.mockClear();
    elements.wsSettings.emit('click', { target: tabs[2] });
    expect(accessController.deactivate).toHaveBeenCalledOnce();
    studio.destroy();
    expect(accessController.destroy).toHaveBeenCalledOnce();
  });

  it('keeps webinar B selected when overlapping selection A resolves after B', async () => {
    const pendingA = deferred();
    const pendingB = deferred();
    const test = coordinatorHarness({
      api: {
        getWebinar: vi.fn(id => id === 12 ? pendingA.promise : pendingB.promise),
      },
    });
    await test.studio.init();

    const selectingA = test.studio.selectWebinar(12);
    await Promise.resolve();
    const selectingB = test.studio.selectWebinar(99);
    pendingB.resolve(privateDocumentFor(99, 'Webinar B', 3));
    await expect(selectingB).resolves.toBe(true);
    pendingA.resolve(privateDocumentFor(12, 'Webinar A', 7));
    await selectingA;

    expect(test.elements.wsWorkspace.innerHTML).toContain('Webinar B');
    expect(test.elements.wsWorkspace.innerHTML).not.toContain('Webinar A');
    expect(test.elements.wsStatus.textContent).toContain('Live version 3');
    expect(test.elements.wsDeckList.innerHTML).toContain('data-ws-webinar-id="99" aria-current="true"');
    expect(test.api.getWebinar.mock.calls.map(([id]) => id)).toEqual([12, 99]);
  });

  it('does not let a late reload for webinar A overwrite a faster selection of webinar B', async () => {
    const lateReloadA = deferred();
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.selectWebinar(12);
    test.tab('access');
    const contextA = test.accessController.contexts.at(-1);
    test.api.getWebinar.mockImplementationOnce(() => lateReloadA.promise)
      .mockResolvedValueOnce(privateDocumentFor(99, 'Webinar B', 3));

    const reloadingA = contextA.reload();
    const selectingB = test.studio.selectWebinar(99);
    await selectingB;
    lateReloadA.resolve(privateDocumentFor(12, 'Late Webinar A', 8));
    await reloadingA;

    expect(test.elements.wsWorkspace.innerHTML).toContain('Webinar B');
    expect(test.elements.wsWorkspace.innerHTML).not.toContain('Late Webinar A');
    expect(test.elements.wsStatus.textContent).toContain('Live version 3');
    expect(test.accessController.contexts.at(-1)).toMatchObject({ webinarId: 99 });
  });

  it('ignores a stale rejected selection after webinar B has loaded', async () => {
    const pendingA = deferred();
    const test = coordinatorHarness({
      api: {
        getWebinar: vi.fn(id => id === 12 ? pendingA.promise : Promise.resolve(privateDocumentFor(99, 'Webinar B', 3))),
      },
    });
    await test.studio.init();
    const selectingA = test.studio.selectWebinar(12);
    await Promise.resolve();
    await test.studio.selectWebinar(99);
    pendingA.reject(Object.assign(new Error('PRIVATE_STALE_ERROR'), { status: 500 }));
    await selectingA;

    expect(test.elements.wsWorkspace.innerHTML).toContain('Webinar B');
    expect(test.elements.wsWorkspace.innerHTML).not.toMatch(/unavailable|PRIVATE_STALE_ERROR/);
    expect(test.elements.wsStatus.textContent).toContain('Live version 3');
  });

  it('does not apply a pending selection after close or destroy', async () => {
    const closePending = deferred();
    const closed = coordinatorHarness({ api: { getWebinar: vi.fn(() => closePending.promise) } });
    await closed.studio.init();
    const opening = closed.studio.open();
    await Promise.resolve();
    await closed.studio.close();
    closePending.resolve(privateDocumentFor(12, 'Closed Webinar A', 7));
    await opening;
    expect(closed.elements.webinarStudioModal.hidden).toBe(true);
    expect(closed.elements.wsWorkspace.innerHTML).not.toContain('Closed Webinar A');

    const destroyPending = deferred();
    const destroyed = coordinatorHarness({ api: { getWebinar: vi.fn(() => destroyPending.promise) } });
    await destroyed.studio.init();
    const selecting = destroyed.studio.selectWebinar(12);
    destroyed.studio.destroy();
    destroyPending.resolve(privateDocumentFor(12, 'Destroyed Webinar A', 7));
    await selecting;
    expect(destroyed.elements.wsWorkspace.innerHTML).not.toContain('Destroyed Webinar A');
    expect(destroyed.accessController.renderAccessPanel).not.toHaveBeenCalled();
  });

  it('discards a late archive list refresh after webinar B is selected', async () => {
    const archiveList = deferred();
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.selectWebinar(12);
    test.tab('access');
    const contextA = test.accessController.contexts.at(-1);
    test.api.listWebinars.mockImplementationOnce(() => archiveList.promise);

    const refreshingArchive = contextA.onArchived();
    await test.studio.selectWebinar(99);
    archiveList.resolve([{ id: 12, slug: 'webinar-12', title: 'Stale A', liveVersion: 8, audienceEnabled: false }]);
    await refreshingArchive;

    expect(test.elements.wsWorkspace.innerHTML).toContain('Webinar B');
    expect(test.elements.wsWorkspace.innerHTML).not.toContain('Stale A');
    expect(test.elements.wsStatus.textContent).toContain('Live version 3');
    expect(test.accessController.contexts.at(-1)).toMatchObject({ webinarId: 99 });
  });

  it('does not leak rejected stale reload or archive refresh errors into webinar B', async () => {
    const lateReloadA = deferred();
    const lateArchiveList = deferred();
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.selectWebinar(12);
    test.tab('access');
    const contextA = test.accessController.contexts.at(-1);
    test.api.getWebinar.mockImplementationOnce(() => lateReloadA.promise)
      .mockResolvedValueOnce(privateDocumentFor(99, 'Webinar B', 3));

    const reloadingA = contextA.reload();
    await test.studio.selectWebinar(99);
    lateReloadA.reject(Object.assign(new Error('PRIVATE_RELOAD_ERROR'), { status: 500 }));
    await expect(reloadingA).resolves.toBe(false);

    await test.studio.selectWebinar(12);
    test.tab('access');
    const currentContextA = test.accessController.contexts.at(-1);
    test.api.listWebinars.mockImplementationOnce(() => lateArchiveList.promise);
    const staleArchive = currentContextA.onArchived();
    await test.studio.selectWebinar(99);
    lateArchiveList.reject(Object.assign(new Error('PRIVATE_ARCHIVE_ERROR'), { status: 500 }));
    await expect(staleArchive).resolves.toBe(false);

    expect(test.elements.wsWorkspace.innerHTML).toContain('Webinar B');
    expect(test.elements.wsWorkspace.innerHTML).not.toMatch(/PRIVATE_|unavailable/);
    expect(test.elements.wsStatus.textContent).toContain('Live version 3');
  });
});
