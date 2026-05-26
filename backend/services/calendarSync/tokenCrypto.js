const crypto = require('crypto');

function getKey() {
  const raw = process.env.CALENDAR_SYNC_ENCRYPTION_KEY;
  if (!raw) throw new Error('CALENDAR_SYNC_ENCRYPTION_KEY is required');

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CALENDAR_SYNC_ENCRYPTION_KEY must decode to 32 bytes');
  }

  return key;
}

function encryptToken(value) {
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptToken(value) {
  if (!value) return null;

  const [ivRaw, tagRaw, encryptedRaw] = String(value).split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Encrypted token payload is invalid');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = {
  encryptToken,
  decryptToken,
};
