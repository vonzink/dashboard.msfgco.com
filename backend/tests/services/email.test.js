import { describe, it, expect } from 'vitest';
import {
  htmlToSnippet,
  isValidEmail,
  buildAnnouncementBodies,
} from '../../services/email';

describe('email service helpers', () => {
  it('turns announcement HTML into a clean plain-text snippet', () => {
    const snippet = htmlToSnippet(
      '<p>Rates improved <strong>this week</strong>.</p><div>New 401(k) forms &amp; docs posted.</div><script>alert("x")</script>'
    );
    expect(snippet).toBe('Rates improved this week. New 401(k) forms & docs posted.');
    expect(snippet).not.toContain('<');
    expect(snippet).not.toContain('script');
  });

  it('truncates long snippets with an ellipsis', () => {
    const long = 'word '.repeat(200);
    const snippet = htmlToSnippet(long, 40);
    expect(snippet.length).toBeLessThanOrEqual(40);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('validates email addresses', () => {
    expect(isValidEmail('team.member@msfg.us')).toBe(true);
    expect(isValidEmail('  spaced@msfg.us  ')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });

  it('builds subject, HTML, and text bodies with the title escaped', () => {
    const { subject, html, text } = buildAnnouncementBodies({
      title: 'Rates <down> & "hot"',
      authorName: 'Zack',
      snippet: 'Join us Friday.',
    });

    expect(subject).toContain('Rates <down> & "hot"');
    // HTML escapes the title so markup can't be injected
    expect(html).toContain('Rates &lt;down&gt; &amp; &quot;hot&quot;');
    expect(html).not.toContain('<down>');
    expect(html).toContain('View on the Dashboard');
    expect(html).toContain('Join us Friday.');
    expect(html).toContain('Posted by Zack');
    // Plain-text alternative carries the raw title and byline
    expect(text).toContain('Rates <down> & "hot"');
    expect(text).toContain('Posted by Zack');
    expect(text).toContain('NMLS# 1314257');
  });

  it('omits the byline author when none is given', () => {
    const { html } = buildAnnouncementBodies({ title: 'Heads up' });
    expect(html).toContain('A new item was just posted');
    expect(html).not.toContain('Posted by');
  });
});
