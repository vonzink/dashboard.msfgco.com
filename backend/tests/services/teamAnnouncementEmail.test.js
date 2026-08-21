import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  buildEmail,
  normalizeRecipients,
  sendAnnouncementEmail,
} = require('../../services/teamAnnouncementEmail');

describe('team announcement email', () => {
  it('deduplicates and validates recipients', () => {
    expect(normalizeRecipients([
      ' Zachary.Zink@msfg.us ',
      'zachary.zink@msfg.us',
      'not-an-email',
      '',
    ])).toEqual(['zachary.zink@msfg.us']);
  });

  it('builds HTML and text versions without expiring inline images', () => {
    const email = buildEmail({
      title: 'Team Update',
      content: '<p>Hello <strong>team</strong>.</p><img src="https://temporary.example/image.png">',
      links: [{ label: 'Details', url: 'https://example.com/details' }],
      authorName: 'Test User',
    });

    expect(email.subject).toBe('[MSFG Team] Team Update');
    expect(email.html).toContain('<strong>team</strong>');
    expect(email.html).not.toContain('<img');
    expect(email.text).toContain('Hello team.');
    expect(email.text).toContain('Details: https://example.com/details');
  });

  it('sends recipients in private batches of at most 50', async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: 'message-id' });
    const recipients = Array.from({ length: 51 }, (_, index) => `user${index}@example.com`);

    const result = await sendAnnouncementEmail({
      title: 'Update',
      content: '<p>News</p>',
      authorName: 'Test User',
      recipients,
    }, { send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].input.Destination.BccAddresses).toHaveLength(50);
    expect(send.mock.calls[1][0].input.Destination.BccAddresses).toHaveLength(1);
    expect(send.mock.calls[0][0].input.Destination.ToAddresses).toBeUndefined();
    expect(result).toEqual(expect.objectContaining({
      sent: true,
      recipientCount: 51,
      messageCount: 2,
    }));
  });
});
