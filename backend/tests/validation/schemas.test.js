import { describe, it, expect } from 'vitest';
import { chatMessage, announcement, preApproval, pipelineUpdate, goalsUpdate } from '../../validation/schemas';

describe('chatMessage schema', () => {
  it('accepts valid message', () => {
    const result = chatMessage.safeParse({ message: 'Hello world', tag_ids: [1, 2] });
    expect(result.success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = chatMessage.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects message over 2000 chars', () => {
    const result = chatMessage.safeParse({ message: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('defaults tag_ids to empty array', () => {
    const result = chatMessage.safeParse({ message: 'hello' });
    expect(result.success).toBe(true);
    expect(result.data.tag_ids).toEqual([]);
  });

  it('trims whitespace from message', () => {
    const result = chatMessage.safeParse({ message: '  hello  ' });
    expect(result.success).toBe(true);
    expect(result.data.message).toBe('hello');
  });
});

describe('announcement schema', () => {
  it('accepts valid announcement', () => {
    const result = announcement.safeParse({ title: 'Test', content: 'Content here' });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = announcement.safeParse({ content: 'Content here' });
    expect(result.success).toBe(false);
  });

  it('rejects title over 200 chars', () => {
    const result = announcement.safeParse({ title: 'x'.repeat(201), content: 'ok' });
    expect(result.success).toBe(false);
  });
});

describe('preApproval schema', () => {
  const valid = {
    client_name: 'John Doe',
    loan_amount: 250000,
    pre_approval_date: '2026-01-15',
    expiration_date: '2026-04-15',
  };

  it('accepts valid pre-approval', () => {
    expect(preApproval.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid date format', () => {
    const result = preApproval.safeParse({ ...valid, pre_approval_date: '01/15/2026' });
    expect(result.success).toBe(false);
  });

  it('rejects negative loan amount', () => {
    const result = preApproval.safeParse({ ...valid, loan_amount: -100 });
    expect(result.success).toBe(false);
  });

  it('defaults status to active', () => {
    const result = preApproval.safeParse(valid);
    expect(result.data.status).toBe('active');
  });
});

describe('pipelineUpdate schema', () => {
  it('accepts partial update', () => {
    const result = pipelineUpdate.safeParse({ client_name: 'Jane' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields (strict)', () => {
    const result = pipelineUpdate.safeParse({ unknown_field: 'value' });
    expect(result.success).toBe(false);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = pipelineUpdate.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('goalsUpdate schema', () => {
  const validGoal = {
    period_type: 'monthly',
    period_value: '2026-01',
    goal_type: 'units',
    target_value: 10,
  };

  it('accepts single goal', () => {
    expect(goalsUpdate.safeParse(validGoal).success).toBe(true);
  });

  it('accepts array of goals', () => {
    expect(goalsUpdate.safeParse([validGoal, { ...validGoal, goal_type: 'volume', target_value: 5000000 }]).success).toBe(true);
  });

  it('rejects invalid period_type', () => {
    const result = goalsUpdate.safeParse({ ...validGoal, period_type: 'weekly' });
    expect(result.success).toBe(false);
  });

  it('rejects negative target_value', () => {
    const result = goalsUpdate.safeParse({ ...validGoal, target_value: -1 });
    expect(result.success).toBe(false);
  });
});
