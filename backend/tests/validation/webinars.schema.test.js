import { describe, expect, it } from 'vitest';
import { webinarSlug } from '../../validation/schemas/webinars';

describe('webinar slug schema', () => {
  it('accepts lowercase words joined by single dashes', () => {
    for (const slug of ['reverse-mortgages', 'va', 'homebuyers', 'first-home-without-mystery', 'rates-2']) {
      expect(webinarSlug.safeParse(slug).success, slug).toBe(true);
    }
  });

  it('rejects anything that is not a plain slug', () => {
    for (const slug of ['', 'Not valid', 'Reverse', 'a--b', '-a', 'a-', 'a_b', 'a/b', '_master', 'x'.repeat(191)]) {
      expect(webinarSlug.safeParse(slug).success, JSON.stringify(slug)).toBe(false);
    }
  });
});
