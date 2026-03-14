import { describe, it, expect } from 'vitest';
import {
  notification, calendarEvent, task, taskUpdate, investor,
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
