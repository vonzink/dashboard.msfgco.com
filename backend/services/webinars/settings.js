const db = require('../../db/connection');

const SHORTCUT_ACTIONS = Object.freeze([
  'previousSlide', 'nextSlide', 'animationPrevious', 'animationNext',
  'animationPlay', 'animationPause', 'toggleDrawing', 'toggleFullscreen',
]);

const UNSAFE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

const MODIFIER_ALIASES = Object.freeze({
  alt: 'Alt',
  option: 'Alt',
  cmd: 'Meta',
  command: 'Meta',
  control: 'Control',
  ctrl: 'Control',
  meta: 'Meta',
  shift: 'Shift',
});

const MODIFIER_ORDER = Object.freeze(['Control', 'Alt', 'Shift', 'Meta']);

const BASE_KEY_ALIASES = Object.freeze({
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  end: 'End',
  enter: 'Enter',
  home: 'Home',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  space: 'Space',
});

// Mirrors validateDescriptor() in deck/js/presenter-shortcuts.js.
const PRESENTER_BROWSER_RESERVED = /^(?:Control|Meta)(?:\+(?:Alt|Shift))*\+(?:Key[LRNWPT]|Tab)$/;
const PRESENTER_HISTORY_ARROW = /^Arrow(?:Left|Right)$/;

class WebinarSettingsError extends Error {
  constructor(code, message = 'Webinar settings operation failed', extra = {}) {
    super(message);
    this.name = 'WebinarSettingsError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalizeBinding(binding) {
  const tokens = binding.trim().split('+').map((segment) => segment.trim());
  if (tokens.some((token) => !token)) {
    throw new WebinarSettingsError('SHORTCUT_BINDING_INVALID', 'Shortcut binding cannot contain an empty chord segment', { status: 400 });
  }

  const modifiers = [];
  const baseTokens = [];
  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();
    const modifier = MODIFIER_ALIASES[normalizedToken];
    if (modifier) modifiers.push(modifier);
    else baseTokens.push(normalizedToken);
  }

  const base = normalizeBaseToken(baseTokens);
  if (!base || new Set(modifiers).size !== modifiers.length) {
    throw new WebinarSettingsError('SHORTCUT_BINDING_INVALID', 'Shortcut binding must map to a valid presenter descriptor', { status: 400 });
  }
  modifiers.sort((left, right) => MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right));
  const descriptor = [...modifiers, base].join('+');
  if (isPresenterBrowserReserved(descriptor, modifiers, base)) {
    throw new WebinarSettingsError('SHORTCUT_BINDING_RESERVED', 'Shortcut binding is reserved by the browser', { status: 400 });
  }
  return descriptor;
}

function normalizeBaseToken(baseTokens) {
  if (baseTokens.length !== 1) return null;
  const [base] = baseTokens;
  if (/^[a-z]$/.test(base)) return `Key${base.toUpperCase()}`;
  if (/^key[a-z]$/.test(base)) return `Key${base.slice(-1).toUpperCase()}`;
  if (/^[0-9]$/.test(base)) return `Digit${base}`;
  if (/^digit[0-9]$/.test(base)) return `Digit${base.slice(-1)}`;
  return BASE_KEY_ALIASES[base] || null;
}

function isPresenterBrowserReserved(descriptor, modifiers, base) {
  return PRESENTER_BROWSER_RESERVED.test(descriptor) ||
    ((modifiers.includes('Alt') || modifiers.includes('Meta')) && PRESENTER_HISTORY_ARROW.test(base));
}

function normalizeShortcuts(shortcuts) {
  if (!isPlainObject(shortcuts)) {
    throw new WebinarSettingsError('SHORTCUTS_INVALID', 'Shortcuts must be an object', { status: 400 });
  }
  const normalized = {};
  const seenBindings = new Set();
  for (const [action, binding] of Object.entries(shortcuts)) {
    if (!SHORTCUT_ACTIONS.includes(action)) {
      throw new WebinarSettingsError('SHORTCUT_ACTION_UNKNOWN', `Unknown shortcut action: ${action}`, { status: 400 });
    }
    if (typeof binding !== 'string' || !binding.trim()) {
      throw new WebinarSettingsError('SHORTCUT_BINDING_INVALID', 'Shortcut binding must be a nonempty string', { status: 400 });
    }
    const normalizedBinding = canonicalizeBinding(binding);
    if (seenBindings.has(normalizedBinding)) {
      throw new WebinarSettingsError('SHORTCUT_BINDING_DUPLICATE', 'Shortcut bindings must be unique', { status: 400 });
    }
    seenBindings.add(normalizedBinding);
    normalized[action] = normalizedBinding;
  }
  return normalized;
}

function normalizePreferences(preferences) {
  if (!isPlainObject(preferences)) {
    throw new WebinarSettingsError('PREFERENCES_INVALID', 'Preferences must be an object', { status: 400 });
  }
  const normalized = {};
  for (const key of Object.getOwnPropertyNames(preferences)) {
    if (UNSAFE_KEYS.includes(key)) {
      throw new WebinarSettingsError('PREFERENCE_KEY_UNSAFE', `Unsafe preference key: ${key}`, { status: 400 });
    }
    const value = preferences[key];
    if (typeof value !== 'boolean' && typeof value !== 'string') {
      throw new WebinarSettingsError('PREFERENCE_VALUE_INVALID', 'Preference values must be boolean or string', { status: 400 });
    }
    normalized[key] = value;
  }
  return normalized;
}

function parseJsonColumn(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new WebinarSettingsError(
      'SETTINGS_DATA_CORRUPT',
      'Stored webinar presenter settings are corrupt',
      { status: 500, cause },
    );
  }
}

async function getSettings(userId) {
  const [rows] = await db.query(
    `SELECT shortcuts, preferences, created_at, updated_at
     FROM webinar_presenter_settings
     WHERE user_id = ?`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    shortcuts: parseJsonColumn(row.shortcuts),
    preferences: parseJsonColumn(row.preferences),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertSettings({ userId, shortcuts, preferences }) {
  const normalizedShortcuts = normalizeShortcuts(shortcuts);
  const normalizedPreferences = normalizePreferences(preferences);
  await db.query(
    `INSERT INTO webinar_presenter_settings (user_id, shortcuts, preferences)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE shortcuts = VALUES(shortcuts), preferences = VALUES(preferences)`,
    [userId, JSON.stringify(normalizedShortcuts), JSON.stringify(normalizedPreferences)],
  );
  return { shortcuts: normalizedShortcuts, preferences: normalizedPreferences };
}

module.exports = {
  WebinarSettingsError,
  SHORTCUT_ACTIONS,
  getSettings,
  upsertSettings,
};
