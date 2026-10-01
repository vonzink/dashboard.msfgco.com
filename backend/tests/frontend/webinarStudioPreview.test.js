import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPreviewController } = require('../../../js/webinar-studio/preview.js');

const PREVIEW_ORIGIN = 'https://msfgmortgage.com';
const NONCE = '11111111-1111-4111-8111-111111111111';
const SLIDE_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';

function candidate(overrides = {}) {
  return {
    master: { html: '<main>{{SLIDE_CONTENT}}</main>', css: 'main{color:#123}' },
    slide: {
      id: SLIDE_ID,
      anchor: 'opening',
      title: 'Opening',
      html: '<section>Candidate</section>',
      css: '.slide{display:grid}',
      javascript: 'window.addEventListener("slide-enter", () => {});',
    },
    assets: { [ASSET_ID]: 'https://assets.example/decks/opening.webp' },
    resourcePolicy: {
      assetOrigin: 'https://assets.example',
      stylesheetOrigins: [],
      fontOrigins: [],
    },
    ...overrides,
  };
}

class FakeWindow {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener));
  }
  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
}

function harness({ iframeSrc = `${PREVIEW_ORIGIN}/webinars/first-home/studio-viewer.html?mode=preview` } = {}) {
  const posts = [];
  const states = [];
  const timers = new Map();
  let timerId = 0;
  const contentWindow = {
    postMessage(message, targetOrigin) { posts.push({ message, targetOrigin }); },
  };
  const iframe = { src: iframeSrc, contentWindow };
  const windowObject = new FakeWindow();
  const controller = createPreviewController({
    allowedOrigin: PREVIEW_ORIGIN,
    cryptoImpl: { randomUUID: () => NONCE },
    iframe,
    onState: state => states.push(state),
    windowObject,
    setTimeoutImpl(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutImpl(id) { timers.delete(id); },
    startupTimeoutMs: 5000,
  });
  return { contentWindow, controller, iframe, posts, states, timers, windowObject };
}

describe('Webinar Studio candidate preview boundary', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts the exact candidate only to the configured origin and exact iframe window', async () => {
    const test = harness();
    const source = candidate();
    const startup = test.controller.boot(source);

    expect(test.posts).toEqual([{
      targetOrigin: PREVIEW_ORIGIN,
      message: { v: 1, nonce: NONCE, type: 'preview-candidate', payload: source },
    }]);
    expect(test.states).toEqual([{ type: 'pending' }]);
    expect([...test.timers.values()].map(timer => timer.delay)).toEqual([5000]);

    test.windowObject.emit('message', {
      origin: PREVIEW_ORIGIN,
      source: test.contentWindow,
      data: { v: 1, nonce: NONCE, type: 'preview-ready', payload: {} },
    });
    await expect(startup).resolves.toEqual({ type: 'ready' });
    expect(test.states).toEqual([{ type: 'pending' }, { type: 'ready' }]);
    expect(test.timers.size).toBe(0);
  });

  it('ignores wrong origins, sources, nonces, versions, types, and executable response fields', async () => {
    const test = harness();
    const startup = test.controller.boot(candidate());
    const attacker = {};
    const invalid = [
      { origin: 'https://evil.example', source: test.contentWindow, data: { v: 1, nonce: NONCE, type: 'preview-ready', payload: {} } },
      { origin: PREVIEW_ORIGIN, source: attacker, data: { v: 1, nonce: NONCE, type: 'preview-ready', payload: {} } },
      { origin: PREVIEW_ORIGIN, source: test.contentWindow, data: { v: 1, nonce: 'wrong-wrong-wrong-1', type: 'preview-ready', payload: {} } },
      { origin: PREVIEW_ORIGIN, source: test.contentWindow, data: { v: 2, nonce: NONCE, type: 'preview-ready', payload: {} } },
      { origin: PREVIEW_ORIGIN, source: test.contentWindow, data: { v: 1, nonce: NONCE, type: 'unknown', payload: {} } },
      { origin: PREVIEW_ORIGIN, source: test.contentWindow, data: { v: 1, nonce: NONCE, type: 'preview-ready', payload: { html: '<script>bad()</script>' } } },
    ];
    invalid.forEach(event => test.windowObject.emit('message', event));
    expect(test.states).toEqual([{ type: 'pending' }]);

    test.windowObject.emit('message', {
      origin: PREVIEW_ORIGIN,
      source: test.contentWindow,
      data: { v: 1, nonce: NONCE, type: 'preview-error', payload: { code: 'SLIDE_RUNTIME_ERROR' } },
    });
    await expect(startup).resolves.toEqual({ type: 'error', code: 'SLIDE_RUNTIME_ERROR' });
  });

  it('fails closed for a mismatched iframe origin, malformed candidate, timeout, and teardown', async () => {
    expect(() => harness({ iframeSrc: 'https://evil.example/preview' }).controller.boot(candidate()))
      .toThrow(/preview origin/i);

    const malformed = harness();
    expect(() => malformed.controller.boot(candidate({ token: 'private-auth-token' })))
      .toThrow(/candidate/i);
    expect(malformed.posts).toEqual([]);

    const timed = harness();
    const startup = timed.controller.boot(candidate());
    const timer = [...timed.timers.values()][0];
    timer.callback();
    await expect(startup).resolves.toEqual({ type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });
    expect(timed.states.at(-1)).toEqual({ type: 'error', code: 'PREVIEW_STARTUP_TIMEOUT' });

    timed.controller.destroy();
    expect(() => timed.controller.boot(candidate())).toThrow(/destroyed/i);
    expect(timed.windowObject.listeners.get('message')).toEqual([]);
  });
});
