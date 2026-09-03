const db = require('../../db/connection');

const SHORTCUT_ACTIONS = Object.freeze([
  'previousSlide', 'nextSlide', 'animationPrevious', 'animationNext',
  'animationPlay', 'animationPause', 'toggleDrawing', 'toggleFullscreen',
]);

const UNSAFE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

const MODIFIER_ALIASES = Object.freeze({
  alt: 'alt',
  option: 'alt',
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  ctrl: 'ctrl',
  meta: 'meta',
  shift: 'shift',
});

const MODIFIER_ORDER = Object.freeze(['ctrl', 'alt', 'shift', 'meta']);

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
  const keys = [];
  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();
    const modifier = MODIFIER_ALIASES[normalizedToken];
    if (modifier) modifiers.push(modifier);
    else keys.push(normalizedToken);
  }

  modifiers.sort((left, right) => MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right));
  return [...modifiers, ...keys].join('+');
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
    const canonicalBinding = canonicalizeBinding(binding);
    if (seenBindings.has(canonicalBinding)) {
      throw new WebinarSettingsError('SHORTCUT_BINDING_DUPLICATE', 'Shortcut bindings must be unique', { status: 400 });
    }
    seenBindings.add(canonicalBinding);
    normalized[action] = binding;
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
  return typeof value === 'string' ? JSON.parse(value) : value;
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
