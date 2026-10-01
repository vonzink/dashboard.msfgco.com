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
  hasAttribute(name) { return this.attributes.has(name); }
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

  it('copies only canonical asset tokens and predefined snippets and inserts only through a logical editor target', async () => {
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

    /* Insertion only ever goes through an editor-owned logical target; a bare
       textarea is not an accepted target even when passed explicitly. */
    const detached = test.document.createElement('textarea');
    detached.value = '<section>before after</section>';
    expect(test.library.insertReference(version, detached)).toBe(false);
    expect(detached.value).toBe('<section>before after</section>');
    const logical = { insertText: vi.fn().mockReturnValue(true) };
    expect(test.library.insertReference(version, logical)).toBe(true);
    expect(logical.insertText).toHaveBeenCalledWith(token);
  });

  it('uses a logical editor target after focus is gone and clearly disables insertion without one', async () => {
    const test = harness();
    test.context.getEditorTarget = () => null;
    await test.library.renderAssetCatalog(test.context);
    const unavailable = test.root.querySelector('[data-insert-asset-reference]');
    expect(unavailable.disabled).toBe(true);
    expect(unavailable.textContent).toMatch(/choose.*code field/i);

    const insertText = vi.fn().mockReturnValue(true);
    test.context.getEditorTarget = () => ({
      webinarId: 12,
      generation: 3,
      surface: FAMILY,
      field: 'html',
      insertText,
    });
    await test.library.renderAssetCatalog(test.context);
    const available = test.root.querySelector('[data-insert-asset-reference]');
    expect(available.disabled).toBe(false);
    expect(available.textContent).toBe('Insert at cursor');

    expect(test.library.insertReference(family().versions[0])).toBe(true);
    expect(insertText).toHaveBeenCalledWith(`{{ASSET:${VERSION}}}`);
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

  const SECOND_SLIDE = '55555555-5555-4555-8555-555555555555';
  const TOKEN = `{{ASSET:${VERSION}}}`;

  function studioDocument(id, overrides = {}) {
    return {
      id,
      slug: id === 12 ? 'first-home' : `deck-${id}`,
      title: id === 12 ? 'First Home' : `Deck ${id}`,
      primaryOwnerUserId: 7,
      audienceEnabled: false,
      liveVersion: 7,
      masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
      masterCss: 'main{gap:8px}',
      resourcePolicy: { assetOrigin: 'https://assets.example', stylesheetOrigins: [], fontOrigins: [] },
      assets: {},
      slides: [{
        id: FAMILY,
        title: 'Opening',
        anchor: 'opening',
        targetSeconds: 60,
        speakerNotes: '',
        html: '<section>before after</section>',
        css: '',
        javascript: '',
      }, {
        id: SECOND_SLIDE,
        title: 'Agenda',
        anchor: 'agenda',
        targetSeconds: 90,
        speakerNotes: '',
        html: '<article>agenda</article>',
        css: '',
        javascript: '',
      }],
      ...overrides,
    };
  }

  function summaryOf(documentRecord) {
    return {
      id: documentRecord.id,
      slug: documentRecord.slug,
      title: documentRecord.title,
      liveVersion: documentRecord.liveVersion,
      audienceEnabled: documentRecord.audienceEnabled,
    };
  }

  /* Drives the real coordinator, editor, and asset library together through the
     fake DOM so insertion targets are proven across coordinator lifecycle paths. */
  function coordinatorHarness({ documents = { 12: studioDocument(12) } } = {}) {
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
    const tabNames = ['presenter', 'access', 'code', 'assets', 'history'];
    const tabs = tabNames.map(name => {
      const tab = new FakeElement('button', document);
      tab.dataset.wsTab = name;
      return tab;
    });
    elements.wsSettings.querySelectorAll = selector => selector === '[data-ws-tab]' ? tabs : [];
    const api = {
      listWebinars: vi.fn().mockResolvedValue(Object.values(documents).map(summaryOf)),
      getWebinar: vi.fn(id => documents[id]
        ? Promise.resolve(structuredClone(documents[id]))
        : Promise.reject(Object.assign(new Error('Not found'), { status: 404 }))),
      listAssets: vi.fn().mockResolvedValue([family()]),
      listUsers: vi.fn().mockResolvedValue([{ id: 7, name: 'Active Owner', email: 'owner@example.test' }]),
      archiveSlide: vi.fn().mockResolvedValue({ liveVersion: 8, updatedAt: '2026-09-05T12:08:00.000Z' }),
    };
    const createStudio = require('../../../js/webinar-studio.js');
    const editorApi = require('../../../js/webinar-studio/editor.js');
    const realAssetsApi = require('../../../js/webinar-studio/assets.js');
    const studioStateApi = require('../../../js/webinar-studio/state.js');
    const captured = { getEditorTarget: null, accessContext: null };
    const assetsApi = {
      createAssetLibrary(deps) {
        const library = realAssetsApi.createAssetLibrary(deps);
        return {
          ...library,
          renderAssetCatalog(context) {
            captured.getEditorTarget = context.getEditorTarget;
            return library.renderAssetCatalog(context);
          },
        };
      },
    };
    const accessHistoryApi = {
      createAccessHistory: () => ({
        renderAccessPanel: vi.fn(context => { captured.accessContext = context; }),
        renderHistoryPanel: vi.fn(),
        deactivate: vi.fn(),
        destroy: vi.fn(),
      }),
    };
    const preview = { boot: vi.fn().mockResolvedValue({ type: 'ready' }), destroy: vi.fn() };
    const timers = [];
    const studio = createStudio({
      accessHistoryApi,
      api,
      assetsApi,
      confirm: vi.fn().mockResolvedValue(true),
      currentUser: () => ({ id: 1, name: 'Admin', activeRole: 'admin' }),
      document,
      editorApi,
      editorPreview: preview,
      navigationTarget: new FakeElement('window', document),
      openWindow: vi.fn(),
      setTimeoutImpl(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeoutImpl: vi.fn(),
      stateApi: studioStateApi,
    });
    const panel = elements.wsSettingsPanel;
    const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
    return {
      studio,
      document,
      elements,
      tabs,
      api,
      preview,
      timers,
      panel,
      captured,
      settle,
      clickTab(name) {
        const tab = tabs[tabNames.indexOf(name)];
        tab.focus();
        elements.wsSettings.emit('click', { target: tab });
      },
      codeField(field, slideId = FAMILY) {
        return panel.querySelectorAll(`[data-code-field="${field}"]`).find(node => node.dataset.slideId === slideId) || null;
      },
      masterField(field) { return panel.querySelector(`[data-master-field="${field}"]`); },
      dirtyBadge(surface) { return panel.querySelector(`[data-dirty-surface="${surface}"]`); },
      insertButton() { return panel.querySelector('[data-insert-asset-reference]'); },
      assetError() { return panel.querySelector('[data-asset-error]'); },
      deleteButton(slideId) {
        return panel.querySelectorAll('[data-delete-slide]').find(node => node.dataset.slideId === slideId) || null;
      },
      /* Focus a Code textarea with a real selection exactly as a user would. */
      chooseCode(field, slideId, start, end) {
        const node = this.codeField(field, slideId);
        node.selectionStart = start;
        node.selectionEnd = end;
        panel.emit('focusin', { target: node });
        return node;
      },
      async openAssets() {
        this.clickTab('assets');
        await settle();
        return this.insertButton();
      },
    };
  }

  it('coordinates focus in Code through Assets insertion and back with exact caret and dirty state', async () => {
    const test = coordinatorHarness({ documents: { 12: studioDocument(12, { slides: [studioDocument(12).slides[0]] }) } });
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    test.chooseCode('html', FAMILY, 16, 21);

    const insert = await test.openAssets();
    expect(test.document.activeElement).toBe(test.tabs[3]);
    expect(insert.disabled).toBe(false);
    insert.emit('click');

    test.clickTab('code');
    const restored = test.codeField('html', FAMILY);
    expect(restored.value).toBe(`<section>before ${TOKEN}</section>`);
    expect(restored.selectionStart).toBe(16 + TOKEN.length);
    expect(restored.selectionEnd).toBe(16 + TOKEN.length);
    expect(test.document.activeElement).toBe(restored);
    expect(test.dirtyBadge(FAMILY).textContent).toBe('Unsaved');
    expect(test.timers.at(-1).delay).toBe(300);
    expect(test.preview.boot).not.toHaveBeenCalled();
  });

  it('inserts into a Master field through the same logical target path', async () => {
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    const css = test.masterField('css');
    css.selectionStart = 5;
    css.selectionEnd = 8;
    test.panel.emit('select', { target: css });

    const insert = await test.openAssets();
    expect(insert.disabled).toBe(false);
    insert.emit('click');

    test.clickTab('code');
    expect(test.masterField('css').value).toBe(`main{${TOKEN}:8px}`);
    expect(test.dirtyBadge('master').textContent).toBe('Unsaved');
    expect(test.codeField('html', FAMILY).value).toBe('<section>before after</section>');
  });

  it('shows no editable surface for the previous webinar while the next one loads', async () => {
    const pending = deferred();
    const test = coordinatorHarness({ documents: { 12: studioDocument(12), 13: studioDocument(13) } });
    test.api.getWebinar.mockImplementation(id => id === 13 ? pending.promise : Promise.resolve(structuredClone(studioDocument(12))));
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    expect(test.codeField('html', FAMILY)).not.toBeNull();

    const switching = test.studio.selectWebinar(13);
    await Promise.resolve();
    expect(test.codeField('html', FAMILY)).toBeNull();
    expect(test.panel.querySelectorAll('[data-save-slide]')).toHaveLength(0);
    expect(test.panel.querySelectorAll('[data-save-master]')).toHaveLength(0);
    expect(test.panel.innerHTML).toMatch(/loading/i);
    expect(test.elements.wsLaunchPresenter.disabled).toBe(true);

    pending.resolve(structuredClone(studioDocument(13)));
    await switching;
    await test.settle();
    expect(test.codeField('html', FAMILY)).not.toBeNull();
  });

  it('never lets a target from one webinar insert into a newly selected webinar', async () => {
    const test = coordinatorHarness({ documents: { 12: studioDocument(12), 13: studioDocument(13) } });
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    test.chooseCode('html', FAMILY, 9, 15);
    await test.openAssets();
    const stale = test.captured.getEditorTarget();
    expect(stale).toMatchObject({ webinarId: 12, surface: FAMILY, field: 'html' });

    await test.studio.selectWebinar(13);
    await test.settle();
    expect(stale.insertText(TOKEN)).toBe(false);
    const insert = test.insertButton();
    expect(insert.disabled).toBe(true);
    expect(insert.textContent).toBe('Choose a Code field');
    insert.emit('click');
    expect(test.assetError().textContent).toMatch(/choose an html, css, or javascript code field/i);

    test.clickTab('code');
    expect(test.codeField('html', FAMILY).value).toBe('<section>before after</section>');
    expect(test.dirtyBadge(FAMILY).textContent).toBe('Live');
    expect(test.timers.some(timer => timer.delay === 300)).toBe(false);
  });

  it('invalidates the target when the live version reloads and accepts a freshly chosen field afterwards', async () => {
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    test.chooseCode('html', SECOND_SLIDE, 9, 15);

    test.clickTab('access');
    expect(test.captured.accessContext).not.toBeNull();
    await test.captured.accessContext.reload();
    await test.settle();

    let insert = await test.openAssets();
    expect(insert.disabled).toBe(true);
    insert.emit('click');
    expect(test.assetError().textContent).toMatch(/choose an html, css, or javascript code field/i);
    test.clickTab('code');
    expect(test.codeField('html', SECOND_SLIDE).value).toBe('<article>agenda</article>');

    test.chooseCode('html', SECOND_SLIDE, 9, 15);
    insert = await test.openAssets();
    expect(insert.disabled).toBe(false);
    insert.emit('click');
    test.clickTab('code');
    expect(test.codeField('html', SECOND_SLIDE).value).toBe(`<article>${TOKEN}</article>`);
    expect(test.codeField('html', FAMILY).value).toBe('<section>before after</section>');
  });

  it('drops the target when its slide is deleted and keeps a different slide target exact', async () => {
    const deletedTarget = coordinatorHarness();
    await deletedTarget.studio.init();
    await deletedTarget.studio.open();
    deletedTarget.clickTab('code');
    deletedTarget.chooseCode('html', SECOND_SLIDE, 0, 0);
    deletedTarget.panel.emit('click', { target: deletedTarget.deleteButton(SECOND_SLIDE) });
    await deletedTarget.settle();
    expect(deletedTarget.api.archiveSlide).toHaveBeenCalledWith(12, SECOND_SLIDE, { expectedVersion: 7 });
    expect(deletedTarget.codeField('html', SECOND_SLIDE)).toBeNull();
    const insert = await deletedTarget.openAssets();
    expect(insert.disabled).toBe(true);

    const survivingTarget = coordinatorHarness();
    await survivingTarget.studio.init();
    await survivingTarget.studio.open();
    survivingTarget.clickTab('code');
    survivingTarget.chooseCode('html', FAMILY, 9, 15);
    survivingTarget.panel.emit('click', { target: survivingTarget.deleteButton(SECOND_SLIDE) });
    await survivingTarget.settle();
    const survivingInsert = await survivingTarget.openAssets();
    expect(survivingInsert.disabled).toBe(false);
    survivingInsert.emit('click');
    survivingTarget.clickTab('code');
    expect(survivingTarget.codeField('html', FAMILY).value).toBe(`<section>${TOKEN} after</section>`);
    expect(survivingTarget.codeField('html', SECOND_SLIDE)).toBeNull();
  });

  it('clears the target when the Studio closes and requires a new choice after reopening', async () => {
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    test.chooseCode('javascript', FAMILY, 0, 0);
    await test.openAssets();
    const stale = test.captured.getEditorTarget();
    expect(stale).not.toBeNull();

    expect(await test.studio.close()).toBe(true);
    expect(stale.insertText(TOKEN)).toBe(false);
    await test.studio.open();
    await test.settle();
    const insert = await test.openAssets();
    expect(insert.disabled).toBe(true);
    test.clickTab('code');
    expect(test.codeField('javascript', FAMILY).value).toBe('');
    expect(test.dirtyBadge(FAMILY).textContent).toBe('Live');
  });

  it('detaches every target when the Studio is destroyed', async () => {
    const test = coordinatorHarness();
    await test.studio.init();
    await test.studio.open();
    test.clickTab('code');
    test.chooseCode('css', FAMILY, 0, 0);
    await test.openAssets();
    const target = test.captured.getEditorTarget();
    expect(target).toMatchObject({ field: 'css' });
    const timersBefore = test.timers.length;

    test.studio.destroy();
    expect(target.insertText(TOKEN)).toBe(false);
    expect(test.captured.getEditorTarget()).toBeNull();
    expect(test.timers.length).toBe(timersBefore);
    expect(test.preview.destroy).toHaveBeenCalledOnce();
  });
});
