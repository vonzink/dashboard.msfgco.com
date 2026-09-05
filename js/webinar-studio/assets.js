(function initializeWebinarStudioAssets(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioAssets = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioAssetsApi() {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const POLL_DELAYS = Object.freeze([1000, 2000, 4000, 8000]);
  const MEDIA_RULES = Object.freeze({
    'image/png': Object.freeze({ mediaType: 'image', maxBytes: 20 * 1024 * 1024 }),
    'image/jpeg': Object.freeze({ mediaType: 'image', maxBytes: 20 * 1024 * 1024 }),
    'image/webp': Object.freeze({ mediaType: 'image', maxBytes: 20 * 1024 * 1024 }),
    'image/gif': Object.freeze({ mediaType: 'image', maxBytes: 20 * 1024 * 1024 }),
    'image/svg+xml': Object.freeze({ mediaType: 'svg', maxBytes: 5 * 1024 * 1024 }),
    'font/woff': Object.freeze({ mediaType: 'font', maxBytes: 10 * 1024 * 1024 }),
    'font/woff2': Object.freeze({ mediaType: 'font', maxBytes: 10 * 1024 * 1024 }),
    'audio/mpeg': Object.freeze({ mediaType: 'audio', maxBytes: 100 * 1024 * 1024 }),
    'audio/wav': Object.freeze({ mediaType: 'audio', maxBytes: 100 * 1024 * 1024 }),
    'video/mp4': Object.freeze({ mediaType: 'video', maxBytes: 500 * 1024 * 1024 }),
    'video/webm': Object.freeze({ mediaType: 'video', maxBytes: 500 * 1024 * 1024 }),
  });
  const MEDIA_TYPES = new Set(['image', 'svg', 'font', 'audio', 'video']);
  const STATUSES = new Set(['processing', 'available', 'rejected', 'archived']);

  function required(value, message) {
    if (!value) throw new TypeError(message);
    return value;
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function boundedText(value, maximum, fallback = '') {
    if (typeof value !== 'string') return fallback;
    return value.trim().slice(0, maximum) || fallback;
  }

  function canonicalUuid(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!UUID.test(id)) throw new TypeError('A canonical asset version id is required');
    return id;
  }

  function safePublicUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeVersion(row) {
    let id;
    try {
      id = canonicalUuid(row?.id || row?.versionId);
    } catch {
      return null;
    }
    const status = STATUSES.has(row?.status) ? row.status : 'processing';
    const mediaType = MEDIA_TYPES.has(row?.mediaType) ? row.mediaType : 'image';
    return {
      id,
      versionNumber: positiveInteger(row?.versionNumber) || 1,
      mediaType,
      mimeType: boundedText(row?.mimeType, 100),
      byteSize: Math.max(0, Number(row?.byteSize) || 0),
      width: Number.isFinite(Number(row?.width)) ? Number(row.width) : null,
      height: Number.isFinite(Number(row?.height)) ? Number(row.height) : null,
      durationMs: Number.isFinite(Number(row?.durationMs)) ? Number(row.durationMs) : null,
      status,
      rejectionCode: status === 'rejected' ? boundedText(row?.rejectionCode, 64, 'ASSET_REJECTED') : null,
      uploadedByUserId: positiveInteger(row?.uploadedByUserId),
      uploaderName: boundedText(row?.uploaderName, 255),
      createdAt: boundedText(row?.createdAt, 64),
      archivedAt: boundedText(row?.archivedAt, 64) || null,
      publicUrl: status === 'available' ? safePublicUrl(row?.publicUrl) : null,
    };
  }

  function normalizeFamily(row) {
    let id;
    try {
      id = canonicalUuid(row?.id);
    } catch {
      return null;
    }
    const versions = Array.isArray(row?.versions)
      ? row.versions.map(normalizeVersion).filter(Boolean).sort((a, b) => b.versionNumber - a.versionNumber)
      : [];
    return {
      id,
      displayName: boundedText(row?.displayName, 255, 'Untitled asset'),
      description: boundedText(row?.description, 65535),
      createdByUserId: positiveInteger(row?.createdByUserId),
      createdAt: boundedText(row?.createdAt, 64),
      archivedAt: boundedText(row?.archivedAt, 64) || null,
      archived: row?.archived === true || Boolean(row?.archivedAt),
      versions,
    };
  }

  function normalizeCatalog(value) {
    if (!Array.isArray(value)) throw new TypeError('Asset catalog must be an array');
    return value.map(normalizeFamily).filter(Boolean);
  }

  function normalizeUsage(value, versionId) {
    const current = Array.isArray(value?.current) ? value.current : [];
    const history = Array.isArray(value?.history) ? value.history : [];
    return {
      versionId,
      current: current.map(row => ({
        webinarId: positiveInteger(row?.webinarId),
        webinarTitle: boundedText(row?.webinarTitle, 255, 'Untitled webinar'),
        slideId: typeof row?.slideId === 'string' && UUID.test(row.slideId) ? row.slideId : null,
        slideTitle: boundedText(row?.slideTitle, 255),
        surface: boundedText(row?.surface, 64),
      })).filter(row => row.webinarId),
      history: history.map(row => ({
        revisionId: positiveInteger(row?.revisionId),
        webinarId: positiveInteger(row?.webinarId),
        webinarTitle: boundedText(row?.webinarTitle, 255, 'Untitled webinar'),
        webinarVersion: positiveInteger(row?.webinarVersion),
      })).filter(row => row.revisionId && row.webinarId && row.webinarVersion),
    };
  }

  function createNode(document, tagName, attributes = {}, content = null) {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === undefined) continue;
      if (name === 'class') node.className = String(value);
      else if (name === 'disabled') node.disabled = Boolean(value);
      else if (name === 'checked') node.checked = Boolean(value);
      else if (name === 'value') node.value = String(value);
      else node.setAttribute(name, String(value));
    }
    if (content !== null) node.textContent = String(content);
    return node;
  }

  function append(parent, ...children) {
    parent.append(...children.filter(Boolean));
    return parent;
  }

  function assetToken(version) {
    return `{{ASSET:${canonicalUuid(version?.id || version?.versionId)}}}`;
  }

  function predefinedSnippet(version, kind) {
    const token = assetToken(version);
    if (kind === 'html') {
      if (version?.mediaType === 'audio') return `<audio src="${token}" controls></audio>`;
      if (version?.mediaType === 'video') return `<video src="${token}" controls></video>`;
      return `<img src="${token}" alt="">`;
    }
    if (kind === 'css') return `background-image: url("${token}");`;
    throw new TypeError('A predefined asset snippet kind is required');
  }

  function assertBrowserMediaLimit(file) {
    if (!file || typeof file.name !== 'string' || !file.name.trim()) {
      throw new TypeError('Choose a file to upload.');
    }
    const rule = MEDIA_RULES[file.type];
    if (!rule) throw new TypeError('That file type is not supported.');
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new TypeError('The selected file is empty.');
    if (file.size > rule.maxBytes) throw new TypeError('The selected file is larger than the upload limit.');
    return rule;
  }

  function createAssetLibrary({
    api,
    document,
    fetch: fetchImpl = globalThis.fetch,
    copyText = value => globalThis.navigator?.clipboard?.writeText(value),
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
    AbortControllerImpl = globalThis.AbortController,
  } = {}) {
    required(api, 'Asset API is required');
    required(document && typeof document.createElement === 'function', 'Asset document is required');
    required(typeof fetchImpl === 'function', 'Asset upload transport is required');
    required(typeof copyText === 'function', 'Asset copy function is required');

    let context = null;
    let catalog = [];
    const filters = { search: '', mediaType: '', status: '' };
    let active = false;
    let destroyed = false;
    let lifecycleGeneration = 0;
    let catalogRequestGeneration = 0;
    let operationSequence = 0;
    let errorMessage = '';
    let activityMessage = '';
    let retainedUpload = { displayName: '', description: '' };
    const metadataDrafts = new Map();
    const usageByVersion = new Map();
    const operations = new Set();
    const operationsByFamily = new Map();

    function currentUserId() {
      return positiveInteger(context?.currentUser?.id || context?.currentUser?.db?.id);
    }

    function isAdmin() {
      return context?.isAdmin === true;
    }

    function canManageFamily(family) {
      return isAdmin() || (currentUserId() && currentUserId() === family.createdByUserId);
    }

    function canArchiveVersion(version) {
      return isAdmin() || (currentUserId() && currentUserId() === version.uploadedByUserId);
    }

    function editorTarget() {
      try {
        const target = context?.getEditorTarget?.();
        return target && (typeof target.insertText === 'function' || typeof target.setRangeText === 'function')
          ? target
          : null;
      } catch {
        return null;
      }
    }

    function operationIsCurrent(operation) {
      return Boolean(active
        && !destroyed
        && !operation.cancelled
        && operation.lifecycleGeneration === lifecycleGeneration
        && operations.has(operation)
        && (!operation.familyId || operationsByFamily.get(operation.familyId) === operation));
    }

    function cancelOperation(operation) {
      if (!operation || operation.cancelled) return;
      operation.cancelled = true;
      operation.abortController?.abort?.();
      for (const wait of operation.waits) {
        clearTimeoutImpl(wait.id);
        wait.resolve(false);
      }
      operation.waits.clear();
      operations.delete(operation);
      if (operation.familyId && operationsByFamily.get(operation.familyId) === operation) {
        operationsByFamily.delete(operation.familyId);
      }
    }

    function createOperation(familyId = null) {
      const operation = {
        id: ++operationSequence,
        familyId,
        lifecycleGeneration,
        cancelled: false,
        waits: new Set(),
        abortController: typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null,
      };
      operations.add(operation);
      if (familyId) replaceFamilyOperation(operation, familyId);
      return operation;
    }

    function replaceFamilyOperation(operation, familyId) {
      const previous = operationsByFamily.get(familyId);
      if (previous && previous !== operation) cancelOperation(previous);
      operation.familyId = familyId;
      operationsByFamily.set(familyId, operation);
    }

    function finishOperation(operation) {
      if (!operation) return;
      operations.delete(operation);
      if (operation.familyId && operationsByFamily.get(operation.familyId) === operation) {
        operationsByFamily.delete(operation.familyId);
      }
      for (const wait of operation.waits) clearTimeoutImpl(wait.id);
      operation.waits.clear();
    }

    function waitForPoll(delay, operation) {
      if (!operationIsCurrent(operation)) return Promise.resolve(false);
      return new Promise(resolve => {
        const wait = { id: null, resolve };
        wait.id = setTimeoutImpl(() => {
          operation.waits.delete(wait);
          resolve(operationIsCurrent(operation));
        }, delay);
        operation.waits.add(wait);
      });
    }

    function safeErrorStatus(error) {
      return Number(error?.status || error?.statusCode || error?.response?.status) || 0;
    }

    function safeRejectionCode(error) {
      const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
        ? error.code
        : '';
      return code;
    }

    function uploadError(error) {
      const status = safeErrorStatus(error);
      if (status === 400) return 'The server rejected the upload details. Check the file and try again.';
      if (status === 403) return 'The upload was not accepted. Refresh your access and try again.';
      if (status === 429) return 'Uploads are temporarily limited. Wait a moment and try again.';
      if (status === 503) return 'Asset processing is temporarily unavailable. Your file details are still here.';
      return 'The asset upload could not finish. Your file details are still here; try again.';
    }

    function actionError(error, action) {
      const status = safeErrorStatus(error);
      if (status === 409) return `${action} could not finish because this asset is in use. Usage remains shown below.`;
      if (status === 403) return `The server denied ${action.toLowerCase()}. Refresh your access and try again.`;
      if (status === 404) return 'This asset is no longer available. Refresh the library.';
      return `${action} could not be completed. Try again.`;
    }

    function filterPayload() {
      const output = {};
      if (filters.search) output.search = filters.search;
      if (filters.mediaType) output.mediaType = filters.mediaType;
      if (filters.status) output.status = filters.status;
      return output;
    }

    function renderError(container) {
      if (!errorMessage) return;
      container.append(createNode(document, 'p', { class: 'ws-form-error', role: 'alert', 'data-asset-error': '' }, errorMessage));
    }

    function renderActivity(container) {
      if (!activityMessage) return;
      container.append(createNode(document, 'p', { role: 'status', 'data-asset-activity': '' }, activityMessage));
    }

    function renderUpload(container) {
      const form = createNode(document, 'form', { class: 'ws-asset-upload', 'data-asset-upload-form': '' });
      const heading = createNode(document, 'h4', {}, 'Add reusable asset');
      const name = createNode(document, 'input', {
        type: 'text',
        maxlength: 255,
        required: '',
        'aria-label': 'Asset display name',
        'data-upload-display-name': '',
        value: retainedUpload.displayName,
      });
      const description = createNode(document, 'textarea', {
        'aria-label': 'Asset description',
        'data-upload-description': '',
      });
      description.value = retainedUpload.description;
      const file = createNode(document, 'input', {
        type: 'file',
        required: '',
        accept: Object.keys(MEDIA_RULES).join(','),
        'aria-label': 'Choose reusable asset file',
        'data-upload-file': '',
      });
      const submit = createNode(document, 'button', { type: 'submit' }, 'Upload asset');
      form.addEventListener('submit', event => {
        event.preventDefault?.();
        void uploadAsset(file.files?.[0], { displayName: name.value, description: description.value });
      });
      name.addEventListener('input', () => { retainedUpload.displayName = name.value; });
      description.addEventListener('input', () => { retainedUpload.description = description.value; });
      append(form, heading, name, description, file, submit);
      container.append(form);
    }

    function renderFilters(container) {
      const controls = createNode(document, 'div', { class: 'ws-asset-filters' });
      const search = createNode(document, 'input', {
        type: 'search',
        placeholder: 'Search assets',
        'aria-label': 'Search reusable assets',
        'data-asset-search': '',
        value: filters.search,
      });
      search.addEventListener('input', () => {
        filters.search = String(search.value || '').trim();
        void loadCatalog();
      });
      const media = createNode(document, 'select', {
        'aria-label': 'Filter by media type',
        'data-asset-media-filter': '',
        value: filters.mediaType,
      });
      [
        ['', 'All media'], ['image', 'Images'], ['svg', 'SVG'], ['video', 'Video'],
        ['audio', 'Audio'], ['font', 'Fonts'],
      ].forEach(([value, label]) => media.append(createNode(document, 'option', { value }, label)));
      media.value = filters.mediaType;
      media.addEventListener('change', () => {
        filters.mediaType = MEDIA_TYPES.has(media.value) ? media.value : '';
        void loadCatalog();
      });
      const status = createNode(document, 'select', {
        'aria-label': 'Filter by asset status',
        'data-asset-status-filter': '',
        value: filters.status,
      });
      [['', 'All statuses'], ...[...STATUSES].map(value => [value, value[0].toUpperCase() + value.slice(1)])]
        .forEach(([value, label]) => status.append(createNode(document, 'option', { value }, label)));
      status.value = filters.status;
      status.addEventListener('change', () => {
        filters.status = STATUSES.has(status.value) ? status.value : '';
        void loadCatalog();
      });
      append(controls, search, media, status);
      container.append(controls);
    }

    function mediaPreview(version, familyName) {
      if (version.status !== 'available' || !version.publicUrl) return null;
      let preview;
      if (version.mediaType === 'image' || version.mediaType === 'svg') {
        preview = createNode(document, 'img', {
          src: version.publicUrl,
          alt: `${familyName} preview`,
          loading: 'lazy',
          'data-asset-preview': '',
        });
      } else if (version.mediaType === 'video') {
        preview = createNode(document, 'video', {
          src: version.publicUrl,
          controls: '',
          preload: 'metadata',
          'aria-label': `${familyName} preview`,
          'data-asset-preview': '',
        });
      } else if (version.mediaType === 'audio') {
        preview = createNode(document, 'audio', {
          src: version.publicUrl,
          controls: '',
          preload: 'metadata',
          'aria-label': `${familyName} preview`,
          'data-asset-preview': '',
        });
      } else {
        preview = createNode(document, 'span', { class: 'ws-asset-font-preview', 'data-asset-preview': '' }, 'Aa');
      }
      return preview;
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatSurface(surface) {
      return String(surface || 'webinar source').replaceAll('_', ' ');
    }

    function renderUsage(container, version) {
      const usage = usageByVersion.get(version.id);
      if (!usage) return;
      const block = createNode(document, 'div', { class: 'ws-asset-usage', 'data-asset-usage': version.id });
      append(block, createNode(document, 'strong', {}, 'Usage'));
      if (!usage.current.length && !usage.history.length) {
        block.append(createNode(document, 'p', {}, 'Unused in live webinars and history.'));
      }
      usage.current.forEach(row => {
        block.append(createNode(
          document,
          'p',
          {},
          `${row.webinarTitle}${row.slideTitle ? ` · ${row.slideTitle}` : ''} · ${formatSurface(row.surface)}`,
        ));
      });
      usage.history.forEach(row => {
        block.append(createNode(document, 'p', {}, `${row.webinarTitle} · History version ${row.webinarVersion}`));
      });
      container.append(block);
    }

    function renderVersion(container, family, version) {
      const row = createNode(document, 'article', {
        class: 'ws-asset-version',
        'data-asset-version': version.id,
      });
      const preview = mediaPreview(version, family.displayName);
      const details = createNode(document, 'div', { class: 'ws-asset-version-details' });
      append(
        details,
        createNode(document, 'strong', {}, `Version ${version.versionNumber}`),
        createNode(document, 'span', { class: `ws-asset-status ws-asset-status-${version.status}` }, version.status[0].toUpperCase() + version.status.slice(1)),
        createNode(document, 'small', {}, `${version.mediaType} · ${formatBytes(version.byteSize)}${version.width && version.height ? ` · ${version.width}×${version.height}` : ''}`),
      );
      if (version.status === 'rejected') {
        details.append(createNode(document, 'p', { role: 'alert' }, `Rejected: ${version.rejectionCode}`));
      }
      const actions = createNode(document, 'div', { class: 'ws-asset-version-actions' });
      if (version.status === 'available') {
        const copy = createNode(document, 'button', { type: 'button', 'data-copy-asset-reference': version.id }, 'Copy reference');
        copy.addEventListener('click', () => { void copyReference(version); });
        const html = createNode(document, 'button', { type: 'button', 'data-copy-asset-html': version.id }, 'Copy HTML');
        html.addEventListener('click', () => { void copySnippet(version, 'html'); });
        const css = createNode(document, 'button', { type: 'button', 'data-copy-asset-css': version.id }, 'Copy CSS');
        css.addEventListener('click', () => { void copySnippet(version, 'css'); });
        const canInsert = Boolean(editorTarget());
        const insert = createNode(document, 'button', {
          type: 'button',
          'data-insert-asset-reference': version.id,
          disabled: !canInsert,
          title: canInsert ? 'Insert into the last selected code field' : 'Choose a Code field before opening Assets',
        }, canInsert ? 'Insert at cursor' : 'Choose a Code field');
        insert.addEventListener('click', () => { insertReference(version); });
        append(actions, copy, html, css, insert);
      }
      const usage = createNode(document, 'button', { type: 'button', 'data-show-asset-usage': version.id }, 'Show usage');
      usage.addEventListener('click', () => { void loadUsage(version.id); });
      actions.append(usage);
      if (version.status !== 'archived' && canArchiveVersion(version)) {
        const archive = createNode(document, 'button', { type: 'button', 'data-archive-version': version.id }, 'Archive version');
        archive.addEventListener('click', () => { void archiveVersion(family.id, version.id); });
        actions.append(archive);
      }
      append(row, preview, details, actions);
      renderUsage(row, version);
      container.append(row);
    }

    function renderFamily(container, family) {
      const card = createNode(document, 'section', { class: 'ws-asset-family', 'data-asset-family': family.id });
      const header = createNode(document, 'header', { class: 'ws-asset-family-header' });
      append(
        header,
        createNode(document, 'h4', {}, family.displayName),
        family.description ? createNode(document, 'p', {}, family.description) : null,
      );
      if (family.archived) header.append(createNode(document, 'span', { class: 'ws-asset-status' }, 'Archived'));
      const actions = createNode(document, 'div', { class: 'ws-asset-family-actions' });
      if (!family.archived && canManageFamily(family)) {
        const edit = createNode(document, 'button', { type: 'button', 'data-edit-asset': family.id }, 'Edit details');
        edit.addEventListener('click', () => {
          metadataDrafts.set(family.id, { displayName: family.displayName, description: family.description });
          render();
        });
        const versionInput = createNode(document, 'input', {
          type: 'file',
          accept: Object.keys(MEDIA_RULES).join(','),
          'aria-label': `Upload a new version of ${family.displayName}`,
          'data-new-asset-version': family.id,
        });
        versionInput.addEventListener('change', () => {
          if (versionInput.files?.[0]) void uploadAsset(versionInput.files[0], { assetId: family.id });
        });
        append(actions, edit, versionInput);
      }
      if (!family.archived && isAdmin()) {
        const archive = createNode(document, 'button', { type: 'button', 'data-archive-family': family.id }, 'Archive asset');
        archive.addEventListener('click', () => { void archiveFamily(family.id); });
        actions.append(archive);
      }
      append(header, actions);
      card.append(header);

      const draft = metadataDrafts.get(family.id);
      if (draft) {
        const form = createNode(document, 'form', { class: 'ws-asset-metadata', 'data-asset-metadata-form': family.id });
        const name = createNode(document, 'input', { type: 'text', maxlength: 255, value: draft.displayName, 'aria-label': 'Asset display name' });
        const description = createNode(document, 'textarea', { 'aria-label': 'Asset description' });
        description.value = draft.description;
        name.addEventListener('input', () => { draft.displayName = name.value; });
        description.addEventListener('input', () => { draft.description = description.value; });
        form.addEventListener('submit', event => {
          event.preventDefault?.();
          void updateFamily(family.id, { displayName: name.value, description: description.value });
        });
        append(form, name, description, createNode(document, 'button', { type: 'submit' }, 'Save details'));
        card.append(form);
      }

      const versions = createNode(document, 'div', { class: 'ws-asset-versions' });
      family.versions.forEach(version => renderVersion(versions, family, version));
      if (!family.versions.length) versions.append(createNode(document, 'p', {}, 'No versions match these filters.'));
      card.append(versions);
      container.append(card);
    }

    function render() {
      if (!context?.root || destroyed) return;
      const container = createNode(document, 'section', { class: 'ws-asset-library', 'data-asset-library': '' });
      append(
        container,
        createNode(document, 'h3', {}, 'Assets'),
        createNode(document, 'p', {}, 'Reuse approved images, media, and fonts across every webinar.'),
      );
      renderUpload(container);
      renderFilters(container);
      renderError(container);
      renderActivity(container);
      const list = createNode(document, 'div', { class: 'ws-asset-catalog', 'data-asset-catalog': '' });
      if (!catalog.length) list.append(createNode(document, 'p', {}, 'No reusable assets match these filters.'));
      else catalog.forEach(item => renderFamily(list, item));
      container.append(list);
      context.root.replaceChildren(container);
    }

    async function loadCatalog() {
      if (!active || destroyed) return { ok: false, cancelled: true };
      const request = ++catalogRequestGeneration;
      const generation = lifecycleGeneration;
      try {
        const response = await api.listAssets(filterPayload());
        if (!active || destroyed || generation !== lifecycleGeneration || request !== catalogRequestGeneration) {
          return { ok: false, cancelled: true };
        }
        catalog = normalizeCatalog(response);
        errorMessage = '';
        render();
        return { ok: true, catalog };
      } catch {
        if (!active || destroyed || generation !== lifecycleGeneration || request !== catalogRequestGeneration) {
          return { ok: false, cancelled: true };
        }
        errorMessage = 'The asset library could not refresh. The current catalog is still here.';
        render();
        return { ok: false, error: errorMessage };
      }
    }

    async function renderAssetCatalog(nextContext) {
      required(nextContext?.root && typeof nextContext.root.replaceChildren === 'function', 'Asset catalog root is required');
      if (destroyed) return { ok: false, cancelled: true };
      if (context !== nextContext) {
        deactivate();
        context = nextContext;
      }
      active = true;
      lifecycleGeneration += 1;
      render();
      return loadCatalog();
    }

    async function pollVersion(versionId, suppliedOperation = null) {
      const id = canonicalUuid(versionId);
      const operation = suppliedOperation || createOperation(`version:${id}`);
      let attempt = 0;
      try {
        while (operationIsCurrent(operation)) {
          const response = normalizeVersion(await api.confirmUpload(id));
          if (!operationIsCurrent(operation)) return { ok: false, cancelled: true };
          if (!response) throw new TypeError('Invalid asset processing response');
          activityMessage = response.status === 'processing'
            ? 'Asset processing is still running. You can close Studio and refresh the library later.'
            : response.status === 'rejected'
              ? `Asset rejected: ${response.rejectionCode}`
              : response.status === 'available'
                ? 'Asset is approved and ready to reuse.'
                : 'Asset processing stopped.';
          render();
          if (response.status !== 'processing') {
            if (response.status === 'available') await loadCatalog();
            return { ok: response.status === 'available', version: response };
          }
          const delay = POLL_DELAYS[Math.min(attempt, POLL_DELAYS.length - 1)];
          attempt += 1;
          if (!await waitForPoll(delay, operation)) return { ok: false, cancelled: true };
        }
        return { ok: false, cancelled: true };
      } catch (error) {
        if (!operationIsCurrent(operation)) return { ok: false, cancelled: true };
        errorMessage = uploadError(error);
        activityMessage = '';
        render();
        return { ok: false, error: errorMessage };
      } finally {
        if (!suppliedOperation) finishOperation(operation);
      }
    }

    async function uploadAsset(file, metadata = {}) {
      retainedUpload = {
        displayName: String(metadata.displayName || retainedUpload.displayName || ''),
        description: String(metadata.description || retainedUpload.description || ''),
      };
      let rule;
      try {
        rule = assertBrowserMediaLimit(file);
        if (!metadata.assetId && !retainedUpload.displayName.trim()) throw new TypeError('Enter an asset display name.');
      } catch (error) {
        errorMessage = boundedText(error?.message, 255, 'The selected asset is not valid.');
        render();
        return { ok: false, error: errorMessage };
      }
      const familyId = metadata.assetId ? canonicalUuid(metadata.assetId) : null;
      const operation = createOperation(familyId);
      errorMessage = '';
      activityMessage = 'Preparing the asset upload…';
      render();
      try {
        const uploadBody = {
          filename: file.name,
          contentType: file.type,
          byteSize: file.size,
        };
        const intent = familyId
          ? await api.createAssetVersionIntent(familyId, uploadBody)
          : await api.createUploadIntent({
            displayName: retainedUpload.displayName.trim(),
            description: retainedUpload.description.trim(),
            ...uploadBody,
          });
        if (!operationIsCurrent(operation)) return { ok: false, cancelled: true };
        const intendedFamilyId = canonicalUuid(intent?.assetId);
        const intendedVersionId = canonicalUuid(intent?.versionId);
        replaceFamilyOperation(operation, intendedFamilyId);
        if (!operationIsCurrent(operation)) return { ok: false, cancelled: true };
        if (typeof intent?.uploadUrl !== 'string' || !intent.uploadUrl) throw new TypeError('Upload transport unavailable');
        const response = await fetchImpl(intent.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
          ...(operation.abortController ? { signal: operation.abortController.signal } : {}),
        });
        if (!operationIsCurrent(operation)) return { ok: false, cancelled: true };
        if (!response?.ok) throw Object.assign(new Error('Asset upload transport failed'), { status: response?.status });
        activityMessage = `Upload complete. Checking ${rule.mediaType} safety and format…`;
        render();
        const result = await pollVersion(intendedVersionId, operation);
        if (!operationIsCurrent(operation) && result.cancelled) return result;
        if (result.ok && !familyId) retainedUpload = { displayName: '', description: '' };
        return result;
      } catch (error) {
        if (!operationIsCurrent(operation)) return { ok: false, cancelled: true };
        errorMessage = uploadError(error);
        activityMessage = safeRejectionCode(error) ? `Server response: ${safeRejectionCode(error)}` : '';
        render();
        return { ok: false, error: errorMessage };
      } finally {
        finishOperation(operation);
      }
    }

    async function copyReference(version) {
      const reference = assetToken(version);
      await copyText(reference);
      if (active) {
        activityMessage = 'Asset reference copied.';
        render();
      }
      return reference;
    }

    async function copySnippet(version, kind) {
      const snippet = predefinedSnippet(version, kind);
      await copyText(snippet);
      if (active) {
        activityMessage = `${kind === 'css' ? 'CSS' : 'HTML'} snippet copied.`;
        render();
      }
      return snippet;
    }

    function insertReference(version, targetEditor = null) {
      const target = targetEditor || editorTarget();
      if (!target) {
        errorMessage = 'Choose an HTML, CSS, or JavaScript Code field before inserting an asset.';
        render();
        return false;
      }
      const reference = assetToken(version);
      if (typeof target.insertText === 'function') {
        if (target.insertText(reference) !== true) {
          errorMessage = 'That Code field is no longer available. Choose it again before inserting.';
          render();
          return false;
        }
        activityMessage = 'Asset reference inserted. Save Live when the slide is ready.';
        errorMessage = '';
        render();
        return true;
      }
      if (typeof target.setRangeText !== 'function') {
        errorMessage = 'Choose an HTML, CSS, or JavaScript Code field before inserting an asset.';
        render();
        return false;
      }
      const start = Number.isSafeInteger(target.selectionStart) ? target.selectionStart : String(target.value || '').length;
      const end = Number.isSafeInteger(target.selectionEnd) ? target.selectionEnd : start;
      target.setRangeText(reference, start, end, 'end');
      const EventType = document.defaultView?.Event || globalThis.Event;
      if (typeof target.dispatchEvent === 'function' && typeof EventType === 'function') {
        target.dispatchEvent(new EventType('input', { bubbles: true }));
      } else if (typeof target.emit === 'function') {
        target.emit('input');
      }
      target.focus?.();
      activityMessage = 'Asset reference inserted. Save Live when the slide is ready.';
      errorMessage = '';
      render();
      return true;
    }

    async function loadUsage(versionId) {
      const id = canonicalUuid(versionId);
      const generation = lifecycleGeneration;
      try {
        const response = await api.getAssetUsage(id);
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        usageByVersion.set(id, normalizeUsage(response, id));
        render();
        return { ok: true, usage: usageByVersion.get(id) };
      } catch {
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        errorMessage = 'Asset usage could not load. The catalog is unchanged.';
        render();
        return { ok: false, error: errorMessage };
      }
    }

    async function updateFamily(assetId, metadata) {
      const id = canonicalUuid(assetId);
      const family = catalog.find(item => item.id === id);
      if (!family || !canManageFamily(family)) return { ok: false, error: 'Asset access required.' };
      const draft = {
        displayName: String(metadata?.displayName || '').trim(),
        description: String(metadata?.description || '').trim(),
      };
      metadataDrafts.set(id, draft);
      if (!draft.displayName) {
        errorMessage = 'Enter an asset display name.';
        render();
        return { ok: false, error: errorMessage };
      }
      const generation = lifecycleGeneration;
      try {
        await api.updateAsset(id, draft);
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        metadataDrafts.delete(id);
        return loadCatalog();
      } catch (error) {
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        errorMessage = actionError(error, 'Saving asset details');
        render();
        return { ok: false, error: errorMessage };
      }
    }

    async function archiveVersion(assetId, versionId) {
      const familyId = canonicalUuid(assetId);
      const id = canonicalUuid(versionId);
      const family = catalog.find(item => item.id === familyId);
      const version = family?.versions.find(item => item.id === id);
      if (!version || !canArchiveVersion(version)) return { ok: false, error: 'Asset access required.' };
      const generation = lifecycleGeneration;
      try {
        await api.updateAssetVersion(familyId, id, { archive: true });
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        return loadCatalog();
      } catch (error) {
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        errorMessage = actionError(error, 'Archive version');
        if (safeErrorStatus(error) === 409) await loadUsage(id);
        else render();
        return { ok: false, error: errorMessage };
      }
    }

    async function archiveFamily(assetId) {
      const id = canonicalUuid(assetId);
      const family = catalog.find(item => item.id === id);
      if (!family || !isAdmin()) return { ok: false, error: 'Administrator access required.' };
      const generation = lifecycleGeneration;
      try {
        await api.updateAsset(id, { archive: true });
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        return loadCatalog();
      } catch (error) {
        if (!active || destroyed || generation !== lifecycleGeneration) return { ok: false, cancelled: true };
        errorMessage = actionError(error, 'Archive asset');
        if (safeErrorStatus(error) === 409) {
          await Promise.all(family.versions.map(version => loadUsage(version.id)));
        } else {
          render();
        }
        return { ok: false, error: errorMessage };
      }
    }

    function deactivate() {
      active = false;
      lifecycleGeneration += 1;
      catalogRequestGeneration += 1;
      for (const operation of [...operations]) cancelOperation(operation);
    }

    function destroy() {
      deactivate();
      destroyed = true;
      context = null;
    }

    return Object.freeze({
      renderAssetCatalog,
      uploadAsset,
      pollVersion,
      copyReference,
      copySnippet,
      insertReference,
      loadUsage,
      updateFamily,
      archiveVersion,
      archiveFamily,
      deactivate,
      destroy,
    });
  }

  return Object.freeze({
    createAssetLibrary,
    assetToken,
    predefinedSnippet,
    assertBrowserMediaLimit,
  });
}));
