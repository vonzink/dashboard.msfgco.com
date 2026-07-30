import { describe, it, expect } from 'vitest';
import {
  UserFilePathError,
  resolveUserKey,
  resolveTrashKey,
  userRootPrefix,
  userTrashPrefix,
  toClientPath,
} from '../../utils/userFileKeys';

// These functions are the only thing standing between one user's files and
// another's — the instance role can read the whole bucket, so a path that
// escapes here is a real cross-user read. The traversal cases below matter
// more than the happy path.

describe('resolveUserKey', () => {
  it('scopes a plain path under the caller own root', () => {
    expect(resolveUserKey(42, 'Loan Docs/app.pdf')).toBe('users/42/Loan Docs/app.pdf');
  });

  it('returns the bare root for an empty, null, or undefined path', () => {
    expect(resolveUserKey(42, '')).toBe('users/42/');
    expect(resolveUserKey(42, null)).toBe('users/42/');
    expect(resolveUserKey(42, undefined)).toBe('users/42/');
  });

  it('collapses duplicate and trailing slashes', () => {
    expect(resolveUserKey(42, 'a//b///c')).toBe('users/42/a/b/c');
    expect(resolveUserKey(42, 'a/b/')).toBe('users/42/a/b');
  });

  it('appends a trailing slash for folder keys only when there is a path', () => {
    expect(resolveUserKey(42, 'Loan Docs', { trailingSlash: true })).toBe('users/42/Loan Docs/');
    expect(resolveUserKey(42, '', { trailingSlash: true })).toBe('users/42/');
  });

  it('keeps spaces, unicode, and dots that are not traversal', () => {
    expect(resolveUserKey(7, 'My Docs/résumé v1.2.pdf')).toBe('users/7/My Docs/résumé v1.2.pdf');
    expect(resolveUserKey(7, '.hidden')).toBe('users/7/.hidden');
    expect(resolveUserKey(7, 'a..b/c')).toBe('users/7/a..b/c');
  });
});

describe('resolveUserKey — traversal and injection', () => {
  const rejected = [
    ['parent segment', '../43/secret.pdf'],
    ['nested parent segment', 'Loan Docs/../../43/secret.pdf'],
    ['trailing parent segment', 'Loan Docs/..'],
    ['bare parent segment', '..'],
    ['current-dir segment', './a'],
    ['absolute path', '/etc/passwd'],
    ['absolute into another user', '/users/43/secret.pdf'],
    ['backslash separator', '..\\43\\secret.pdf'],
    ['lone backslash', 'a\\b'],
    ['null byte', 'a\u0000b'],
    ['control character', 'a\u0007b'],
    ['reserved trash segment', '.trash/old.pdf'],
    ['nested trash segment', 'Loan Docs/.trash/old.pdf'],
  ];

  it.each(rejected)('rejects %s', (_label, input) => {
    expect(() => resolveUserKey(42, input)).toThrow(UserFilePathError);
  });

  it('does not decode percent-encoding, so encoded traversal stays inert', () => {
    // Express has already decoded the query string. Decoding again here is
    // what turns %2e%2e into a working '..', so we treat it as a literal name.
    expect(resolveUserKey(42, '%2e%2e/43')).toBe('users/42/%2e%2e/43');
  });

  it('rejects a non-string path', () => {
    expect(() => resolveUserKey(42, { toString: () => '../43' })).toThrow(UserFilePathError);
    expect(() => resolveUserKey(42, 123)).toThrow(UserFilePathError);
  });

  it('rejects a user id that could inject a separator or widen scope', () => {
    expect(() => resolveUserKey('42/../43', 'a.pdf')).toThrow(UserFilePathError);
    expect(() => resolveUserKey(0, 'a.pdf')).toThrow(UserFilePathError);
    expect(() => resolveUserKey(-1, 'a.pdf')).toThrow(UserFilePathError);
    expect(() => resolveUserKey(4.2, 'a.pdf')).toThrow(UserFilePathError);
    expect(() => resolveUserKey(null, 'a.pdf')).toThrow(UserFilePathError);
  });

  it('rejects an over-long segment and an over-long key', () => {
    expect(() => resolveUserKey(42, `${'a'.repeat(256)}.pdf`)).toThrow(UserFilePathError);
    const deep = Array.from({ length: 20 }, () => 'a'.repeat(200)).join('/');
    expect(() => resolveUserKey(42, deep)).toThrow(UserFilePathError);
  });

  it('never produces a key outside the caller own prefix', () => {
    const attempts = rejected.map(([, input]) => input);
    for (const attempt of attempts) {
      let key = null;
      try {
        key = resolveUserKey(42, attempt);
      } catch {
        continue; // rejected, which is the expected outcome
      }
      expect(key.startsWith('users/42/')).toBe(true);
    }
  });
});

describe('resolveTrashKey', () => {
  it('scopes under the caller trash', () => {
    expect(resolveTrashKey(42, '1700000000000/app.pdf')).toBe('users/42/.trash/1700000000000/app.pdf');
  });

  it('applies the same traversal rules', () => {
    expect(() => resolveTrashKey(42, '../../43/secret.pdf')).toThrow(UserFilePathError);
    expect(() => resolveTrashKey(42, 'a\u0000b')).toThrow(UserFilePathError);
  });

  it('still rejects a nested .trash segment, so trash cannot nest', () => {
    expect(() => resolveTrashKey(42, '.trash/again')).toThrow(UserFilePathError);
  });

  it('is the only route into trash — resolveUserKey cannot reach it', () => {
    expect(() => resolveUserKey(42, '.trash')).toThrow(UserFilePathError);
    expect(resolveTrashKey(42, '')).toBe('users/42/.trash/');
  });
});

describe('prefix and client-path helpers', () => {
  it('builds root and trash prefixes', () => {
    expect(userRootPrefix(42)).toBe('users/42/');
    expect(userTrashPrefix(42)).toBe('users/42/.trash/');
  });

  it('round-trips a key back to a client path', () => {
    const key = resolveUserKey(42, 'Loan Docs/app.pdf');
    expect(toClientPath(42, key)).toBe('Loan Docs/app.pdf');
  });

  it('returns null for a key belonging to someone else', () => {
    expect(toClientPath(42, 'users/43/secret.pdf')).toBeNull();
    expect(toClientPath(42, 'archive/42/old.pdf')).toBeNull();
  });

  it('is not fooled by a user id that is a prefix of another', () => {
    expect(toClientPath(4, 'users/42/secret.pdf')).toBeNull();
  });
});
