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

function loadCalendarState() {
  const source = readFileSync(
    resolve(process.cwd(), '../Calculators/Company Calendar/calendar-state.js'),
    'utf8'
  );
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.CalendarState;
}

function loadCalendarApi(fetchImpl) {
  const source = readFileSync(
    resolve(process.cwd(), '../Calculators/Company Calendar/calendar-api.js'),
    'utf8'
  );
  const context = {
    window: {
      location: { protocol: 'https:' },
      CalendarApi: null,
    },
    document: { cookie: '' },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    fetch: fetchImpl,
    URLSearchParams,
    Error,
  };
  vm.runInNewContext(source, context);
  return context.window.CalendarApi;
}

function loadCalendarRender() {
  const context = { window: {} };
  for (const file of ['calendar-state.js', 'calendar-render.js']) {
    const source = readFileSync(
      resolve(process.cwd(), `../Calculators/Company Calendar/${file}`),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }
  return context.window.CalendarRender;
}

function loadCalendarDetail() {
  const context = { window: {} };
  for (const file of ['calendar-state.js', 'calendar-render.js', 'calendar-detail.js']) {
    const source = readFileSync(
      resolve(process.cwd(), `../Calculators/Company Calendar/${file}`),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }
  return context.window;
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

describe('calendar state view ranges', () => {
  it('calculates one-month, two-month, and year ranges from the current view date', () => {
    const CalendarState = loadCalendarState();
    const state = CalendarState.createState();
    state.viewDate = new Date(2026, 5, 1);

    state.viewMode = 'month';
    expect(CalendarState.visibleRange(state)).toEqual({
      start_date: '2026-06-01',
      end_date: '2026-06-30',
    });

    state.viewMode = 'two_months';
    expect(CalendarState.visibleRange(state)).toEqual({
      start_date: '2026-06-01',
      end_date: '2026-07-31',
    });

    state.viewMode = 'year';
    expect(CalendarState.visibleRange(state)).toEqual({
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
  });
});

describe('calendar API helpers', () => {
  it('sends imported event visibility updates to the schedule visibility endpoint', async () => {
    const calls = [];
    const CalendarApi = loadCalendarApi(async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });

    await CalendarApi.updateEntryVisibility(42, 'shared_details');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.msfgco.com/api/schedule/entries/42/visibility');
    expect(calls[0].options.method).toBe('PATCH');
    expect(JSON.parse(calls[0].options.body)).toEqual({ visibility: 'shared_details' });
    expect(typeof CalendarApi.getUserDirectory).toBe('function');
  });
});

describe('calendar editor enhanced fields', () => {
  it('renders employee names, NMLS numbers, color controls, and attendee picker fields', () => {
    const context = { window: {} };
    for (const file of ['calendar-state.js', 'calendar-render.js', 'calendar-editor.js']) {
      const source = readFileSync(
        resolve(process.cwd(), `../Calculators/Company Calendar/${file}`),
        'utf8'
      );
      vm.runInNewContext(source, context);
    }

    const state = context.window.CalendarState.createState();
    state.peopleDirectory = [
      { id: 10, name: 'Zachary Zink', email: 'zachary.zink@msfg.us', nmls_number: '451924' },
      { id: 11, name: 'Assistant User', email: 'assistant@msfg.us', nmls_number: null },
    ];
    state.editor = {
      user_id: 10,
      status: 'meeting_event',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      visibility: 'availability_only',
      source: 'manual',
      event_color: '#0F766E',
      attendees: [{ email: 'assistant@msfg.us', name: 'Assistant User' }],
    };

    const html = context.window.CalendarEditor.render(state);
    expect(html).toContain('Zachary Zink - NMLS 451924');
    expect(html).not.toContain('Employee ID');
    expect(html).toContain('name="event_color"');
    expect(html).toContain('Assistant User');
    expect(html).toContain('Hidden from Team');
  });
});

describe('calendar view controls', () => {
  it('renders segmented view buttons for the supported calendar views', () => {
    const CalendarRender = loadCalendarRender();
    const html = CalendarRender.renderViewTabs({ viewMode: 'month' });

    expect(html).toContain('data-view-mode="day"');
    expect(html).toContain('data-view-mode="week"');
    expect(html).toContain('data-view-mode="month"');
    expect(html).toContain('data-view-mode="two_months"');
    expect(html).toContain('data-view-mode="year"');
    expect(html).toContain('data-view-mode="people"');
    expect(html).toContain('data-view-mode="all"');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('calendar multi-day view rendering', () => {
  it('renders week and all-view multi-day bars with span metadata', () => {
    const context = { window: {} };
    for (const file of ['calendar-state.js', 'calendar-render.js', 'calendar-roster.js']) {
      const source = readFileSync(
        resolve(process.cwd(), `../Calculators/Company Calendar/${file}`),
        'utf8'
      );
      vm.runInNewContext(source, context);
    }

    const state = context.window.CalendarState.createState();
    state.viewDate = new Date(2026, 5, 1);
    state.viewMode = 'week';
    state.entries = [{
      id: 30,
      user_id: 10,
      employee_name: 'Zachary Zink',
      status: 'out',
      start_date: '2026-06-02',
      end_date: '2026-06-05',
      visibility: 'availability_only',
      event_color: '#0F766E',
    }];
    state.people = context.window.CalendarRender.derivePeople(state.entries);

    const weekHtml = context.window.CalendarRoster.render(state);
    expect(weekHtml).toContain('week-overview');
    expect(weekHtml).toContain('grid-column');
    expect(weekHtml).toContain('is-hidden-details');

    state.viewMode = 'all';
    const allHtml = context.window.CalendarRoster.render(state);
    expect(allHtml).toContain('all-overview');
    expect(allHtml).toContain('person-timeline-row');
  });
});

describe('calendar detail sharing controls', () => {
  it('renders an owner-only reveal-details control for shareable provider entries', () => {
    const { CalendarDetail, CalendarState } = loadCalendarDetail();
    const state = CalendarState.createState();
    state.me = { id: 10 };
    state.selectedDate = new Date(2026, 5, 1);
    state.entries = [{
      id: 91,
      user_id: 10,
      employee_name: 'Employee User',
      status: 'busy',
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: '09:00:00',
      end_time: '10:00:00',
      note: 'Client review',
      visibility: 'availability_only',
      source: 'outlook',
      source_provider: 'outlook',
      provider_owned: true,
      details_shareable: true,
      provider_sensitivity: 'normal',
    }];

    const ownerHtml = CalendarDetail.render(state);
    expect(ownerHtml).toContain('data-entry-visibility="shared_details"');

    state.me = { id: 11 };
    const coworkerHtml = CalendarDetail.render(state);
    expect(coworkerHtml).not.toContain('data-entry-visibility=');
  });

  it('labels provider-private entries instead of rendering a reveal control', () => {
    const { CalendarDetail, CalendarState } = loadCalendarDetail();
    const state = CalendarState.createState();
    state.me = { id: 10 };
    state.selectedDate = new Date(2026, 5, 1);
    state.entries = [{
      id: 92,
      user_id: 10,
      employee_name: 'Employee User',
      status: 'busy',
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      visibility: 'availability_only',
      source: 'outlook',
      source_provider: 'outlook',
      provider_owned: true,
      details_shareable: false,
      provider_sensitivity: 'private',
    }];

    const html = CalendarDetail.render(state);
    expect(html).toContain('Private in Outlook');
    expect(html).not.toContain('data-entry-visibility="shared_details"');
  });
});
