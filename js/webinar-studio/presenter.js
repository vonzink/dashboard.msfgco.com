(function initializeWebinarStudioPresenter(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioPresenter = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioPresenterApi() {
  'use strict';

  /* ==========================================================================
     AUTHENTICATED PRESENTER — the private presenter surface inside the Studio.
     Current authenticated user only: notes and shortcuts come from the Studio
     API, never from a loan-officer selector, browser write key, or storage.
     Audience control goes through an injected bridge (Task 8) that accepts
     only fixed control types with scalar payloads; without a bridge the
     presenter runs as a local rehearsal.
     ======================================================================== */

  const SHORTCUT_ACTIONS = Object.freeze([
    Object.freeze({ id: 'previousSlide', label: 'Previous slide' }),
    Object.freeze({ id: 'nextSlide', label: 'Next slide' }),
    Object.freeze({ id: 'animationPrevious', label: 'Previous animation' }),
    Object.freeze({ id: 'animationNext', label: 'Next animation' }),
    Object.freeze({ id: 'animationPlay', label: 'Play animations' }),
    Object.freeze({ id: 'animationPause', label: 'Pause animations' }),
    Object.freeze({ id: 'toggleDrawing', label: 'Toggle drawing' }),
    Object.freeze({ id: 'toggleFullscreen', label: 'Fullscreen slide' }),
  ]);

  const DEFAULT_SHORTCUTS = Object.freeze({
    previousSlide: 'ArrowLeft',
    nextSlide: 'ArrowRight',
    animationPrevious: 'KeyJ',
    animationNext: 'KeyL',
    animationPlay: 'KeyK',
    animationPause: 'KeyP',
    toggleDrawing: 'KeyD',
    toggleFullscreen: 'KeyF',
  });

  const MODIFIERS = Object.freeze(['Control', 'Alt', 'Shift', 'Meta']);
  const BASE_KEY = /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Left|Right|Up|Down)|Space|Enter|Backspace|Home|End|PageUp|PageDown)$/;
  const BROWSER_RESERVED = /^(?:Control|Meta)(?:\+(?:Alt|Shift))*\+(?:Key[LRNWPT]|Tab)$/;
  const ACTION_ID = /^[a-z][a-z0-9-]{0,63}$/;
  const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
  const CLOCK_INTERVAL_MS = 500;
  const MAX_NOTE_BYTES = 10000;
  const LABELS = new Map(SHORTCUT_ACTIONS.map(action => [action.id, action.label]));

  function required(value, message) {
    if (!value) throw new TypeError(message);
    return value;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function createNode(document, tagName, attributes = {}, content = null) {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'class') node.className = value;
      else if (name === 'disabled') node.disabled = Boolean(value);
      else if (name === 'open') node.open = Boolean(value);
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

  function iconButton(document, attributes, iconClass, label) {
    const button = createNode(document, 'button', {
      type: 'button',
      class: 'ws-icon-action',
      'aria-label': label,
      title: label,
      ...attributes,
    });
    button.append(createNode(document, 'i', { class: `fas ${iconClass}`, 'aria-hidden': 'true' }));
    return button;
  }

  function formatClock(seconds) {
    const whole = Math.max(0, Math.round(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }

  /* ---- shortcut descriptors (mirrors the backend canonical form) ---- */

  function validateDescriptor(descriptor) {
    if (descriptor === 'Escape') return { ok: false, error: 'Escape is reserved for closing dialogs.' };
    if (typeof descriptor !== 'string' || !descriptor) {
      return { ok: false, error: 'Press a letter, number, arrow, or navigation key.' };
    }
    const parts = descriptor.split('+');
    const base = parts.pop();
    const orderedModifiers = parts.every((part, index) => MODIFIERS.includes(part)
      && (index === 0 || MODIFIERS.indexOf(part) > MODIFIERS.indexOf(parts[index - 1])));
    if (!BASE_KEY.test(base) || !orderedModifiers) {
      return { ok: false, error: 'Press a letter, number, arrow, or navigation key.' };
    }
    if (BROWSER_RESERVED.test(descriptor)
      || ((parts.includes('Alt') || parts.includes('Meta')) && /^Arrow(?:Left|Right)$/.test(base))) {
      return { ok: false, error: 'That shortcut is reserved by the browser.' };
    }
    return { ok: true };
  }

  function validateShortcuts(value) {
    if (!isPlainObject(value)) return { ok: false, error: 'Shortcut settings must be an object.' };
    const seen = new Map();
    for (const { id, label } of SHORTCUT_ACTIONS) {
      const descriptor = value[id];
      if (typeof descriptor !== 'string') return { ok: false, error: `${label} needs one shortcut.` };
      const result = validateDescriptor(descriptor);
      if (!result.ok) return result;
      if (seen.has(descriptor)) return { ok: false, error: `${descriptor} is already assigned to ${seen.get(descriptor)}.` };
      seen.set(descriptor, label);
    }
    return { ok: true };
  }

  function normalizeSettings(response) {
    const source = isPlainObject(response?.shortcuts) ? response.shortcuts : {};
    const shortcuts = {};
    for (const { id } of SHORTCUT_ACTIONS) {
      const candidate = source[id];
      shortcuts[id] = typeof candidate === 'string' && validateDescriptor(candidate).ok ? candidate : DEFAULT_SHORTCUTS[id];
    }
    const preferences = {};
    if (isPlainObject(response?.preferences)) {
      for (const [key, value] of Object.entries(response.preferences)) {
        if (typeof value === 'boolean' || typeof value === 'string') preferences[key] = value;
      }
    }
    return {
      shortcuts: validateShortcuts(shortcuts).ok ? shortcuts : { ...DEFAULT_SHORTCUTS },
      preferences,
    };
  }

  function descriptorFromEvent(event) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event?.key)) return null;
    const code = event?.code || (event?.key === ' ' ? 'Space' : event?.key);
    if (!code) return null;
    const held = { Control: event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey, Meta: event.metaKey };
    const prefix = MODIFIERS.filter(modifier => held[modifier]).join('+');
    return `${prefix ? `${prefix}+` : ''}${code}`;
  }

  function actionForEvent(event, shortcuts) {
    const descriptor = descriptorFromEvent(event);
    if (!descriptor) return null;
    for (const { id } of SHORTCUT_ACTIONS) if (shortcuts[id] === descriptor) return id;
    return null;
  }

  function formatDescriptor(descriptor) {
    const names = {
      ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
      Space: 'Space', Control: 'Ctrl', Meta: 'Cmd', Alt: 'Alt', Shift: 'Shift',
    };
    return String(descriptor || '').split('+')
      .map(part => names[part] || part.replace(/^Key/, '').replace(/^Digit/, ''))
      .join(' + ');
  }

  const ACTIVATION_KEYS = new Set(['Space', 'Enter']);
  const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"]';
  const ARROW_OWNERS = '[role="tab"], [role="tablist"], [role="listbox"], [role="option"], [role="menu"], [role="menubar"], [role="menuitem"], [role="radiogroup"], [role="radio"], [role="slider"], [role="tree"], [role="grid"]';

  function keyCode(event) {
    if (!event) return '';
    if (event.code) return event.code;
    if (event.key === ' ') return 'Space';
    return String(event.key || '');
  }

  function closestMatch(target, selector) {
    if (!target || typeof target !== 'object') return null;
    if (typeof target.closest === 'function') return target.closest(selector);
    return typeof target.matches === 'function' && target.matches(selector) ? target : null;
  }

  /* Shortcut keys never fire from text entry, from the activation keys of any
     activatable control, from the arrow keys of a widget that owns arrows,
     or from any dialog other than the Studio itself. Focus usually rests on
     a Studio button, so letters and arrows there still reach the presenter. */
  function isTextEntryTarget(target, event = null) {
    if (!target || typeof target !== 'object') return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return true;
    if (target.isContentEditable === true) return true;
    const editable = typeof target.getAttribute === 'function' ? target.getAttribute('contenteditable') : null;
    if (editable !== null && editable !== undefined && editable !== 'false') return true;
    const code = keyCode(event);
    if (!event && tag === 'BUTTON') return true;
    if (ACTIVATION_KEYS.has(code) && (tag === 'BUTTON' || closestMatch(target, ACTIVATABLE))) return true;
    if (NAVIGATION_KEYS.has(code) && closestMatch(target, ARROW_OWNERS)) return true;
    const dialog = closestMatch(target, 'dialog, [role="dialog"], [role="alertdialog"]');
    return Boolean(dialog && dialog.id !== 'webinarStudioModal');
  }

  function normalizeNotes(value) {
    if (!Array.isArray(value)) throw new TypeError('Presenter notes must be an array');
    return value.reduce((notes, row) => {
      const id = positiveInteger(row?.id);
      const slideId = typeof row?.slideId === 'string' ? row.slideId : '';
      const body = typeof row?.body === 'string' ? row.body : '';
      if (!id || !slideId || !body) return notes;
      notes.push({ id, slideId, body });
      return notes;
    }, []);
  }

  function normalizeNoteBody(value) {
    const body = String(value ?? '').trim();
    if (!body) return { error: 'Type a note before saving it.' };
    if (new TextEncoder().encode(body).length > MAX_NOTE_BYTES) return { error: 'Notes are limited to 10,000 bytes.' };
    return { body };
  }

  function createPresenterController({
    document,
    api,
    confirm = async () => true,
    preview = null,
    bridge = null,
    keyTarget = null,
    now = () => Date.now(),
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
  } = {}) {
    required(document && typeof document.createElement === 'function', 'Presenter document is required');
    required(api, 'Presenter API is required');
    required(typeof confirm === 'function', 'Presenter confirmation function is required');

    let context = null;
    let active = false;
    let destroyed = false;
    let contextGeneration = 0;
    let index = 0;
    let timer = { startedAt: null, slideAt: null, interval: null };
    let animation = { current: 0, total: 0, playing: false };
    let annotationOn = false;
    let fullscreenOn = false;
    let navHidden = false;
    let overlays = new Map();
    let calculators = new Map();
    let explicitConnection = null;
    let notes = [];
    let notesLoaded = false;
    let draftNoteText = '';
    let editingNoteId = null;
    let editingNoteText = '';
    let saved = { shortcuts: { ...DEFAULT_SHORTCUTS }, preferences: {} };
    let draft = { ...DEFAULT_SHORTCUTS };
    let capture = null;
    let shortcutStatus = '';
    let shortcutStatusState = '';
    let savingSettings = false;
    let errorMessage = '';
    let statusMessage = '';
    let previewedSlideId = null;
    let previewStatus = '';
    let previewGeneration = 0;
    let keyListenerAttached = false;
    let shortcutsOpen = false;
    let renderedAudienceStatus = null;

    /* ---- state helpers ---- */

    function state() {
      return typeof context?.getState === 'function' ? context.getState() : null;
    }

    function slides() {
      const current = state();
      if (!current?.slideOrder) return [];
      return current.slideOrder.map(id => current.slidesById[id]).filter(Boolean);
    }

    function clampIndex(value) {
      const total = slides().length;
      const number = Number(value);
      if (!Number.isSafeInteger(number) || total === 0) return 0;
      return Math.max(0, Math.min(total - 1, number));
    }

    function currentSlide() {
      return slides()[clampIndex(index)] || null;
    }

    function nextSlide() {
      return slides()[clampIndex(index) + 1] || null;
    }

    function targetBefore(position) {
      return slides().slice(0, position).reduce((total, slide) => total + (Number(slide.targetSeconds) || 0), 0);
    }

    function totalTarget() {
      return targetBefore(slides().length);
    }

    const CONNECTION_STATES = ['idle', 'connecting', 'connected', 'disconnected'];

    function connection() {
      if (!bridge) return 'offline';
      let reported = null;
      try { reported = typeof bridge.status === 'function' ? bridge.status() : null; } catch { reported = null; }
      if (CONNECTION_STATES.includes(reported)) return reported;
      return CONNECTION_STATES.includes(explicitConnection) ? explicitConnection : 'idle';
    }

    /* Audience control is remote only once a launch has been attempted. Before
       that the presenter navigates locally so the deck can be rehearsed. */
    function audienceIsRemote() {
      const status = connection();
      return status === 'connected' || status === 'connecting' || status === 'disconnected';
    }

    function operation() {
      return { generation: contextGeneration, webinarId: context?.webinarId };
    }

    function operationIsCurrent(started) {
      return active && !destroyed && started.generation === contextGeneration;
    }

    function operationError(error, action) {
      const status = Number(error?.status || error?.statusCode || error?.response?.status);
      if (status === 403) return `${action} was denied. Your access may have changed.`;
      if (status === 404) return `${action} could not find that record. Reload the webinar.`;
      return `${action} was not saved. Your text is still here; try again.`;
    }

    /* ---- audience control ---- */

    function sendControl(type, payload = {}) {
      if (!bridge || typeof bridge.sendControl !== 'function') return true;
      let delivered = false;
      try { delivered = bridge.sendControl(type, payload) === true; } catch { delivered = false; }
      if (!delivered) {
        statusMessage = 'The audience window is not connected. Reconnect to send controls.';
        renderStatus();
      }
      return delivered;
    }

    function goToIndex(nextIndex, { control = null, payload = {} } = {}) {
      const target = clampIndex(nextIndex);
      if (control && audienceIsRemote() && !sendControl(control, payload)) return false;
      if (target !== clampIndex(index)) timer.slideAt = now();
      index = target;
      render();
      return true;
    }

    function goNext() {
      if (clampIndex(index) >= slides().length - 1) return false;
      return goToIndex(index + 1, { control: 'next' });
    }

    function goPrevious() {
      if (clampIndex(index) <= 0) return false;
      return goToIndex(index - 1, { control: 'previous' });
    }

    function animationCommand(type) {
      return deliver(`animation-${type}`, {});
    }

    function deliver(type, payload) {
      return !audienceIsRemote() || sendControl(type, payload);
    }

    function toggleDrawing() {
      const next = !annotationOn;
      if (!deliver('annotation-command', { on: next })) return false;
      annotationOn = next;
      renderControls();
      return true;
    }

    function toggleFullscreen() {
      const next = !fullscreenOn;
      if (!deliver('fullscreen-request', { on: next })) return false;
      fullscreenOn = next;
      renderControls();
      return true;
    }

    function toggleNavigation() {
      const next = !navHidden;
      if (!deliver('nav-visibility', { hidden: next })) return false;
      navHidden = next;
      renderControls();
      return true;
    }

    function toggleSupported(kind, id) {
      const map = kind === 'overlay' ? overlays : calculators;
      if (!map.has(id)) return false;
      const next = !map.get(id);
      if (!deliver(`supported-${kind}-state`, { id, visible: next })) return false;
      map.set(id, next);
      renderControls();
      return true;
    }

    /* Audience acknowledgements are already validated by the bridge, but every
       value is re-checked here so a malformed payload can only be ignored. */
    function applyAudienceState(message) {
      if (!isPlainObject(message) || typeof message.type !== 'string') return false;
      const payload = isPlainObject(message.payload) ? message.payload : {};
      switch (message.type) {
        case 'slide-state': {
          const total = slides().length;
          const nextIndex = Number(payload.index);
          if (!Number.isSafeInteger(nextIndex) || nextIndex < 0 || nextIndex >= total) return false;
          if (nextIndex !== clampIndex(index)) timer.slideAt = now();
          index = nextIndex;
          render();
          return true;
        }
        case 'animation-state': {
          const total = Number(payload.total);
          const current = Number(payload.current);
          if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(current) || current < 0 || current > total) return false;
          animation = { current, total, playing: payload.playing === true && current < total };
          updateAnimationControls();
          syncAudience();
          return true;
        }
        case 'annotation-state':
          if (typeof payload.on !== 'boolean') return false;
          annotationOn = payload.on;
          renderControls();
          return true;
        case 'fullscreen-state':
          if (typeof payload.on !== 'boolean') return false;
          fullscreenOn = payload.on;
          renderControls();
          return true;
        case 'nav-state':
          if (typeof payload.hidden !== 'boolean') return false;
          navHidden = payload.hidden;
          renderControls();
          return true;
        case 'supported-overlay-state':
        case 'supported-calculator-state': {
          if (typeof payload.id !== 'string' || !ACTION_ID.test(payload.id) || typeof payload.visible !== 'boolean') return false;
          (message.type === 'supported-overlay-state' ? overlays : calculators).set(payload.id, payload.visible);
          renderControls();
          return true;
        }
        case 'audience-error':
          if (typeof payload.code !== 'string' || !ERROR_CODE.test(payload.code)) return false;
          statusMessage = `The audience window reported ${payload.code}.`;
          renderStatus();
          return true;
        case 'audience-ready': {
          // The bridge's own status is authoritative once the audience answers.
          explicitConnection = null;
          const total = slides().length;
          const nextIndex = Number(payload.index);
          if (Number.isSafeInteger(nextIndex) && nextIndex >= 0 && nextIndex < total && nextIndex !== clampIndex(index)) {
            timer.slideAt = now();
            index = nextIndex;
            render();
          } else {
            renderAudience();
          }
          return true;
        }
        default:
          return false;
      }
    }

    function setConnection(status) {
      if (!CONNECTION_STATES.includes(status)) return false;
      explicitConnection = status;
      renderAudience();
      return true;
    }

    function syncAudience() {
      if (renderedAudienceStatus !== connection()) renderAudience();
    }

    /* ---- clocks ---- */

    function nodesFor(attribute, value) {
      const root = context?.root;
      if (!root) return [];
      const selector = value === undefined ? `[${attribute}]` : `[${attribute}="${value}"]`;
      return Array.from(root.querySelectorAll(selector) || []);
    }

    function clockNode(name) {
      return nodesFor('data-clock', name)[0] || null;
    }

    function updateClocks() {
      const slide = currentSlide();
      const target = Number(slide?.targetSeconds) || 0;
      const position = clampIndex(index);
      const running = timer.startedAt !== null;
      const elapsed = running ? (now() - timer.startedAt) / 1000 : 0;
      const onSlide = running && timer.slideAt !== null ? (now() - timer.slideAt) / 1000 : 0;
      const drift = elapsed - (targetBefore(position) + target);
      const slideNode = clockNode('slide');
      if (slideNode) {
        slideNode.textContent = formatClock(onSlide);
        slideNode.dataset.state = running && onSlide > target ? 'behind' : 'ok';
      }
      const targetNode = clockNode('target');
      if (targetNode) targetNode.textContent = formatClock(target);
      const paceNode = clockNode('pace');
      if (paceNode) {
        paceNode.textContent = running ? `${drift >= 0 ? '+' : '−'}${formatClock(Math.abs(drift))}` : '+00:00';
        paceNode.dataset.state = !running ? 'ok' : drift > 60 ? 'behind' : drift < -60 ? 'ahead' : 'ok';
      }
      const elapsedNode = clockNode('elapsed');
      if (elapsedNode) elapsedNode.textContent = formatClock(elapsed);
      const totalNode = clockNode('total');
      if (totalNode) totalNode.textContent = formatClock(totalTarget());
    }

    function stopInterval() {
      if (timer.interval !== null) clearIntervalImpl(timer.interval);
      timer.interval = null;
    }

    function armInterval() {
      stopInterval();
      timer.interval = setIntervalImpl(updateClocks, CLOCK_INTERVAL_MS);
    }

    function startTimer() {
      if (!active || destroyed) return false;
      timer.startedAt = now();
      timer.slideAt = now();
      armInterval();
      renderControls();
      updateClocks();
      return true;
    }

    function resetTimer() {
      if (!active || destroyed) return false;
      stopInterval();
      timer = { startedAt: null, slideAt: null, interval: null };
      renderControls();
      updateClocks();
      return true;
    }

    /* ---- up-next preview through the canonical sandbox ---- */

    function candidateFor(slide) {
      const current = state();
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
        assets: typeof context.getAssets === 'function' ? context.getAssets() : {},
        resourcePolicy: typeof context.getResourcePolicy === 'function' ? context.getResourcePolicy() : {},
      };
    }

    async function previewUpNext() {
      const slide = nextSlide() || currentSlide();
      if (!slide) return;
      if (!preview || typeof preview.boot !== 'function') {
        previewStatus = 'Preview host is not configured.';
        renderUpNext();
        return;
      }
      if (previewedSlideId === slide.id) return;
      previewedSlideId = slide.id;
      const generation = ++previewGeneration;
      const started = operation();
      previewStatus = 'Checking the up-next preview…';
      renderUpNext();
      let result;
      try { result = await preview.boot(candidateFor(slide)); } catch { result = { type: 'error' }; }
      if (!operationIsCurrent(started) || generation !== previewGeneration) return;
      if (result?.type === 'ready') {
        previewStatus = 'Up-next preview is ready.';
      } else {
        previewStatus = 'The up-next preview could not start.';
        // Do not pin the failure: the next render tries this slide again.
        previewedSlideId = null;
      }
      renderUpNext();
    }

    /* ---- notes (current user, current webinar, stable slide id) ---- */

    async function loadNotes() {
      const started = operation();
      if (!operationIsCurrent(started)) return false;
      try {
        const rows = normalizeNotes(await api.listNotes(started.webinarId));
        if (!operationIsCurrent(started)) return false;
        notes = rows;
        notesLoaded = true;
        errorMessage = '';
      } catch {
        if (!operationIsCurrent(started)) return false;
        errorMessage = 'Your notes could not load. Try again.';
      }
      renderNotes();
      return true;
    }

    async function addNote(bodyValue) {
      const started = operation();
      const slide = currentSlide();
      if (!operationIsCurrent(started) || !slide) return false;
      const normalized = normalizeNoteBody(bodyValue);
      if (normalized.error) {
        errorMessage = normalized.error;
        renderNotes();
        return false;
      }
      draftNoteText = String(bodyValue);
      try {
        const created = await api.addNote(started.webinarId, slide.id, { body: normalized.body });
        if (!operationIsCurrent(started)) return false;
        const id = positiveInteger(created?.id);
        if (!id) throw new TypeError('The server did not return a note id');
        notes = [...notes, { id, slideId: typeof created.slideId === 'string' ? created.slideId : slide.id, body: normalized.body }];
        draftNoteText = '';
        errorMessage = '';
        renderNotes();
        return true;
      } catch (error) {
        if (!operationIsCurrent(started)) return false;
        errorMessage = operationError(error, 'The note');
        renderNotes();
        return false;
      }
    }

    async function editNote(noteId, bodyValue) {
      const started = operation();
      const id = positiveInteger(noteId);
      if (!operationIsCurrent(started) || !id || !notes.some(note => note.id === id)) return false;
      const normalized = normalizeNoteBody(bodyValue);
      if (normalized.error) {
        errorMessage = normalized.error;
        renderNotes();
        return false;
      }
      editingNoteId = id;
      editingNoteText = String(bodyValue);
      try {
        await api.updateNote(started.webinarId, id, { body: normalized.body });
        if (!operationIsCurrent(started)) return false;
        notes = notes.map(note => (note.id === id ? { ...note, body: normalized.body } : note));
        editingNoteId = null;
        editingNoteText = '';
        errorMessage = '';
        renderNotes();
        return true;
      } catch (error) {
        if (!operationIsCurrent(started)) return false;
        errorMessage = operationError(error, 'The note');
        renderNotes();
        return false;
      }
    }

    async function deleteNote(noteId) {
      const started = operation();
      const id = positiveInteger(noteId);
      if (!operationIsCurrent(started) || !id || !notes.some(note => note.id === id)) return false;
      const approved = await confirm('Delete this note?', {
        title: 'Delete note',
        confirmText: 'Delete note',
        cancelText: 'Keep note',
        variant: 'danger',
      });
      if (!approved || !operationIsCurrent(started)) return false;
      try {
        await api.deleteNote(started.webinarId, id);
        if (!operationIsCurrent(started)) return false;
        notes = notes.filter(note => note.id !== id);
        if (editingNoteId === id) editingNoteId = null;
        errorMessage = '';
        renderNotes();
        return true;
      } catch (error) {
        if (!operationIsCurrent(started)) return false;
        errorMessage = operationError(error, 'The note');
        renderNotes();
        return false;
      }
    }

    /* ---- account-wide shortcuts and preferences ---- */

    async function loadSettings() {
      const started = operation();
      if (!operationIsCurrent(started)) return false;
      try {
        const loaded = normalizeSettings(await api.getSettings());
        if (!operationIsCurrent(started)) return false;
        saved = loaded;
        draft = { ...loaded.shortcuts };
        shortcutStatus = '';
        shortcutStatusState = '';
      } catch {
        if (!operationIsCurrent(started)) return false;
        shortcutStatus = 'Saved shortcuts could not load. Defaults are active until they do.';
        shortcutStatusState = 'error';
      }
      renderShortcuts();
      return true;
    }

    async function saveSettings(shortcuts, preferences = saved.preferences) {
      if (!active || destroyed) return { ok: false, error: 'The presenter is not active.' };
      const validation = validateShortcuts(shortcuts);
      if (!validation.ok) {
        shortcutStatus = validation.error;
        shortcutStatusState = 'error';
        renderShortcuts();
        return { ok: false, error: validation.error };
      }
      if (!isPlainObject(preferences)) {
        shortcutStatus = 'Preferences must be an object.';
        shortcutStatusState = 'error';
        renderShortcuts();
        return { ok: false, error: shortcutStatus };
      }
      const body = { shortcuts: { ...shortcuts }, preferences: { ...preferences } };
      draft = { ...shortcuts };
      savingSettings = true;
      shortcutStatus = 'Saving shortcuts to your account…';
      shortcutStatusState = 'saving';
      renderShortcuts();
      try {
        const response = await api.saveSettings(body);
        saved = normalizeSettings(isPlainObject(response) ? response : body);
        draft = { ...saved.shortcuts };
        savingSettings = false;
        shortcutStatus = 'Saved. These shortcuts follow your account across every webinar.';
        shortcutStatusState = 'saved';
        renderShortcuts();
        return { ok: true, settings: saved };
      } catch (error) {
        savingSettings = false;
        shortcutStatus = 'Settings were not saved. Your changes are still here.';
        shortcutStatusState = 'error';
        renderShortcuts();
        throw error;
      }
    }

    function beginCapture(actionId) {
      if (!LABELS.has(actionId)) return false;
      capture = { action: actionId };
      shortcutStatus = `Press a key for ${LABELS.get(actionId)}.`;
      shortcutStatusState = 'listening';
      renderShortcuts();
      return true;
    }

    function completeCapture(event) {
      const action = capture.action;
      const descriptor = descriptorFromEvent(event);
      if (!descriptor) return;
      const descriptorResult = validateDescriptor(descriptor);
      capture = null;
      if (!descriptorResult.ok) {
        shortcutStatus = descriptorResult.error;
        shortcutStatusState = 'error';
        renderShortcuts();
        return;
      }
      const candidate = { ...draft, [action]: descriptor };
      const profileResult = validateShortcuts(candidate);
      if (!profileResult.ok) {
        shortcutStatus = profileResult.error;
        shortcutStatusState = 'error';
        renderShortcuts();
        return;
      }
      draft = candidate;
      shortcutStatus = 'Shortcut updated. Save shortcuts to keep it.';
      shortcutStatusState = '';
      renderShortcuts();
    }

    function resetDraft() {
      draft = { ...DEFAULT_SHORTCUTS };
      capture = null;
      shortcutStatus = 'Defaults restored. Save shortcuts to keep them.';
      shortcutStatusState = '';
      renderShortcuts();
    }

    /* ---- keyboard ---- */

    function cancelCapture() {
      capture = null;
      shortcutStatus = 'Shortcut capture cancelled.';
      shortcutStatusState = '';
      renderShortcuts();
    }

    function handleKeydown(event) {
      if (!active || destroyed || !event) return false;
      if (capture) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (event.key === 'Escape') cancelCapture();
        else completeCapture(event);
        return true;
      }
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target, event)) return false;
      const action = actionForEvent(event, saved.shortcuts);
      if (!action) return false;
      event.preventDefault?.();
      switch (action) {
        case 'previousSlide': goPrevious(); break;
        case 'nextSlide': goNext(); break;
        case 'animationPrevious': animationCommand('back'); break;
        case 'animationNext': animationCommand('forward'); break;
        case 'animationPlay': animationCommand('play'); break;
        case 'animationPause': animationCommand('pause'); break;
        case 'toggleDrawing': toggleDrawing(); break;
        case 'toggleFullscreen': toggleFullscreen(); break;
        default: return false;
      }
      return true;
    }

    /* Capture phase, so a key capture in progress is settled before any other
       document handler (the Studio's own Escape-to-close included) sees it. */
    function attachKeys() {
      if (keyListenerAttached || !keyTarget || typeof keyTarget.addEventListener !== 'function') return;
      keyTarget.addEventListener('keydown', handleKeydown, true);
      keyListenerAttached = true;
    }

    function detachKeys() {
      if (!keyListenerAttached) return;
      keyTarget.removeEventListener('keydown', handleKeydown, true);
      keyListenerAttached = false;
    }

    /* ---- rendering ---- */

    function renderStatus() {
      const errorNode = nodesFor('data-presenter-error')[0];
      if (errorNode) errorNode.textContent = errorMessage;
      const statusNode = nodesFor('data-presenter-status')[0];
      if (statusNode) statusNode.textContent = statusMessage;
    }

    function buildHeader() {
      const slide = currentSlide();
      const header = createNode(document, 'header', { class: 'ws-presenter-header' });
      const clocks = createNode(document, 'div', { class: 'ws-presenter-clocks', role: 'group', 'aria-label': 'Presentation clocks' });
      for (const [name, label] of [['slide', 'Slide'], ['target', 'Target'], ['pace', 'Pace'], ['elapsed', 'Elapsed']]) {
        const clock = createNode(document, 'div', { class: 'ws-presenter-clock' });
        append(clock,
          createNode(document, 'span', { class: 'ws-presenter-clock-label' }, label),
          createNode(document, 'span', { class: 'ws-presenter-clock-value', 'data-clock': name, 'data-state': 'ok' }, '00:00'));
        if (name === 'elapsed') {
          append(clock, createNode(document, 'span', { class: 'ws-presenter-clock-total' }, ' / '),
            createNode(document, 'span', { class: 'ws-presenter-clock-total', 'data-clock': 'total' }, formatClock(totalTarget())));
        }
        clocks.append(clock);
      }
      const summary = createNode(document, 'div', { class: 'ws-presenter-summary' });
      append(summary,
        createNode(document, 'div', { class: 'ws-presenter-position', 'data-position': '' }, `${clampIndex(index) + 1} / ${slides().length}`),
        createNode(document, 'h3', { class: 'ws-presenter-title', 'data-slide-title': '' }, slide?.title || 'No slides'),
      );
      append(header, clocks, summary);
      return header;
    }

    function buildSharedNotes() {
      const slide = currentSlide();
      const section = createNode(document, 'section', { class: 'ws-settings-section ws-presenter-shared' });
      append(section,
        createNode(document, 'h4', {}, 'Speaker notes'),
        createNode(document, 'p', { class: 'ws-presenter-shared-notes', 'data-shared-notes': '' }, slide?.speakerNotes?.trim() ? slide.speakerNotes : 'No shared speaker notes for this slide.'));
      return section;
    }

    function buildUpNext() {
      const upcoming = nextSlide();
      const section = createNode(document, 'section', { class: 'ws-settings-section ws-presenter-up-next', 'data-up-next': '' });
      append(section,
        createNode(document, 'h4', {}, 'Up next'),
        createNode(document, 'p', { class: 'ws-presenter-up-next-title', 'data-up-next-title': '' }, upcoming ? upcoming.title : 'End — open Q&A'),
        createNode(document, 'p', { class: 'ws-presenter-up-next-status', role: 'status', 'data-up-next-status': '' }, previewStatus));
      return section;
    }

    function renderUpNext() {
      const title = nodesFor('data-up-next-title')[0];
      if (title) {
        const upcoming = nextSlide();
        title.textContent = upcoming ? upcoming.title : 'End — open Q&A';
      }
      const status = nodesFor('data-up-next-status')[0];
      if (status) status.textContent = previewStatus;
    }

    function buildAudience() {
      const status = connection();
      const section = createNode(document, 'section', { class: 'ws-settings-section ws-presenter-audience', 'data-audience': '' });
      renderedAudienceStatus = status;
      const copy = {
        offline: 'Audience window: not connected. Rehearsal mode controls only this view.',
        idle: 'Audience window: not connected.',
        connecting: 'Audience window: connecting…',
        connected: 'Audience window: connected.',
        disconnected: 'Audience window: disconnected. Reconnect to resume sending controls.',
      }[status];
      append(section, createNode(document, 'p', { 'data-audience-status': '', 'data-state': status, role: 'status' }, copy));
      if (bridge && status === 'idle' && typeof bridge.connect === 'function') {
        const connect = createNode(document, 'button', { type: 'button', class: 'ws-action-button', 'data-audience-connect': '' }, 'Launch audience');
        connect.addEventListener('click', () => { bridge.connect(); });
        section.append(connect);
      }
      if (bridge && status === 'disconnected' && typeof bridge.reconnect === 'function') {
        const reconnect = createNode(document, 'button', { type: 'button', class: 'ws-action-button', 'data-audience-reconnect': '' }, 'Reconnect audience');
        reconnect.addEventListener('click', () => { bridge.reconnect(); });
        section.append(reconnect);
      }
      return section;
    }

    function renderAudience() {
      const existing = nodesFor('data-audience')[0];
      if (!existing?.parentElement || typeof existing.parentElement.replaceChild !== 'function') { render(); return; }
      existing.parentElement.replaceChild(buildAudience(), existing);
    }

    /* Animation acknowledgements arrive often while a build plays; update the
       existing buttons so keyboard focus on them survives. */
    function updateAnimationControls() {
      const buttons = nodesFor('data-animation');
      const status = nodesFor('data-animation-status')[0];
      if (buttons.length !== 4 || !status) { renderControls(); return; }
      const disabled = {
        back: animation.total === 0 || animation.current === 0,
        forward: animation.total === 0 || animation.current >= animation.total,
        play: animation.total === 0 || animation.playing,
        pause: animation.total === 0 || !animation.playing,
      };
      for (const button of buttons) button.disabled = Boolean(disabled[button.dataset.animation]);
      status.textContent = `${animation.current} / ${animation.total}`;
    }

    function buildNotes() {
      const slide = currentSlide();
      const section = createNode(document, 'section', { class: 'ws-settings-section ws-presenter-notes', 'data-notes': '' });
      const heading = createNode(document, 'div', { class: 'ws-presenter-notes-heading' });
      append(heading, createNode(document, 'h4', {}, 'My notes — this slide'));
      const composer = createNode(document, 'div', { class: 'ws-note-add' });
      const input = createNode(document, 'textarea', {
        'data-note-input': '',
        'aria-label': 'Add a note for this slide',
        placeholder: 'Add a note for this slide…',
        rows: '3',
      });
      input.value = draftNoteText;
      const save = iconButton(document, { 'data-note-save': '' }, 'fa-floppy-disk', 'Save note');
      save.addEventListener('click', () => { void addNote(nodesFor('data-note-input')[0]?.value ?? ''); });
      append(composer, input, append(createNode(document, 'div', { class: 'ws-note-actions' }), save));
      const list = createNode(document, 'div', { class: 'ws-note-list', 'data-note-list': '' });
      const rows = slide ? notes.filter(note => note.slideId === slide.id) : [];
      if (!notesLoaded) {
        list.append(createNode(document, 'p', { class: 'ws-note-none' }, 'Loading your notes…'));
      } else if (!rows.length) {
        list.append(createNode(document, 'p', { class: 'ws-note-none' }, 'No notes yet for this slide.'));
      }
      for (const note of rows) {
        const item = createNode(document, 'article', { class: 'ws-note', 'data-note-id': note.id });
        if (editingNoteId === note.id) {
          const editor = createNode(document, 'textarea', { 'data-note-editor': '', 'aria-label': 'Edit note', rows: '3' });
          editor.value = editingNoteText;
          const actions = createNode(document, 'div', { class: 'ws-note-actions' });
          const saveEdit = iconButton(document, { 'data-note-editor-save': '' }, 'fa-check', 'Save changes');
          saveEdit.addEventListener('click', () => { void editNote(note.id, nodesFor('data-note-editor')[0]?.value ?? ''); });
          const cancel = iconButton(document, { 'data-note-editor-cancel': '' }, 'fa-xmark', 'Cancel editing');
          cancel.addEventListener('click', () => { editingNoteId = null; editingNoteText = ''; renderNotes(); });
          append(item, editor, append(actions, saveEdit, cancel));
        } else {
          const actions = createNode(document, 'div', { class: 'ws-note-actions' });
          const edit = iconButton(document, { 'data-note-edit': '' }, 'fa-pen', 'Edit note');
          edit.addEventListener('click', () => { editingNoteId = note.id; editingNoteText = note.body; renderNotes(); });
          const remove = iconButton(document, { 'data-note-delete': '', class: 'ws-icon-action is-delete' }, 'fa-trash', 'Delete note');
          remove.addEventListener('click', () => { void deleteNote(note.id); });
          append(item, append(actions, edit, remove), createNode(document, 'p', { class: 'ws-note-body', 'data-note-body': '' }, note.body));
        }
        list.append(item);
      }
      append(section, heading, composer, list);
      return section;
    }

    function renderNotes() {
      const existing = nodesFor('data-notes')[0];
      if (!existing?.parentElement || typeof existing.parentElement.replaceChild !== 'function') { render(); return; }
      existing.parentElement.replaceChild(buildNotes(), existing);
      renderStatus();
    }

    function buildControls() {
      const container = createNode(document, 'section', { class: 'ws-settings-section ws-presenter-controls', 'data-controls': '' });

      const toggles = createNode(document, 'div', { class: 'ws-presenter-toggles', role: 'group', 'aria-label': 'Shared slide state' });
      const annotation = createNode(document, 'button', {
        type: 'button', 'data-annotation-toggle': '', 'aria-pressed': String(annotationOn), class: annotationOn ? 'on' : '',
      }, `Draw: ${annotationOn ? 'On' : 'Off'}`);
      annotation.addEventListener('click', () => { toggleDrawing(); });
      const fullscreen = createNode(document, 'button', {
        type: 'button', 'data-fullscreen-toggle': '', 'aria-pressed': String(fullscreenOn), class: fullscreenOn ? 'on' : '',
      }, `Fullscreen slide: ${fullscreenOn ? 'On' : 'Off'}`);
      fullscreen.addEventListener('click', () => { toggleFullscreen(); });
      const navVisibility = createNode(document, 'button', { type: 'button', 'data-nav-visibility': '', class: navHidden ? 'on' : '' },
        `Slide navigation: ${navHidden ? 'Hidden' : 'Shown'}`);
      navVisibility.addEventListener('click', () => { toggleNavigation(); });
      append(toggles, annotation, fullscreen, navVisibility);
      for (const [kind, map] of [['overlay', overlays], ['calculator', calculators]]) {
        for (const [id, visible] of map) {
          const button = createNode(document, 'button', {
            type: 'button', [`data-${kind}-toggle`]: id, 'aria-pressed': String(visible), class: visible ? 'on' : '',
          }, `${kind === 'overlay' ? 'Overlay' : 'Calculator'} ${id}: ${visible ? 'Shown' : 'Hidden'}`);
          button.addEventListener('click', () => { toggleSupported(kind, id); });
          toggles.append(button);
        }
      }

      const animationRow = createNode(document, 'div', { class: 'ws-presenter-animation', role: 'group', 'aria-label': 'Animation controls', 'data-animation-row': '' });
      const buttons = [
        ['back', 'fa-backward-step', 'Previous animation build', animation.total === 0 || animation.current === 0],
        ['forward', 'fa-forward-step', 'Next animation build', animation.total === 0 || animation.current >= animation.total],
        ['play', 'fa-play', 'Play animations', animation.total === 0 || animation.playing],
        ['pause', 'fa-pause', 'Pause animations', animation.total === 0 || !animation.playing],
      ];
      for (const [type, icon, label, disabled] of buttons) {
        const button = iconButton(document, { 'data-animation': type, disabled }, icon, label);
        button.addEventListener('click', () => { animationCommand(type); });
        animationRow.append(button);
      }
      animationRow.append(createNode(document, 'output', { class: 'ws-presenter-animation-status', 'data-animation-status': '', 'aria-live': 'polite' }, `${animation.current} / ${animation.total}`));

      const navRow = createNode(document, 'div', { class: 'ws-presenter-nav', role: 'group', 'aria-label': 'Slide navigation', 'data-nav-row': '' });
      const previous = createNode(document, 'button', { type: 'button', 'data-nav': 'previous' }, '‹ Back');
      previous.addEventListener('click', () => { goPrevious(); });
      const next = createNode(document, 'button', { type: 'button', 'data-nav': 'next' }, 'Next ›');
      next.addEventListener('click', () => { goNext(); });
      const start = createNode(document, 'button', { type: 'button', 'data-timer-start': '' }, timer.startedAt === null ? 'Start timer' : 'Restart timer');
      start.addEventListener('click', () => { startTimer(); });
      const reset = createNode(document, 'button', { type: 'button', 'data-timer-reset': '', disabled: timer.startedAt === null }, 'Reset');
      reset.addEventListener('click', () => { resetTimer(); });
      append(navRow, previous, next, start, reset);

      append(container, toggles, animationRow, navRow);
      return container;
    }

    function renderControls() {
      const existing = nodesFor('data-controls')[0];
      if (!existing?.parentElement || typeof existing.parentElement.replaceChild !== 'function') { render(); return; }
      existing.parentElement.replaceChild(buildControls(), existing);
    }

    function buildShortcuts() {
      const section = createNode(document, 'details', {
        class: 'ws-settings-section ws-presenter-shortcuts',
        'data-shortcut-settings': '',
        open: shortcutsOpen || Boolean(capture) || shortcutStatusState === 'error',
      });
      section.addEventListener('toggle', () => { shortcutsOpen = Boolean(section.open); });
      append(section, createNode(document, 'summary', {}, 'Keyboard shortcuts'));
      append(section, createNode(document, 'p', {}, 'These shortcuts follow your account across every webinar.'));
      const list = createNode(document, 'div', { class: 'ws-shortcut-list' });
      for (const { id, label } of SHORTCUT_ACTIONS) {
        const row = createNode(document, 'div', { class: 'ws-shortcut-row', 'data-shortcut-action': id });
        const button = createNode(document, 'button', {
          type: 'button',
          class: capture?.action === id ? 'ws-key-capture is-listening' : 'ws-key-capture',
          'data-shortcut-capture': id,
          'aria-label': `Change ${label} shortcut`,
        }, capture?.action === id ? '…' : formatDescriptor(draft[id]));
        button.addEventListener('click', () => { beginCapture(id); });
        append(row, createNode(document, 'span', { class: 'ws-shortcut-name' }, label), button);
        list.append(row);
      }
      const status = createNode(document, 'p', { class: 'ws-shortcut-status', role: 'status', 'aria-live': 'polite', 'data-shortcut-status': '', 'data-state': shortcutStatusState }, shortcutStatus);
      const actions = createNode(document, 'div', { class: 'ws-form-actions' });
      const reset = createNode(document, 'button', { type: 'button', class: 'ws-form-cancel', 'data-shortcut-reset': '' }, 'Reset defaults');
      reset.addEventListener('click', () => { resetDraft(); });
      const save = createNode(document, 'button', { type: 'button', class: 'ws-form-create', 'data-shortcut-save': '', disabled: savingSettings }, 'Save shortcuts');
      save.addEventListener('click', () => { saveSettings({ ...draft }, saved.preferences).catch(() => {}); });
      append(actions, reset, save);
      append(section, list, status, actions);
      return section;
    }

    function renderShortcuts() {
      const existing = nodesFor('data-shortcut-settings')[0];
      if (!existing?.parentElement || typeof existing.parentElement.replaceChild !== 'function') { render(); return; }
      existing.parentElement.replaceChild(buildShortcuts(), existing);
    }

    function render() {
      if (!active || destroyed || !context?.root) return false;
      const panel = createNode(document, 'section', { class: 'ws-presenter', 'data-presenter-panel': '' });
      panel.addEventListener('input', event => {
        if (event.target?.dataset?.noteInput !== undefined) draftNoteText = String(event.target.value ?? '');
        if (event.target?.dataset?.noteEditor !== undefined) editingNoteText = String(event.target.value ?? '');
      });
      append(panel,
        buildHeader(),
        createNode(document, 'p', { class: 'ws-form-error', role: 'alert', 'data-presenter-error': '' }, errorMessage),
        createNode(document, 'p', { class: 'ws-presenter-status', role: 'status', 'data-presenter-status': '' }, statusMessage),
        buildSharedNotes(),
        buildUpNext(),
        buildAudience(),
        buildNotes(),
        buildControls(),
        buildShortcuts());
      context.root.replaceChildren(panel);
      updateClocks();
      void previewUpNext();
      return true;
    }

    /* ---- lifecycle ---- */

    async function renderPresenterPanel(nextContext) {
      if (destroyed) return undefined;
      required(nextContext?.root && typeof nextContext.root.replaceChildren === 'function', 'Presenter root is required');
      required(positiveInteger(nextContext.webinarId), 'A webinar id is required');
      required(typeof nextContext.getState === 'function', 'Presenter state access is required');
      const sameWebinar = context && Number(context.webinarId) === Number(nextContext.webinarId);
      if (sameWebinar && active) {
        // A re-render of the active webinar keeps in-flight work and drafts.
        context = nextContext;
        render();
        return undefined;
      }
      contextGeneration += 1;
      context = nextContext;
      active = true;
      if (!sameWebinar) {
        stopInterval();
        timer = { startedAt: null, slideAt: null, interval: null };
        capture = null;
        saved = { shortcuts: { ...DEFAULT_SHORTCUTS }, preferences: {} };
        draft = { ...DEFAULT_SHORTCUTS };
        shortcutStatus = '';
        shortcutStatusState = '';
      }
      if (!sameWebinar) {
        index = 0;
        notes = [];
        notesLoaded = false;
        editingNoteId = null;
        editingNoteText = '';
        draftNoteText = '';
        overlays = new Map();
        calculators = new Map();
        errorMessage = '';
        statusMessage = '';
        previewedSlideId = null;
        previewStatus = '';
      }
      index = clampIndex(index);
      attachKeys();
      render();
      if (timer.startedAt !== null) armInterval();
      const draftIsClean = capture === null && SHORTCUT_ACTIONS.every(({ id }) => draft[id] === saved.shortcuts[id]);
      await Promise.all([loadNotes(), !sameWebinar || draftIsClean ? loadSettings() : Promise.resolve(false)]);
      return undefined;
    }

    function deactivate() {
      contextGeneration += 1;
      previewGeneration += 1;
      active = false;
      capture = null;
      // The clocks keep their origin so a tab visit mid-talk does not reset them.
      stopInterval();
      detachKeys();
      previewedSlideId = null;
      renderedAudienceStatus = null;
      context?.root?.replaceChildren?.();
    }

    function destroy() {
      if (destroyed) return;
      deactivate();
      destroyed = true;
      timer = { startedAt: null, slideAt: null, interval: null };
      context = null;
      notes = [];
    }

    return Object.freeze({
      renderPresenterPanel,
      deactivate,
      destroy,
      applyAudienceState,
      setConnection,
      handleKeydown,
      startTimer,
      resetTimer,
      goNext,
      goPrevious,
      goToIndex: nextIndex => goToIndex(nextIndex, { control: 'goto', payload: { index: clampIndex(nextIndex) } }),
      animationBack: () => animationCommand('back'),
      animationForward: () => animationCommand('forward'),
      animationPlay: () => animationCommand('play'),
      animationPause: () => animationCommand('pause'),
      toggleDrawing,
      toggleFullscreen,
      loadNotes,
      addNote,
      editNote,
      deleteNote,
      loadSettings,
      saveSettings,
      currentSlideId: () => currentSlide()?.id ?? null,
    });
  }

  return Object.freeze({
    createPresenterController,
    SHORTCUT_ACTIONS,
    DEFAULT_SHORTCUTS,
    validateDescriptor,
    validateShortcuts,
    normalizeSettings,
    normalizeNotes,
    descriptorFromEvent,
    actionForEvent,
    formatDescriptor,
    isTextEntryTarget,
  });
}));
