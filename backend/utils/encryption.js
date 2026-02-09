/**
 * AES-256-GCM encryption for storing API keys & tokens in the database.
 *
 * Requires env var: ENCRYPTION_KEY  (64-char hex string = 32 bytes)
 *
 * Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const TAG_LENGTH = 16; // 128-bit auth tag

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY env var must be a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string.
 * @returns {{ encrypted: string, iv: string, authTag: string }}
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypt back to plaintext.
 * @param {string} encrypted  - hex-encoded ciphertext
 * @param {string} ivHex      - hex-encoded IV
 * @param {string} authTagHex - hex-encoded GCM auth tag
 * @returns {string} plaintext
 */
function decrypt(encrypted, ivHex, authTagHex) {
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Mask a value for display (show first 8 + last 4 chars).
 */
function mask(value) {
  if (!value || value.length < 16) return value ? '••••••••' : '';
  return value.slice(0, 8) + '••••' + value.slice(-4);
}

module.exports = { encrypt, decrypt, mask };
