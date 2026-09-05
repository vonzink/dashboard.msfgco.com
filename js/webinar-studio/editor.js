(function initializeWebinarStudioEditor(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioEditor = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioEditorApi() {
  'use strict';

  const ANCHOR = /^[a-z][a-z0-9-]{0,189}$/;
  const FORBIDDEN_HTML = /<\s*\/?\s*(?:script|iframe|object|embed|form|base)\b|\s(?:on[a-z]+|srcdoc|data-slide-mount)\s*=/i;
  const FORBIDDEN_CSS = /@\s*import\b|(?:^|[^-\w])expression\s*\(|javascript\s*:/i;
  const MASTER_TOKEN = '{{SLIDE_CONTENT}}';
  const PREVIEW_DELAY_MS = 300;

  function required(value, message) {
    if (!value) throw new TypeError(message);
    return value;
  }

  function createNode(document, tagName, attributes = {}, text = null) {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'class') node.className = value;
      else if (name === 'disabled') node.disabled = Boolean(value);
      else if (name === 'open') node.open = Boolean(value);
      else node.setAttribute(name, String(value));
    }
    if (text !== null) node.textContent = String(text);
    return node;
  }

  function append(parent, ...children) {
    parent.append(...children.filter(Boolean));
    return parent;
  }

  function fieldLabel(document, text, control) {
    const label = createNode(document, 'label', { for: control.id || control.getAttribute?.('id') }, text);
    return append(createNode(document, 'div', { class: 'ws-editor-field' }), label, control);
  }

  function textArea(document, attributes, value) {
    const field = createNode(document, 'textarea', { ...attributes, spellcheck: 'false' });
    field.value = value;
    return field;
  }

  function exactTokenCount(value) {
    return String(value).split(MASTER_TOKEN).length - 1;
  }

  function validateHtml(value, master = false) {
    if (typeof value !== 'string') return 'HTML must be text.';
    if (master && exactTokenCount(value) !== 1) return 'Master HTML needs exactly one slide-content token.';
    if (FORBIDDEN_HTML.test(value)) return 'HTML contains a blocked element or attribute.';
    return null;
  }

  function validateCss(value) {
    if (typeof value !== 'string') return 'CSS must be text.';
    return FORBIDDEN_CSS.test(value) ? 'CSS contains a blocked construct.' : null;
  }

  function createEditor({
    root,
    document,
    api,
    stateApi,
    getState,
    setState,
    preview,
    getAssets = () => ({}),
    getResourcePolicy,
    confirm = async () => true,
    copyText = async () => undefined,
    onReload = async () => undefined,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    required(root && typeof root.replaceChildren === 'function', 'Editor root is required');
    required(document && typeof document.createElement === 'function', 'Editor document is required');
    required(api, 'Editor API is required');
    required(stateApi, 'Editor state API is required');
    required(typeof getState === 'function' && typeof setState === 'function', 'Editor state access is required');
    required(preview && typeof preview.boot === 'function', 'Editor preview is required');
    required(typeof getResourcePolicy === 'function', 'Editor resource policy is required');

    const previewStates = new Map();
    const activeTabs = new Map();
    let debounceTimer = null;
    let previewGeneration = 0;
    let editorError = '';
    let destroyed = false;

    function surfaceKey(surface) {
      return surface === 'master' ? 'master' : `slide:${surface}`;
    }

    function state() {
      return getState();
    }

    function validationFor(surface) {
      const current = state();
      if (!current) return 'The webinar is not loaded.';
      const masterError = validateHtml(current.master.html, true) || validateCss(current.master.css);
      if (surface === 'master') return masterError;
      const slide = current.slidesById[surface];
      if (!slide) return 'The slide is no longer active.';
      if (!slide.title.trim()) return 'Enter a slide title.';
      if (!ANCHOR.test(slide.anchor)) return 'Use a canonical lowercase slide anchor.';
      if (current.slideOrder.some(id => id !== surface && current.slidesById[id].anchor === slide.anchor)) {
        return 'Every slide anchor must be unique.';
      }
      if (!Number.isSafeInteger(slide.targetSeconds) || slide.targetSeconds < 0 || slide.targetSeconds > 7200) {
        return 'Target duration must be between 0 and 7,200 seconds.';
      }
      return masterError || validateHtml(slide.html) || validateCss(slide.css);
    }

    function candidateFor(surface) {
      const current = state();
      const slideId = surface === 'master' ? current.selectedSlideId : surface;
      const slide = current.slidesById[slideId];
      return {
        master: { html: current.master.html, css: current.master.css },
        slide: {
          id: slide.id,
          anchor: slide.anchor,
          title: slide.title,
          html: slide.html,
          css: slide.css,
          javascript: slide.javascript,
        },
        assets: getAssets(),
        resourcePolicy: getResourcePolicy(),
      };
    }

    function nodesFor(attribute) {
      return Array.from(root.querySelectorAll(`[${attribute}]`) || []);
    }

    function saveButton(surface) {
      if (surface === 'master') return nodesFor('data-save-master')[0] || null;
      return nodesFor('data-save-slide').find(node => node.dataset?.slideId === surface) || null;
    }

    function updatePreviewStatus(surface, message) {
      const status = nodesFor('data-preview-status').find(node => node.dataset?.surface === surface)
        || nodesFor('data-preview-status')[0];
      if (status) status.textContent = message;
    }

    function updateDirtyBadge(surface) {
      const current = state();
      const badge = nodesFor('data-dirty-surface').find(node => node.dataset?.dirtySurface === surface);
      if (!badge) return;
      const dirtyFields = surface === 'master'
        ? current.master.dirtyFields
        : current.slidesById[surface]?.dirtyFields;
      badge.textContent = dirtyFields?.length ? 'Unsaved' : 'Live';
    }

    function updateSaveAvailability(surface) {
      const button = saveButton(surface);
      if (!button) return;
      button.disabled = Boolean(validationFor(surface)) || previewStates.get(surfaceKey(surface)) !== 'ready';
    }

    async function previewSurface(surface) {
      if (destroyed) return { type: 'error', code: 'EDITOR_DESTROYED' };
      const error = validationFor(surface);
      previewStates.delete(surfaceKey(surface));
      updateSaveAvailability(surface);
      if (error) {
        updatePreviewStatus(surface, error);
        return { type: 'error', code: 'LOCAL_VALIDATION_FAILED' };
      }
      const generation = ++previewGeneration;
      previewStates.set(surfaceKey(surface), 'pending');
      updatePreviewStatus(surface, 'Checking the slide preview…');
      updateSaveAvailability(surface);
      let result;
      try {
        result = await preview.boot(candidateFor(surface));
      } catch {
        result = { type: 'error', code: 'PREVIEW_STARTUP_FAILED' };
      }
      if (destroyed || generation !== previewGeneration) return result;
      if (result?.type === 'ready') {
        previewStates.set(surfaceKey(surface), 'ready');
        updatePreviewStatus(surface, 'Slide preview is ready.');
      } else {
        previewStates.set(surfaceKey(surface), 'error');
        updatePreviewStatus(surface, 'The slide preview could not start. Your changes are still here.');
      }
      updateSaveAvailability(surface);
      return result;
    }

    function schedulePreview(surface) {
      if (debounceTimer !== null) clearTimeoutImpl(debounceTimer);
      debounceTimer = setTimeoutImpl(() => {
        debounceTimer = null;
        void previewSurface(surface);
      }, PREVIEW_DELAY_MS);
    }

    function updateInput(target) {
      const current = state();
      const masterField = target.dataset?.masterField;
      const slideField = target.dataset?.slideField;
      const codeField = target.dataset?.codeField;
      const slideId = target.dataset?.slideId;
      let next;
      let surface;
      try {
        if (masterField) {
          next = stateApi.updateMaster(current, masterField, target.value);
          surface = 'master';
        } else if (slideId && (slideField || codeField)) {
          const field = slideField || codeField;
          const value = field === 'targetSeconds' ? Number(target.value) : target.value;
          next = stateApi.updateSlide(current, slideId, field, value);
          surface = slideId;
        } else {
          return;
        }
        setState(next);
        editorError = '';
        previewStates.delete(surfaceKey(surface));
        updateDirtyBadge(surface);
        updateSaveAvailability(surface);
        schedulePreview(surface);
      } catch {
        editorError = 'This value is not valid. Your changes are still in the editor.';
        const errorNode = nodesFor('data-editor-error')[0];
        if (errorNode) errorNode.textContent = editorError;
        updateSaveAvailability(surface);
      }
    }

    function activateTab(button) {
      const slideId = button.dataset?.slideId;
      const tab = button.dataset?.codeTab;
      if (!slideId || !['html', 'css', 'javascript'].includes(tab)) return;
      activeTabs.set(slideId, tab);
      for (const item of nodesFor('data-code-tab').filter(node => node.dataset?.slideId === slideId)) {
        const selected = item.dataset.codeTab === tab;
        item.setAttribute('aria-selected', String(selected));
        item.setAttribute('tabindex', selected ? '0' : '-1');
      }
      for (const panel of nodesFor('data-code-panel').filter(node => node.dataset?.slideId === slideId)) {
        panel.hidden = panel.dataset.codePanel !== tab;
      }
    }

    function renderConflict(fragment, current) {
      if (!current.conflict) return;
      const updater = current.conflict.updatedBy.name || 'another editor';
      const banner = createNode(document, 'section', {
        class: 'ws-editor-conflict',
        'data-conflict': '',
        role: 'alert',
      });
      const message = createNode(
        document,
        'p',
        {},
        `${updater} saved ${current.conflict.updatedAt}. The server is now on version ${current.conflict.currentVersion}. Your unsaved changes are still here.`,
      );
      const actions = createNode(document, 'div', { class: 'ws-editor-conflict-actions' });
      append(actions,
        createNode(document, 'button', { type: 'button', 'data-reload-conflict': '' }, 'Reload live version'),
        createNode(document, 'button', { type: 'button', 'data-copy-conflict': '' }, 'Copy my changes'));
      append(banner, message, actions);
      fragment.append(banner);
    }

    function renderMaster(fragment, current) {
      const box = createNode(document, 'details', { class: 'ws-master-box', open: true });
      const summary = createNode(document, 'summary');
      append(summary,
        createNode(document, 'strong', {}, 'Master layout'),
        createNode(document, 'span', { 'data-dirty-surface': 'master' }, current.master.dirtyFields.length ? 'Unsaved' : 'Live'));
      box.append(summary);
      const body = createNode(document, 'div', { class: 'ws-editor-box-body' });
      const html = textArea(document, {
        id: 'ws-master-html',
        'data-master-field': 'html',
        'aria-label': 'Master HTML',
      }, current.master.html);
      const css = textArea(document, {
        id: 'ws-master-css',
        'data-master-field': 'css',
        'aria-label': 'Master CSS',
      }, current.master.css);
      const status = createNode(document, 'p', { 'data-preview-status': '', 'data-surface': 'master', role: 'status' }, 'Preview required before saving.');
      const save = createNode(document, 'button', { type: 'button', 'data-save-master': '', disabled: true }, 'Save Live');
      append(body, fieldLabel(document, 'Master HTML', html), fieldLabel(document, 'Master CSS', css), status, save);
      box.append(body);
      fragment.append(box);
      updateSaveAvailability('master');
    }

    function metadataField(slide, field, label, type = 'text') {
      const input = field === 'speakerNotes'
        ? textArea(document, {
          id: `ws-${slide.id}-${field}`,
          'data-slide-id': slide.id,
          'data-slide-field': field,
          'aria-label': label,
        }, slide[field])
        : createNode(document, 'input', {
          id: `ws-${slide.id}-${field}`,
          type,
          'data-slide-id': slide.id,
          'data-slide-field': field,
          'aria-label': label,
          ...(field === 'targetSeconds' ? { min: 0, max: 7200, step: 1 } : {}),
        });
      if (field !== 'speakerNotes') input.value = String(slide[field]);
      return fieldLabel(document, label, input);
    }

    function renderSlide(fragment, current, slideId, position) {
      const slide = current.slidesById[slideId];
      const box = createNode(document, 'details', {
        class: 'ws-slide-box',
        'data-slide-id': slide.id,
        'data-anchor': slide.anchor,
        open: slide.id === current.selectedSlideId,
      });
      const summary = createNode(document, 'summary');
      append(summary,
        createNode(document, 'span', { class: 'ws-slide-position' }, String(position + 1)),
        createNode(document, 'strong', {}, slide.title),
        createNode(document, 'span', {
          'data-dirty-badge': '',
          'data-dirty-surface': slide.id,
        }, slide.dirtyFields.length ? 'Unsaved' : 'Live'));
      box.append(summary);

      const body = createNode(document, 'div', { class: 'ws-editor-box-body' });
      const metadata = createNode(document, 'div', { class: 'ws-slide-metadata' });
      append(metadata,
        metadataField(slide, 'title', 'Slide title'),
        metadataField(slide, 'anchor', 'Slide anchor'),
        metadataField(slide, 'targetSeconds', 'Target duration in seconds', 'number'),
        metadataField(slide, 'speakerNotes', 'Shared speaker notes'));

      const tabList = createNode(document, 'div', { role: 'tablist', 'aria-label': `${slide.title} code` });
      const panels = createNode(document, 'div', { class: 'ws-code-panels' });
      const selectedTab = activeTabs.get(slide.id) || 'html';
      for (const [field, label] of [['html', 'HTML'], ['css', 'CSS'], ['javascript', 'JavaScript']]) {
        const selected = field === selectedTab;
        const tabId = `ws-tab-${slide.id}-${field}`;
        const panelId = `ws-panel-${slide.id}-${field}`;
        tabList.append(createNode(document, 'button', {
          id: tabId,
          type: 'button',
          role: 'tab',
          'aria-controls': panelId,
          'aria-selected': String(selected),
          tabindex: selected ? '0' : '-1',
          'data-code-tab': field,
          'data-slide-id': slide.id,
        }, label));
        const panel = createNode(document, 'section', {
          id: panelId,
          role: 'tabpanel',
          'aria-labelledby': tabId,
          'data-code-panel': field,
          'data-slide-id': slide.id,
        });
        panel.hidden = !selected;
        panel.append(textArea(document, {
          'data-code-field': field,
          'data-slide-id': slide.id,
          'aria-label': `${slide.title} ${label}`,
        }, slide[field]));
        panels.append(panel);
      }

      const status = createNode(document, 'p', {
        'data-preview-status': '',
        'data-surface': slide.id,
        role: 'status',
      }, 'Preview required before saving.');
      const actions = createNode(document, 'div', { class: 'ws-slide-actions' });
      append(actions,
        createNode(document, 'button', { type: 'button', 'data-slide-up': '', 'data-slide-id': slide.id, disabled: position === 0 }, 'Move up'),
        createNode(document, 'button', { type: 'button', 'data-slide-down': '', 'data-slide-id': slide.id, disabled: position === current.slideOrder.length - 1 }, 'Move down'),
        createNode(document, 'button', { type: 'button', 'data-duplicate-slide': '', 'data-slide-id': slide.id }, 'Duplicate'),
        createNode(document, 'button', { type: 'button', 'data-delete-slide': '', 'data-slide-id': slide.id, disabled: current.slideOrder.length === 1 }, 'Delete'),
        createNode(document, 'button', { type: 'button', 'data-save-slide': '', 'data-slide-id': slide.id, disabled: true }, 'Save Live'));
      append(body, metadata, tabList, panels, status, actions);
      box.append(body);
      fragment.append(box);
    }

    function render(nextState = state()) {
      if (destroyed) return false;
      required(nextState, 'A Studio state is required');
      stateApi.hasUnsavedChanges(nextState);
      const fragment = document.createDocumentFragment();
      const header = createNode(document, 'header', { class: 'ws-editor-header' });
      append(header,
        createNode(document, 'div', { 'data-live-version': '' }, `Live version ${nextState.liveVersion}`),
        createNode(document, 'button', { type: 'button', 'data-add-slide': '' }, 'Add slide'));
      fragment.append(header);
      const error = createNode(document, 'p', { 'data-editor-error': '', role: 'alert' }, editorError);
      fragment.append(error);
      renderConflict(fragment, nextState);
      renderMaster(fragment, nextState);
      nextState.slideOrder.forEach((slideId, position) => renderSlide(fragment, nextState, slideId, position));
      root.replaceChildren(fragment);
      updateSaveAvailability('master');
      nextState.slideOrder.forEach(updateSaveAvailability);
      return true;
    }

    function handleFailure(error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 409 && error?.code === 'VERSION_CONFLICT') {
        try {
          setState(stateApi.applyConflict(state(), {
            currentVersion: error.currentVersion,
            updatedAt: error.updatedAt,
            updatedBy: error.updatedBy,
          }));
        } catch { /* malformed metadata stays generic */ }
      }
      editorError = status === 409 && error?.code === 'VERSION_CONFLICT'
        ? 'The live version changed. Your edits were not overwritten.'
        : 'Changes were not saved. Your work is still here; try again.';
      render(state());
      return error;
    }

    async function saveMaster() {
      const current = state();
      if (validationFor('master') || previewStates.get('master') !== 'ready') return false;
      try {
        const response = await api.saveMaster(current.webinar.id, {
          expectedVersion: current.liveVersion,
          masterHtml: current.master.html,
          masterCss: current.master.css,
        });
        setState(stateApi.markSurfaceSaved(current, 'master', response));
        editorError = '';
        render(state());
        return true;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    }

    async function saveSlide(id) {
      const current = state();
      const slide = current.slidesById[id];
      if (!slide || validationFor(id) || previewStates.get(surfaceKey(id)) !== 'ready') return false;
      try {
        const response = await api.saveSlide(current.webinar.id, id, {
          expectedVersion: current.liveVersion,
          anchor: slide.anchor,
          title: slide.title,
          targetSeconds: slide.targetSeconds,
          speakerNotes: slide.speakerNotes,
          html: slide.html,
          css: slide.css,
          javascript: slide.javascript,
        });
        setState(stateApi.markSurfaceSaved(current, id, response));
        editorError = '';
        render(state());
        return true;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    }

    function uniqueBlankAnchor(current) {
      const used = new Set(current.slideOrder.map(id => current.slidesById[id].anchor));
      if (!used.has('new-slide')) return 'new-slide';
      let suffix = 2;
      while (used.has(`new-slide-${suffix}`)) suffix += 1;
      return `new-slide-${suffix}`;
    }

    async function addSlide() {
      const current = state();
      try {
        const response = await api.addSlide(current.webinar.id, {
          expectedVersion: current.liveVersion,
          anchor: uniqueBlankAnchor(current),
          title: 'New slide',
          targetSeconds: 0,
          speakerNotes: '',
          html: '',
          css: '',
          javascript: '',
        });
        setState(stateApi.appendServerSlide(current, response.slide, response));
        editorError = '';
        render(state());
        return response.slide;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    }

    async function duplicateSlide(id) {
      const current = state();
      if (!current.slidesById[id]) return false;
      try {
        const response = await api.addSlide(current.webinar.id, {
          expectedVersion: current.liveVersion,
          sourceSlideId: id,
        });
        setState(stateApi.appendServerSlide(current, response.slide, response));
        editorError = '';
        render(state());
        return response.slide;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    }

    async function reorderSlides(ids) {
      const current = state();
      try {
        const response = await api.reorderSlides(current.webinar.id, {
          expectedVersion: current.liveVersion,
          slideIds: [...ids],
        });
        setState(stateApi.applyOrder(current, ids, response));
        editorError = '';
        render(state());
        return true;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    }

    async function deleteSlide(id) {
      const current = state();
      const slide = current.slidesById[id];
      if (!slide) return false;
      if (current.slideOrder.length === 1) {
        editorError = 'A webinar must keep at least one live slide.';
        render(current);
        return false;
      }
      const approved = await confirm(
        `Delete “${slide.title}” from the live deck? You can restore it later from History.`,
        {
          title: 'Delete slide',
          confirmText: 'Delete slide',
          cancelText: 'Keep slide',
          variant: 'danger',
        },
      );
      if (!approved) return false;
      try {
        const response = await api.archiveSlide(current.webinar.id, id, {
          expectedVersion: current.liveVersion,
        });
        setState(stateApi.removeServerSlide(current, id, response));
        editorError = '';
        render(state());
        return true;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    }

    function moveSlide(id, offset) {
      const current = state();
      const from = current.slideOrder.indexOf(id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.slideOrder.length) return Promise.resolve(false);
      const ids = [...current.slideOrder];
      [ids[from], ids[to]] = [ids[to], ids[from]];
      return reorderSlides(ids);
    }

    async function copyConflictChanges() {
      const current = state();
      const payload = {
        liveVersion: current.liveVersion,
        master: current.master,
        slideOrder: current.slideOrder,
        slides: current.slideOrder.map(id => current.slidesById[id]),
      };
      await copyText(JSON.stringify(payload, null, 2));
    }

    async function handleClick(event) {
      const target = event.target;
      const slideId = target.dataset?.slideId;
      try {
        if (target.dataset?.codeTab) activateTab(target);
        else if (target.hasAttribute?.('data-save-master')) await saveMaster();
        else if (target.hasAttribute?.('data-save-slide')) await saveSlide(slideId);
        else if (target.hasAttribute?.('data-add-slide')) await addSlide();
        else if (target.hasAttribute?.('data-duplicate-slide')) await duplicateSlide(slideId);
        else if (target.hasAttribute?.('data-delete-slide')) await deleteSlide(slideId);
        else if (target.hasAttribute?.('data-slide-up')) await moveSlide(slideId, -1);
        else if (target.hasAttribute?.('data-slide-down')) await moveSlide(slideId, 1);
        else if (target.hasAttribute?.('data-reload-conflict')) await onReload();
        else if (target.hasAttribute?.('data-copy-conflict')) await copyConflictChanges();
      } catch {
        // Mutation helpers already retain state and render bounded errors.
      }
    }

    function handleKeydown(event) {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || !event.target
        || String(event.target.tagName).toUpperCase() !== 'TEXTAREA') return;
      event.preventDefault();
      const target = event.target;
      target.setRangeText('  ', target.selectionStart, target.selectionEnd, 'end');
      updateInput(target);
    }

    function handleInput(event) {
      updateInput(event.target);
    }

    root.addEventListener('input', handleInput);
    root.addEventListener('keydown', handleKeydown);
    root.addEventListener('click', handleClick);

    return Object.freeze({
      render,
      previewMaster: () => previewSurface('master'),
      previewSlide: id => previewSurface(id),
      saveMaster,
      saveSlide,
      addSlide,
      duplicateSlide,
      reorderSlides,
      deleteSlide,
      copyConflictChanges,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (debounceTimer !== null) clearTimeoutImpl(debounceTimer);
        root.removeEventListener('input', handleInput);
        root.removeEventListener('keydown', handleKeydown);
        root.removeEventListener('click', handleClick);
        preview.destroy?.();
      },
    });
  }

  return Object.freeze({ createEditor, validateCss, validateHtml });
}));
