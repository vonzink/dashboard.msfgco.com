import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

// The service is CommonJS and the AWS SDK lives in node_modules, which vitest
// externalises — so vi.mock never intercepts the require. This swaps the
// module cache instead, matching tests/services/statusLabels.test.js.
//
// These tests assert the commands the service builds: trash key shape,
// tagging, and quota direction. Path validation is covered separately in
// tests/utils/userFileKeys.test.js.

const require = createRequire(import.meta.url);

const s3Path = require.resolve('@aws-sdk/client-s3');
const presignerPath = require.resolve('@aws-sdk/s3-request-presigner');
const dbPath = require.resolve('../../db/connection');
const loggerPath = require.resolve('../../lib/logger');
const servicePath = require.resolve('../../services/userFiles');

const originals = {
  [s3Path]: require.cache[s3Path],
  [presignerPath]: require.cache[presignerPath],
  [dbPath]: require.cache[dbPath],
  [loggerPath]: require.cache[loggerPath],
};

const sendMock = vi.fn();
const queryMock = vi.fn();
let captured = [];

/** Records the input of every command the service constructs. */
function makeCommand(name) {
  return class {
    constructor(input) {
      this.name = name;
      this.input = input;
      captured.push({ name, input });
    }
  };
}

const s3Module = {
  S3Client: class { send(command) { return sendMock(command); } },
  ListObjectsV2Command: makeCommand('ListObjectsV2'),
  GetObjectCommand: makeCommand('GetObject'),
  HeadObjectCommand: makeCommand('HeadObject'),
  PutObjectCommand: makeCommand('PutObject'),
  CopyObjectCommand: makeCommand('CopyObject'),
  DeleteObjectCommand: makeCommand('DeleteObject'),
  DeleteObjectsCommand: makeCommand('DeleteObjects'),
  PutObjectTaggingCommand: makeCommand('PutObjectTagging'),
};

const presignerModule = { getSignedUrl: vi.fn(async () => 'https://signed.example/url') };
const dbModule = { query: (...args) => queryMock(...args) };
const loggerModule = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function loadService() {
  stub(s3Path, s3Module);
  stub(presignerPath, presignerModule);
  stub(dbPath, dbModule);
  stub(loggerPath, loggerModule);
  delete require.cache[servicePath];
  return require('../../services/userFiles');
}

const commandsOfType = (name) => captured.filter((c) => c.name === name);

let userFiles;

beforeEach(() => {
  sendMock.mockReset();
  queryMock.mockReset();
  captured = [];
  queryMock.mockResolvedValue([[]]);
  userFiles = loadService();
});

afterEach(() => {
  delete require.cache[servicePath];
  for (const [path, original] of Object.entries(originals)) {
    if (original) require.cache[path] = original;
    else delete require.cache[path];
  }
});

describe('listPath', () => {
  it('hides the trash folder and the folder placeholder from a normal listing', async () => {
    sendMock.mockResolvedValueOnce({
      CommonPrefixes: [
        { Prefix: 'users/42/Loan Docs/' },
        { Prefix: 'users/42/.trash/' },
      ],
      Contents: [
        { Key: 'users/42/', Size: 0 },
        { Key: 'users/42/notes.txt', Size: 12, ETag: '"abc"' },
      ],
      IsTruncated: false,
    });

    const result = await userFiles.listPath(42, '');

    expect(result.folders.map((f) => f.name)).toEqual(['Loan Docs']);
    expect(result.files.map((f) => f.name)).toEqual(['notes.txt']);
    expect(result.files[0].etag).toBe('abc');
  });

  it('lists with a delimiter so only immediate children come back', async () => {
    sendMock.mockResolvedValueOnce({ CommonPrefixes: [], Contents: [], IsTruncated: false });
    await userFiles.listPath(42, 'Loan Docs');

    const [list] = commandsOfType('ListObjectsV2');
    expect(list.input.Prefix).toBe('users/42/Loan Docs/');
    expect(list.input.Delimiter).toBe('/');
  });
});

describe('prepareUpload', () => {
  it('rejects an upload that would exceed the quota, before signing anything', async () => {
    queryMock.mockResolvedValueOnce([[{
      bytes_used: 9 * 1024 * 1024 * 1024, file_count: 3, quota_bytes: null, reconciled_at: null,
    }]]);

    await expect(userFiles.prepareUpload(42, 'big.zip', 2 * 1024 * 1024 * 1024, 'application/zip'))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(commandsOfType('PutObject')).toHaveLength(0);
  });

  it('signs a PUT without an encryption header, so the browser need not send one', async () => {
    queryMock.mockResolvedValueOnce([[{
      bytes_used: 0, file_count: 0, quota_bytes: null, reconciled_at: null,
    }]]);

    const result = await userFiles.prepareUpload(42, 'notes.txt', 10, 'text/plain');

    const [put] = commandsOfType('PutObject');
    expect(put.input.Key).toBe('users/42/notes.txt');
    expect(put.input.ServerSideEncryption).toBeUndefined();
    expect(result.uploadUrl).toBe('https://signed.example/url');
  });

  it('rejects a negative or non-numeric size', async () => {
    await expect(userFiles.prepareUpload(42, 'a.txt', -1)).rejects.toThrow();
    await expect(userFiles.prepareUpload(42, 'a.txt', 'huge')).rejects.toThrow();
  });
});

describe('confirmUpload', () => {
  it('bills the size S3 reports, not the size the client declared', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 4096, ContentType: 'text/plain' });
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);

    await userFiles.confirmUpload(42, 'notes.txt');

    const quotaCall = queryMock.mock.calls.find(([sql]) => sql.includes('user_file_quota'));
    expect(quotaCall[1]).toEqual([42, 4096, 1, 4096, 1]);
  });
});

describe('softDelete', () => {
  beforeEach(() => {
    // Empty folder listing, then a successful HeadObject: treated as one file.
    sendMock
      .mockResolvedValueOnce({ Contents: [], IsTruncated: false })
      .mockResolvedValueOnce({ ContentLength: 100 })
      .mockResolvedValue({});
  });

  it('copies into .trash under a timestamp, tagged for the lifecycle rule', async () => {
    await userFiles.softDelete(42, 'Loan Docs/app.pdf');

    const [copy] = commandsOfType('CopyObject');
    expect(copy.input.Key).toMatch(/^users\/42\/\.trash\/\d+\/Loan Docs\/app\.pdf$/);
    // The 30-day expiry matches this tag, not the key prefix, because S3
    // lifecycle prefixes cannot wildcard the user id.
    expect(copy.input.Tagging).toBe('msfg-state=trash');
    expect(copy.input.TaggingDirective).toBe('REPLACE');
  });

  it('encodes the copy source but leaves separators intact', async () => {
    await userFiles.softDelete(42, 'Loan Docs/app v2.pdf');

    const [copy] = commandsOfType('CopyObject');
    expect(copy.input.CopySource).toContain('msfg-user-folders/users/42/Loan%20Docs/app%20v2.pdf');
    expect(copy.input.CopySource).not.toContain('%2F');
  });

  it('removes the original after copying', async () => {
    await userFiles.softDelete(42, 'notes.txt');

    const [del] = commandsOfType('DeleteObjects');
    expect(del.input.Delete.Objects).toEqual([{ Key: 'users/42/notes.txt' }]);
  });

  it('does not decrement the quota, because trash still occupies storage', async () => {
    await userFiles.softDelete(42, 'notes.txt');
    const quotaCall = queryMock.mock.calls.find(([sql]) => sql.includes('user_file_quota'));
    expect(quotaCall).toBeUndefined();
  });

  it('refuses to delete the root', async () => {
    await expect(userFiles.softDelete(42, '')).rejects.toThrow();
  });
});

describe('softDelete — oversize folder', () => {
  it('refuses a folder beyond the synchronous limit rather than timing out', async () => {
    const many = Array.from({ length: userFiles.SYNC_OBJECT_LIMIT + 1 }, (_, i) => ({
      Key: `users/42/Big/${i}.txt`, Size: 1,
    }));
    sendMock.mockResolvedValueOnce({ Contents: many, IsTruncated: false });

    await expect(userFiles.softDelete(42, 'Big')).rejects.toMatchObject({ statusCode: 409 });
    expect(commandsOfType('CopyObject')).toHaveLength(0);
  });
});

describe('move', () => {
  const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound' });
  const empty = { Contents: [], IsTruncated: false };

  /** Source is a single file, destination is free. */
  function stubFileMove() {
    sendMock
      .mockResolvedValueOnce(empty)      // list source prefix - not a folder
      .mockResolvedValueOnce({})         // head source - exists
      .mockResolvedValueOnce(empty)      // list destination prefix - free
      .mockRejectedValueOnce(notFound()) // head destination - free
      .mockResolvedValue({});
  }

  it('copies to the new key and removes the original', async () => {
    stubFileMove();

    const result = await userFiles.move(42, 'a.txt', 'Loan Docs/a.txt');

    const [copy] = commandsOfType('CopyObject');
    expect(copy.input.Key).toBe('users/42/Loan Docs/a.txt');
    expect(copy.input.CopySource).toBe('msfg-user-folders/users/42/a.txt');

    const [del] = commandsOfType('DeleteObjects');
    expect(del.input.Delete.Objects).toEqual([{ Key: 'users/42/a.txt' }]);
    expect(result.moved).toBe(1);
  });

  it('leaves the quota alone, because a move changes no bytes', async () => {
    stubFileMove();
    await userFiles.move(42, 'a.txt', 'b.txt');

    const quotaCall = queryMock.mock.calls.find(([sql]) => sql.includes('user_file_quota'));
    expect(quotaCall).toBeUndefined();
  });

  it('rewrites every key under a folder, preserving the subtree', async () => {
    sendMock
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'users/42/Docs/', Size: 0 },
          { Key: 'users/42/Docs/2026/app.pdf', Size: 10 },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce(empty)      // destination prefix free
      .mockRejectedValueOnce(notFound()) // destination key free
      .mockResolvedValue({});

    await userFiles.move(42, 'Docs', 'Archive/Docs');

    expect(commandsOfType('CopyObject').map((c) => c.input.Key)).toEqual([
      'users/42/Archive/Docs/',
      'users/42/Archive/Docs/2026/app.pdf',
    ]);
  });

  it('refuses to move a folder inside itself, which would never terminate', async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [{ Key: 'users/42/Docs/app.pdf', Size: 10 }],
      IsTruncated: false,
    });

    await expect(userFiles.move(42, 'Docs', 'Docs/Nested')).rejects.toMatchObject({ statusCode: 409 });
    expect(commandsOfType('CopyObject')).toHaveLength(0);
  });

  it('refuses to overwrite an existing file at the destination', async () => {
    sendMock
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({})   // source exists
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({});  // destination is taken

    await expect(userFiles.move(42, 'a.txt', 'b.txt')).rejects.toMatchObject({ statusCode: 409 });
    expect(commandsOfType('CopyObject')).toHaveLength(0);
  });

  it('refuses to move onto an existing folder name', async () => {
    sendMock
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Contents: [{ Key: 'users/42/Docs/x.pdf' }], IsTruncated: false });

    await expect(userFiles.move(42, 'a.txt', 'Docs')).rejects.toMatchObject({ statusCode: 409 });
    expect(commandsOfType('CopyObject')).toHaveLength(0);
  });

  it('rejects a missing source instead of silently succeeding', async () => {
    sendMock
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(notFound());

    await expect(userFiles.move(42, 'gone.txt', 'b.txt')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses to move the root', async () => {
    await expect(userFiles.move(42, '', 'somewhere')).rejects.toThrow();
  });

  it('treats a move onto itself as a no-op', async () => {
    const result = await userFiles.move(42, 'a.txt', 'a.txt');
    expect(result.unchanged).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a folder beyond the synchronous limit', async () => {
    const many = Array.from({ length: userFiles.SYNC_OBJECT_LIMIT + 1 }, (_, i) => ({
      Key: `users/42/Big/${i}.txt`, Size: 1,
    }));
    sendMock
      .mockResolvedValueOnce({ Contents: many, IsTruncated: false })
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(notFound());

    await expect(userFiles.move(42, 'Big', 'Archive/Big')).rejects.toMatchObject({ statusCode: 409 });
    expect(commandsOfType('CopyObject')).toHaveLength(0);
  });

  it('rejects a path that escapes the user prefix', async () => {
    await expect(userFiles.move(42, 'a.txt', '../43/steal.txt')).rejects.toThrow();
  });
});

describe('purgeFromTrash', () => {
  it('gives the space back to the quota', async () => {
    sendMock
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'users/42/.trash/1700/a.txt', Size: 300 },
          { Key: 'users/42/.trash/1700/b.txt', Size: 200 },
        ],
        IsTruncated: false,
      })
      .mockResolvedValue({});
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await userFiles.purgeFromTrash(42, '1700');

    expect(result.bytes).toBe(500);
    const quotaCall = queryMock.mock.calls.find(([sql]) => sql.includes('user_file_quota'));
    expect(quotaCall[1]).toEqual([42, -500, -2, -500, -2]);
  });
});

describe('restoreFromTrash', () => {
  it('restores to the original path and clears the trash tag', async () => {
    sendMock
      .mockResolvedValueOnce({
        Contents: [{ Key: 'users/42/.trash/1700/Loan Docs/app.pdf', Size: 10 }],
        IsTruncated: false,
      })
      .mockResolvedValue({});

    await userFiles.restoreFromTrash(42, '1700');

    const [copy] = commandsOfType('CopyObject');
    expect(copy.input.Key).toBe('users/42/Loan Docs/app.pdf');
    expect(copy.input.Tagging).toBe('');
    expect(copy.input.TaggingDirective).toBe('REPLACE');
  });
});

describe('listTrash', () => {
  it('groups by deletion batch, newest first, keeping the original path', async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [
        { Key: 'users/42/.trash/1000/old.txt', Size: 1 },
        { Key: 'users/42/.trash/2000/Loan Docs/app.pdf', Size: 2 },
      ],
      IsTruncated: false,
    });

    const groups = await userFiles.listTrash(42);

    expect(groups.map((g) => g.deletedAt)).toEqual([2000, 1000]);
    expect(groups[0].items[0].originalPath).toBe('Loan Docs/app.pdf');
    expect(groups[0].items[0].name).toBe('app.pdf');
  });
});
