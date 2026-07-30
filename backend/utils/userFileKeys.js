/**
 * utils/userFileKeys.js
 *
 * Translates a client-supplied path into an S3 key inside the caller's own
 * folder, and refuses anything that could reach outside it.
 *
 * This file is the entire isolation boundary for My Files. Authentication is
 * Cognito User Pool only, so there is no Identity Pool and therefore no
 * per-user AWS credentials — the instance role can read every object in
 * msfg-user-folders. Nothing in IAM prevents user A from reading user B's
 * files. These functions do, and only if every endpoint routes through them.
 *
 * The client never sends an S3 key. It sends a path relative to its own root.
 */

/** Longest S3 key S3 itself will accept, in UTF-8 bytes. */
const MAX_KEY_BYTES = 1024;

/** Folder name holding soft-deleted items. Unreachable via resolveUserKey. */
const TRASH_SEGMENT = '.trash';

class UserFilePathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFilePathError';
    this.statusCode = 400;
  }
}

/**
 * Validate and normalise a client path into safe segments.
 *
 * Rejects rather than sanitises. Stripping bad input invites a second bug
 * where the stripped result still resolves somewhere unintended — a path like
 * `..%2f..` becomes valid the moment something upstream decodes it twice. A
 * rejected request cannot do that.
 *
 * @param {string} clientPath  path relative to the user's root
 * @returns {string[]} normalised, non-empty path segments
 * @throws {UserFilePathError}
 */
function normalizeSegments(clientPath) {
  if (clientPath === undefined || clientPath === null || clientPath === '') return [];

  if (typeof clientPath !== 'string') {
    throw new UserFilePathError('Path must be a string');
  }

  // Null bytes truncate the key in some S3 SDK paths and in most C-backed
  // filesystem code the value may later touch.
  if (clientPath.includes('\0')) {
    throw new UserFilePathError('Path contains a null byte');
  }

  // Other C0 control characters, plus DEL. These are legal in S3 keys but are
  // never legitimate here, and they make audit-log entries misleading.
  // eslint-disable-next-line no-control-regex
  if (/[\x01-\x1f\x7f]/.test(clientPath)) {
    throw new UserFilePathError('Path contains control characters');
  }

  // Backslash is a separator on Windows clients. Treating it as an ordinary
  // character would let `..\..\` through the '..' check below.
  if (clientPath.includes('\\')) {
    throw new UserFilePathError('Path contains a backslash');
  }

  if (clientPath.startsWith('/')) {
    throw new UserFilePathError('Path must be relative');
  }

  const segments = clientPath.split('/').filter((segment) => segment !== '');

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new UserFilePathError('Path contains a relative segment');
    }
    // Rejected unconditionally so trash is reachable only through
    // resolveTrashKey. There is no flag on this function whose default
    // could be wrong.
    if (segment === TRASH_SEGMENT) {
      throw new UserFilePathError('Path contains a reserved segment');
    }
    if (segment.length > 255) {
      throw new UserFilePathError('Path segment is too long');
    }
  }

  return segments;
}

/** Reject a finished key that S3 would refuse anyway. */
function assertKeyLength(key) {
  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new UserFilePathError('Path is too long');
  }
  return key;
}

/** Coerce and validate a user ID, so it can never inject a path separator. */
function assertUserId(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new UserFilePathError('Invalid user id');
  }
  return userId;
}

/**
 * Resolve a client path to a key inside the user's own folder.
 *
 * @param {number} userId
 * @param {string} clientPath  path relative to the user's root
 * @param {{ trailingSlash?: boolean }} [options]  append '/' for folder keys
 * @returns {string} an S3 key under `users/{userId}/`
 * @throws {UserFilePathError}
 */
function resolveUserKey(userId, clientPath, options = {}) {
  assertUserId(userId);
  const segments = normalizeSegments(clientPath);

  let key = `users/${userId}/${segments.join('/')}`;
  if (options.trailingSlash && segments.length > 0) key += '/';

  return assertKeyLength(key);
}

/**
 * Resolve a client path to a key inside the user's trash.
 *
 * Deliberately a separate function rather than an option on resolveUserKey.
 * Only the trash, restore, and purge endpoints call it.
 *
 * @param {number} userId
 * @param {string} clientPath  path relative to the user's trash root
 * @param {{ trailingSlash?: boolean }} [options]
 * @returns {string} an S3 key under `users/{userId}/.trash/`
 * @throws {UserFilePathError}
 */
function resolveTrashKey(userId, clientPath, options = {}) {
  assertUserId(userId);
  const segments = normalizeSegments(clientPath);

  let key = `users/${userId}/${TRASH_SEGMENT}/${segments.join('/')}`;
  if (options.trailingSlash && segments.length > 0) key += '/';

  return assertKeyLength(key);
}

/** The user's root prefix, for listing and usage totals. */
function userRootPrefix(userId) {
  assertUserId(userId);
  return `users/${userId}/`;
}

/** The user's trash prefix. */
function userTrashPrefix(userId) {
  assertUserId(userId);
  return `users/${userId}/${TRASH_SEGMENT}/`;
}

/**
 * Strip the user's prefix back off a key, for returning paths to the client.
 * Returns null if the key does not belong to the user — callers should treat
 * that as a bug rather than rendering it.
 *
 * @param {number} userId
 * @param {string} key
 * @returns {string|null}
 */
function toClientPath(userId, key) {
  assertUserId(userId);
  const prefix = `users/${userId}/`;
  if (typeof key !== 'string' || !key.startsWith(prefix)) return null;
  return key.slice(prefix.length);
}

module.exports = {
  UserFilePathError,
  TRASH_SEGMENT,
  MAX_KEY_BYTES,
  resolveUserKey,
  resolveTrashKey,
  userRootPrefix,
  userTrashPrefix,
  toClientPath,
};
