import { describe, it, expect } from 'vitest';
import {
  buildAnnouncementImagePrompt,
  extractGeneratedImageBase64,
  normalizeAnnouncementLinks,
} from '../../utils/announcementMedia';

describe('announcement media utilities', () => {
  it('builds a concise image prompt from announcement HTML without leaking tags', () => {
    const prompt = buildAnnouncementImagePrompt({
      title: 'May Rate Rally',
      content: '<p>Rates improved <strong>this week</strong>.</p><script>alert("x")</script>',
    });

    expect(prompt).toContain('May Rate Rally');
    expect(prompt).toContain('Rates improved this week');
    expect(prompt).toContain('professional mortgage company announcement');
    expect(prompt).not.toContain('<strong>');
    expect(prompt).not.toContain('<script>');
  });

  it('extracts base64 data from Image API and Responses API shapes', () => {
    expect(extractGeneratedImageBase64({ data: [{ b64_json: 'image-api-data' }] })).toBe('image-api-data');
    expect(extractGeneratedImageBase64({
      output: [
        { type: 'message', content: [] },
        { type: 'image_generation_call', result: 'responses-data' },
      ],
    })).toBe('responses-data');
  });

  it('normalizes announcement links while dropping blank rows', () => {
    const links = normalizeAnnouncementLinks([
      { label: '  Rate Sheet ', url: ' https://example.com/rates ' },
      { label: '', url: '' },
      { url: 'https://example.com/events' },
    ]);

    expect(links).toEqual([
      { label: 'Rate Sheet', url: 'https://example.com/rates' },
      { label: 'Link 2', url: 'https://example.com/events' },
    ]);
  });
});
