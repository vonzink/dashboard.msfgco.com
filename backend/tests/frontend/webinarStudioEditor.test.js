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
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
}

class FakeDocument {
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
  return { api: completeApi, confirm, editor, get state() { return state; }, preview, root, timers };
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
