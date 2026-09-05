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
  // A (re)opened named window is open by definition, so the fake reopens it.
  const openWindow = vi.fn().mockImplementation(() => { if (openResult === undefined) { audience.closed = false; return audience; } return openResult; });
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

  it('always re-navigates the named window on reconnect so a foreign or reloaded audience page is recovered', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    // The window is open but no longer the studio page: pongs stop.
    for (let tick = 0; tick < 4; tick += 1) test.intervals.at(-1).callback();
    expect(test.bridge.status()).toBe('disconnected');
    expect(test.bridge.reconnect()).toBe(true);
    expect(test.openWindow).toHaveBeenCalledTimes(2);
    expect(test.openWindow).toHaveBeenLastCalledWith(AUDIENCE_URL, 'MSFGWebinarAudience');
    expect(test.bridge.status()).toBe('connecting');
    test.ready();
    expect(test.bridge.status()).toBe('connected');
  });

  it('stops initializing as soon as the window closes instead of burning the retry budget', () => {
    const test = harness();
    test.bridge.connect();
    test.audience.closed = true;
    test.timeouts.at(-1).callback();
    expect(test.bridge.status()).toBe('disconnected');
    expect(test.audience.postMessage).toHaveBeenCalledTimes(1);
  });

  it('never reports delivery to a window that has already closed', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    test.audience.closed = true;
    expect(test.bridge.sendControl('next', {})).toBe(false);
    expect(test.bridge.status()).toBe('disconnected');
    expect(test.onStatus).toHaveBeenLastCalledWith('disconnected');
    expect(test.audience.postMessage.mock.calls.filter(([message]) => message.type === 'next')).toHaveLength(0);
  });

  it('keeps the boolean contract when no nonce can be generated', () => {
    const test = harness({ cryptoImpl: { randomUUID: () => { throw new Error('no crypto'); } } });
    expect(() => test.bridge.connect()).not.toThrow();
    expect(test.bridge.connect()).toBe(false);
    expect(test.bridge.status()).toBe('idle');
    expect(test.audience.postMessage).not.toHaveBeenCalled();
  });

  it('reports a blocked popup once per attempt, from any prior status', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    test.audience.closed = true;
    test.intervals.at(-1).callback();
    expect(test.bridge.status()).toBe('disconnected');
    test.openWindow.mockImplementation(() => null);
    test.onStatus.mockClear();
    expect(test.bridge.reconnect()).toBe(false);
    expect(test.onStatus.mock.calls.map(([status]) => status)).toEqual(['idle']);
  });

  it('accepts a late audience-ready for the current launch after the init budget lapsed', () => {
    const test = harness({ maxInitAttempts: 2 });
    test.bridge.connect();
    test.timeouts.at(-1).callback();
    test.timeouts.at(-1).callback();
    expect(test.bridge.status()).toBe('disconnected');
    test.ready();
    expect(test.bridge.status()).toBe('connected');
    expect(test.onState).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'audience-ready' }));
  });

  it('reconnects cleanly while connected: the old heartbeat stops and a stale ready is rejected; a duplicate ready does not leak a heartbeat', () => {
    const test = harness();
    test.bridge.connect();
    test.ready();
    const first = test.currentNonce();
    const heartbeatsBefore = test.intervals.length;
    test.ready();
    expect(test.intervals.length).toBe(heartbeatsBefore + 1);
    expect(test.clearedIntervals).toContain(heartbeatsBefore);
    test.bridge.reconnect();
    expect(test.clearedIntervals).toContain(heartbeatsBefore + 1);
    expect(test.currentNonce()).not.toBe(first);
    test.fromAudience({ v: 1, nonce: first, type: 'audience-ready', payload: { index: 0, total: 15 } });
    expect(test.onIgnored).toHaveBeenLastCalledWith('WRONG_NONCE');
    expect(test.bridge.status()).toBe('connecting');
  });

  it('survives observers that throw', () => {
    const test = harness({ onState: () => { throw new Error('boom'); }, onStatus: () => { throw new Error('boom'); }, onIgnored: () => { throw new Error('boom'); } });
    expect(() => test.bridge.connect()).not.toThrow();
    expect(() => test.ready()).not.toThrow();
    expect(test.bridge.status()).toBe('connected');
    expect(() => test.fromAudience('junk')).not.toThrow();
    expect(test.bridge.sendControl('next', {})).toBe(true);
  });

  it('pins the protocol shape shared with the audience: enumerations, bounds, nonce pattern, and data-only records', () => {
    const { validateControlMessage, validateAudienceMessage } = loadModule();
    const nonce = 'n'.repeat(32);
    const control = (type, payload) => validateControlMessage({ v: 1, nonce, type, payload }, nonce);
    const audience = (type, payload) => validateAudienceMessage({ v: 1, nonce, type, payload }, nonce);
    for (const tool of ['pen', 'highlight', 'box', 'text', 'laser']) expect(control('annotation-command', { tool })).not.toBeNull();
    for (const color of ['green', 'yellow', 'blue', 'red', 'black', 'white']) expect(control('annotation-command', { color })).not.toBeNull();
    expect(control('annotation-command', { tool: 'script' })).toBeNull();
    expect(control('annotation-command', { color: 'url(x)' })).toBeNull();
    expect(control('annotation-command', {})).toBeNull();
    expect(control('goto', { index: 100_000 })).not.toBeNull();
    expect(control('goto', { index: 100_001 })).toBeNull();
    expect(control('goto', { index: -1 })).toBeNull();
    expect(control('goto', { index: 1.5 })).toBeNull();
    expect(audience('animation-state', { current: 10_000, total: 10_000, playing: false })).not.toBeNull();
    expect(audience('animation-state', { current: 0, total: 10_001, playing: false })).toBeNull();
    expect(audience('slide-state', { index: 0, total: 100_000 })).not.toBeNull();
    expect(audience('slide-state', { index: 0, total: 100_001 })).toBeNull();
    expect(audience('supported-overlay-state', { id: 'cash-to-close', visible: true })).not.toBeNull();
    expect(audience('supported-overlay-state', { id: 'Cash', visible: true })).toBeNull();
    expect(audience('audience-error', { code: 'SLIDE_RUNTIME_ERROR' })).not.toBeNull();
    expect(audience('audience-error', { code: 'lower' })).toBeNull();
    for (const bad of ['short', 'x'.repeat(129), 'has space'.padEnd(20, 'a'), 'bad$chars'.padEnd(20, 'a')]) {
      expect(validateControlMessage({ v: 1, nonce: bad, type: 'ping', payload: {} }, bad)).toBeNull();
    }
    expect(validateControlMessage({ v: 1, nonce, type: 'ping', payload: {} }, nonce)).not.toBeNull();
    // Data-only records: accessors, prototype keys, class instances, symbols, and extras are rejected.
    const accessor = {}; Object.defineProperty(accessor, 'index', { enumerable: true, get: () => 1 });
    expect(control('goto', accessor)).toBeNull();
    const polluted = JSON.parse('{"index":1,"__proto__":{"x":1}}');
    expect(control('goto', polluted)).toBeNull();
    class Payload { constructor() { this.index = 1; } }
    expect(control('goto', new Payload())).toBeNull();
    expect(control('goto', { index: 1, [Symbol('s')]: 1 })).toBeNull();
    expect(control('goto', { index: 1, extra: true })).toBeNull();
    expect(control('goto', Object.assign(Object.create(null), { index: 1 }))).not.toBeNull();
    expect(control('next', [])).toBeNull();
    expect(control('next', null)).toBeNull();
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
