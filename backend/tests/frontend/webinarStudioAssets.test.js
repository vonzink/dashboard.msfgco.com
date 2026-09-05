import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAssetLibrary } = require('../../../js/webinar-studio/assets.js');

const FAMILY = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const SECOND_VERSION = '33333333-3333-4333-8333-333333333333';
const PUBLIC_URL = `https://assets.example/approved/sha256/${'a'.repeat(64)}/asset`;

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
    this.files = [];
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.style = {};
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
    if (name === 'value') this.value = String(value);
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
    for (const listener of [...(this.listeners.get(type) || [])]) listener({
      target: this,
      preventDefault: vi.fn(),
      ...event,
    });
  }
  dispatchEvent(event) { this.emit(event.type, event); return true; }
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
    if (selector === '[data-ws-tab]' && this.dataset.wsTab) return this;
    return matches(this, selector) ? this : null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  setRangeText(value, start, end) {
    this.value = `${this.value.slice(0, start)}${value}${this.value.slice(end)}`;
    this.selectionStart = start + value.length;
    this.selectionEnd = this.selectionStart;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.defaultView = { Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } } };
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  createDocumentFragment() { return new FakeElement('fragment', this); }
}

function text(node) {
  return [node.textContent, ...(node.children || []).map(text)].join(' ');
}

function family(overrides = {}) {
  return {
    id: FAMILY,
    displayName: 'Front porch',
    description: 'Reusable opening image',
    createdByUserId: 7,
    createdAt: '2026-09-04T10:00:00.000Z',
    archivedAt: null,
    versions: [{
      id: VERSION,
      versionNumber: 1,
      mediaType: 'image',
      mimeType: 'image/webp',
      byteSize: 4096,
      width: 1280,
      height: 720,
      durationMs: null,
      status: 'available',
      rejectionCode: null,
      uploadedByUserId: 7,
      uploaderName: 'Seth Angell',
      createdAt: '2026-09-04T10:01:00.000Z',
      archivedAt: null,
      publicUrl: PUBLIC_URL,
    }],
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
  return { promise, resolve, reject };
}

function harness({ admin = true, api = {}, fetchImpl, copyText } = {}) {
  const document = new FakeDocument();
  const root = document.createElement('section');
  const completeApi = {
    listAssets: vi.fn().mockResolvedValue([family()]),
    createUploadIntent: vi.fn().mockResolvedValue({
      assetId: FAMILY,
      versionId: VERSION,
      uploadUrl: 'https://signed.example/private-put',
      expiresInSeconds: 600,
    }),
    confirmUpload: vi.fn().mockResolvedValue({ versionId: VERSION, status: 'available', publicUrl: PUBLIC_URL }),
    createAssetVersionIntent: vi.fn().mockResolvedValue({
      assetId: FAMILY,
      versionId: SECOND_VERSION,
      uploadUrl: 'https://signed.example/private-version-put',
      expiresInSeconds: 600,
    }),
    updateAsset: vi.fn().mockResolvedValue(family({ displayName: 'Updated porch' })),
    updateAssetVersion: vi.fn().mockResolvedValue({ versionId: VERSION, status: 'archived' }),
    getAssetUsage: vi.fn().mockResolvedValue({
      versionId: VERSION,
      current: [{ webinarId: 12, webinarTitle: 'First Home', slideId: null, slideTitle: null, surface: 'master_html' }],
      history: [{ revisionId: 41, webinarId: 12, webinarTitle: 'First Home', webinarVersion: 3 }],
    }),
    ...api,
  };
  const delays = [];
  const timers = new Map();
  let nextTimer = 1;
  const library = createAssetLibrary({
    api: completeApi,
    copyText: copyText || vi.fn().mockResolvedValue(undefined),
    document,
    fetch: fetchImpl || vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    setTimeoutImpl(callback, delay) {
      const id = nextTimer++;
      delays.push(delay);
      timers.set(id, callback);
      return id;
    },
    clearTimeoutImpl(id) { timers.delete(id); },
  });
  const context = {
    root,
    isAdmin: admin,
    currentUser: { id: 7, name: 'Seth Angell' },
    getEditorTarget: () => document.activeElement,
  };
  return {
    api: completeApi,
    context,
    delays,
    document,
    library,
    root,
    timers,
    async runNextTimer() {
      for (let attempt = 0; attempt < 20 && timers.size === 0; attempt += 1) {
        await Promise.resolve();
      }
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      timers.delete(id);
      callback();
      await Promise.resolve();
      return true;
    },
  };
}

describe('Webinar Studio reusable asset library', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('loads a searchable media catalog with safe previews, family metadata, and version status', async () => {
    const rejected = family({
      id: '44444444-4444-4444-8444-444444444444',
      displayName: 'Old audio',
      versions: [{
        ...family().versions[0],
        id: '55555555-5555-4555-8555-555555555555',
        mediaType: 'audio',
        mimeType: 'audio/mpeg',
        publicUrl: undefined,
        status: 'rejected',
        rejectionCode: 'MALWARE_DETECTED',
      }],
    });
    const test = harness({ api: { listAssets: vi.fn().mockResolvedValue([family(), rejected]) } });

    await test.library.renderAssetCatalog(test.context);

    expect(text(test.root)).toMatch(/Front porch.*Reusable opening image/s);
    expect(text(test.root)).toMatch(/Available/);
    expect(text(test.root)).toMatch(/Rejected.*MALWARE_DETECTED/s);
    const preview = test.root.querySelector('[data-asset-preview]');
    expect(preview.tagName).toBe('IMG');
    expect(preview.getAttribute('src')).toBe(PUBLIC_URL);
    expect(text(test.root)).not.toContain('signed.example');

    const search = test.root.querySelector('[data-asset-search]');
    search.value = 'porch';
    search.emit('input');
    const media = test.root.querySelector('[data-asset-media-filter]');
    media.value = 'image';
    media.emit('change');
    await Promise.resolve();
    expect(test.api.listAssets).toHaveBeenLastCalledWith({ search: 'porch', mediaType: 'image' });
  });

  it('uploads with the exact Content-Type then confirms using 1/2/4/8-second capped polling', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const test = harness({
      fetchImpl,
      api: {
        confirmUpload: vi.fn()
          .mockResolvedValueOnce({ versionId: VERSION, status: 'processing' })
          .mockResolvedValueOnce({ versionId: VERSION, status: 'processing' })
          .mockResolvedValueOnce({ versionId: VERSION, status: 'processing' })
          .mockResolvedValueOnce({ versionId: VERSION, status: 'processing' })
          .mockResolvedValueOnce({ versionId: VERSION, status: 'processing' })
          .mockResolvedValueOnce({ versionId: VERSION, status: 'available', publicUrl: PUBLIC_URL }),
      },
    });
    await test.library.renderAssetCatalog(test.context);
    const file = { name: 'porch.webp', type: 'image/webp', size: 4096 };

    const uploading = test.library.uploadAsset(file, { displayName: 'Front porch', description: 'Opening' });
    await Promise.resolve();
    await Promise.resolve();
    expect(test.api.createUploadIntent).toHaveBeenCalledWith({
      displayName: 'Front porch',
      description: 'Opening',
      filename: 'porch.webp',
      contentType: 'image/webp',
      byteSize: 4096,
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://signed.example/private-put', expect.objectContaining({
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp' },
      body: file,
    }));

    for (let index = 0; index < 5; index += 1) await test.runNextTimer();
    await expect(uploading).resolves.toMatchObject({ ok: true, version: { status: 'available' } });
    expect(test.delays).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(test.api.confirmUpload).toHaveBeenCalledTimes(6);
  });

  it('keeps the existing catalog and upload fields visible when upload transport or server processing fails', async () => {
    const test = harness({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 403 }) });
    await test.library.renderAssetCatalog(test.context);

    const result = await test.library.uploadAsset(
      { name: 'porch.webp', type: 'image/webp', size: 4096 },
      { displayName: 'Retained name', description: 'Retained description' },
    );

    expect(result).toMatchObject({ ok: false });
    expect(text(test.root)).toContain('Front porch');
    expect(test.root.querySelector('[data-upload-display-name]').value).toBe('Retained name');
    expect(test.root.querySelector('[data-upload-description]').value).toBe('Retained description');
    expect(text(test.root)).toMatch(/upload.*try again/i);
    expect(text(test.root)).not.toContain('signed.example');
  });

  it('keeps the catalog recoverable when a later processing refresh fails', async () => {
    const test = harness({
      api: { confirmUpload: vi.fn().mockRejectedValue(Object.assign(new Error('private'), { status: 503 })) },
    });
    await test.library.renderAssetCatalog(test.context);

    await expect(test.library.pollVersion(VERSION)).resolves.toMatchObject({ ok: false });

    expect(text(test.root)).toContain('Front porch');
    expect(text(test.root)).toMatch(/processing.*temporarily unavailable|could not finish/i);
  });

  it('shows a rejection reason and retains the catalog when authoritative inspection rejects a file', async () => {
    const test = harness({
      api: {
        confirmUpload: vi.fn().mockResolvedValue({
          versionId: VERSION,
          status: 'rejected',
          rejectionCode: 'ASSET_INSPECTION_MEDIA_INVALID',
        }),
      },
    });
    await test.library.renderAssetCatalog(test.context);

    const result = await test.library.uploadAsset(
      { name: 'porch.webp', type: 'image/webp', size: 4096 },
      { displayName: 'Rejected porch', description: '' },
    );

    expect(result).toMatchObject({ ok: false, version: { status: 'rejected' } });
    expect(text(test.root)).toContain('Front porch');
    expect(text(test.root)).toContain('ASSET_INSPECTION_MEDIA_INVALID');
  });

  it('creates immutable new versions and offers uploader/admin archive actions with visible 409 usage', async () => {
    const conflict = Object.assign(new Error('private detail'), { status: 409, code: 'ASSET_IN_USE' });
    const test = harness({ api: { updateAssetVersion: vi.fn().mockRejectedValue(conflict) } });
    await test.library.renderAssetCatalog(test.context);

    const uploading = test.library.uploadAsset(
      { name: 'porch-v2.webp', type: 'image/webp', size: 8192 },
      { assetId: FAMILY },
    );
    await Promise.resolve();
    await Promise.resolve();
    await uploading;
    expect(test.api.createAssetVersionIntent).toHaveBeenCalledWith(FAMILY, {
      filename: 'porch-v2.webp',
      contentType: 'image/webp',
      byteSize: 8192,
    });

    await test.library.archiveVersion(FAMILY, VERSION);
    expect(test.api.updateAssetVersion).toHaveBeenCalledWith(FAMILY, VERSION, { archive: true });
    expect(test.api.getAssetUsage).toHaveBeenCalledWith(VERSION);
    expect(text(test.root)).toMatch(/First Home.*master html.*version 3/is);

    await test.library.archiveFamily(FAMILY);
    expect(test.api.updateAsset).toHaveBeenCalledWith(FAMILY, { archive: true });
  });

  it('renders role-appropriate family and version actions', async () => {
    const owner = harness({ admin: false });
    await owner.library.renderAssetCatalog(owner.context);
    expect(owner.root.querySelector('[data-edit-asset]')).not.toBeNull();
    expect(owner.root.querySelector('[data-archive-version]')).not.toBeNull();
    expect(owner.root.querySelector('[data-archive-family]')).toBeNull();

    const viewer = harness({ admin: false, api: { listAssets: vi.fn().mockResolvedValue([family({ createdByUserId: 9, versions: [{ ...family().versions[0], uploadedByUserId: 9 }] })]) } });
    await viewer.library.renderAssetCatalog(viewer.context);
    expect(viewer.root.querySelector('[data-edit-asset]')).toBeNull();
    expect(viewer.root.querySelector('[data-archive-version]')).toBeNull();
  });

  it('copies or inserts only canonical asset tokens and predefined snippets while preserving editor selection', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const test = harness({ copyText });
    await test.library.renderAssetCatalog(test.context);
    const version = family().versions[0];
    const token = `{{ASSET:${VERSION}}}`;

    await test.library.copyReference(version);
    await test.library.copySnippet(version, 'html');
    await test.library.copySnippet(version, 'css');
    expect(copyText.mock.calls).toEqual([
      [token],
      [`<img src="${token}" alt="">`],
      [`background-image: url("${token}");`],
    ]);
    expect(copyText.mock.calls.flat().join(' ')).not.toMatch(/assets\.example|signed\.example|approved\//);

    const editor = test.document.createElement('textarea');
    editor.value = '<section>before after</section>';
    editor.selectionStart = 16;
    editor.selectionEnd = 21;
    const input = vi.fn();
    editor.addEventListener('input', input);
    test.document.activeElement = editor;

    expect(test.library.insertReference(version, editor)).toBe(true);
    expect(editor.value).toBe(`<section>before ${token}</section>`);
    expect(editor.selectionStart).toBe(16 + token.length);
    expect(input).toHaveBeenCalledOnce();
    expect(test.document.activeElement).toBe(editor);
  });

  it('cancels timers and upload requests on close and ignores stale polling after replacement', async () => {
    const firstConfirm = deferred();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const test = harness({
      fetchImpl,
      api: {
        confirmUpload: vi.fn()
          .mockImplementationOnce(() => firstConfirm.promise)
          .mockResolvedValueOnce({ versionId: SECOND_VERSION, status: 'available', publicUrl: PUBLIC_URL }),
      },
    });
    await test.library.renderAssetCatalog(test.context);

    const first = test.library.uploadAsset(
      { name: 'v1.webp', type: 'image/webp', size: 4096 },
      { assetId: FAMILY },
    );
    await Promise.resolve();
    await Promise.resolve();
    const second = test.library.uploadAsset(
      { name: 'v2.webp', type: 'image/webp', size: 4096 },
      { assetId: FAMILY },
    );
    await Promise.resolve();
    await Promise.resolve();
    firstConfirm.resolve({ versionId: VERSION, status: 'rejected', rejectionCode: 'STALE_PRIVATE' });

    await expect(first).resolves.toMatchObject({ ok: false, cancelled: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(text(test.root)).not.toContain('STALE_PRIVATE');

    test.library.deactivate();
    expect(test.timers.size).toBe(0);
    const putOptions = fetchImpl.mock.calls.at(-1)[1];
    expect(putOptions.signal).toBeDefined();
  });

  it('rejects unsupported files locally without overriding server-authoritative catalog state', async () => {
    const test = harness();
    await test.library.renderAssetCatalog(test.context);

    const result = await test.library.uploadAsset(
      { name: 'source.html', type: 'text/html', size: 12 },
      { displayName: 'Unsafe source' },
    );

    expect(result).toMatchObject({ ok: false });
    expect(test.api.createUploadIntent).not.toHaveBeenCalled();
    expect(text(test.root)).toContain('Front porch');
    expect(text(test.root)).toMatch(/file type/i);
  });

  it('binds the Assets tab to the selected Studio lifecycle and tears it down on close and destroy', async () => {
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
    const assetController = {
      renderAssetCatalog: vi.fn().mockResolvedValue({ ok: true }),
      deactivate: vi.fn(),
      destroy: vi.fn(),
    };
    const assetsApi = { createAssetLibrary: vi.fn(() => assetController) };
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
        slides: [{
          id: FAMILY,
          title: 'Opening',
          anchor: 'opening',
          targetSeconds: 60,
          speakerNotes: '',
          html: '<section>Opening</section>',
          css: '',
          javascript: '',
        }],
      }),
    };
    const createStudio = require('../../../js/webinar-studio.js');
    const stateApi = require('../../../js/webinar-studio/state.js');
    const studio = createStudio({
      accessHistoryApi: { createAccessHistory: () => ({ deactivate: vi.fn(), destroy: vi.fn() }) },
      api,
      assetsApi,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 1, name: 'Admin', activeRole: 'admin' }),
      document,
      navigationTarget: new FakeElement('window', document),
      openWindow: vi.fn(),
      stateApi,
    });

    await studio.init();
    await studio.open();
    elements.wsSettings.emit('click', { target: tabs[3] });
    await Promise.resolve();

    expect(assetsApi.createAssetLibrary).toHaveBeenCalledOnce();
    expect(assetController.renderAssetCatalog).toHaveBeenCalledWith(expect.objectContaining({
      root: elements.wsSettingsPanel,
      isAdmin: true,
      currentUser: expect.objectContaining({ id: 1 }),
      getEditorTarget: expect.any(Function),
    }));

    await studio.close();
    expect(assetController.deactivate).toHaveBeenCalled();
    studio.destroy();
    expect(assetController.destroy).toHaveBeenCalledOnce();
  });
});
