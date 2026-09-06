(function initializeWebinarStudioPreview(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioPreview = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioPreviewApi() {
  'use strict';

  const PROTOCOL_VERSION = 1;
  const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ANCHOR = /^[a-z][a-z0-9-]{0,189}$/;
  const ERROR_CODES = new Set([
    'PREVIEW_CANDIDATE_INVALID',
    'PREVIEW_COMPOSITION_FAILED',
    'PREVIEW_STARTUP_TIMEOUT',
    'SLIDE_RUNTIME_ERROR',
    'SLIDE_STARTUP_TIMEOUT',
  ]);

  function fail(message) {
    throw new TypeError(message);
  }

  function dataRecord(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is invalid`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(`${label} is invalid`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) {
      fail(`${label} contains unexpected fields`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail(`${label} is invalid`);
      }
    }
    return descriptors;
  }

  function stringValue(descriptors, key, label) {
    const value = descriptors[key].value;
    if (typeof value !== 'string') fail(`${label} must be a string`);
    return value;
  }

  function exactArray(value, label) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} is invalid`);
    const keys = Reflect.ownKeys(value);
    const expected = [...Array(value.length).keys()].map(String);
    if (keys.length !== expected.length + 1 || keys.at(-1) !== 'length'
      || expected.some((key, index) => keys[index] !== key)) fail(`${label} is invalid`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return expected.map(key => {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${label} is invalid`);
      if (typeof descriptor.value !== 'string') fail(`${label} is invalid`);
      return descriptor.value;
    });
  }

  function exactOrigin(value, label) {
    if (typeof value !== 'string' || value !== value.trim() || value.includes('*')) fail(`${label} is invalid`);
    let parsed;
    try { parsed = new URL(value); } catch { fail(`${label} is invalid`); }
    const localHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) {
      fail(`${label} is invalid`);
    }
    return parsed.origin;
  }

  function httpsUrl(value) {
    if (typeof value !== 'string' || value !== value.trim() || value.length > 4096) fail('Candidate asset URL is invalid');
    let parsed;
    try { parsed = new URL(value); } catch { fail('Candidate asset URL is invalid'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.href !== value) fail('Candidate asset URL is invalid');
    return value;
  }

  function cloneAssets(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Candidate assets are invalid');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('Candidate assets are invalid');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 10_000 || keys.some(key => typeof key !== 'string' || !UUID.test(key))) {
      fail('Candidate assets are invalid');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Candidate assets are invalid');
      result[key] = httpsUrl(descriptor.value);
    }
    return result;
  }

  function cloneCandidate(value) {
    const candidate = dataRecord(value, ['master', 'slide', 'assets', 'resourcePolicy'], 'Preview candidate');
    const master = dataRecord(candidate.master.value, ['html', 'css'], 'Candidate Master');
    const slide = dataRecord(
      candidate.slide.value,
      ['id', 'anchor', 'title', 'html', 'css', 'javascript'],
      'Candidate slide',
    );
    const resourcePolicy = dataRecord(
      candidate.resourcePolicy.value,
      ['assetOrigin', 'stylesheetOrigins', 'fontOrigins'],
      'Candidate resource policy',
    );
    const id = stringValue(slide, 'id', 'Candidate slide id');
    const anchor = stringValue(slide, 'anchor', 'Candidate slide anchor');
    if (!UUID.test(id) || !ANCHOR.test(anchor)) fail('Preview candidate slide identity is invalid');
    const assetOrigin = exactOrigin(resourcePolicy.assetOrigin.value, 'Candidate asset origin');
    if (!assetOrigin.startsWith('https://')) fail('Candidate asset origin is invalid');
    return {
      master: {
        html: stringValue(master, 'html', 'Candidate Master HTML'),
        css: stringValue(master, 'css', 'Candidate Master CSS'),
      },
      slide: {
        id,
        anchor,
        title: stringValue(slide, 'title', 'Candidate slide title'),
        html: stringValue(slide, 'html', 'Candidate slide HTML'),
        css: stringValue(slide, 'css', 'Candidate slide CSS'),
        javascript: stringValue(slide, 'javascript', 'Candidate slide JavaScript'),
      },
      assets: cloneAssets(candidate.assets.value),
      resourcePolicy: {
        assetOrigin,
        stylesheetOrigins: exactArray(resourcePolicy.stylesheetOrigins.value, 'Candidate stylesheet origins')
          .map(value => exactOrigin(value, 'Candidate stylesheet origin')),
        fontOrigins: exactArray(resourcePolicy.fontOrigins.value, 'Candidate font origins')
          .map(value => exactOrigin(value, 'Candidate font origin')),
      },
    };
  }

  function responseFor(raw, nonce) {
    let envelope;
    try { envelope = dataRecord(raw, ['v', 'nonce', 'type', 'payload'], 'Preview response'); } catch { return null; }
    if (envelope.v.value !== PROTOCOL_VERSION || envelope.nonce.value !== nonce
      || !NONCE.test(envelope.nonce.value) || typeof envelope.type.value !== 'string') return null;
    if (envelope.type.value === 'preview-ready') {
      try { dataRecord(envelope.payload.value, [], 'Preview ready payload'); } catch { return null; }
      return { type: 'ready' };
    }
    if (envelope.type.value === 'preview-error') {
      let payload;
      try { payload = dataRecord(envelope.payload.value, ['code'], 'Preview error payload'); } catch { return null; }
      if (!ERROR_CODES.has(payload.code.value)) return null;
      return { type: 'error', code: payload.code.value };
    }
    return null;
  }

  function createPreviewController({
    iframe,
    allowedOrigin,
    onState,
    cryptoImpl = globalThis.crypto,
    windowObject = globalThis.window,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
    startupTimeoutMs = 10_000,
  } = {}) {
    const origin = exactOrigin(allowedOrigin, 'Configured preview origin');
    if (!iframe || !iframe.contentWindow || typeof iframe.contentWindow.postMessage !== 'function'
      || !windowObject || typeof windowObject.addEventListener !== 'function'
      || typeof windowObject.removeEventListener !== 'function'
      || typeof onState !== 'function'
      || !cryptoImpl || typeof cryptoImpl.randomUUID !== 'function'
      || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function'
      || !Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120_000) {
      fail('Preview controller configuration is invalid');
    }

    let destroyed = false;
    let active = null;

    function notify(state) {
      try { onState(state); } catch { /* UI callbacks cannot weaken the boundary. */ }
    }

    function finish(record, state) {
      if (active !== record || record.done) return;
      record.done = true;
      active = null;
      clearTimeoutImpl(record.timer);
      notify(state);
      record.resolve(state);
    }

    function receive(event) {
      const record = active;
      if (!record || destroyed || event?.origin !== origin || event.source !== record.targetWindow) return;
      const state = responseFor(event.data, record.nonce);
      if (state) finish(record, state);
    }

    windowObject.addEventListener('message', receive);

    function boot(candidate) {
      if (destroyed) fail('Preview controller is destroyed');
      let iframeOrigin;
      try { iframeOrigin = new URL(iframe.src).origin; } catch { fail('Preview iframe origin is invalid'); }
      if (iframeOrigin !== origin) fail('Preview iframe origin does not match the configured preview origin');
      const payload = cloneCandidate(candidate);
      const targetWindow = iframe.contentWindow;
      if (!targetWindow || typeof targetWindow.postMessage !== 'function') fail('Preview iframe window is unavailable');
      let nonce;
      try { nonce = cryptoImpl.randomUUID(); } catch { fail('Preview cryptographic nonce is unavailable'); }
      if (typeof nonce !== 'string' || !NONCE.test(nonce)) fail('Preview cryptographic nonce is unavailable');

      if (active) finish(active, { type: 'error', code: 'PREVIEW_SUPERSEDED' });
      let resolve;
      const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
      const record = { done: false, nonce, promise, resolve, targetWindow, timer: null };
      active = record;
      notify({ type: 'pending' });
      record.timer = setTimeoutImpl(() => {
        finish(record, { type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });
      }, startupTimeoutMs);
      try {
        targetWindow.postMessage({
          v: PROTOCOL_VERSION,
          nonce,
          type: 'preview-candidate',
          payload,
        }, origin);
      } catch {
        finish(record, { type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });
      }
      return promise;
    }

    return Object.freeze({
      boot,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        windowObject.removeEventListener('message', receive);
        if (active) finish(active, { type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });
      },
    });
  }

  return Object.freeze({ createPreviewController });
}));
