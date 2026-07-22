import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { askAiQuestion } = require('../../validation/schemas');

describe('askAiQuestion schema', () => {
  it('accepts a plain question and trims it', () => {
    const r = askAiQuestion.safeParse({ question: '  Where are funded loans?  ' });
    expect(r.success).toBe(true);
    expect(r.data.question).toBe('Where are funded loans?');
  });

  it('rejects a missing or blank question', () => {
    expect(askAiQuestion.safeParse({}).success).toBe(false);
    expect(askAiQuestion.safeParse({ question: '   ' }).success).toBe(false);
  });

  it('caps question at 2000 chars (engine limit)', () => {
    expect(askAiQuestion.safeParse({ question: 'x'.repeat(2000) }).success).toBe(true);
    expect(askAiQuestion.safeParse({ question: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('accepts optional conversationId and pageRoute', () => {
    const r = askAiQuestion.safeParse({
      question: 'q', conversationId: 'e5e48b02-aaaa', pageRoute: 'pipeline',
    });
    expect(r.success).toBe(true);
    expect(r.data.conversationId).toBe('e5e48b02-aaaa');
    expect(r.data.pageRoute).toBe('pipeline');
  });

  it('rejects unexpected junk types', () => {
    expect(askAiQuestion.safeParse({ question: 42 }).success).toBe(false);
    expect(askAiQuestion.safeParse({ question: 'q', conversationId: 12 }).success).toBe(false);
  });
});
