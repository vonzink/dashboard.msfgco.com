import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createInboxService } = require('../../services/infoInbox');

const raw = 'From: Sender <sender@example.com>\r\nTo: info@msfginfo.com\r\nSubject: =?UTF-8?B?UmF0ZXM=?=\r\nDate: Fri, 25 Sep 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nToday\'s rates.\r\n';
function fixture(entries = {}, { failWrite = false } = {}) {
  const objects = new Map(Object.entries(entries));
  const s3 = { async send(command) {
    const i = command.input;
    if (command.constructor.name === 'ListObjectsV2Command') {
      const keys = [...objects.keys()].filter(k => k.startsWith(i.Prefix || '')).sort();
      const offset = Number(i.ContinuationToken || 0);
      return { Contents: keys.slice(offset, offset + 2).map(Key => ({ Key, Size: Buffer.byteLength(objects.get(Key)), LastModified: new Date('2026-09-25T10:00:00Z') })), IsTruncated: offset + 2 < keys.length, NextContinuationToken: String(offset + 2) };
    }
    if (command.constructor.name === 'GetObjectCommand') {
      if (!objects.has(i.Key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      const body = objects.get(i.Key);
      return { Body: { transformToString: async () => body }, ContentLength: Buffer.byteLength(body) };
    }
    if (command.constructor.name === 'PutObjectCommand') {
      if (failWrite) throw new Error('unavailable');
      if (i.IfNoneMatch === '*' && objects.has(i.Key)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      objects.set(i.Key, i.Body);
      return {};
    }
    throw new Error('Unexpected operation: ' + command.constructor.name);
  } };
  return { objects, service: createInboxService({ s3 }) };
}

describe('mailbox migration', () => {
  it('cleans every page of incoming mail without deleting originals or changing the viewer', async () => {
    const { objects, service } = fixture({ 'info_emails/a': raw, 'info_emails/b': raw, 'info_emails/c': raw, 'viewer/index.html': '<html>viewer</html>', 'unrelated': 'keep' });
    const result = await service.clean();
    expect(result.processed).toBe(3);
    expect(objects.get('info_emails/a')).toBe(raw);
    expect(objects.get('info_emails/c')).toBe(raw);
    expect(objects.get('viewer/index.html')).toBe('<html>viewer</html>');
    expect(objects.has('cleaned/viewer/index.html')).toBe(false);
    expect(objects.has('cleaned/unrelated')).toBe(false);
    expect(objects.get('cleaned/info_emails/c')).toContain('Subject: Rates');
    expect(objects.get('cleaned/info_emails/c')).toContain("Today's rates.");
  });
  it('preserves existing cleaned copies on repeated runs', async () => {
    const { objects, service } = fixture({ 'info_emails/a': raw, 'cleaned/info_emails/a': 'legacy copy' });
    const result = await service.clean();
    expect(result.skipped).toBe(1);
    expect(objects.get('cleaned/info_emails/a')).toBe('legacy copy');
  });
  it('leaves originals intact and reports a failed upload', async () => {
    const { objects, service } = fixture({ 'info_emails/a': raw }, { failWrite: true });
    expect((await service.clean()).failed).toBe(1);
    expect(objects.get('info_emails/a')).toBe(raw);
    expect(objects.has('cleaned/info_emails/a')).toBe(false);
  });
  it('dry run reports candidates without writing copies', async () => {
    const { objects, service } = fixture({ 'info_emails/a': raw });
    expect((await service.clean({ dryRun: true })).pending).toBe(1);
    expect(objects.size).toBe(1);
  });
  it('handles an empty incoming prefix', async () => {
    const { service } = fixture();
    expect(await service.clean()).toMatchObject({ processed: 0, failed: 0 });
  });
  it('lists old cleaned mail and new originals once, excluding non-mail files', async () => {
    const { service } = fixture({ 'info_emails/a': raw, 'cleaned/info_emails/a': raw, 'cleaned/info_emails/b': raw, 'cleaned/viewer/index.html': 'not an email', 'viewer/index.html': 'viewer', 'cleaned/info_emails/': '' });
    const result = await service.list();
    expect(result.total).toBe(2);
    expect(result.items.map(m => m.key).sort()).toEqual(['cleaned/info_emails/b', 'info_emails/a']);
    expect(result.items[0].subject).toBe('Rates');
  });
  it('reads a legacy cleaned message whose original no longer exists', async () => {
    const { service } = fixture({ 'cleaned/info_emails/a': raw });
    expect(await service.get('cleaned/info_emails/a')).toMatchObject({ subject: 'Rates', text: expect.stringContaining("Today's rates.") });
  });
  it.each(['viewer/index.html', 'cleaned/viewer/index.html', 'info_emails/', '../secret', 'info_emails/../viewer/index.html'])('rejects non-mail key %s', async key => {
    const { service } = fixture({ [key]: raw });
    await expect(service.get(key)).rejects.toMatchObject({ status: 400 });
  });
});
