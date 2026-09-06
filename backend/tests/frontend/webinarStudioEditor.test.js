import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const stateApi = require('../../../js/webinar-studio/state.js');
const { createEditor } = require('../../../js/webinar-studio/editor.js');

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

function privateDocument() {
  return {
    id: 12,
    slug: 'first-home',
    title: 'First Home',
    primaryOwnerUserId: 7,
    audienceEnabled: false,
    liveVersion: 7,
    masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
    masterCss: 'main{display:grid}',
    resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] },
    slides: [
      { id: FIRST, title: 'Opening', anchor: 'opening', targetSeconds: 90, speakerNotes: 'Welcome', html: '<section>Opening</section>', css: '.slide{color:#123}', javascript: '' },
      { id: SECOND, title: 'Agenda', anchor: 'agenda', targetSeconds: 120, speakerNotes: '', html: '<section>Agenda</section>', css: '', javascript: '' },
    ],
  };
}

function success(liveVersion) {
  return { liveVersion, updatedAt: `2026-09-05T12:0${liveVersion}:00.000Z` };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function matches(element, selector) {
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  if (/^[a-z]+$/i.test(selector)) return element.tagName.toLowerCase() === selector.toLowerCase();
  const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (!attribute) return false;
  const value = element.getAttribute(attribute[1]);
  return attribute[2] === undefined ? value !== null : value === attribute[2];
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
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
    for (const listener of [...(this.listeners.get(type) || [])]) listener({ target: this, ...event });
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children || []) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    return matches(this, selector) ? this : null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
}

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tagName) { return new FakeElement(tagName, this); }
  createDocumentFragment() { return new FakeElement('fragment', this); }
}

function makeHarness({ previewResult = Promise.resolve({ type: 'ready' }), api = {}, confirm = vi.fn().mockResolvedValue(true) } = {}) {
  const document = new FakeDocument();
  const root = new FakeElement('main', document);
  let state = stateApi.createStudioState(privateDocument());
  const timers = [];
  const preview = { boot: vi.fn(() => previewResult), destroy: vi.fn() };
  const completeApi = {
    saveMaster: vi.fn().mockResolvedValue(success(8)),
    saveSlide: vi.fn().mockResolvedValue(success(8)),
    addSlide: vi.fn().mockResolvedValue({
      ...success(8),
      slide: { id: THIRD, title: 'New slide', anchor: 'new-slide', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' },
    }),
    reorderSlides: vi.fn().mockResolvedValue(success(8)),
    archiveSlide: vi.fn().mockResolvedValue(success(8)),
    ...api,
  };
  const editor = createEditor({
    api: completeApi,
    confirm,
    copyText: vi.fn().mockResolvedValue(undefined),
    document,
    getAssets: () => ({}),
    getResourcePolicy: () => privateDocument().resourcePolicy,
    getState: () => state,
    onReload: vi.fn(),
    preview,
    root,
    stateApi,
    setState(next) { state = next; },
    setTimeoutImpl(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeoutImpl: vi.fn(),
  });
  return { api: completeApi, confirm, editor, get state() { return state; }, setState(next) { state = next; }, preview, root, timers };
}

describe('Webinar Studio one-box editor', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders Master HTML/CSS and one accessible three-tab box per stable server slide', () => {
    const test = makeHarness();
    test.editor.render(test.state);

    expect(test.root.querySelectorAll('.ws-slide-box')).toHaveLength(2);
    expect(test.root.querySelectorAll('.ws-slide-box').map(node => node.dataset.slideId)).toEqual([FIRST, SECOND]);
    expect(test.root.querySelectorAll('[data-master-field="html"]')).toHaveLength(1);
    expect(test.root.querySelectorAll('[data-master-field="css"]')).toHaveLength(1);
    expect(test.root.querySelectorAll('[role="tab"]')).toHaveLength(6);
    expect(test.root.querySelectorAll('[data-slide-field="title"]')).toHaveLength(2);
    expect(test.root.querySelectorAll('[data-slide-field="anchor"]')).toHaveLength(2);
    expect(test.root.querySelectorAll('[data-slide-field="targetSeconds"]')).toHaveLength(2);
    expect(test.root.querySelectorAll('[data-slide-field="speakerNotes"]')).toHaveLength(2);
    expect(test.root.querySelectorAll('textarea').every(field => field.getAttribute('spellcheck') === 'false')).toBe(true);
  });

  it('shows live-version and per-surface dirty status without replacing the active editor', () => {
    const test = makeHarness();
    test.editor.render(test.state);
    expect(test.root.querySelector('[data-live-version]').textContent).toBe('Live version 7');
    expect(test.root.querySelector('[data-dirty-surface="master"]').textContent).toBe('Live');

    const title = test.root.querySelectorAll('[data-slide-field="title"]')[0];
    title.value = 'A changed opening';
    test.root.emit('input', { target: title });

    expect(test.root.querySelector(`[data-dirty-surface="${FIRST}"]`).textContent).toBe('Unsaved');
    expect(test.root.querySelectorAll('[data-slide-field="title"]')[0]).toBe(title);
  });

  it('inserts spaces for Tab and debounces candidate preview by exactly 300ms without autosaving', async () => {
    const test = makeHarness();
    test.editor.render(test.state);
    const html = test.root.querySelectorAll('[data-code-field="html"]')[0];
    html.value = '<section>Changed</section>';
    html.selectionStart = 9;
    html.selectionEnd = 9;
    const preventDefault = vi.fn();
    test.root.emit('keydown', { target: html, key: 'Tab', preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(html.value).toBe('<section>  Changed</section>');

    test.root.emit('input', { target: html });
    expect(test.timers.at(-1).delay).toBe(300);
    expect(test.api.saveSlide).not.toHaveBeenCalled();
    test.timers.at(-1).callback();
    await Promise.resolve();
    expect(test.preview.boot).toHaveBeenCalledWith(expect.objectContaining({
      master: expect.objectContaining({ html: '<main>{{SLIDE_CONTENT}}</main>' }),
      slide: expect.objectContaining({ id: FIRST, html: '<section>  Changed</section>' }),
    }));
    expect(test.api.saveSlide).not.toHaveBeenCalled();
  });

  it('keeps an explicitly focused code selection as a logical asset insertion target across panel replacement', async () => {
    const test = makeHarness();
    test.editor.setContext({ webinarId: 12, generation: 4 });
    test.editor.render(test.state);
    const html = test.root.querySelectorAll('[data-code-field="html"]')[0];
    const token = '{{ASSET:44444444-4444-4444-8444-444444444444}}';
    html.selectionStart = 9;
    html.selectionEnd = 16;
    test.root.emit('focusin', { target: html });
    test.root.emit('select', { target: html });

    test.root.replaceChildren(new FakeElement('section', test.root.ownerDocument));
    test.root.ownerDocument.activeElement = null;
    const target = test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 4 });

    expect(target).toMatchObject({ webinarId: 12, generation: 4, surface: FIRST, field: 'html' });
    expect(target.insertText(token)).toBe(true);
    expect(test.state.slidesById[FIRST].html).toBe(`<section>${token}</section>`);
    expect(test.state.slidesById[FIRST].dirtyFields).toContain('html');
    expect(test.timers.at(-1).delay).toBe(300);
    expect(test.api.saveSlide).not.toHaveBeenCalled();

    test.editor.render(test.state);
    const restored = test.root.querySelectorAll('[data-code-field="html"]')[0];
    expect(restored.value).toBe(`<section>${token}</section>`);
    expect(restored.selectionStart).toBe(9 + token.length);
    expect(restored.selectionEnd).toBe(9 + token.length);
    expect(test.root.ownerDocument.activeElement).toBe(restored);

    test.timers.at(-1).callback();
    await Promise.resolve();
    expect(test.preview.boot).toHaveBeenCalledWith(expect.objectContaining({
      slide: expect.objectContaining({ id: FIRST, html: `<section>${token}</section>` }),
    }));
  });

  it('invalidates logical asset targets on context change, slide removal, explicit close, and destroy', async () => {
    const test = makeHarness();
    test.editor.setContext({ webinarId: 12, generation: 1 });
    test.editor.render(test.state);
    const secondHtml = test.root.querySelectorAll('[data-code-field="html"]')[1];
    secondHtml.selectionStart = 0;
    secondHtml.selectionEnd = 0;
    test.root.emit('focusin', { target: secondHtml });
    expect(test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 1 })).not.toBeNull();
    expect(test.editor.getAssetInsertionTarget({ webinarId: 13, generation: 1 })).toBeNull();

    await test.editor.deleteSlide(SECOND);
    expect(test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 1 })).toBeNull();

    const firstHtml = test.root.querySelectorAll('[data-code-field="html"]')[0];
    test.root.emit('focusin', { target: firstHtml });
    test.editor.invalidateInsertionTarget();
    expect(test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 1 })).toBeNull();

    test.root.emit('focusin', { target: firstHtml });
    test.editor.setContext({ webinarId: 12, generation: 2 });
    expect(test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 2 })).toBeNull();
    test.editor.destroy();
    expect(test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 2 })).toBeNull();
  });

  it('inserts two spaces on Tab only inside Code textareas so other fields keep native focus movement', () => {
    const test = makeHarness();
    test.editor.render(test.state);
    const code = test.root.querySelectorAll('[data-code-field="html"]')[0];
    code.value = '<section>';
    code.selectionStart = code.selectionEnd = 9;
    const codeEvent = { target: code, key: 'Tab', preventDefault: vi.fn() };
    test.root.emit('keydown', codeEvent);
    expect(codeEvent.preventDefault).toHaveBeenCalled();
    expect(test.state.slidesById[FIRST].html).toBe('<section>  ');

    const notes = test.root.querySelectorAll('[data-slide-field="speakerNotes"]')[0];
    notes.value = 'Welcome';
    notes.selectionStart = notes.selectionEnd = 7;
    const notesEvent = { target: notes, key: 'Tab', preventDefault: vi.fn() };
    test.root.emit('keydown', notesEvent);
    expect(notesEvent.preventDefault).not.toHaveBeenCalled();
    expect(notes.value).toBe('Welcome');
    expect(test.state.slidesById[FIRST].speakerNotes).toBe('Welcome');

    const foreign = new FakeElement('textarea', test.root.ownerDocument);
    foreign.value = 'asset description';
    const foreignEvent = { target: foreign, key: 'Tab', preventDefault: vi.fn() };
    test.root.emit('keydown', foreignEvent);
    expect(foreignEvent.preventDefault).not.toHaveBeenCalled();
    expect(foreign.value).toBe('asset description');
  });

  it('opens a collapsed slide box when restoring an insertion target so focus can land', async () => {
    const test = makeHarness();
    test.editor.setContext({ webinarId: 12, generation: 1 });
    test.editor.render(test.state);
    const secondBox = test.root.querySelectorAll('.ws-slide-box').find(box => box.dataset.slideId === SECOND);
    expect(secondBox.open).toBe(false);
    const secondHtml = test.root.querySelectorAll('[data-code-field="html"]')[1];
    secondHtml.selectionStart = secondHtml.selectionEnd = 9;
    test.root.emit('focusin', { target: secondHtml });
    const target = test.editor.getAssetInsertionTarget({ webinarId: 12, generation: 1 });
    const token = '{{ASSET:44444444-4444-4444-8444-444444444444}}';
    expect(target.insertText(token)).toBe(true);

    test.editor.render(test.state);
    const restoredBox = test.root.querySelectorAll('.ws-slide-box').find(box => box.dataset.slideId === SECOND);
    expect(restoredBox.open).toBe(true);
    const restored = test.root.querySelectorAll('[data-code-field="html"]')[1];
    expect(test.root.ownerDocument.activeElement).toBe(restored);
    expect(restored.selectionStart).toBe(9 + token.length);
  });

  it('forgets preview readiness, code tabs, and errors when the webinar changes so Save Live never carries over', async () => {
    const test = makeHarness();
    test.editor.setContext({ webinarId: 12, generation: 1 });
    test.editor.render(test.state);
    await test.editor.previewMaster();
    expect(test.root.querySelector('[data-save-master]').disabled).toBe(false);
    test.root.emit('click', { target: test.root.querySelectorAll('[data-code-tab="css"]')[0] });

    const other = { ...test.state, webinar: { ...test.state.webinar, id: 13, slug: 'second' } };
    test.editor.setContext({ webinarId: 13, generation: 1 });
    test.setState(other);
    test.editor.render(other);
    expect(test.root.querySelector('[data-save-master]').disabled).toBe(true);
    const masterStatus = test.root.querySelectorAll('[data-preview-status]').find(node => node.dataset.surface === 'master');
    expect(masterStatus.textContent).toBe('Preview required before saving.');
    const firstTabs = test.root.querySelectorAll('[data-code-tab]').filter(node => node.dataset.slideId === FIRST);
    expect(firstTabs.find(node => node.dataset.codeTab === 'html').getAttribute('aria-selected')).toBe('true');
    expect(test.root.querySelector('[data-editor-error]').textContent).toBe('');
  });

  it('moves focus and activation through each slide code tab with wrapping keyboard controls', () => {
    const test = makeHarness();
    test.editor.render(test.state);
    const tabs = test.root.querySelectorAll('[data-code-tab]').filter(node => node.dataset.slideId === FIRST);
    const panels = test.root.querySelectorAll('[data-code-panel]').filter(node => node.dataset.slideId === FIRST);
    const preventDefault = vi.fn();

    test.root.emit('keydown', { target: tabs[0], key: 'ArrowRight', preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(test.root.ownerDocument.activeElement).toBe(tabs[1]);
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map(tab => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(panels.map(panel => panel.hidden)).toEqual([true, false, true]);

    test.root.emit('keydown', { target: tabs[1], key: 'End', preventDefault });
    expect(test.root.ownerDocument.activeElement).toBe(tabs[2]);
    test.root.emit('keydown', { target: tabs[2], key: 'ArrowRight', preventDefault });
    expect(test.root.ownerDocument.activeElement).toBe(tabs[0]);
    test.root.emit('keydown', { target: tabs[0], key: 'ArrowLeft', preventDefault });
    expect(test.root.ownerDocument.activeElement).toBe(tabs[2]);
    test.root.emit('keydown', { target: tabs[2], key: 'Home', preventDefault });
    expect(test.root.ownerDocument.activeElement).toBe(tabs[0]);
    expect(panels.map(panel => panel.hidden)).toEqual([false, true, true]);
  });

  it('keeps Save Live disabled until local validation and the current preview startup both succeed', async () => {
    let resolvePreview;
    const test = makeHarness({ previewResult: new Promise(resolve => { resolvePreview = resolve; }) });
    test.editor.render(test.state);
    const save = test.root.querySelectorAll('[data-save-slide]')[0];
    expect(save.disabled).toBe(true);

    const startup = test.editor.previewSlide(FIRST);
    expect(save.disabled).toBe(true);
    resolvePreview({ type: 'ready' });
    await startup;
    expect(save.disabled).toBe(false);

    const anchor = test.root.querySelectorAll('[data-slide-field="anchor"]')[0];
    anchor.value = 'Not Canonical';
    test.root.emit('input', { target: anchor });
    expect(save.disabled).toBe(true);
  });

  it('saves complete Master and slide surfaces against the current live version only', async () => {
    const test = makeHarness();
    test.editor.render(test.state);
    await test.editor.previewMaster();
    await test.editor.saveMaster();
    expect(test.api.saveMaster).toHaveBeenCalledWith(12, {
      expectedVersion: 7,
      masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
      masterCss: 'main{display:grid}',
    });
    expect(test.state.liveVersion).toBe(8);

    const slideTest = makeHarness();
    slideTest.editor.render(slideTest.state);
    await slideTest.editor.previewSlide(FIRST);
    await slideTest.editor.saveSlide(FIRST);
    expect(slideTest.api.saveSlide).toHaveBeenCalledWith(12, FIRST, {
      expectedVersion: 7,
      anchor: 'opening',
      title: 'Opening',
      targetSeconds: 90,
      speakerNotes: 'Welcome',
      html: '<section>Opening</section>',
      css: '.slide{color:#123}',
      javascript: '',
    });
    expect(slideTest.state.liveVersion).toBe(8);
  });

  it('reconciles pending Master and slide saves against newer typing without clearing changed fields', async () => {
    const masterPending = deferred();
    const master = makeHarness({ api: { saveMaster: vi.fn(() => masterPending.promise) } });
    master.editor.render(master.state);
    const masterHtml = master.root.querySelector('[data-master-field="html"]');
    masterHtml.value = '<main class="submitted">{{SLIDE_CONTENT}}</main>';
    master.root.emit('input', { target: masterHtml });
    await master.editor.previewMaster();
    const masterSave = master.editor.saveMaster();

    const masterCss = master.root.querySelector('[data-master-field="css"]');
    masterCss.value = 'main{display:flex}';
    master.root.emit('input', { target: masterCss });
    masterPending.resolve(success(8));
    await masterSave;

    expect(master.state.liveVersion).toBe(8);
    expect(master.state.master).toMatchObject({
      html: '<main class="submitted">{{SLIDE_CONTENT}}</main>',
      css: 'main{display:flex}',
      dirtyFields: ['css'],
    });

    const slidePending = deferred();
    const slide = makeHarness({ api: { saveSlide: vi.fn(() => slidePending.promise) } });
    slide.editor.render(slide.state);
    const title = slide.root.querySelectorAll('[data-slide-field="title"]')[0];
    title.value = 'Submitted title';
    slide.root.emit('input', { target: title });
    await slide.editor.previewSlide(FIRST);
    const slideSave = slide.editor.saveSlide(FIRST);

    const firstHtml = slide.root.querySelectorAll('[data-code-field="html"]')[0];
    firstHtml.value = '<section>Typed after Save Live</section>';
    slide.root.emit('input', { target: firstHtml });
    const secondNotes = slide.root.querySelectorAll('[data-slide-field="speakerNotes"]')[1];
    secondNotes.value = 'Other slide typing';
    slide.root.emit('input', { target: secondNotes });
    slidePending.resolve(success(8));
    await slideSave;

    expect(slide.state.liveVersion).toBe(8);
    expect(slide.state.slidesById[FIRST]).toMatchObject({
      title: 'Submitted title',
      html: '<section>Typed after Save Live</section>',
      dirtyFields: ['html'],
    });
    expect(slide.state.slidesById[SECOND]).toMatchObject({
      speakerNotes: 'Other slide typing',
      dirtyFields: ['speakerNotes'],
    });
  });

  it('applies pending structural results to the latest edited state', async () => {
    const cases = [
      {
        name: 'add',
        start(test) { return test.editor.addSlide(); },
        api: 'addSlide',
        response: {
          ...success(8),
          slide: { id: THIRD, title: 'New slide', anchor: 'new-slide', targetSeconds: 0, speakerNotes: '', html: '', css: '', javascript: '' },
        },
        expectedOrder: [FIRST, SECOND, THIRD],
      },
      {
        name: 'duplicate',
        start(test) { return test.editor.duplicateSlide(FIRST); },
        api: 'addSlide',
        response: {
          ...success(8),
          slide: { id: THIRD, title: 'Opening', anchor: 'opening-copy', targetSeconds: 90, speakerNotes: 'Welcome', html: '<section>Opening</section>', css: '.slide{color:#123}', javascript: '' },
        },
        expectedOrder: [FIRST, SECOND, THIRD],
      },
      {
        name: 'reorder',
        start(test) { return test.editor.reorderSlides([SECOND, FIRST]); },
        api: 'reorderSlides',
        response: success(8),
        expectedOrder: [SECOND, FIRST],
      },
      {
        name: 'archive',
        start(test) { return test.editor.deleteSlide(FIRST); },
        api: 'archiveSlide',
        response: success(8),
        expectedOrder: [SECOND],
      },
    ];

    for (const item of cases) {
      const pending = deferred();
      const test = makeHarness({ api: { [item.api]: vi.fn(() => pending.promise) } });
      test.editor.render(test.state);
      const mutation = item.start(test);
      await Promise.resolve();

      const notes = test.root.querySelectorAll('[data-slide-field="speakerNotes"]')[1];
      notes.value = `Typed during ${item.name}`;
      test.root.emit('input', { target: notes });
      pending.resolve(item.response);
      await mutation;

      expect(test.state.liveVersion, item.name).toBe(8);
      expect(test.state.slideOrder, item.name).toEqual(item.expectedOrder);
      expect(test.state.slidesById[SECOND], item.name).toMatchObject({
        speakerNotes: `Typed during ${item.name}`,
        dirtyFields: ['speakerNotes'],
      });
    }
  });

  it('retains edits made while pending mutations fail with conflict or network errors', async () => {
    const conflictPending = deferred();
    const conflict = makeHarness({ api: { saveSlide: vi.fn(() => conflictPending.promise) } });
    conflict.editor.render(conflict.state);
    await conflict.editor.previewSlide(FIRST);
    const save = conflict.editor.saveSlide(FIRST);
    const firstHtml = conflict.root.querySelectorAll('[data-code-field="html"]')[0];
    firstHtml.value = '<section>Conflict-safe typing</section>';
    conflict.root.emit('input', { target: firstHtml });
    conflictPending.reject(Object.assign(new Error('stale private response'), {
      status: 409,
      code: 'VERSION_CONFLICT',
      currentVersion: 8,
      updatedAt: '2026-09-05T12:00:00.000Z',
      updatedBy: { id: 9, name: 'Another Editor' },
    }));
    await expect(save).rejects.toThrow('stale');
    expect(conflict.state.liveVersion).toBe(7);
    expect(conflict.state.slidesById[FIRST]).toMatchObject({
      html: '<section>Conflict-safe typing</section>',
      dirtyFields: ['html'],
    });
    expect(conflict.state.conflict).toMatchObject({ currentVersion: 8 });

    const networkPending = deferred();
    const network = makeHarness({ api: { reorderSlides: vi.fn(() => networkPending.promise) } });
    network.editor.render(network.state);
    const reorder = network.editor.reorderSlides([SECOND, FIRST]);
    const secondNotes = network.root.querySelectorAll('[data-slide-field="speakerNotes"]')[1];
    secondNotes.value = 'Network-safe typing';
    network.root.emit('input', { target: secondNotes });
    networkPending.reject(new Error('database password=secret'));
    await expect(reorder).rejects.toThrow();
    expect(network.state.liveVersion).toBe(7);
    expect(network.state.slideOrder).toEqual([FIRST, SECOND]);
    expect(network.state.slidesById[SECOND]).toMatchObject({
      speakerNotes: 'Network-safe typing',
      dirtyFields: ['speakerNotes'],
    });
  });

  it('uses exact expectedVersion mutations and only appends the server-committed stable slide', async () => {
    const test = makeHarness();
    test.editor.render(test.state);
    await test.editor.addSlide();
    expect(test.api.addSlide).toHaveBeenCalledWith(12, expect.objectContaining({ expectedVersion: 7 }));
    expect(test.state.slideOrder.at(-1)).toBe(THIRD);
    expect(test.state.liveVersion).toBe(8);

    const duplicate = makeHarness({ api: {
      addSlide: vi.fn().mockResolvedValue({
        ...success(8),
        slide: { id: THIRD, title: 'Opening', anchor: 'opening-copy', targetSeconds: 90, speakerNotes: 'Welcome', html: '<section>Opening</section>', css: '.slide{color:#123}', javascript: '' },
      }),
    } });
    duplicate.editor.render(duplicate.state);
    await duplicate.editor.duplicateSlide(FIRST);
    expect(duplicate.api.addSlide).toHaveBeenCalledWith(12, { expectedVersion: 7, sourceSlideId: FIRST });
    expect(duplicate.state.slidesById[THIRD].anchor).toBe('opening-copy');

    const reorder = makeHarness();
    reorder.editor.render(reorder.state);
    await reorder.editor.reorderSlides([SECOND, FIRST]);
    expect(reorder.api.reorderSlides).toHaveBeenCalledWith(12, { expectedVersion: 7, slideIds: [SECOND, FIRST] });

    const remove = makeHarness();
    remove.editor.render(remove.state);
    await remove.editor.deleteSlide(FIRST);
    expect(remove.confirm).toHaveBeenCalledWith(expect.stringMatching(/Opening.*History/is), expect.any(Object));
    expect(remove.api.archiveSlide).toHaveBeenCalledWith(12, FIRST, { expectedVersion: 7 });
    expect(remove.state.slideOrder).toEqual([SECOND]);
  });

  it('blocks deleting the final slide before the API and reports History recovery in confirmation', async () => {
    const test = makeHarness();
    test.editor.render(test.state);
    await test.editor.deleteSlide(FIRST);
    await test.editor.deleteSlide(SECOND);
    expect(test.api.archiveSlide).toHaveBeenCalledTimes(1);
    expect(test.state.slideOrder).toEqual([SECOND]);
  });

  it('retains unsaved source and liveVersion on conflicts, preview errors, and network failures', async () => {
    const conflict = Object.assign(new Error('stale private response'), {
      status: 409,
      code: 'VERSION_CONFLICT',
      currentVersion: 8,
      updatedAt: '2026-09-05T12:00:00.000Z',
      updatedBy: { id: 9, name: 'Another Editor' },
    });
    const test = makeHarness({ api: { saveSlide: vi.fn().mockRejectedValue(conflict) } });
    test.editor.render(test.state);
    const html = test.root.querySelectorAll('[data-code-field="html"]')[0];
    html.value = '<section>Unsaved source</section>';
    test.root.emit('input', { target: html });
    await test.editor.previewSlide(FIRST);
    await expect(test.editor.saveSlide(FIRST)).rejects.toThrow('stale');
    expect(test.state.liveVersion).toBe(7);
    expect(test.state.slidesById[FIRST].html).toBe('<section>Unsaved source</section>');
    expect(test.state.conflict).toEqual(expect.objectContaining({ currentVersion: 8 }));
    expect(test.root.querySelector('[data-conflict]').querySelector('p').textContent).toMatch(/Another Editor.*version 8/is);
    expect(test.root.querySelector('[data-reload-conflict]')).not.toBeNull();
    expect(test.root.querySelector('[data-copy-conflict]')).not.toBeNull();

    const network = makeHarness({ api: { saveSlide: vi.fn().mockRejectedValue(new Error('database password=secret')) } });
    network.editor.render(network.state);
    await network.editor.previewSlide(FIRST);
    await expect(network.editor.saveSlide(FIRST)).rejects.toThrow();
    expect(network.state.liveVersion).toBe(7);
    expect(network.root.querySelector('[data-editor-error]').textContent).toMatch(/not saved.*still here/i);
    expect(network.root.querySelector('[data-editor-error]').textContent).not.toMatch(/password|secret/i);

    const preview = makeHarness({ previewResult: Promise.resolve({ type: 'error', code: 'SLIDE_RUNTIME_ERROR' }) });
    preview.editor.render(preview.state);
    await preview.editor.previewSlide(FIRST);
    expect(preview.root.querySelectorAll('[data-save-slide]')[0].disabled).toBe(true);
    const previewStatus = preview.root
      .querySelectorAll('[data-preview-status]')
      .find(node => node.dataset.surface === FIRST);
    expect(previewStatus.textContent).toMatch(/slide.*preview/i);
  });

  it('contains no Dashboard candidate execution or candidate innerHTML sink', () => {
    const source = readFileSync(resolve(process.cwd(), '../js/webinar-studio/editor.js'), 'utf8');
    expect(source).not.toMatch(/\beval\s*\(|new Function\s*\(/);
    expect(source).not.toMatch(/\.innerHTML\s*=/);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it('removes delegated listeners and cancels pending preview work when destroyed', () => {
    const test = makeHarness();
    test.editor.render(test.state);
    const html = test.root.querySelectorAll('[data-code-field="html"]')[0];
    test.root.emit('input', { target: html });

    expect(test.root.listeners.get('input')).toHaveLength(1);
    expect(test.root.listeners.get('keydown')).toHaveLength(1);
    expect(test.root.listeners.get('click')).toHaveLength(1);

    test.editor.destroy();

    expect(test.root.listeners.get('input')).toHaveLength(0);
    expect(test.root.listeners.get('keydown')).toHaveLength(0);
    expect(test.root.listeners.get('click')).toHaveLength(0);
    expect(test.preview.destroy).toHaveBeenCalledOnce();
  });
});
