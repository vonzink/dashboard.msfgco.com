import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { askAiQuestion } = require('../../validation/schemas/askAi');

describe('askAiQuestion.mode', () => {
  it('defaults to dashboard when omitted', () => {
    expect(askAiQuestion.parse({ question: 'q' }).mode).toBe('dashboard');
  });

  it('accepts the open mode', () => {
    expect(askAiQuestion.parse({ question: 'q', mode: 'open' }).mode).toBe('open');
  });

  it('rejects an unknown mode', () => {
    expect(() => askAiQuestion.parse({ question: 'q', mode: 'nope' })).toThrow();
  });
});
