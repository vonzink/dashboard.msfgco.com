import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const AUDIENCE_ORIGIN = 'https://msfgmortgage.com';
const AUDIENCE_URL = 'https://msfgmortgage.com/webinars/first-home-without-mystery/studio-viewer.html';

class FakeWindow {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener)); }
  emit(type, event) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}

function loadModule() {
  vi.resetModules();
  return require('../../../js/webinar-studio/bridge.js');
}

function harness({ openResult, ...options } = {}) {
  const { createAudienceBridge } = loadModule();
  const windowObject = new FakeWindow();
  const audience = { closed: false, postMessage: vi.fn() };
  const openWindow = vi.fn().mockImplementation(() => (openResult === undefined ? audience : openResult));
  const onState = vi.fn();
  const onStatus = vi.fn();
  const onIgnored = vi.fn();
  const timeouts = [];
  const intervals = [];
  const clearedTimeouts = [];
  const clearedIntervals = [];
  let nonceCounter = 0;
  const bridge = createAudienceBridge({
    audienceUrl: AUDIENCE_URL,
    allowedOrigin: AUDIENCE_ORIGIN,
    onState,
    onStatus,
    onIgnored,
    windowObject,
    openWindow,
    cryptoImpl: { randomUUID: () => `nonce-${++nonceCounter}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` },
    setTimeoutImpl: (callback, delay) => { timeouts.push({ callback, delay }); return timeouts.length; },
    clearTimeoutImpl: id => { clearedTimeouts.push(id); },
    setIntervalImpl: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    clearIntervalImpl: id => { clearedIntervals.push(id); },
    ...options,
  });
  const currentNonce = () => audience.postMessage.mock.calls.at(-1)?.[0]?.nonce;
  const fromAudience = (data, { origin = AUDIENCE_ORIGIN, source = audience } = {}) => windowObject.emit('message', { origin, source, data });
  const ready = () => fromAudience({ v: 1, nonce: currentNonce(), type: 'audience-ready', payload: { index: 0, total: 15 } });
  return { bridge, windowObject, audience, openWindow, onState, onStatus, onIgnored, timeouts, intervals, clearedTimeouts, clearedIntervals, currentNonce, fromAudience, ready };
}

describe('Webinar Studio audience bridge', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refuses invalid configuration up front', () => {
    const { createAudienceBridge } = loadModule();
    const base = { audienceUrl: AUDIENCE_URL, allowedOrigin: AUDIENCE_ORIGIN, onState: () => {}, windowObject: new FakeWindow(), openWindow: () => null, cryptoImpl: { randomUUID: () => 'x'.repeat(32) } };
    expect(() => createAudienceBridge({ ...base, allowedOrigin: 'https://evil.example' })).toThrow(/origin/i);
    expect(() => createAudienceBridge({ ...base, allowedOrigin: '*' })).toThrow(/origin/i);
    expect(() => createAudienceBridge({ ...base, allowedOrigin: 'http://msfgmortgage.com' })).toThrow(/origin/i);
    expect(() => createAudienceBridge({ ...base, audienceUrl: 'javascript:alert(1)' })).toThrow(/url/i);
    expect(() => createAudienceBridge({ ...base, onState: null })).toThrow();
    expect(() => createAudienceBridge(base)).not.toThrow();
  });

  it('opens one named window, retains its exact WindowProxy, and initializes only to the configured origin', () => {
    const test = harness();
    expect(test.bridge.status()).toBe('idle');
    expect(test.bridge.connect()).toBe(true);
    expect(test.openWindow).toHaveBeenCalledTimes(1);
    expect(test.openWindow).toHaveBeenCalledWith(AUDIENCE_URL, 'MSFGWebinarAudience');
    expect(test.openWindow.mock.calls[0]).toHaveLength(2);
    expect(test.bridge.status()).toBe('connecting');
    expect(test.onStatus).toHaveBeenLastCalledWith('connecting');
    const [init, target] = test.audience.postMessage.mock.calls[0];
    expect(target).toBe(AUDIENCE_ORIGIN);
    expect(init).toEqual({ v: 1, nonce: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/), type: 'presenter-init', payload: {} });
    expect(test.timeouts.at(-1).delay).toBe(500);
    test.timeouts.at(-1).callback();
    expect(test.audience.postMessage).toHaveBeenCalledTimes(2);
    expect(test.audience.postMessage.mock.calls[1][0].nonce).toBe(init.nonce);

    test.bridge.connect();
    expect(test.openWindow).toHaveBeenCalledTimes(1);

    test.ready();
    expect(test.bridge.status()).toBe('connected');
    expect(test.onStatus).toHaveBeenLastCalledWith('connected');
    expect(test.onState).toHaveBeenCalledWith({ v: 1, nonce: init.nonce, type: 'audience-ready', payload: { index: 0, total: 15 } });
    expect(test.clearedTimeouts).toContain(test.timeouts.length);
    expect(test.intervals.at(-1).delay).toBe(5000);
  });

  it('ignores wrong origin, wrong source, wrong nonce, wrong version, unknown types, and executable payloads, logging reasons only', () => {
    const test = harness();
    test.bridge.connect();
    const nonce = test.currentNonce();
    const other = { closed: false, postMessage: vi.fn() };
    test.fromAudience({ v: 1, nonce, type: 'audience-ready', payload: { index: 0, total: 15 } }, { origin: 'https://evil.example' });
    test.fromAudience({ v: 1, nonce, type: 'audience-ready', payload: { index: 0, total: 15 } }, { source: other });
    test.fromAudience({ v: 1, nonce: 'wrong-nonce-value-000000', type: 'audience-ready', payload: { index: 0, total: 15 } });
    test.fromAudience({ v: 2, nonce, type: 'audience-ready', payload: { index: 0, total: 15 } });
    test.fromAudience({ v: 1, nonce, type: 'eval', payload: {} });
    test.fromAudience({ v: 1, nonce, type: 'slide-state', payload: { index: 0, total: 15, url: 'https://evil.example/x' } });
    test.fromAudience({ v: 1, nonce, type: 'audience-error', payload: { code: '<script>alert(1)</script>' } });
    expect(test.bridge.status()).toBe('connecting');
    expect(test.onState).not.toHaveBeenCalled();
    expect(test.onIgnored.mock.calls.map(call => call[0])).toEqual([
      'SOURCE_OR_ORIGIN', 'SOURCE_OR_ORIGIN', 'WRONG_NONCE', 'WRONG_VERSION', 'UNKNOWN_TYPE', 'INVALID_PAYLOAD', 'INVALID_PAYLOAD',
    ]);
    const logged = JSON.stringify(test.onIgnored.mock.calls);
    expect(logged).not.toContain('evil.example');
    expect(logged).not.toContain('script');
    expect(logged).not.toContain(nonce);
  });

  it('sends only validated fixed control types with scalar payloads, and only while connected', () => {
    const test = harness();
    expect(test.bridge.sendControl('next', {})).toBe(false);
    test.bridge.connect();
    expect(test.bridge.sendControl('next', {})).toBe(false);
    test.ready();
    const nonce = test.currentNonce();
    test.audience.postMessage.mockClear();
    expect(test.bridge.sendControl('goto', { index: 4 })).toBe(true);
    expect(test.bridge.sendControl('annotation-command', { on: true })).toBe(true);
    expect(test.bridge.sendControl('supported-calculator-state', { id: 'cash-to-close', visible: true })).toBe(true);
    expect(test.audience.postMessage.mock.calls).toEqual([
      [{ v: 1, nonce, type: 'goto', payload: { index: 4 } }, AUDIENCE_ORIGIN],
      [{ v: 1, nonce, type: 'annotation-command', payload: { on: true } }, AUDIENCE_ORIGIN],
      [{ v: 1, nonce, type: 'supported-calculator-state', payload: { id: 'cash-to-close', visible: true } }, AUDIENCE_ORIGIN],
    ]);
    test.audience.postMessage.mockClear();
    expect(test.bridge.sendControl('eval', { code: 'x' })).toBe(false);
    expect(test.bridge.sendControl('goto', { url: 'https://evil.example' })).toBe(false);
    expect(test.bridge.sendControl('goto', { index: '4' })).toBe(false);
    expect(test.bridge.sendControl('annotation-command', { html: '<b>' })).toBe(false);
    expect(test.bridge.sendControl('fullscreen-request', 'on')).toBe(false);
    expect(test.audience.postMessage).not.toHaveBeenCalled();
  });

  it('pings every five seconds, marks the audience disconnected after three missed acknowledgements, and recovers on pong', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    const nonce = test.currentNonce();
    const tick = () => test.intervals.at(-1).callback();
    test.audience.postMessage.mockClear();
    tick();
    expect(test.audience.postMessage).toHaveBeenLastCalledWith({ v: 1, nonce, type: 'ping', payload: {} }, AUDIENCE_ORIGIN);
    test.fromAudience({ v: 1, nonce, type: 'pong', payload: {} });
    tick(); tick(); tick();
    expect(test.bridge.status()).toBe('connected');
    tick();
    expect(test.bridge.status()).toBe('disconnected');
    expect(test.onStatus).toHaveBeenLastCalledWith('disconnected');
    expect(test.clearedIntervals).toContain(test.intervals.length);
    expect(test.bridge.sendControl('next', {})).toBe(false);
    test.fromAudience({ v: 1, nonce, type: 'pong', payload: {} });
    expect(test.bridge.status()).toBe('disconnected');
  });

  it('treats a closed audience window as disconnected and reopens it on reconnect with a fresh nonce', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    const first = test.currentNonce();
    test.audience.closed = true;
    test.intervals.at(-1).callback();
    expect(test.bridge.status()).toBe('disconnected');

    expect(test.bridge.reconnect()).toBe(true);
    expect(test.openWindow).toHaveBeenCalledTimes(2);
    expect(test.bridge.status()).toBe('connecting');
    const second = test.currentNonce();
    expect(second).not.toBe(first);
    test.fromAudience({ v: 1, nonce: first, type: 'audience-ready', payload: { index: 0, total: 15 } });
    expect(test.bridge.status()).toBe('connecting');
    expect(test.onIgnored).toHaveBeenLastCalledWith('WRONG_NONCE');
    test.audience.closed = false;
    test.ready();
    expect(test.bridge.status()).toBe('connected');
  });

  it('gives up initialization after the retry budget and reports disconnected without weakening origin checks', () => {
    const test = harness({ maxInitAttempts: 3 });
    test.bridge.connect();
    test.timeouts.at(-1).callback();
    test.timeouts.at(-1).callback();
    expect(test.bridge.status()).toBe('connecting');
    expect(test.audience.postMessage).toHaveBeenCalledTimes(3);
    // The final attempt keeps its retry window; only after it lapses is the launch abandoned.
    test.timeouts.at(-1).callback();
    expect(test.bridge.status()).toBe('disconnected');
    expect(test.audience.postMessage).toHaveBeenCalledTimes(3);
    test.fromAudience({ v: 1, nonce: test.currentNonce(), type: 'audience-ready', payload: { index: 0, total: 15 } }, { origin: 'https://evil.example' });
    expect(test.bridge.status()).toBe('disconnected');
    expect(test.onIgnored).toHaveBeenLastCalledWith('SOURCE_OR_ORIGIN');
  });

  it('reports a blocked popup as idle and never posts', () => {
    const test = harness({ openResult: null });
    expect(test.bridge.connect()).toBe(false);
    expect(test.bridge.status()).toBe('idle');
    expect(test.audience.postMessage).not.toHaveBeenCalled();
    expect(test.onStatus).toHaveBeenLastCalledWith('idle');
  });

  it('destroy removes the listener, stops timers, and leaves the audience window open', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    test.bridge.destroy();
    expect(test.windowObject.listeners.get('message')).toHaveLength(0);
    expect(test.clearedIntervals).toContain(test.intervals.length);
    expect(test.bridge.status()).toBe('idle');
    expect(test.bridge.sendControl('next', {})).toBe(false);
    expect(test.audience.closed).toBe(false);
    test.fromAudience({ v: 1, nonce: test.currentNonce(), type: 'pong', payload: {} });
    expect(test.onState).toHaveBeenCalledTimes(1);
  });
});
