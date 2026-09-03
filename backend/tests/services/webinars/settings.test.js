import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbPath = require.resolve('../../../db/connection');
const settingsPath = path.resolve(import.meta.dirname, '../../../services/webinars/settings.js');
const originalDb = require.cache[dbPath];
const db = { query: vi.fn() };

const shortcuts = {
  previousSlide: 'ArrowLeft',
  nextSlide: 'ArrowRight',
};

const preferences = {
  showTimer: true,
  theme: 'dark',
};

function loadSettings() {
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  delete require.cache[settingsPath];
  return require(settingsPath);
}

beforeEach(() => { db.query.mockReset(); });

afterEach(() => {
  delete require.cache[settingsPath];
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
});

describe('Webinar Studio presenter settings', () => {
  describe('upsertSettings', () => {
    it('uses ON DUPLICATE KEY UPDATE with [userId, serialized shortcuts, serialized preferences]', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { upsertSettings } = loadSettings();
      await upsertSettings({ userId: 7, shortcuts, preferences });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        [7, JSON.stringify(shortcuts), JSON.stringify(preferences)],
      );
    });

    it('rejects unknown shortcut action names before querying the database', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { launchMissile: 'ArrowLeft', ...shortcuts },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_ACTION_UNKNOWN' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects duplicate key bindings across shortcut actions', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'ArrowLeft', nextSlide: 'ArrowLeft' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_DUPLICATE' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects case-only equivalent bindings across shortcut actions', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'ArrowLeft', nextSlide: 'arrowleft' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_DUPLICATE' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects bindings that differ only in separator whitespace', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'Ctrl+A', nextSlide: 'ctrl + a' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_DUPLICATE' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects bindings that differ only in modifier order', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'Ctrl+Shift+A', nextSlide: 'Shift+Ctrl+A' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_DUPLICATE' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects bindings that differ only by a modifier alias', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'Control+A', nextSlide: 'ctrl+a' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_DUPLICATE' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects chord bindings containing an empty segment', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'Ctrl+' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('normalizes aliases, modifier order, and key codes before persisting settings', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { upsertSettings } = loadSettings();
      const raw = {
        previousSlide: 'ctrl + a',
        nextSlide: 'arrowleft',
        toggleDrawing: 'Shift+Ctrl+B',
      };
      const normalized = {
        previousSlide: 'Control+KeyA',
        nextSlide: 'ArrowLeft',
        toggleDrawing: 'Control+Shift+KeyB',
      };
      const result = await upsertSettings({ userId: 7, shortcuts: raw, preferences });
      expect(result.shortcuts).toEqual(normalized);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        [7, JSON.stringify(normalized), JSON.stringify(preferences)],
      );
    });

    it('normalizes common modifier aliases to the consumer descriptor order', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { upsertSettings } = loadSettings();
      const result = await upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'command+option+1' },
        preferences,
      });
      expect(result.shortcuts).toEqual({ previousSlide: 'Alt+Meta+Digit1' });
    });

    it('rejects bindings that cannot become valid consumer descriptors', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'Ctrl+F13' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('accepts distinct bindings after canonicalization', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { upsertSettings } = loadSettings();
      const result = await upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 'Ctrl+A', nextSlide: 'Ctrl+B' },
        preferences,
      });
      expect(result.shortcuts).toEqual({ previousSlide: 'Control+KeyA', nextSlide: 'Control+KeyB' });
    });

    it('rejects non-string shortcut key bindings', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: 42 },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects empty string shortcut key bindings', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts: { previousSlide: '' },
        preferences,
      })).rejects.toMatchObject({ code: 'SHORTCUT_BINDING_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects preference values that are not boolean or string', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts,
        preferences: { fontSize: 16 },
      })).rejects.toMatchObject({ code: 'PREFERENCE_VALUE_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects null preference values', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts,
        preferences: { showTimer: null },
      })).rejects.toMatchObject({ code: 'PREFERENCE_VALUE_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects object preference values', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts,
        preferences: { config: { nested: true } },
      })).rejects.toMatchObject({ code: 'PREFERENCE_VALUE_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects unsafe prototype-pollution preference keys', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({
        userId: 7,
        shortcuts,
        preferences: JSON.parse('{"__proto__": "polluted"}'),
      })).rejects.toMatchObject({ code: 'PREFERENCE_KEY_UNSAFE' });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects non-object shortcuts', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({ userId: 7, shortcuts: null, preferences }))
        .rejects.toMatchObject({ code: 'SHORTCUTS_INVALID' });
    });

    it('rejects non-object preferences', async () => {
      const { upsertSettings } = loadSettings();
      await expect(upsertSettings({ userId: 7, shortcuts, preferences: 'dark' }))
        .rejects.toMatchObject({ code: 'PREFERENCES_INVALID' });
    });
  });

  describe('getSettings', () => {
    it('queries by user_id and returns null when no row exists', async () => {
      db.query.mockResolvedValueOnce([[]]); // no row
      const { getSettings } = loadSettings();
      const result = await getSettings(7);
      expect(result).toBeNull();
      expect(db.query).toHaveBeenCalledWith(expect.any(String), [7]);
    });

    it('parses JSON columns returned as strings by the mysql2 driver', async () => {
      db.query.mockResolvedValueOnce([[{
        shortcuts: JSON.stringify({ previousSlide: 'ArrowLeft' }),
        preferences: JSON.stringify({ showTimer: true }),
        created_at: '2026-09-03T00:00:00.000Z',
        updated_at: '2026-09-03T00:00:00.000Z',
      }]]);
      const { getSettings } = loadSettings();
      const result = await getSettings(7);
      expect(result).toMatchObject({
        shortcuts: { previousSlide: 'ArrowLeft' },
        preferences: { showTimer: true },
        createdAt: '2026-09-03T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
      });
    });

    it('returns already-parsed JSON columns when the driver parses them', async () => {
      db.query.mockResolvedValueOnce([[{
        shortcuts: { previousSlide: 'ArrowLeft' },
        preferences: { showTimer: true },
        created_at: '2026-09-03T00:00:00.000Z',
        updated_at: '2026-09-03T00:00:00.000Z',
      }]]);
      const { getSettings } = loadSettings();
      const result = await getSettings(7);
      expect(result.shortcuts).toEqual({ previousSlide: 'ArrowLeft' });
      expect(result.preferences).toEqual({ showTimer: true });
    });
  });

  describe('SHORTCUT_ACTIONS export', () => {
    it('exports the eight authorized action names', () => {
      const { SHORTCUT_ACTIONS } = loadSettings();
      expect(SHORTCUT_ACTIONS).toEqual([
        'previousSlide', 'nextSlide', 'animationPrevious', 'animationNext',
        'animationPlay', 'animationPause', 'toggleDrawing', 'toggleFullscreen',
      ]);
      expect(Object.isFrozen(SHORTCUT_ACTIONS)).toBe(true);
    });
  });
});
