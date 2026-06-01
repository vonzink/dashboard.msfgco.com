import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadCalendarSync() {
  const source = readFileSync(
    resolve(process.cwd(), '../Calculators/Company Calendar/calendar-sync.js'),
    'utf8'
  );
  const context = {
    window: {
      MSFG_CALENDAR_ENABLE_GOOGLE_SYNC: false,
      CalendarRender: {
        escapeHtml(value) {
          return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        },
      },
    },
  };
  vm.runInNewContext(source, context);
  return context.window.CalendarSync;
}

describe('calendar sync settings UI', () => {
  it('keeps calendar connections behind a settings cog until opened', () => {
    const CalendarSync = loadCalendarSync();
    const closedState = { syncConnections: [], syncSettingsOpen: false };
    const openState = { syncConnections: [], syncSettingsOpen: true };

    expect(CalendarSync.renderTrigger(closedState)).toContain('data-sync-settings-toggle');
    expect(CalendarSync.renderTrigger(closedState)).toContain('aria-label="Calendar connection settings"');
    expect(CalendarSync.render(closedState)).not.toContain('Calendar Connections');
    expect(CalendarSync.render(openState)).toContain('role="dialog"');
    expect(CalendarSync.render(openState)).toContain('Calendar Connections');
  });
});
