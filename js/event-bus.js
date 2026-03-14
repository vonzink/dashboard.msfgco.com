/* ============================================
   MSFG Dashboard - Event Bus
   Lightweight pub/sub for decoupled module communication
   ============================================ */
const EventBus = {
  _listeners: {},

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback); // return unsubscribe fn
  },

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  emit(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(cb => {
      try { cb(data); } catch (e) { console.error(`EventBus error [${event}]:`, e); }
    });
  },

  // Clear all listeners (useful for testing)
  clear() { this._listeners = {}; }
};

window.EventBus = EventBus;
