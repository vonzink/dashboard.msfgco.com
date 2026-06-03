import { describe, it, expect } from 'vitest';
import {
  notification, calendarEvent, scheduleEntry, scheduleEntryUpdate, scheduleEntryQuery, task, taskUpdate, investor,
  calendarSyncConnectionStart, calendarSyncRun, scheduleEntryVisibilityUpdate,
  contentGenerate, contentItemUpdate, contentTemplate, contentTemplateUpdate,
  contentPublishBatch, guidelineUpload, guidelineSearch,
  handbookSearch, handbookSectionUpdate, handbookSectionCreate,
} from '../../validation/schemas';

// ── Notification ─────────────────────────────
describe('notification schema', () => {
  const valid = {
    user_id: 1,
    reminder_date: '2026-04-01',
    reminder_time: '09:00',
    note: 'Follow up with client',
  };

  it('accepts valid notification', () => {
    expect(notification.safeParse(valid).success).toBe(true);
  });

  it('defaults delivery_method to email', () => {
    const result = notification.safeParse(valid);
    expect(result.data.delivery_method).toBe('email');
  });

  it('defaults recurrence to none', () => {
    const result = notification.safeParse(valid);
    expect(result.data.recurrence).toBe('none');
  });

  it('rejects invalid time format', () => {
    expect(notification.safeParse({ ...valid, reminder_time: '9am' }).success).toBe(false);
  });

  it('rejects invalid delivery_method', () => {
    expect(notification.safeParse({ ...valid, delivery_method: 'pigeon' }).success).toBe(false);
  });

  it('accepts HH:MM:SS format', () => {
    expect(notification.safeParse({ ...valid, reminder_time: '14:30:00' }).success).toBe(true);
  });
});

// ── Calendar Event ───────────────────────────
describe('calendarEvent schema', () => {
  const valid = { title: 'Team Meeting', start: '2026-04-01T10:00:00Z' };

  it('accepts valid event', () => {
    expect(calendarEvent.safeParse(valid).success).toBe(true);
  });

  it('rejects missing title', () => {
    expect(calendarEvent.safeParse({ start: '2026-04-01T10:00:00Z' }).success).toBe(false);
  });

  it('rejects missing start', () => {
    expect(calendarEvent.safeParse({ title: 'Test' }).success).toBe(false);
  });

  it('defaults allDay to false', () => {
    const result = calendarEvent.safeParse(valid);
    expect(result.data.allDay).toBe(false);
  });

  it('defaults recurrence_rule to none', () => {
    const result = calendarEvent.safeParse(valid);
    expect(result.data.recurrence_rule).toBe('none');
  });

  it('accepts valid recurrence rules', () => {
    for (const rule of ['daily', 'weekly', 'biweekly', 'monthly', 'yearly']) {
      expect(calendarEvent.safeParse({ ...valid, recurrence_rule: rule }).success).toBe(true);
    }
  });
});

describe('scheduleEntry schema', () => {
  const valid = {
    user_id: 7,
    status: 'out',
    start_date: '2026-06-01',
    end_date: '2026-06-03',
    start_time: null,
    end_time: null,
    timezone: 'America/Denver',
    note: 'Conference',
    visibility: 'shared_details',
    source: 'manual',
  };

  it('accepts a valid manual availability entry', () => {
    const result = scheduleEntry.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('out');
    expect(result.data.visibility).toBe('shared_details');
  });

  it('defaults imported event visibility to availability only', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      source: 'outlook',
      visibility: undefined,
      status: 'busy',
    });
    expect(result.success).toBe(true);
    expect(result.data.visibility).toBe('availability_only');
  });

  it('accepts provider detail metadata for imported schedule entries', () => {
    const result = scheduleEntry.safeParse({
      user_id: 7,
      status: 'busy',
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      visibility: 'availability_only',
      source: 'outlook',
      source_provider: 'outlook',
      source_event_id: 'outlook-1',
      details_shareable: true,
      provider_sensitivity: 'normal',
      note: 'Client review',
    });

    expect(result.success).toBe(true);
    expect(result.data.details_shareable).toBe(true);
    expect(result.data.provider_sensitivity).toBe('normal');
  });

  it('accepts event color, attendees, and send_updates on schedule entries', () => {
    const result = scheduleEntry.safeParse({
      user_id: 10,
      status: 'meeting_event',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      event_color: '#0F766E',
      attendees: [
        { user_id: 11, email: 'assistant@msfg.us', name: 'Assistant User' },
      ],
      send_updates: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.event_color).toBe('#0F766E');
    expect(result.data.attendees).toEqual([
      { user_id: 11, email: 'assistant@msfg.us', name: 'Assistant User' },
    ]);
    expect(result.data.send_updates).toBe(true);
  });

  it('rejects invalid event colors and attendee emails', () => {
    expect(scheduleEntry.safeParse({
      user_id: 10,
      status: 'busy',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      event_color: 'red',
    }).success).toBe(false);

    expect(scheduleEntry.safeParse({
      user_id: 10,
      status: 'busy',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      attendees: [{ email: 'not-an-email', name: 'Bad Email' }],
    }).success).toBe(false);
  });

  it('rejects PTO as a status', () => {
    expect(scheduleEntry.safeParse({ ...valid, status: 'pto' }).success).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      start_date: '2026-06-03',
      end_date: '2026-06-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects impossible start dates', () => {
    expect(scheduleEntry.safeParse({ ...valid, start_date: '2026-02-31' }).success).toBe(false);
  });

  it('rejects impossible end dates', () => {
    expect(scheduleEntry.safeParse({ ...valid, end_date: '2026-13-01' }).success).toBe(false);
  });

  it('rejects an end time before the start time on the same date', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: '15:00',
      end_time: '09:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects equal start and end times on the same date', () => {
    const result = scheduleEntry.safeParse({
      ...valid,
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: '09:00',
      end_time: '09:00',
    });
    expect(result.success).toBe(false);
  });
});

describe('scheduleEntryUpdate schema', () => {
  it('accepts partial updates', () => {
    expect(scheduleEntryUpdate.safeParse({ status: 'remote' }).success).toBe(true);
  });

  it('does not apply create defaults to partial updates', () => {
    const result = scheduleEntryUpdate.safeParse({ status: 'remote' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'remote' });
  });

  it('rejects equal start and end times on the same date', () => {
    const result = scheduleEntryUpdate.safeParse({
      start_date: '2026-06-01',
      end_date: '2026-06-01',
      start_time: '09:00',
      end_time: '09:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown update fields', () => {
    expect(scheduleEntryUpdate.safeParse({ paid_hours: 8 }).success).toBe(false);
  });

  it('rejects impossible start dates', () => {
    expect(scheduleEntryUpdate.safeParse({ start_date: '2026-02-31' }).success).toBe(false);
  });
});

describe('scheduleEntryQuery schema', () => {
  it('accepts valid schedule query filters', () => {
    const result = scheduleEntryQuery.safeParse({
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      user_id: '7',
      status: 'busy',
      source: 'outlook',
    });
    expect(result.success).toBe(true);
    expect(result.data.user_id).toBe(7);
  });

  it('rejects impossible query dates', () => {
    const result = scheduleEntryQuery.safeParse({
      start_date: '2026-02-31',
      end_date: '2026-03-01',
    });
    expect(result.success).toBe(false);
  });
});

describe('calendar sync schemas', () => {
  it('accepts a valid sync connection start request', () => {
    const result = calendarSyncConnectionStart.safeParse({
      provider: 'outlook',
      privacy_default: 'availability_only',
      sync_enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported providers', () => {
    const result = calendarSyncConnectionStart.safeParse({
      provider: 'icloud',
      privacy_default: 'availability_only',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an on-demand sync run request', () => {
    const result = calendarSyncRun.safeParse({ provider: 'google' });
    expect(result.success).toBe(true);
  });
});

describe('scheduleEntryVisibilityUpdate schema', () => {
  it('accepts supported visibility values', () => {
    expect(scheduleEntryVisibilityUpdate.safeParse({ visibility: 'shared_details' }).success).toBe(true);
    expect(scheduleEntryVisibilityUpdate.safeParse({ visibility: 'availability_only' }).success).toBe(true);
  });

  it('rejects unsupported visibility values', () => {
    expect(scheduleEntryVisibilityUpdate.safeParse({ visibility: 'public' }).success).toBe(false);
  });
});

// ── Task ─────────────────────────────────────
describe('task schema', () => {
  const valid = { title: 'Fix the thing' };

  it('accepts minimal task', () => {
    expect(task.safeParse(valid).success).toBe(true);
  });

  it('defaults priority to medium', () => {
    expect(task.safeParse(valid).data.priority).toBe('medium');
  });

  it('defaults status to todo', () => {
    expect(task.safeParse(valid).data.status).toBe('todo');
  });

  it('rejects invalid priority', () => {
    expect(task.safeParse({ ...valid, priority: 'critical' }).success).toBe(false);
  });

  it('rejects title over 200 chars', () => {
    expect(task.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('taskUpdate schema', () => {
  it('accepts partial update', () => {
    expect(taskUpdate.safeParse({ status: 'done' }).success).toBe(true);
  });

  it('accepts empty object (partial with defaults fills keys)', () => {
    // .partial() makes all fields optional; defaults like priority='medium' fill in,
    // so Object.keys(data).length > 0 passes the refine check
    expect(taskUpdate.safeParse({}).success).toBe(true);
  });
});

// ── Investor ─────────────────────────────────
describe('investor schema', () => {
  it('accepts valid investor', () => {
    expect(investor.safeParse({ name: 'Test Bank' }).success).toBe(true);
  });

  it('rejects missing name', () => {
    expect(investor.safeParse({}).success).toBe(false);
  });

  it('accepts all optional fields', () => {
    const result = investor.safeParse({
      name: 'Test',
      account_executive_name: 'Jane',
      account_executive_email: 'jane@test.com',
      states: 'WV, VA',
      minimum_fico: '640',
      website_url: 'https://test.com',
    });
    expect(result.success).toBe(true);
  });
});

// ── Content Generate ─────────────────────────
describe('contentGenerate schema', () => {
  it('accepts valid generation request', () => {
    const result = contentGenerate.safeParse({
      suggestion: 'Write about mortgage rates',
      platforms: ['linkedin', 'facebook'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty platforms array', () => {
    expect(contentGenerate.safeParse({ suggestion: 'test', platforms: [] }).success).toBe(false);
  });

  it('rejects missing suggestion', () => {
    expect(contentGenerate.safeParse({ platforms: ['linkedin'] }).success).toBe(false);
  });

  it('defaults save_drafts to false', () => {
    const result = contentGenerate.safeParse({ suggestion: 'test', platforms: ['x'] });
    expect(result.data.save_drafts).toBe(false);
  });
});

// ── Content Item Update ──────────────────────
describe('contentItemUpdate schema', () => {
  it('accepts text update', () => {
    expect(contentItemUpdate.safeParse({ text_content: 'Updated post' }).success).toBe(true);
  });

  it('accepts status update', () => {
    expect(contentItemUpdate.safeParse({ status: 'approved' }).success).toBe(true);
  });

  it('rejects empty object', () => {
    expect(contentItemUpdate.safeParse({}).success).toBe(false);
  });

  it('accepts hashtags as array', () => {
    const result = contentItemUpdate.safeParse({ hashtags: ['#mortgage', '#homebuying'] });
    expect(result.success).toBe(true);
  });
});

// ── Content Template ─────────────────────────
describe('contentTemplate schema', () => {
  const valid = {
    platform: 'linkedin',
    name: 'Professional Post',
    system_prompt: 'You are a mortgage industry expert...',
  };

  it('accepts valid template', () => {
    expect(contentTemplate.safeParse(valid).success).toBe(true);
  });

  it('rejects missing system_prompt', () => {
    expect(contentTemplate.safeParse({ platform: 'x', name: 'Test' }).success).toBe(false);
  });

  it('defaults is_default to false', () => {
    expect(contentTemplate.safeParse(valid).data.is_default).toBe(false);
  });

  it('accepts temperature between 0 and 2', () => {
    expect(contentTemplate.safeParse({ ...valid, temperature: 0.7 }).success).toBe(true);
    expect(contentTemplate.safeParse({ ...valid, temperature: 2.5 }).success).toBe(false);
  });
});

describe('contentTemplateUpdate schema', () => {
  it('accepts partial update', () => {
    expect(contentTemplateUpdate.safeParse({ name: 'New Name' }).success).toBe(true);
  });

  it('accepts empty object (partial with defaults fills keys)', () => {
    // is_default defaults to false, is_company_wide defaults to false → keys > 0
    expect(contentTemplateUpdate.safeParse({}).success).toBe(true);
  });
});

// ── Content Publish Batch ────────────────────
describe('contentPublishBatch schema', () => {
  it('accepts valid batch', () => {
    expect(contentPublishBatch.safeParse({ item_ids: [1, 2, 3] }).success).toBe(true);
  });

  it('rejects empty item_ids', () => {
    expect(contentPublishBatch.safeParse({ item_ids: [] }).success).toBe(false);
  });

  it('rejects more than 20 items', () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    expect(contentPublishBatch.safeParse({ item_ids: ids }).success).toBe(false);
  });

  it('accepts optional method', () => {
    expect(contentPublishBatch.safeParse({ item_ids: [1], method: 'n8n' }).success).toBe(true);
    expect(contentPublishBatch.safeParse({ item_ids: [1], method: 'invalid' }).success).toBe(false);
  });
});

// ── Guidelines ───────────────────────────────
describe('guidelineUpload schema', () => {
  it('accepts valid upload', () => {
    const result = guidelineUpload.safeParse({
      fileName: 'conventional-guide.pdf',
      fileSize: 1024000,
      productType: 'conventional',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid product type', () => {
    expect(guidelineUpload.safeParse({
      fileName: 'test.pdf', fileSize: 100, productType: 'heloc',
    }).success).toBe(false);
  });
});

describe('guidelineSearch schema', () => {
  it('accepts valid search', () => {
    expect(guidelineSearch.safeParse({ q: 'DTI limits' }).success).toBe(true);
  });

  it('rejects empty query', () => {
    expect(guidelineSearch.safeParse({ q: '' }).success).toBe(false);
  });

  it('defaults page to 1 and limit to 20', () => {
    const result = guidelineSearch.safeParse({ q: 'test' });
    expect(result.data.page).toBe(1);
    expect(result.data.limit).toBe(20);
  });
});

// ── Handbook ─────────────────────────────────
describe('handbookSearch schema', () => {
  it('accepts valid search', () => {
    expect(handbookSearch.safeParse({ q: 'PTO policy' }).success).toBe(true);
  });

  it('defaults limit to 50', () => {
    expect(handbookSearch.safeParse({ q: 'test' }).data.limit).toBe(50);
  });
});

describe('handbookSectionUpdate schema', () => {
  it('accepts valid update', () => {
    const result = handbookSectionUpdate.safeParse({ title: 'Updated Title', content: 'New content' });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    expect(handbookSectionUpdate.safeParse({ content: 'test' }).success).toBe(false);
  });
});

describe('handbookSectionCreate schema', () => {
  it('accepts with just title', () => {
    const result = handbookSectionCreate.safeParse({ title: 'New Section' });
    expect(result.success).toBe(true);
    expect(result.data.content).toBe('');
  });
});
