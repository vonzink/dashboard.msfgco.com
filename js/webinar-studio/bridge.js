(function initializeWebinarStudioBridge(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioBridge = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioBridgeApi() {
  'use strict';

  /* ==========================================================================
     AUDIENCE BRIDGE — Dashboard side of the two-window control contract.
     Opens one named audience window, keeps its exact WindowProxy, performs a
     versioned handshake bound to a fresh in-memory nonce, sends only fixed
     control types with scalar payloads to exactly the configured origin, and
     accepts acknowledgements only from that window and origin with that
     nonce. Heartbeats every five seconds; three missed acknowledgements mean
     disconnected until an explicit reconnect. Nothing here touches storage,
     tokens, or Dashboard data.

     The schema below is a structural copy of the audience shell's
     control-protocol.js; both test suites pin the same shape.
     ======================================================================== */

  const PROTOCOL_VERSION = 1;
  const INIT_TYPE = 'presenter-init';
  const WINDOW_NAME = 'MSFGWebinarAudience';
  const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
  const ACTION_ID = /^[a-z][a-z0-9-]{0,63}$/;
  const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
  const MAX_INDEX = 100_000;
  const MAX_ANIMATION_ITEMS = 10_000;
  const ANNOTATION_TOOLS = new Set(['pen', 'highlight', 'box', 'text', 'laser']);
  const ANNOTATION_COLORS = new Set(['green', 'yellow', 'blue', 'red', 'black', 'white']);
  const STATUSES = Object.freeze(['idle', 'connecting', 'connected', 'disconnected']);

  function dataProperties(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    }
    return { descriptors, keys };
  }

  function exactRecord(value, required, optional = []) {
    const data = dataProperties(value);
    if (!data) return null;
    const allowed = new Set([...required, ...optional]);
    if (data.keys.some(key => !allowed.has(key))) return null;
    if (required.some(key => !Object.hasOwn(data.descriptors, key))) return null;
    const record = {};
    for (const key of data.keys) record[key] = data.descriptors[key].value;
    return record;
  }

  const boundedIndex = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_INDEX;
  const isBoolean = value => typeof value === 'boolean';
  const isActionId = value => typeof value === 'string' && ACTION_ID.test(value);

  const emptyPayload = value => (exactRecord(value, []) ? {} : null);
  const indexPayload = value => {
    const record = exactRecord(value, ['index']);
    return record && boundedIndex(record.index) ? { index: record.index } : null;
  };
  const positionPayload = value => {
    const record = exactRecord(value, ['index', 'total']);
    if (!record || !boundedIndex(record.index) || !Number.isSafeInteger(record.total)
      || record.total < 1 || record.total > MAX_INDEX || record.index >= record.total) return null;
    return { index: record.index, total: record.total };
  };
  const annotationPayload = value => {
    const record = exactRecord(value, [], ['on', 'tool', 'color', 'autoOff', 'toolbar', 'undo', 'redo', 'clear']);
    if (!record || Object.keys(record).length === 0) return null;
    const payload = {};
    for (const [key, item] of Object.entries(record)) {
      if (['on', 'autoOff', 'toolbar'].includes(key)) { if (!isBoolean(item)) return null; }
      else if (key === 'tool') { if (!ANNOTATION_TOOLS.has(item)) return null; }
      else if (key === 'color') { if (!ANNOTATION_COLORS.has(item)) return null; }
      else if (item !== true) return null;
      payload[key] = item;
    }
    return payload;
  };
  const supportedPayload = value => {
    const record = exactRecord(value, ['id', 'visible']);
    return record && isActionId(record.id) && isBoolean(record.visible) ? { id: record.id, visible: record.visible } : null;
  };
  const flagPayload = key => value => {
    const record = exactRecord(value, [key]);
    return record && isBoolean(record[key]) ? { [key]: record[key] } : null;
  };
  const animationPayload = value => {
    const record = exactRecord(value, ['current', 'total', 'playing']);
    if (!record || !Number.isSafeInteger(record.current) || !Number.isSafeInteger(record.total)
      || record.current < 0 || record.total < 0 || record.current > record.total
      || record.total > MAX_ANIMATION_ITEMS || !isBoolean(record.playing)) return null;
    return { current: record.current, total: record.total, playing: record.playing };
  };
  const errorPayload = value => {
    const record = exactRecord(value, ['code']);
    return record && typeof record.code === 'string' && ERROR_CODE.test(record.code) ? { code: record.code } : null;
  };

  const CONTROL_PAYLOADS = Object.freeze({
    goto: indexPayload,
    next: emptyPayload,
    previous: emptyPayload,
    'animation-back': emptyPayload,
    'animation-forward': emptyPayload,
    'animation-play': emptyPayload,
    'animation-pause': emptyPayload,
    'annotation-command': annotationPayload,
    'supported-overlay-state': supportedPayload,
    'supported-calculator-state': supportedPayload,
    'fullscreen-request': flagPayload('on'),
    'nav-visibility': flagPayload('hidden'),
    ping: emptyPayload,
  });

  const AUDIENCE_PAYLOADS = Object.freeze({
    'audience-ready': positionPayload,
    'slide-state': positionPayload,
    'animation-state': animationPayload,
    'annotation-state': flagPayload('on'),
    'supported-overlay-state': supportedPayload,
    'supported-calculator-state': supportedPayload,
    'fullscreen-state': flagPayload('on'),
    'nav-state': flagPayload('hidden'),
    pong: emptyPayload,
    'audience-error': errorPayload,
  });

  function classify(data, expectedNonce, payloads) {
    try {
      if (typeof expectedNonce !== 'string' || !NONCE.test(expectedNonce)) return { ok: false, reason: 'NOT_INITIALIZED' };
      const envelope = exactRecord(data, ['v', 'nonce', 'type', 'payload']);
      if (!envelope) return { ok: false, reason: 'INVALID_MESSAGE' };
      if (envelope.v !== PROTOCOL_VERSION) return { ok: false, reason: 'WRONG_VERSION' };
      if (envelope.nonce !== expectedNonce) return { ok: false, reason: 'WRONG_NONCE' };
      if (typeof envelope.type !== 'string' || !Object.hasOwn(payloads, envelope.type)) return { ok: false, reason: 'UNKNOWN_TYPE' };
      const payload = payloads[envelope.type](envelope.payload);
      if (!payload) return { ok: false, reason: 'INVALID_PAYLOAD' };
      return { ok: true, message: { v: PROTOCOL_VERSION, nonce: expectedNonce, type: envelope.type, payload } };
    } catch {
      return { ok: false, reason: 'INVALID_MESSAGE' };
    }
  }

  const classifyControlMessage = (data, nonce) => classify(data, nonce, CONTROL_PAYLOADS);
  const classifyAudienceMessage = (data, nonce) => classify(data, nonce, AUDIENCE_PAYLOADS);
  const validateControlMessage = (data, nonce) => { const result = classifyControlMessage(data, nonce); return result.ok ? result.message : null; };
  const validateAudienceMessage = (data, nonce) => { const result = classifyAudienceMessage(data, nonce); return result.ok ? result.message : null; };

  function exactOrigin(value) {
    if (typeof value !== 'string' || value !== value.trim() || value.includes('*')) return null;
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    const localHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) return null;
    return parsed.origin;
  }

  function createAudienceBridge({
    audienceUrl,
    allowedOrigin,
    onState,
    onStatus = () => {},
    onIgnored = () => {},
    windowObject = globalThis.window,
    openWindow = (url, name) => windowObject.open(url, name),
    cryptoImpl = globalThis.crypto,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
    pingIntervalMs = 5000,
    initRetryMs = 500,
    maxInitAttempts = 40,
    inPlaceInitAttempts = 4,
    maxMissedPongs = 3,
  } = {}) {
    const origin = exactOrigin(allowedOrigin);
    if (!origin) throw new TypeError('Audience bridge origin is invalid');
    let url;
    try { url = new URL(String(audienceUrl)); } catch { throw new TypeError('Audience bridge URL is invalid'); }
    if (url.origin !== origin) throw new TypeError('Audience bridge URL must sit on the allowed origin');
    if (typeof onState !== 'function') throw new TypeError('Audience bridge needs an onState function');
    if (!windowObject || typeof windowObject.addEventListener !== 'function'
      || typeof windowObject.removeEventListener !== 'function') throw new TypeError('Audience bridge window is invalid');
    if (typeof openWindow !== 'function' || !cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') {
      throw new TypeError('Audience bridge configuration is invalid');
    }

    let audienceWindow = null;
    let nonce = null;
    let status = 'idle';
    let missedPongs = 0;
    let initAttempts = 0;
    let renavigateAfterInPlace = false;
    let initTimer = null;
    let pingTimer = null;
    let destroyed = false;

    function ignore(reason) {
      try { onIgnored(reason); } catch { /* observers cannot break the boundary */ }
    }

    function setStatus(next) {
      if (!STATUSES.includes(next) || next === status) return;
      status = next;
      try { onStatus(status); } catch { /* observers cannot break the boundary */ }
    }

    function clearTimers() {
      if (initTimer !== null) { clearTimeoutImpl(initTimer); initTimer = null; }
      if (pingTimer !== null) { clearIntervalImpl(pingTimer); pingTimer = null; }
    }

    function post(type, payload) {
      if (!audienceWindow || typeof audienceWindow.postMessage !== 'function' || !nonce) return false;
      const message = validateControlMessage({ v: PROTOCOL_VERSION, nonce, type, payload }, nonce);
      if (!message && type !== INIT_TYPE) return false;
      try {
        audienceWindow.postMessage(message || { v: PROTOCOL_VERSION, nonce, type: INIT_TYPE, payload: {} }, origin);
        return true;
      } catch {
        return false;
      }
    }

    function freshNonce() {
      let value;
      try { value = cryptoImpl.randomUUID(); } catch { value = null; }
      if (typeof value !== 'string' || !NONCE.test(value)) throw new TypeError('Audience bridge nonce is unavailable');
      return value;
    }

    function windowIsClosed() {
      try { return !audienceWindow || audienceWindow.closed === true; } catch { return true; }
    }

    function scheduleInit() {
      if (initTimer !== null) { clearTimeoutImpl(initTimer); initTimer = null; }
      if (windowIsClosed()) { disconnect(); return; }
      if (initAttempts >= maxInitAttempts) {
        setStatus('disconnected');
        return;
      }
      // A reconnect first tries the page already in the window (a reloaded
      // audience answers in place). Only when those attempts lapse is the
      // window re-navigated, once, to replace a foreign or dead page.
      if (renavigateAfterInPlace && initAttempts >= inPlaceInitAttempts) {
        renavigateAfterInPlace = false;
        if (!openAudienceWindow()) return;
      }
      initAttempts += 1;
      post(INIT_TYPE, {});
      initTimer = setTimeoutImpl(() => {
        initTimer = null;
        if (destroyed || status !== 'connecting') return;
        scheduleInit();
      }, initRetryMs);
    }

    function startHeartbeat() {
      if (pingTimer !== null) clearIntervalImpl(pingTimer);
      missedPongs = 0;
      pingTimer = setIntervalImpl(() => {
        if (destroyed || status !== 'connected') return;
        if (windowIsClosed()) { disconnect(); return; }
        missedPongs += 1;
        if (missedPongs > maxMissedPongs) { disconnect(); return; }
        post('ping', {});
      }, pingIntervalMs);
    }

    function disconnect() {
      clearTimers();
      setStatus('disconnected');
    }

    function beginHandshake() {
      let next;
      try { next = freshNonce(); } catch { return false; }
      nonce = next;
      initAttempts = 0;
      missedPongs = 0;
      clearTimers();
      setStatus('connecting');
      scheduleInit();
      return true;
    }

    /* Opening the fixed window name re-navigates an existing audience window
       to the audience URL, so a reloaded, navigated-away, or foreign page in
       that window is replaced by a fresh audience under the new nonce. */
    function openAudienceWindow() {
      let opened = null;
      try { opened = openWindow(url.href, WINDOW_NAME); } catch { opened = null; }
      if (!opened || typeof opened.postMessage !== 'function') {
        audienceWindow = null;
        const wasIdle = status === 'idle';
        setStatus('idle');
        if (wasIdle) { try { onStatus(status); } catch { /* observers cannot break the boundary */ } }
        return false;
      }
      audienceWindow = opened;
      return true;
    }

    function connect() {
      if (destroyed) return false;
      if (status === 'connected' || status === 'connecting') return true;
      renavigateAfterInPlace = false;
      if (windowIsClosed() && !openAudienceWindow()) return false;
      return beginHandshake();
    }

    function reconnect() {
      if (destroyed) return false;
      clearTimers();
      status = 'idle';
      renavigateAfterInPlace = false;
      if (windowIsClosed()) {
        if (!openAudienceWindow()) return false;
      } else {
        renavigateAfterInPlace = true;
      }
      return beginHandshake();
    }

    function receive(event) {
      if (destroyed || !audienceWindow) return;
      if (event?.origin !== origin || event?.source !== audienceWindow) { ignore('SOURCE_OR_ORIGIN'); return; }
      const result = classifyAudienceMessage(event.data, nonce);
      if (!result.ok) { ignore(result.reason); return; }
      const message = result.message;
      if (message.type === 'audience-ready') {
        // The nonce is bound to this launch, so a late answer after the init
        // budget lapsed still belongs to the window we opened.
        if ((status === 'connecting' || status === 'connected' || status === 'disconnected') && !windowIsClosed()) {
          if (initTimer !== null) { clearTimeoutImpl(initTimer); initTimer = null; }
          setStatus('connected');
          startHeartbeat();
        }
      } else if (message.type === 'pong') {
        if (status === 'connected') missedPongs = 0;
        return;
      }
      if (status !== 'connected') return;
      try { onState(message); } catch { /* observers cannot break the boundary */ }
    }

    function sendControl(type, payload = {}) {
      if (destroyed || status !== 'connected' || missedPongs > maxMissedPongs) return false;
      if (windowIsClosed()) { disconnect(); return false; }
      const message = validateControlMessage({ v: PROTOCOL_VERSION, nonce, type, payload }, nonce);
      if (!message) return false;
      try {
        audienceWindow.postMessage(message, origin);
        return true;
      } catch {
        return false;
      }
    }

    windowObject.addEventListener('message', receive);

    return Object.freeze({
      connect,
      reconnect,
      sendControl,
      status: () => status,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimers();
        windowObject.removeEventListener('message', receive);
        nonce = null;
        status = 'idle';
      },
    });
  }

  return Object.freeze({
    createAudienceBridge,
    classifyControlMessage,
    classifyAudienceMessage,
    validateControlMessage,
    validateAudienceMessage,
    PROTOCOL_VERSION,
  });
}));
