import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const s3Path = require.resolve('@aws-sdk/client-s3');
const presignerPath = require.resolve('@aws-sdk/s3-request-presigner');
const storagePath = require.resolve('../../../services/webinarAssets/storage');
const originals = {
  [s3Path]: require.cache[s3Path],
  [presignerPath]: require.cache[presignerPath],
};

const sendMock = vi.fn();
const getSignedUrl = vi.fn();
let captured = [];

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
  PutObjectCommand: makeCommand('PutObject'),
  HeadObjectCommand: makeCommand('HeadObject'),
  GetObjectCommand: makeCommand('GetObject'),
  GetObjectTaggingCommand: makeCommand('GetObjectTagging'),
  CopyObjectCommand: makeCommand('CopyObject'),
};
const presignerModule = { getSignedUrl };

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function loadStorage() {
  stub(s3Path, s3Module);
  stub(presignerPath, presignerModule);
  delete require.cache[storagePath];
  return require('../../../services/webinarAssets/storage');
}

const commandsOfType = name => captured.filter(command => command.name === name);
const config = {
  bucket: 'webinar-assets',
  cdnBaseUrl: 'https://assets.example',
  quarantinePrefix: 'quarantine/',
};
const versionId = '11111111-1111-4111-8111-111111111111';
const quarantineKey = `quarantine/${versionId}/deck.png`;
const approvedKey = `approved/sha256/${'a'.repeat(64)}/asset`;

let storage;

beforeEach(() => {
  sendMock.mockReset();
  getSignedUrl.mockReset();
  getSignedUrl.mockResolvedValue('https://signed.example/upload');
  captured = [];
  storage = loadStorage();
});

afterEach(() => {
  delete require.cache[storagePath];
  for (const [path, original] of Object.entries(originals)) {
    if (original) require.cache[path] = original;
    else delete require.cache[path];
  }
});

describe('Webinar Studio quarantine storage', () => {
  it('presigns only a quarantine PUT with type, declared bytes metadata, and a ten-minute lifetime', async () => {
    const result = await storage.createUploadUrl({
      config,
      versionId,
      filename: '../deck.png',
      mimeType: 'image/png',
      declaredBytes: 2048,
    });

    const [put] = commandsOfType('PutObject');
    expect(put.input).toMatchObject({
      Bucket: 'webinar-assets',
      Key: quarantineKey,
      ContentType: 'image/png',
      ContentLength: 2048,
      Metadata: { declaredBytes: '2048' },
    });
    expect(put.input.Key).toMatch(/^quarantine\//);
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), put, { expiresIn: 600 });
    expect(result).toEqual({
      uploadUrl: 'https://signed.example/upload',
      key: quarantineKey,
      expiresInSeconds: 600,
    });
  });

  it('reads only the GuardDuty malware status tag and treats its absence as processing', async () => {
    sendMock
      .mockResolvedValueOnce({ TagSet: [
        { Key: 'unrelated', Value: 'ignored' },
        { Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' },
      ] })
      .mockResolvedValueOnce({ TagSet: [{ Key: 'unrelated', Value: 'ignored' }] });

    await expect(storage.readScanStatus({ config, key: quarantineKey })).resolves.toBe('NO_THREATS_FOUND');
    await expect(storage.readScanStatus({ config, key: quarantineKey })).resolves.toBeNull();

    expect(commandsOfType('GetObjectTagging').map(command => command.input)).toEqual([
      { Bucket: 'webinar-assets', Key: quarantineKey },
      { Bucket: 'webinar-assets', Key: quarantineKey },
    ]);
  });

  it('refuses operations on keys outside the configured quarantine prefix', async () => {
    await expect(storage.readScanStatus({ config, key: approvedKey }))
      .rejects.toMatchObject({ code: 'ASSET_QUARANTINE_REQUIRED' });
    expect(commandsOfType('GetObjectTagging')).toHaveLength(0);
  });

  it('validates every injected config through the same fail-closed rules before calling S3', async () => {
    const invalidConfigs = [
      { cdnBaseUrl: 'https://assets.example', quarantinePrefix: 'quarantine/' },
      { bucket: 'webinar-assets', quarantinePrefix: 'quarantine/' },
      { bucket: 'webinar-assets', cdnBaseUrl: 'http://assets.example', quarantinePrefix: 'quarantine/' },
      { bucket: 'webinar-assets', cdnBaseUrl: 'https://assets.example', quarantinePrefix: 'approved/' },
    ];

    for (const invalidConfig of invalidConfigs) {
      await expect(storage.headQuarantineObject({ config: invalidConfig, key: quarantineKey }))
        .rejects.toMatchObject({ code: expect.stringMatching(/^ASSET_CONFIG_/) });
    }
    expect(captured).toEqual([]);
  });

  it('heads and reads only a configured quarantine object', async () => {
    const head = { ContentLength: 10, ContentType: 'image/png' };
    const body = Buffer.from('asset bytes');
    sendMock.mockResolvedValueOnce(head).mockResolvedValueOnce({ Body: body });

    await expect(storage.headQuarantineObject({ config, key: quarantineKey })).resolves.toBe(head);
    await expect(storage.readQuarantineObject({ config, key: quarantineKey })).resolves.toBe(body);

    expect(commandsOfType('HeadObject').map(command => command.input)).toEqual([
      { Bucket: 'webinar-assets', Key: quarantineKey },
    ]);
    expect(commandsOfType('GetObject').map(command => command.input)).toEqual([
      { Bucket: 'webinar-assets', Key: quarantineKey },
    ]);
  });

  it('guards immutable approved writes and copies with a create-only destination condition', async () => {
    const body = Buffer.from('approved asset');
    await storage.putApprovedObject({
      config,
      approvedKey,
      body,
      mimeType: 'image/png',
      byteSize: body.length,
    });
    await storage.copyApprovedObject({
      config,
      approvedKey,
      sourceKey: quarantineKey,
      mimeType: 'image/png',
    });

    expect(commandsOfType('PutObject').map(command => command.input)).toEqual([{
      Bucket: 'webinar-assets',
      Key: approvedKey,
      Body: body,
      ContentType: 'image/png',
      ContentLength: body.length,
      CacheControl: 'public, max-age=31536000, immutable',
      IfNoneMatch: '*',
    }]);
    expect(commandsOfType('CopyObject').map(command => command.input)).toEqual([{
      Bucket: 'webinar-assets',
      Key: approvedKey,
      CopySource: `webinar-assets/${quarantineKey}`,
      ContentType: 'image/png',
      MetadataDirective: 'REPLACE',
      CacheControl: 'public, max-age=31536000, immutable',
      IfNoneMatch: '*',
    }]);
  });

  it('rejects malformed approved-key overrides before issuing an immutable write', async () => {
    for (const malformedKey of [
      'approved/sha256/not-a-hash/asset',
      `approved/sha256/${'A'.repeat(64)}/asset`,
      `approved/sha256/${'a'.repeat(64)}/private-upload-name.png`,
      `approved/sha256/${'a'.repeat(64)}/nested/asset`,
      `approved/sha256/${'a'.repeat(64)}/ asset `,
    ]) {
      await expect(storage.putApprovedObject({ config, approvedKey: malformedKey, body: Buffer.alloc(0) }))
        .rejects.toMatchObject({ code: 'ASSET_STORAGE_INVALID' });
    }
    expect(commandsOfType('PutObject')).toHaveLength(0);
  });
});
