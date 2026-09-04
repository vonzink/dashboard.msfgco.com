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
    await expect(storage.readScanStatus({ config, key: `approved/sha256/${'a'.repeat(64)}/deck.png` }))
      .rejects.toMatchObject({ code: 'ASSET_QUARANTINE_REQUIRED' });
    expect(commandsOfType('GetObjectTagging')).toHaveLength(0);
  });
});
