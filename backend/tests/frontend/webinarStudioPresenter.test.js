import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

function matches(element, selector) {
  return selector.split(',').map(part => part.trim()).some(part => {
    if (part.startsWith('.')) return element.className.split(/\s+/).includes(part.slice(1));
    if (part.startsWith('#')) return element.id === part.slice(1);
    const attribute = /^([a-z]*)\[([\w-]+)(?:="([^"]*)")?\]$/i.exec(part);
    if (attribute) {
      if (attribute[1] && element.tagName.toLowerCase() !== attribute[1].toLowerCase()) return false;
      const value = element.getAttribute(attribute[2]);
      return attribute[3] === undefined ? value !== null : value === attribute[3];
    }
    return element.tagName.toLowerCase() === part.toLowerCase();
  });
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.id = '';
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.type = '';
    this.isContentEditable = false;
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach(value => this.classList.values.add(value)),
      remove: (...values) => values.forEach(value => this.classList.values.delete(value)),
      toggle: (value, force) => {
        const on = force === undefined ? !this.classList.values.has(value) : Boolean(force);
        on ? this.classList.values.add(value) : this.classList.values.delete(value);
        return on;
      },
      contains: value => this.classList.values.has(value),
    };
  }
  adopt(nodes) { nodes.filter(Boolean).forEach(node => { node.parentElement = this; }); return nodes.filter(Boolean); }
  append(...nodes) { this.children.push(...this.adopt(nodes)); }
  appendChild(node) { this.children.push(...this.adopt([node])); return node; }
  replaceChildren(...nodes) { this.children = this.adopt(nodes); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'type') this.type = String(value);
    if (name === 'contenteditable') this.isContentEditable = String(value) !== 'false';
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  matches(selector) { return matches(this, selector); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener));
  }
  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener({ target: this, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...event });
    }
  }
  querySelectorAll(selector) {
    // Supports simple selectors plus one level of descendant combinator ("A B").
    const [head, ...rest] = selector.trim().split(/\s+(?![^[]*\])/);
    const found = [];
    const visit = node => {
      for (const child of node.children || []) {
        if (matches(child, head)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    if (!rest.length) return found;
    return found.flatMap(node => node.querySelectorAll(rest.join(' ')));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node;
    return null;
  }
  focus() { this.ownerDocument.activeElement = this; }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.listeners = new Map();
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  createDocumentFragment() { return new FakeElement('fragment', this); }
  addEventListener(type, listener, options) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    this.captureFlags = this.captureFlags || new Map();
    this.captureFlags.set(listener, options === true || options?.capture === true);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener));
  }
  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
}

function text(node) {
  return [node.textContent, ...(node.children || []).map(text)].join(' ').replace(/\s+/g, ' ').trim();
}

function slide(id, title, anchor, targetSeconds, speakerNotes = '') {
  return { id, title, anchor, targetSeconds, speakerNotes, html: `<section>${title}</section>`, css: '', javascript: '', dirtyFields: [] };
}

function studioState(overrides = {}) {
  return {
    webinar: { id: 12, slug: 'first-home', title: 'First Home', primaryOwnerUserId: 7, audienceEnabled: true },
    liveVersion: 7,
    master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: 'main{gap:8px}', dirtyFields: [] },
    slideOrder: [FIRST, SECOND, THIRD],
    slidesById: {
      [FIRST]: slide(FIRST, 'Opening', 'opening', 60, 'Welcome everyone.'),
      [SECOND]: slide(SECOND, 'Agenda', 'agenda', 90),
      [THIRD]: slide(THIRD, 'Close', 'close', 30),
    },
    selectedSlideId: FIRST,
    conflict: null,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function loadModule() {
  vi.resetModules();
  return require('../../../js/webinar-studio/presenter.js');
}

function harness({ api = {}, state = studioState(), bridge, confirms = [true] } = {}) {
  const presenterApi = loadModule();
  const document = new FakeDocument();
  const root = document.createElement('section');
  const completeApi = {
    listNotes: vi.fn().mockResolvedValue([
      { id: 5, slideId: FIRST, body: 'Mention the cash example', createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' },
      { id: 6, slideId: SECOND, body: 'Slow down here', createdAt: '2026-09-05T10:01:00.000Z', updatedAt: '2026-09-05T10:01:00.000Z' },
    ]),
    addNote: vi.fn().mockImplementation((webinarId, slideId, body) => Promise.resolve({ id: 9, slideId, body: body.body })),
    updateNote: vi.fn().mockImplementation((webinarId, noteId, body) => Promise.resolve({ id: noteId, body: body.body })),
    deleteNote: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue({ shortcuts: { nextSlide: 'KeyN' }, preferences: { compactNotes: true } }),
    saveSettings: vi.fn().mockImplementation(body => Promise.resolve(body)),
    ...api,
  };
  const confirm = vi.fn();
  confirms.forEach(result => confirm.mockResolvedValueOnce(result));
  const preview = { boot: vi.fn().mockResolvedValue({ type: 'ready' }), destroy: vi.fn() };
  const fakeBridge = bridge === undefined
    ? { sendControl: vi.fn().mockReturnValue(true), connect: vi.fn(), reconnect: vi.fn(), status: vi.fn().mockReturnValue('connected') }
    : bridge;
  let clock = 1_000_000;
  const intervals = [];
  const cleared = [];
  const controller = presenterApi.createPresenterController({
    document,
    api: completeApi,
    confirm,
    preview,
    bridge: fakeBridge,
    keyTarget: document,
    now: () => clock,
    setIntervalImpl: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    clearIntervalImpl: id => { cleared.push(id); },
  });
  let currentState = state;
  const context = {
    root,
    webinarId: 12,
    getState: () => currentState,
    getAssets: () => ({}),
    getResourcePolicy: () => ({ assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] }),
    currentUser: { id: 1, name: 'Seth Angell', activeRole: 'admin' },
  };
  const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
  return {
    presenterApi,
    document,
    root,
    api: completeApi,
    confirm,
    preview,
    bridge: fakeBridge,
    controller,
    context,
    intervals,
    cleared,
    settle,
    advance(ms) { clock += ms; intervals.forEach(interval => interval.callback()); },
    setState(next) { currentState = next; },
    q: selector => root.querySelector(selector),
    qa: selector => root.querySelectorAll(selector),
    async open() { await controller.renderPresenterPanel(context); await settle(); },
    keydown(overrides = {}) {
      const event = { key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, target: root, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides };
      document.emit('keydown', event);
      return event;
    },
  };
}

describe('Webinar Studio authenticated presenter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('exposes backend-aligned shortcut actions with sensible defaults and validation', () => {
    const { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, validateShortcuts, formatDescriptor, descriptorFromEvent } = loadModule();
    expect(SHORTCUT_ACTIONS.map(action => action.id)).toEqual([
      'previousSlide', 'nextSlide', 'animationPrevious', 'animationNext',
      'animationPlay', 'animationPause', 'toggleDrawing', 'toggleFullscreen',
    ]);
    expect(validateShortcuts(DEFAULT_SHORTCUTS)).toEqual({ ok: true });
    expect(validateShortcuts({ ...DEFAULT_SHORTCUTS, nextSlide: 'ArrowLeft' }).error).toMatch(/already assigned to Previous slide/);
    expect(validateShortcuts({ ...DEFAULT_SHORTCUTS, nextSlide: 'Escape' }).error).toMatch(/Escape is reserved/);
    expect(validateShortcuts({ ...DEFAULT_SHORTCUTS, nextSlide: 'Control+KeyW' }).error).toMatch(/reserved by the browser/);
    expect(validateShortcuts({ ...DEFAULT_SHORTCUTS, nextSlide: ['ArrowRight'] }).error).toMatch(/Next slide needs one shortcut/);
    expect(formatDescriptor('Control+Shift+ArrowRight')).toBe('Ctrl + Shift + →');
    expect(descriptorFromEvent({ code: 'KeyN', shiftKey: true })).toBe('Shift+KeyN');
    expect(descriptorFromEvent({ key: 'Shift' })).toBeNull();
  });

  it('renders clocks, position, shared speaker notes, and the up-next slide through the canonical sandbox preview', async () => {
    const test = harness();
    await test.open();
    expect(text(test.q('[data-position]'))).toBe('1 / 3');
    expect(text(test.q('[data-slide-title]'))).toBe('Opening');
    expect(text(test.q('[data-shared-notes]'))).toBe('Welcome everyone.');
    expect(text(test.q('[data-clock="total"]'))).toBe('03:00');
    expect(text(test.q('[data-clock="target"]'))).toBe('01:00');
    expect(text(test.q('[data-up-next-title]'))).toBe('Agenda');
    expect(test.preview.boot).toHaveBeenCalledTimes(1);
    expect(test.preview.boot).toHaveBeenCalledWith(expect.objectContaining({
      master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: 'main{gap:8px}' },
      slide: expect.objectContaining({ id: SECOND, anchor: 'agenda', html: '<section>Agenda</section>' }),
      resourcePolicy: expect.objectContaining({ assetOrigin: 'https://assets.example' }),
    }));
    expect(text(test.q('[data-up-next-status]'))).toMatch(/ready/i);

    test.controller.goNext();
    test.controller.goNext();
    await test.settle();
    expect(text(test.q('[data-position]'))).toBe('3 / 3');
    expect(text(test.q('[data-up-next-title]'))).toMatch(/End|Q&A/);
    expect(test.preview.boot).toHaveBeenLastCalledWith(expect.objectContaining({ slide: expect.objectContaining({ id: THIRD }) }));
    expect(text(test.root)).not.toContain('<section>');
  });

  it('places the four compact animation controls immediately above Back, Next, and Start timer', async () => {
    const test = harness();
    await test.open();
    const animationRow = test.q('[data-animation-row]');
    const navRow = test.q('[data-nav-row]');
    const siblings = animationRow.parentElement.children;
    expect(siblings.indexOf(navRow)).toBe(siblings.indexOf(animationRow) + 1);
    const controls = animationRow.querySelectorAll('[data-animation]').map(button => button.dataset.animation);
    expect(controls).toEqual(['back', 'forward', 'play', 'pause']);
    animationRow.querySelectorAll('[data-animation]').forEach(button => {
      expect(button.className).toContain('ws-icon-action');
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.type).toBe('button');
    });
    expect(navRow.querySelector('[data-nav="previous"]')).not.toBeNull();
    expect(navRow.querySelector('[data-nav="next"]')).not.toBeNull();
    expect(text(navRow.querySelector('[data-timer-start]'))).toBe('Start timer');
    expect(animationRow.querySelectorAll('[data-animation]').every(button => button.disabled)).toBe(true);
  });

  it('keeps note actions compact and upper-right, and adds, edits, and deletes by stable slide id', async () => {
    const test = harness();
    await test.open();
    expect(test.api.listNotes).toHaveBeenCalledWith(12);
    const notes = test.qa('[data-note-id]');
    expect(notes.map(note => note.dataset.noteId)).toEqual(['5']);
    const actions = notes[0].querySelector('.ws-note-actions');
    expect(actions.className).toContain('ws-note-actions');
    expect(actions.querySelector('[data-note-edit]').getAttribute('aria-label')).toBe('Edit note');
    expect(actions.querySelector('[data-note-delete]').getAttribute('aria-label')).toBe('Delete note');
    expect(text(actions.querySelector('[data-note-edit]'))).toBe('');
    const saveButton = test.q('[data-note-save]');
    expect(saveButton.className).toContain('ws-icon-action');
    expect(saveButton.getAttribute('aria-label')).toBe('Save note');

    const input = test.q('[data-note-input]');
    input.value = '  Remember cash example  ';
    saveButton.emit('click');
    await test.settle();
    expect(test.api.addNote).toHaveBeenCalledWith(12, FIRST, { body: 'Remember cash example' });
    expect(test.qa('[data-note-id]').map(note => note.dataset.noteId)).toEqual(['5', '9']);
    expect(test.q('[data-note-input]').value).toBe('');

    test.q('[data-note-id="5"] [data-note-edit]').emit('click');
    const editor = test.q('[data-note-id="5"] [data-note-editor]');
    expect(editor.value).toBe('Mention the cash example');
    editor.value = 'Mention the cash example first';
    test.q('[data-note-id="5"] [data-note-editor-save]').emit('click');
    await test.settle();
    expect(test.api.updateNote).toHaveBeenCalledWith(12, 5, { body: 'Mention the cash example first' });
    expect(text(test.q('[data-note-id="5"] [data-note-body]'))).toBe('Mention the cash example first');

    test.q('[data-note-id="9"] [data-note-delete]').emit('click');
    await test.settle();
    expect(test.confirm).toHaveBeenCalledOnce();
    expect(test.api.deleteNote).toHaveBeenCalledWith(12, 9);
    expect(test.qa('[data-note-id]').map(note => note.dataset.noteId)).toEqual(['5']);

    test.controller.goNext();
    await test.settle();
    expect(test.qa('[data-note-id]').map(note => note.dataset.noteId)).toEqual(['6']);
    await test.controller.loadNotes();
    expect(test.api.listNotes).toHaveBeenCalledTimes(2);
  });

  it('keeps unsaved note text and reports a bounded error when a note write fails', async () => {
    const test = harness({ api: { addNote: vi.fn().mockRejectedValue(Object.assign(new Error('db exploded at 10.0.0.4'), { status: 500 })) } });
    await test.open();
    test.q('[data-note-input]').value = 'Keep me';
    test.q('[data-note-save]').emit('click');
    await test.settle();
    expect(test.q('[data-note-input]').value).toBe('Keep me');
    expect(text(test.q('[data-presenter-error]'))).toMatch(/note was not saved/i);
    expect(text(test.root)).not.toContain('10.0.0.4');
  });

  it('loads account-wide shortcuts once with defaults filled in and saves them once for the authenticated account', async () => {
    const test = harness();
    await test.open();
    expect(test.api.getSettings).toHaveBeenCalledTimes(1);
    const rows = test.qa('[data-shortcut-action]');
    expect(rows.map(row => row.dataset.shortcutAction)).toHaveLength(8);
    expect(text(test.q('[data-shortcut-capture="nextSlide"]'))).toBe('N');
    expect(text(test.q('[data-shortcut-capture="previousSlide"]'))).toBe('←');

    const result = await test.controller.saveSettings({ ...test.presenterApi.DEFAULT_SHORTCUTS, nextSlide: 'KeyN' }, { compactNotes: true });
    expect(result.ok).toBe(true);
    expect(test.api.saveSettings).toHaveBeenCalledTimes(1);
    expect(test.api.saveSettings).toHaveBeenCalledWith({
      shortcuts: { ...test.presenterApi.DEFAULT_SHORTCUTS, nextSlide: 'KeyN' },
      preferences: { compactNotes: true },
    });
    expect(test.api.saveSettings.mock.calls[0][0]).not.toHaveProperty('webinarId');
    expect(text(test.q('[data-shortcut-status]'))).toMatch(/saved/i);
  });

  it('rejects duplicate shortcut keys before saving and retains the draft when the API fails', async () => {
    const test = harness({ api: { saveSettings: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { status: 500 })) } });
    await test.open();
    const duplicate = { ...test.presenterApi.DEFAULT_SHORTCUTS, nextSlide: 'ArrowLeft' };
    const rejected = await test.controller.saveSettings(duplicate, {});
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/already assigned/);
    expect(test.api.saveSettings).not.toHaveBeenCalled();

    const draft = { ...test.presenterApi.DEFAULT_SHORTCUTS, nextSlide: 'KeyM' };
    await expect(test.controller.saveSettings(draft, {})).rejects.toThrow();
    expect(text(test.q('[data-shortcut-status]'))).toMatch(/not saved.*still here/i);
    expect(text(test.q('[data-shortcut-capture="nextSlide"]'))).toBe('M');
    expect(test.q('[data-shortcut-save]').disabled).toBe(false);
  });

  it('captures a pressed key for one action, rejects reserved keys, and never saves until asked', async () => {
    const test = harness();
    await test.open();
    test.q('[data-shortcut-capture="toggleDrawing"]').emit('click');
    expect(text(test.q('[data-shortcut-status]'))).toMatch(/press a key for toggle drawing/i);
    const consumed = test.keydown({ key: 'm', code: 'KeyM' });
    expect(consumed.preventDefault).toHaveBeenCalled();
    expect(text(test.q('[data-shortcut-capture="toggleDrawing"]'))).toBe('M');
    expect(test.bridge.sendControl).not.toHaveBeenCalled();
    expect(test.api.saveSettings).not.toHaveBeenCalled();

    test.q('[data-shortcut-capture="toggleDrawing"]').emit('click');
    test.keydown({ key: 'n', code: 'KeyN' });
    expect(text(test.q('[data-shortcut-status]'))).toMatch(/KeyN is already assigned to Next slide/);
    expect(text(test.q('[data-shortcut-capture="toggleDrawing"]'))).toBe('M');

    test.q('[data-shortcut-reset]').emit('click');
    expect(text(test.q('[data-shortcut-capture="toggleDrawing"]'))).toBe('D');
    expect(text(test.q('[data-shortcut-capture="nextSlide"]'))).toBe('→');
  });

  it('dispatches shortcuts to presenter controls and suppresses them inside text entry, buttons, and dialogs', async () => {
    const test = harness();
    await test.open();
    const next = test.keydown({ key: 'n', code: 'KeyN' });
    expect(next.preventDefault).toHaveBeenCalled();
    expect(test.bridge.sendControl).toHaveBeenCalledWith('next', {});
    expect(text(test.q('[data-position]'))).toBe('2 / 3');

    test.keydown({ key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(test.bridge.sendControl).toHaveBeenCalledWith('previous', {});
    expect(text(test.q('[data-position]'))).toBe('1 / 3');

    test.keydown({ key: 'd', code: 'KeyD' });
    expect(test.bridge.sendControl).toHaveBeenCalledWith('annotation-command', { on: true });
    expect(test.q('[data-annotation-toggle]').getAttribute('aria-pressed')).toBe('true');

    test.keydown({ key: 'f', code: 'KeyF' });
    expect(test.bridge.sendControl).toHaveBeenCalledWith('fullscreen-request', { on: true });

    test.bridge.sendControl.mockClear();
    const textarea = test.document.createElement('textarea');
    test.keydown({ key: 'n', code: 'KeyN', target: textarea });
    const input = test.document.createElement('input');
    test.keydown({ key: 'n', code: 'KeyN', target: input });
    const select = test.document.createElement('select');
    test.keydown({ key: 'n', code: 'KeyN', target: select });
    const button = test.document.createElement('button');
    test.keydown({ key: ' ', code: 'Space', target: button });
    test.keydown({ key: 'Enter', code: 'Enter', target: button });
    const editable = test.document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    test.keydown({ key: 'n', code: 'KeyN', target: editable });
    const dialog = test.document.createElement('dialog');
    const inDialog = test.document.createElement('span');
    dialog.append(inDialog);
    test.keydown({ key: 'n', code: 'KeyN', target: inDialog });
    const modalControl = test.document.createElement('div');
    modalControl.setAttribute('role', 'dialog');
    const inModal = test.document.createElement('span');
    modalControl.append(inModal);
    test.keydown({ key: 'n', code: 'KeyN', target: inModal });
    test.keydown({ key: 'n', code: 'KeyN', repeat: true });
    expect(test.bridge.sendControl).not.toHaveBeenCalled();
    expect(text(test.q('[data-position]'))).toBe('1 / 3');

    // Focus usually rests on a Studio button; letter and arrow shortcuts still fire there.
    test.keydown({ key: 'n', code: 'KeyN', target: button });
    expect(test.bridge.sendControl).toHaveBeenCalledWith('next', {});
    expect(text(test.q('[data-position]'))).toBe('2 / 3');
  });

  it('cancels key capture on Escape in the capture phase without letting the Studio close', async () => {
    const test = harness();
    await test.open();
    const listener = test.document.listeners.get('keydown')[0];
    expect(test.document.captureFlags.get(listener)).toBe(true);
    test.q('[data-shortcut-capture="toggleDrawing"]').emit('click');
    const escape = test.keydown({ key: 'Escape', code: 'Escape' });
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(text(test.q('[data-shortcut-status]'))).toMatch(/cancel/i);
    expect(text(test.q('[data-shortcut-capture="toggleDrawing"]'))).toBe('D');
    const idle = test.keydown({ key: 'Escape', code: 'Escape' });
    expect(idle.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves arrow keys to tab strips and activation keys to any activatable control', async () => {
    const test = harness();
    await test.open();
    const tablist = test.document.createElement('div');
    tablist.setAttribute('role', 'tablist');
    const tab = test.document.createElement('button');
    tab.setAttribute('role', 'tab');
    tablist.append(tab);
    test.keydown({ key: 'ArrowRight', code: 'ArrowRight', target: tab });
    test.keydown({ key: 'ArrowRight', code: 'ArrowRight', target: tab, defaultPrevented: true });
    const summary = test.document.createElement('summary');
    await test.controller.saveSettings({ ...test.presenterApi.DEFAULT_SHORTCUTS, nextSlide: 'Space' }, {});
    test.keydown({ key: ' ', code: 'Space', target: summary });
    const link = test.document.createElement('a');
    link.setAttribute('href', '#');
    test.keydown({ key: 'Enter', code: 'Enter', target: link });
    const roleButton = test.document.createElement('div');
    roleButton.setAttribute('role', 'button');
    test.keydown({ key: ' ', code: 'Space', target: roleButton });
    expect(test.bridge.sendControl).not.toHaveBeenCalled();
    expect(text(test.q('[data-position]'))).toBe('1 / 3');
    test.keydown({ key: ' ', code: 'Space', target: test.root });
    expect(test.bridge.sendControl).toHaveBeenCalledWith('next', {});
  });

  it('keeps the running timer across deactivate and reactivate for the same webinar', async () => {
    const test = harness();
    await test.open();
    test.q('[data-timer-start]').emit('click');
    test.advance(30_000);
    test.controller.deactivate();
    expect(test.cleared).toContain(test.intervals.length);
    test.advance(30_000);
    await test.open();
    expect(test.intervals.at(-1).delay).toBe(500);
    expect(text(test.q('[data-clock="elapsed"]'))).toBe('01:00');
    expect(text(test.q('[data-timer-start]'))).toBe('Restart timer');
    expect(test.controller.startTimer()).toBe(true);
    test.controller.deactivate();
    expect(test.controller.startTimer()).toBe(false);
    expect(test.controller.resetTimer()).toBe(false);
  });

  it('re-rendering the same webinar keeps in-flight notes, unsaved shortcut drafts, and loads settings once', async () => {
    const pending = deferred();
    const test = harness({ api: { addNote: vi.fn().mockReturnValue(pending.promise) } });
    await test.open();
    test.q('[data-shortcut-capture="toggleDrawing"]').emit('click');
    test.keydown({ key: 'm', code: 'KeyM' });
    test.q('[data-note-input]').value = 'In flight';
    test.q('[data-note-save]').emit('click');

    await test.controller.renderPresenterPanel(test.context);
    await test.settle();
    expect(test.api.getSettings).toHaveBeenCalledTimes(1);
    expect(test.api.listNotes).toHaveBeenCalledTimes(1);
    expect(text(test.q('[data-shortcut-capture="toggleDrawing"]'))).toBe('M');
    pending.resolve({ id: 9, slideId: FIRST, body: 'In flight' });
    await test.settle();
    expect(test.qa('[data-note-id]').map(note => note.dataset.noteId)).toEqual(['5', '9']);
    expect(test.q('[data-note-input]').value).toBe('');
  });

  it('navigates locally until the audience is launched, and blocks only while connecting or disconnected', async () => {
    const test = harness();
    test.bridge.status.mockReturnValue('idle');
    await test.open();
    test.q('[data-nav="next"]').emit('click');
    expect(test.bridge.sendControl).not.toHaveBeenCalled();
    expect(text(test.q('[data-position]'))).toBe('2 / 3');

    test.bridge.status.mockReturnValue('disconnected');
    test.bridge.sendControl.mockReturnValue(false);
    test.controller.setConnection('disconnected');
    test.q('[data-nav="next"]').emit('click');
    expect(text(test.q('[data-position]'))).toBe('2 / 3');
    expect(text(test.q('[data-presenter-status]'))).toMatch(/not connected/i);

    test.bridge.status.mockReturnValue('connected');
    test.bridge.sendControl.mockReturnValue(true);
    test.controller.applyAudienceState({ type: 'audience-ready', payload: { index: 1, total: 3 } });
    test.q('[data-nav="next"]').emit('click');
    expect(test.bridge.sendControl).toHaveBeenCalledWith('next', {});
    expect(text(test.q('[data-position]'))).toBe('3 / 3');
    test.bridge.status.mockReturnValue('disconnected');
    expect(text(test.q('[data-audience-status]'))).toMatch(/connected/i);
    test.controller.applyAudienceState({ type: 'animation-state', payload: { current: 0, total: 0, playing: false } });
    expect(text(test.q('[data-audience-status]'))).toMatch(/disconnected/i);
  });

  it('adopts the audience position on the first launch but pushes its own position on a reconnect', async () => {
    const test = harness();
    test.bridge.status.mockReturnValue('connected');
    await test.open();
    test.controller.applyAudienceState({ type: 'audience-ready', payload: { index: 2, total: 3 } });
    expect(text(test.q('[data-position]'))).toBe('3 / 3');
    expect(test.bridge.sendControl).not.toHaveBeenCalledWith('goto', expect.anything());

    // The audience window was closed or reloaded and comes back at slide 1.
    test.controller.setConnection('disconnected');
    test.controller.setConnection('connected');
    test.controller.applyAudienceState({ type: 'audience-ready', payload: { index: 0, total: 3 } });
    expect(test.bridge.sendControl).toHaveBeenCalledWith('goto', { index: 2 });
    expect(text(test.q('[data-position]'))).toBe('3 / 3');

    // An in-place reconnect where the audience is already in step sends nothing.
    test.bridge.sendControl.mockClear();
    test.controller.applyAudienceState({ type: 'audience-ready', payload: { index: 2, total: 3 } });
    expect(test.bridge.sendControl).not.toHaveBeenCalledWith('goto', expect.anything());
    expect(text(test.q('[data-position]'))).toBe('3 / 3');
  });

  it('updates animation buttons in place so focus survives frequent acknowledgements', async () => {
    const test = harness();
    await test.open();
    test.controller.applyAudienceState({ type: 'animation-state', payload: { current: 1, total: 3, playing: false } });
    const forward = test.q('[data-animation="forward"]');
    forward.focus();
    test.controller.applyAudienceState({ type: 'animation-state', payload: { current: 2, total: 3, playing: true } });
    expect(test.q('[data-animation="forward"]')).toBe(forward);
    expect(test.document.activeElement).toBe(forward);
    expect(text(test.q('[data-animation-status]'))).toBe('2 / 3');
    expect(test.q('[data-animation="pause"]').disabled).toBe(false);
  });

  it('retries the up-next preview after a failed boot instead of pinning the failure', async () => {
    const failing = harness();
    failing.preview.boot.mockResolvedValue({ type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });
    await failing.open();
    expect(text(failing.q('[data-up-next-status]'))).toMatch(/could not start/i);
    const attempts = failing.preview.boot.mock.calls.length;
    await failing.controller.renderPresenterPanel(failing.context);
    await failing.settle();
    expect(failing.preview.boot.mock.calls.length).toBeGreaterThan(attempts);

    const recovering = harness();
    recovering.preview.boot.mockResolvedValueOnce({ type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });
    await recovering.open();
    await recovering.controller.renderPresenterPanel(recovering.context);
    await recovering.settle();
    expect(recovering.preview.boot.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(text(recovering.q('[data-up-next-status]'))).toMatch(/ready/i);
  });

  it('keeps a slide-content failure pinned until the slide changes, but retries transient failures', async () => {
    const test = harness();
    test.preview.boot.mockResolvedValue({ type: 'error', code: 'SLIDE_RUNTIME_ERROR' });
    await test.open();
    expect(text(test.q('[data-up-next-status]'))).toMatch(/could not start/i);
    const attempts = test.preview.boot.mock.calls.length;
    await test.controller.renderPresenterPanel(test.context);
    await test.settle();
    expect(test.preview.boot.mock.calls.length).toBe(attempts);
    test.controller.goNext();
    await test.settle();
    expect(test.preview.boot.mock.calls.length).toBeGreaterThan(attempts);

    const invalid = harness();
    invalid.preview.boot.mockResolvedValue({ type: 'error', code: 'PREVIEW_CANDIDATE_INVALID' });
    await invalid.open();
    const invalidAttempts = invalid.preview.boot.mock.calls.length;
    await invalid.controller.renderPresenterPanel(invalid.context);
    await invalid.settle();
    expect(invalid.preview.boot.mock.calls.length).toBe(invalidAttempts);

    const thrown = harness();
    thrown.preview.boot.mockRejectedValue(new Error('Preview controller is destroyed'));
    await thrown.open();
    const thrownAttempts = thrown.preview.boot.mock.calls.length;
    await thrown.controller.renderPresenterPanel(thrown.context);
    await thrown.settle();
    expect(thrown.preview.boot.mock.calls.length).toBeGreaterThan(thrownAttempts);
  });

  it('runs slide, pace, and elapsed clocks from injected time', async () => {
    const test = harness();
    await test.open();
    expect(text(test.q('[data-clock="slide"]'))).toBe('00:00');
    test.q('[data-timer-start]').emit('click');
    expect(test.intervals.at(-1).delay).toBe(500);
    expect(text(test.q('[data-timer-start]'))).toBe('Restart timer');
    test.advance(95_000);
    expect(text(test.q('[data-clock="slide"]'))).toBe('01:35');
    expect(test.q('[data-clock="slide"]').dataset.state).toBe('behind');
    expect(text(test.q('[data-clock="elapsed"]'))).toBe('01:35');
    expect(text(test.q('[data-clock="pace"]'))).toBe('+00:35');
    expect(test.q('[data-clock="pace"]').dataset.state).toBe('ok');

    test.controller.goNext();
    test.advance(10_000);
    expect(text(test.q('[data-clock="slide"]'))).toBe('00:10');
    expect(test.q('[data-clock="slide"]').dataset.state).toBe('ok');
    expect(text(test.q('[data-clock="pace"]'))).toBe('−00:45');
    expect(test.q('[data-clock="pace"]').dataset.state).toBe('ok');
    test.advance(120_000);
    expect(test.q('[data-clock="pace"]').dataset.state).toBe('behind');

    test.q('[data-timer-reset]').emit('click');
    expect(test.cleared).toContain(test.intervals.length);
    expect(text(test.q('[data-clock="elapsed"]'))).toBe('00:00');
    expect(text(test.q('[data-timer-start]'))).toBe('Start timer');
  });

  it('sends only fixed control types with scalar payloads from the on-screen controls', async () => {
    const test = harness();
    await test.open();
    test.controller.applyAudienceState({ type: 'animation-state', payload: { current: 1, total: 3, playing: false } });
    test.q('[data-animation="back"]').emit('click');
    test.q('[data-animation="forward"]').emit('click');
    test.q('[data-animation="play"]').emit('click');
    test.controller.applyAudienceState({ type: 'animation-state', payload: { current: 1, total: 3, playing: true } });
    test.q('[data-animation="pause"]').emit('click');
    test.q('[data-nav="next"]').emit('click');
    test.q('[data-nav="previous"]').emit('click');
    test.q('[data-nav-visibility]').emit('click');
    test.q('[data-fullscreen-toggle]').emit('click');
    expect(test.bridge.sendControl.mock.calls).toEqual([
      ['animation-back', {}],
      ['animation-forward', {}],
      ['animation-play', {}],
      ['animation-pause', {}],
      ['next', {}],
      ['previous', {}],
      ['nav-visibility', { hidden: true }],
      ['fullscreen-request', { on: true }],
    ]);
    for (const [, payload] of test.bridge.sendControl.mock.calls) {
      for (const value of Object.values(payload)) expect(['boolean', 'number', 'string']).toContain(typeof value);
    }
  });

  it('reflects validated audience acknowledgements and connection state, ignoring malformed payloads', async () => {
    const test = harness();
    await test.open();
    test.controller.applyAudienceState({ type: 'slide-state', payload: { index: 2 } });
    expect(text(test.q('[data-position]'))).toBe('3 / 3');
    test.controller.applyAudienceState({ type: 'slide-state', payload: { index: '<img onerror=1>' } });
    test.controller.applyAudienceState({ type: 'slide-state', payload: { index: 99 } });
    expect(text(test.q('[data-position]'))).toBe('3 / 3');

    test.controller.applyAudienceState({ type: 'animation-state', payload: { current: 1, total: 3, playing: true } });
    expect(text(test.q('[data-animation-status]'))).toBe('1 / 3');
    expect(test.q('[data-animation="play"]').disabled).toBe(true);
    expect(test.q('[data-animation="pause"]').disabled).toBe(false);
    expect(test.q('[data-animation="back"]').disabled).toBe(false);

    test.controller.applyAudienceState({ type: 'annotation-state', payload: { on: true } });
    expect(test.q('[data-annotation-toggle]').getAttribute('aria-pressed')).toBe('true');
    test.controller.applyAudienceState({ type: 'fullscreen-state', payload: { on: true } });
    expect(test.q('[data-fullscreen-toggle]').getAttribute('aria-pressed')).toBe('true');
    test.controller.applyAudienceState({ type: 'nav-state', payload: { hidden: true } });
    expect(text(test.q('[data-nav-visibility]'))).toMatch(/hidden/i);
    test.controller.applyAudienceState({ type: 'supported-calculator-state', payload: { id: 'cash-to-close', visible: false } });
    const calculator = test.q('[data-calculator-toggle="cash-to-close"]');
    expect(calculator).not.toBeNull();
    calculator.emit('click');
    expect(test.bridge.sendControl).toHaveBeenLastCalledWith('supported-calculator-state', { id: 'cash-to-close', visible: true });
    test.controller.applyAudienceState({ type: 'supported-overlay-state', payload: { id: 'javascript:alert(1)', visible: true } });
    expect(test.qa('[data-overlay-toggle]')).toHaveLength(0);
    test.controller.applyAudienceState({ type: 'audience-error', payload: { code: 'SLIDE_RUNTIME_ERROR' } });
    expect(text(test.q('[data-presenter-status]'))).toMatch(/SLIDE_RUNTIME_ERROR/);

    test.bridge.status.mockReturnValue('disconnected');
    test.controller.setConnection('disconnected');
    expect(text(test.q('[data-audience-status]'))).toMatch(/disconnected/i);
    test.q('[data-audience-reconnect]').emit('click');
    expect(test.bridge.reconnect).toHaveBeenCalledOnce();
    test.bridge.sendControl.mockReturnValue(false);
    test.q('[data-nav="previous"]').emit('click');
    expect(text(test.q('[data-position]'))).toBe('3 / 3');
    expect(text(test.q('[data-presenter-status]'))).toMatch(/not connected/i);
  });

  it('works without a bridge as a rehearsal presenter and offers audience launch through the bridge when present', async () => {
    const offline = harness({ bridge: null });
    await offline.open();
    offline.q('[data-nav="next"]').emit('click');
    expect(text(offline.q('[data-position]'))).toBe('2 / 3');
    expect(text(offline.q('[data-audience-status]'))).toMatch(/not connected/i);
    expect(offline.q('[data-audience-connect]')).toBeNull();

    const test = harness();
    test.bridge.status.mockReturnValue('idle');
    await test.open();
    test.q('[data-audience-connect]').emit('click');
    expect(test.bridge.connect).toHaveBeenCalledOnce();
  });

  it('ignores stale note and settings responses after the webinar context changes or the panel deactivates', async () => {
    const firstNotes = deferred();
    const test = harness({ api: { listNotes: vi.fn().mockReturnValueOnce(firstNotes.promise).mockResolvedValue([]) } });
    const opening = test.controller.renderPresenterPanel(test.context);
    test.controller.deactivate();
    firstNotes.resolve([{ id: 77, slideId: FIRST, body: 'stale' }]);
    await opening;
    await test.settle();
    expect(test.root.children).toHaveLength(0);

    test.setState(studioState({ webinar: { id: 13, slug: 'second', title: 'Second', primaryOwnerUserId: 7, audienceEnabled: false } }));
    await test.controller.renderPresenterPanel({ ...test.context, webinarId: 13 });
    await test.settle();
    expect(text(test.root)).not.toContain('stale');
    expect(test.api.listNotes).toHaveBeenLastCalledWith(13);
  });

  it('stops timers, key handling, and preview work on deactivate and destroy', async () => {
    const test = harness();
    await test.open();
    test.q('[data-timer-start]').emit('click');
    test.controller.deactivate();
    expect(test.cleared).toContain(test.intervals.length);
    test.keydown({ key: 'n', code: 'KeyN' });
    expect(test.bridge.sendControl).not.toHaveBeenCalled();
    expect(test.document.listeners.get('keydown') || []).toHaveLength(0);

    await test.open();
    test.controller.destroy();
    expect(test.document.listeners.get('keydown') || []).toHaveLength(0);
    expect(test.preview.destroy).not.toHaveBeenCalled();
    await expect(test.controller.renderPresenterPanel(test.context)).resolves.toBeUndefined();
    expect(test.root.children).toHaveLength(0);
  });
});

describe('Webinar Studio presenter tab lifecycle', () => {
  it('binds the Presenter tab to the selected webinar and tears it down on tab change, close, and destroy', async () => {
    vi.resetModules();
    const createStudio = require('../../../js/webinar-studio.js');
    const stateApi = require('../../../js/webinar-studio/state.js');
    const document = new FakeDocument();
    const ids = [
      'webinarStudioLauncher', 'webinarStudioModal', 'wsClose', 'wsDeckList',
      'wsDeckSelect', 'wsWorkspace', 'wsStatus', 'wsNewWebinar', 'wsSettings',
      'wsSettingsPanel', 'wsLaunchAudience', 'wsLaunchPresenter',
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new FakeElement('div', document)]));
    document.getElementById = id => elements[id] || null;
    document.body = new FakeElement('body', document);
    document.activeElement = elements.webinarStudioLauncher;
    elements.webinarStudioModal.hidden = true;
    const tabs = ['presenter', 'access', 'code', 'assets', 'history'].map(name => {
      const tab = new FakeElement('button', document);
      tab.setAttribute('data-ws-tab', name);
      return tab;
    });
    elements.wsSettings.querySelectorAll = selector => selector === '[data-ws-tab]' ? tabs : [];
    const presenterController = {
      renderPresenterPanel: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn(),
      destroy: vi.fn(),
      applyAudienceState: vi.fn(),
      setConnection: vi.fn(),
    };
    const presenterApi = { createPresenterController: vi.fn().mockReturnValue(presenterController) };
    const preview = { boot: vi.fn().mockResolvedValue({ type: 'ready' }), destroy: vi.fn() };
    const api = {
      listWebinars: vi.fn().mockResolvedValue([{ id: 12, slug: 'first-home', title: 'First Home', liveVersion: 7, audienceEnabled: false }]),
      getWebinar: vi.fn().mockResolvedValue({
        id: 12, slug: 'first-home', title: 'First Home', primaryOwnerUserId: 7, audienceEnabled: false, liveVersion: 7,
        masterHtml: '<main>{{SLIDE_CONTENT}}</main>', masterCss: '', resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] }, assets: {},
        slides: [{ id: FIRST, title: 'Opening', anchor: 'opening', targetSeconds: 60, speakerNotes: '', html: '<section>Opening</section>', css: '', javascript: '' }],
      }),
    };
    const studio = createStudio({
      document,
      api,
      stateApi,
      presenterApi,
      editorPreview: preview,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 1, name: 'Admin', activeRole: 'admin' }),
      openWindow: vi.fn(),
      navigationTarget: new FakeElement('window', document),
    });
    await studio.init();
    expect(presenterApi.createPresenterController).not.toHaveBeenCalled();
    await studio.open();
    expect(presenterApi.createPresenterController).toHaveBeenCalledWith(expect.objectContaining({
      api, document, keyTarget: document, preview: expect.objectContaining({ boot: expect.any(Function) }),
    }));
    await presenterApi.createPresenterController.mock.calls[0][0].preview.boot({});
    expect(preview.boot).toHaveBeenCalledTimes(1);
    expect(presenterController.renderPresenterPanel).toHaveBeenCalledWith(expect.objectContaining({
      root: elements.wsSettingsPanel,
      webinarId: 12,
      currentUser: expect.objectContaining({ id: 1 }),
    }));
    const context = presenterController.renderPresenterPanel.mock.calls.at(-1)[0];
    expect(context.getState().webinar.id).toBe(12);
    expect(context.getResourcePolicy()).toEqual(expect.objectContaining({ assetOrigin: 'https://assets.example' }));

    elements.wsSettings.emit('click', { target: tabs[2] });
    expect(presenterController.deactivate).toHaveBeenCalled();
    presenterController.renderPresenterPanel.mockClear();
    elements.wsSettings.emit('click', { target: tabs[0] });
    expect(presenterController.renderPresenterPanel).toHaveBeenCalledTimes(1);

    presenterController.deactivate.mockClear();
    await studio.close();
    expect(presenterController.deactivate).toHaveBeenCalled();
    studio.destroy();
    expect(presenterController.destroy).toHaveBeenCalledOnce();
  });
});
