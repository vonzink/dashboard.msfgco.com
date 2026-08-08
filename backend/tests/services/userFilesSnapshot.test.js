import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

// Same module-cache swap as tests/services/userFiles.test.js: the AWS SDK is
// externalised by vitest, so vi.mock never intercepts the service's require.
//
// These tests cover snapshot() — the flat recursive listing the local-sync
// client polls. Path validation lives in tests/utils/userFileKeys.test.js.

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

/** One S3 ListObjectsV2 page. */
function page(contents, nextToken) {
  return {
    Contents: contents,
    IsTruncated: Boolean(nextToken),
    NextContinuationToken: nextToken || undefined,
  };
}

describe('snapshot', () => {
  it('returns every file under the user root with path, size and unquoted etag', async () => {
    sendMock.mockResolvedValueOnce(page([
      { Key: 'users/7/notes.txt', Size: 12, ETag: '"abc123"', LastModified: new Date('2026-01-01T00:00:00Z') },
      { Key: 'users/7/deals/offer.pdf', Size: 900, ETag: '"def456"', LastModified: new Date('2026-01-02T00:00:00Z') },
    ]));

    const result = await userFiles.snapshot(7);

    expect(result.files).toEqual([
      { path: 'notes.txt', size: 12, etag: 'abc123', lastModified: new Date('2026-01-01T00:00:00Z') },
      { path: 'deals/offer.pdf', size: 900, etag: 'def456', lastModified: new Date('2026-01-02T00:00:00Z') },
    ]);
  });

  it('lists only the requesting user, and does not collapse subfolders', async () => {
    sendMock.mockResolvedValueOnce(page([]));

    await userFiles.snapshot(7);

    const list = captured.find((c) => c.name === 'ListObjectsV2');
    expect(list.input.Prefix).toBe('users/7/');
    // No Delimiter: the client needs the whole tree in one pass.
    expect(list.input.Delimiter).toBeUndefined();
  });

  it('excludes trash objects and zero-byte folder markers', async () => {
    sendMock.mockResolvedValueOnce(page([
      { Key: 'users/7/deals/', Size: 0, ETag: '"d41d8"', LastModified: new Date() },
      { Key: 'users/7/.trash/1700000000000/old.txt', Size: 5, ETag: '"old"', LastModified: new Date() },
      { Key: 'users/7/keep.txt', Size: 5, ETag: '"keep"', LastModified: new Date() },
    ]));

    const result = await userFiles.snapshot(7);

    expect(result.files.map((f) => f.path)).toEqual(['keep.txt']);
  });

  it('follows pagination across pages', async () => {
    sendMock
      .mockResolvedValueOnce(page([{ Key: 'users/7/a.txt', Size: 1, ETag: '"a"', LastModified: new Date() }], 'TOKEN'))
      .mockResolvedValueOnce(page([{ Key: 'users/7/b.txt', Size: 2, ETag: '"b"', LastModified: new Date() }]));

    const result = await userFiles.snapshot(7);

    expect(result.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('tolerates an object with no ETag', async () => {
    sendMock.mockResolvedValueOnce(page([
      { Key: 'users/7/a.txt', Size: 1, LastModified: new Date('2026-01-01T00:00:00Z') },
    ]));

    const result = await userFiles.snapshot(7);

    expect(result.files[0].etag).toBeNull();
  });
});
