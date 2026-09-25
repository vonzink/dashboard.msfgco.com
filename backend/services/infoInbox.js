const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { fromInstanceMetadata } = require('@aws-sdk/credential-providers');
const { simpleParser } = require('mailparser');

const BUCKET = 'msfginfo-emails';
const INCOMING = 'info_emails/';
const CLEANED = 'cleaned/info_emails/';
const MAX_BYTES = 30 * 1024 * 1024;

function isMailKey(key) {
  return typeof key === 'string' && key.length <= 1024
    && (key.startsWith(INCOMING) || key.startsWith(CLEANED))
    && !key.endsWith('/') && !key.split('/').some(p => p === '..' || p === '.')
    && !Array.from(key).some(character => character.charCodeAt(0) < 32);
}

function createInboxService({ s3, bucket = BUCKET } = {}) {
  s3 ||= new S3Client({
    region: 'us-east-1',
    // Production must use the instance role, never the retired IAM access key.
    ...(process.env.NODE_ENV === 'production' ? { credentials: fromInstanceMetadata() } : {}),
  });

  async function listAll(prefix) {
    const objects = [];
    let token;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      objects.push(...(page.Contents || []).filter(o => o.Size > 0 && isMailKey(o.Key)));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token) throw new Error('Incomplete S3 listing');
    } while (token);
    return objects;
  }

  async function read(key, headersOnly = false) {
    if (!isMailKey(key)) throw Object.assign(new Error('Invalid email key'), { status: 400 });
    let data;
    try {
      data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(headersOnly ? { Range: 'bytes=0-16383' } : {}) }));
    } catch (error) {
      if (error.name === 'NoSuchKey') throw Object.assign(new Error('Email not found'), { status: 404 });
      throw error;
    }
    if (data.ContentLength > MAX_BYTES) {
      data.Body.destroy?.();
      throw Object.assign(new Error('Email exceeds the 30 MB viewing limit'), { status: 413 });
    }
    const raw = await data.Body.transformToString();
    // Legacy copies contain plain text, not MIME. Header parsing still decodes subjects.
    const parsed = await simpleParser(headersOnly ? raw.split(/\r?\n\r?\n/)[0] + '\r\n\r\n' : raw);
    const result = {
      key, from: parsed.from?.text || '', to: parsed.to?.text || '',
      subject: parsed.subject || '(No subject)', date: parsed.date?.toISOString() || null,
    };
    if (!headersOnly) {
      result.text = parsed.text || '(No text content)';
      // Legacy text copies cannot recover formatting or attachments removed by the old job.
      result.html = key.startsWith(INCOMING) ? parsed.html || null : null;
      result.archived = key.startsWith(CLEANED);
    }
    return result;
  }

  async function list({ offset = 0, limit = 100 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw Object.assign(new Error('Invalid page'), { status: 400 });
    }
    const [raw, cleaned] = await Promise.all([listAll(INCOMING), listAll(CLEANED)]);
    const unique = new Map(cleaned.map(o => [o.Key.slice('cleaned/'.length), o]));
    for (const object of raw) unique.set(object.Key, object);
    const all = [...unique.values()].sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified) || a.Key.localeCompare(b.Key));
    const selected = all.slice(offset, offset + limit);
    const items = [];
    // Bound S3 reads instead of launching a request for every message at once.
    for (let n = 0; n < selected.length; n += 8) {
      items.push(...await Promise.all(selected.slice(n, n + 8).map(async o => ({
        ...await read(o.Key, true), lastModified: o.LastModified,
      }))));
    }
    return { items, total: all.length, nextOffset: offset + selected.length < all.length ? offset + selected.length : null };
  }

  async function clean({ dryRun = false } = {}) {
    const [raw, cleaned] = await Promise.all([listAll(INCOMING), listAll(CLEANED)]);
    const existing = new Set(cleaned.map(o => o.Key));
    const result = { scanned: raw.length, processed: 0, skipped: 0, pending: 0, failed: 0, dryRun };
    const line = value => String(value || '').replace(/[\r\n]+/g, ' ');
    for (const object of raw) {
      const newKey = `cleaned/${object.Key}`;
      if (existing.has(newKey)) { result.skipped++; continue; }
      result.pending++;
      if (dryRun) continue;
      try {
        const email = await read(object.Key);
        const body = [`From: ${line(email.from)}`, `To: ${line(email.to)}`, `Subject: ${line(email.subject)}`, `Date: ${line(email.date)}`, '', email.text].join('\n');
        await s3.send(new PutObjectCommand({
          Bucket: bucket, Key: newKey, Body: body, ContentType: 'text/plain; charset=utf-8',
          IfNoneMatch: '*',
        }));
        result.processed++;
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 412) result.skipped++;
        else result.failed++;
      }
    }
    return result;
  }
  return { list, get: key => read(key), clean };
}
module.exports = { createInboxService };
