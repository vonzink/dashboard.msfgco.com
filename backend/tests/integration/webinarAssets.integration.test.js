import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

const REQUIRED_ENVIRONMENT = Object.freeze([
  'WEBINAR_ASSET_TEST_ACK_DISPOSABLE',
  'WEBINAR_ASSET_TEST_BUCKET',
  'WEBINAR_ASSET_TEST_CDN_BASE_URL',
  'WEBINAR_ASSET_TEST_S3_ENDPOINT',
  'WEBINAR_ASSET_TEST_REGION',
  'WEBINAR_ASSET_TEST_ACCESS_KEY_ID',
  'WEBINAR_ASSET_TEST_SECRET_ACCESS_KEY',
]);
const EXPECTED_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_IS_DISPOSABLE';
const missingEnvironment = REQUIRED_ENVIRONMENT.filter(name => !process.env[name]);
const hasExactDisposableConfiguration = missingEnvironment.length === 0;
const describeAssetIntegration = hasExactDisposableConfiguration ? describe : describe.skip;
const skippedReason = missingEnvironment.length
  ? `missing exact disposable configuration: ${missingEnvironment.join(', ')}`
  : 'configured';
let gatedDependenciesLoaded = false;
let configuredS3ClientConstructed = false;

function isMissingObject(error) {
  return error?.name === 'NotFound'
    || error?.name === 'NoSuchKey'
    || error?.$metadata?.httpStatusCode === 404;
}

async function cleanupDisposableObjects({
  send,
  bucket,
  keys,
  DeleteObjectsCommand,
  HeadObjectCommand,
}) {
  const failures = [];
  let deletion;
  try {
    deletion = await send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
    }));
  } catch (error) {
    failures.push(new Error('Disposable object deletion request failed', { cause: error }));
  }

  for (const error of deletion?.Errors || []) {
    failures.push(new Error(`Disposable object deletion failed with ${error.Code || 'unknown status'}`));
  }
  for (const key of keys) {
    try {
      await send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      failures.push(new Error('A disposable object remained after cleanup'));
    } catch (error) {
      if (!isMissingObject(error)) {
        failures.push(new Error('Disposable object absence could not be verified', { cause: error }));
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Disposable asset cleanup failed');
}

async function performBrowserUploadCanary({
  createUploadUrl,
  storageClient,
  fetchImpl,
  registerCleanupKey,
  HeadObjectCommand,
  bucket,
  config,
  versionId,
  filename,
  mimeType,
  bytes,
  origin,
}) {
  if (!bytes?.length) throw new Error('Disposable browser canary must be non-empty');
  const intent = await createUploadUrl({
    config,
    versionId,
    filename,
    mimeType,
    declaredBytes: bytes.length,
  }, storageClient);
  registerCleanupKey(intent.key);

  const query = new URL(intent.uploadUrl).searchParams;
  if (query.get('x-amz-meta-declaredbytes') !== String(bytes.length)) {
    throw new Error('Disposable upload intent did not hoist exact declared-byte metadata');
  }
  if (query.has('x-amz-checksum-crc32') || query.has('x-amz-sdk-checksum-algorithm')) {
    throw new Error('Disposable upload intent signed an empty-body checksum');
  }

  const response = await fetchImpl(intent.uploadUrl, {
    method: 'PUT',
    headers: {
      Origin: origin,
      'Content-Type': mimeType,
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Disposable browser PUT failed with HTTP ${response.status}`);

  const head = await storageClient.send(new HeadObjectCommand({ Bucket: bucket, Key: intent.key }));
  if (Number(head.ContentLength) !== bytes.length
    || head.ContentType !== mimeType
    || head.Metadata?.declaredbytes !== String(bytes.length)) {
    throw new Error('Disposable browser PUT object metadata did not match the upload intent');
  }
  return { key: intent.key, contentLength: Number(head.ContentLength), metadata: head.Metadata };
}

describe('webinar asset disposable integration guards', () => {
  it('does not statically load S3 or the catalog before disposable configuration is accepted', () => {
    const source = readFileSync(import.meta.filename, 'utf8');
    expect(source).not.toMatch(/from ['"]@aws-sdk\/client-s3['"]/);
    expect(source).not.toMatch(/from ['"][^'"]*services\/webinarAssets\/catalog(?:\.js)?['"]/);
    expect(source).not.toMatch(/require\(['"]\.\.\/\.\.\/services\/webinarAssets\/catalog['"]\)/);
  });

  it.skipIf(hasExactDisposableConfiguration)(
    'does not load gated dependencies or construct an S3 client when configuration is absent',
    () => {
      const catalogPath = require.resolve('../../services/webinarAssets/catalog');
      expect(require.cache[catalogPath]).toBeUndefined();
      expect(gatedDependenciesLoaded).toBe(false);
      expect(configuredS3ClientConstructed).toBe(false);
    },
  );

  it('fails cleanup after checking every key when S3 reports mixed deletion results', async () => {
    const keys = ['quarantine/integration/test/one', `approved/sha256/${'a'.repeat(64)}/asset`];
    const commands = [];
    class TestDeleteCommand {
      constructor(input) {
        this.kind = 'delete';
        this.input = input;
      }
    }
    class TestHeadCommand {
      constructor(input) {
        this.kind = 'head';
        this.input = input;
      }
    }
    const send = async command => {
      commands.push(command);
      if (command.kind === 'delete') {
        return {
          Deleted: [{ Key: keys[0] }],
          Errors: [{ Key: keys[1], Code: 'AccessDenied', Message: 'denied' }],
        };
      }
      if (command.input.Key === keys[0]) {
        const error = new Error('missing');
        error.name = 'NotFound';
        throw error;
      }
      return { ContentLength: 1 };
    };

    await expect(cleanupDisposableObjects({
      send,
      bucket: 'webinar-studio-it-regression',
      keys,
      DeleteObjectsCommand: TestDeleteCommand,
      HeadObjectCommand: TestHeadCommand,
    })).rejects.toThrow(/Disposable asset cleanup failed/);
    expect(commands.filter(command => command.kind === 'head').map(command => command.input.Key)).toEqual(keys);
  });

  it('models the configured canary as a non-empty browser PUT through the real upload-intent contract', async () => {
    const bytes = Buffer.from('non-empty disposable browser upload');
    const key = `quarantine/${randomUUID()}/browser-canary.png`;
    const events = [];
    let request;
    class TestHeadCommand {
      constructor(input) {
        this.input = input;
      }
    }
    const storageClient = {
      send: async command => {
        events.push('head');
        expect(command.input).toEqual({ Bucket: 'webinar-studio-it-browser-contract', Key: key });
        return {
          ContentLength: bytes.length,
          ContentType: 'image/png',
          Metadata: { declaredbytes: String(bytes.length) },
        };
      },
    };

    const result = await performBrowserUploadCanary({
      createUploadUrl: async (input, client) => {
        events.push('intent');
        expect(client).toBe(storageClient);
        expect(input).toMatchObject({
          filename: 'browser-canary.png',
          mimeType: 'image/png',
          declaredBytes: bytes.length,
        });
        return {
          key,
          uploadUrl: `https://disposable.example/${key}?x-amz-meta-declaredbytes=${bytes.length}`,
        };
      },
      storageClient,
      fetchImpl: async (url, options) => {
        events.push('put');
        request = { url, options };
        return { ok: true, status: 200 };
      },
      registerCleanupKey: registeredKey => {
        events.push('register');
        expect(registeredKey).toBe(key);
      },
      HeadObjectCommand: TestHeadCommand,
      bucket: 'webinar-studio-it-browser-contract',
      config: {
        bucket: 'webinar-studio-it-browser-contract',
        cdnBaseUrl: 'https://assets.example',
        quarantinePrefix: 'quarantine/',
      },
      versionId: randomUUID(),
      filename: 'browser-canary.png',
      mimeType: 'image/png',
      bytes,
      origin: 'http://localhost:3000',
    });

    expect(events).toEqual(['intent', 'register', 'put', 'head']);
    expect(request.options).toEqual({
      method: 'PUT',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'image/png',
      },
      body: bytes,
    });
    expect(request.options.headers).not.toHaveProperty('x-amz-meta-declaredbytes');
    expect(result).toMatchObject({ key, contentLength: bytes.length });
  });

  it('pins separate exact production and local browser-upload CORS contracts without wildcards', () => {
    const runbook = readFileSync(
      new URL('../../../docs/webinar-studio/assets-runbook.md', import.meta.url),
      'utf8',
    );
    const productionBlock = /<!-- S3_BROWSER_UPLOAD_CORS_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- S3_BROWSER_UPLOAD_CORS_END -->/.exec(runbook);
    const localBlock = /<!-- S3_LOCAL_UPLOAD_CORS_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- S3_LOCAL_UPLOAD_CORS_END -->/.exec(runbook);
    expect(productionBlock).not.toBeNull();
    expect(localBlock).not.toBeNull();
    const common = {
      AllowedMethods: ['PUT'],
      AllowedHeaders: ['Content-Type'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 600,
    };
    expect(JSON.parse(productionBlock[1])).toEqual({
      CORSRules: [{
        AllowedOrigins: ['https://dashboard.msfgco.com'],
        ...common,
      }],
    });
    expect(JSON.parse(localBlock[1])).toEqual({
      CORSRules: [{
        AllowedOrigins: ['http://localhost:3000', 'http://localhost:3001'],
        ...common,
      }],
    });
    expect(`${productionBlock[1]}${localBlock[1]}`).not.toContain('"*"');
  });

  it('requires reviewed read-only CORS evidence and an exact disposable preflight/PUT cleanup canary', () => {
    const runbook = readFileSync(
      new URL('../../../docs/webinar-studio/assets-runbook.md', import.meta.url),
      'utf8',
    );
    const canaryBlock = /<!-- S3_BROWSER_UPLOAD_CANARY_BEGIN -->\s*```sh\s*([\s\S]*?)\s*```\s*<!-- S3_BROWSER_UPLOAD_CANARY_END -->/.exec(runbook);
    expect(canaryBlock).not.toBeNull();
    for (const required of [
      'aws s3api get-bucket-cors',
      "--bucket '<REVIEWED_WEBINAR_ASSET_BUCKET>'",
      "--profile '<REVIEWED_READ_ONLY_AWS_PROFILE>'",
      "--region '<REVIEWED_AWS_REGION>'",
      "--upload-file '<REVIEWED_EXACT_DISPOSABLE_FILE_PATH>'",
      "--key '<REVIEWED_EXACT_DISPOSABLE_QUARANTINE_KEY>'",
      'aws s3api delete-object',
      'aws s3api head-object',
      '**UNVERIFIED — DO NOT RUN WITHOUT SEPARATE DISPOSABLE/PRODUCTION APPROVAL**',
    ]) {
      expect(runbook).toContain(required);
    }
    expect(canaryBlock[1]).toContain("-H 'Origin: https://dashboard.msfgco.com'");
    expect(canaryBlock[1]).toContain("-H 'Access-Control-Request-Method: PUT'");
    expect(canaryBlock[1]).toContain("-H 'Access-Control-Request-Headers: content-type'");
    expect(canaryBlock[1].match(/'<ACTUAL_PRESIGNED_UPLOAD_URL_RETURNED_BY_CREATE_UPLOAD_INTENT>'/g))
      .toHaveLength(2);
    expect(canaryBlock[1]).not.toContain('x-amz-meta-declaredbytes:');
    expect(runbook).toMatch(/`x-amz-meta-declaredbytes` is hoisted into\s+that returned URL/);
    expect(runbook).not.toMatch(/delete-object[\s\S]{0,300}(?:--recursive|\*)/);
  });
});

function parseDisposableConfig(env) {
  if (env.WEBINAR_ASSET_TEST_ACK_DISPOSABLE !== EXPECTED_ACKNOWLEDGEMENT) {
    throw new Error('WEBINAR_ASSET_TEST_ACK_DISPOSABLE must explicitly acknowledge disposable mutation');
  }
  if (!/^webinar-studio-it-[a-z0-9-]{8,48}$/.test(env.WEBINAR_ASSET_TEST_BUCKET)) {
    throw new Error('WEBINAR_ASSET_TEST_BUCKET must use the webinar-studio-it- disposable naming convention');
  }

  let endpoint;
  let cdn;
  try {
    endpoint = new URL(env.WEBINAR_ASSET_TEST_S3_ENDPOINT);
    cdn = new URL(env.WEBINAR_ASSET_TEST_CDN_BASE_URL);
  } catch {
    throw new Error('Disposable S3 endpoint and CDN base URL must be valid URLs');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('WEBINAR_ASSET_TEST_S3_ENDPOINT must be an explicit HTTP(S) endpoint without credentials');
  }
  if (cdn.protocol !== 'https:' || cdn.username || cdn.password || cdn.search || cdn.hash) {
    throw new Error('WEBINAR_ASSET_TEST_CDN_BASE_URL must be an explicit HTTPS base URL');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.WEBINAR_ASSET_TEST_REGION)) {
    throw new Error('WEBINAR_ASSET_TEST_REGION is invalid');
  }

  return Object.freeze({
    bucket: env.WEBINAR_ASSET_TEST_BUCKET,
    cdnBaseUrl: cdn.href.replace(/\/+$/, ''),
    endpoint: endpoint.href.replace(/\/+$/, ''),
    region: env.WEBINAR_ASSET_TEST_REGION,
    credentials: Object.freeze({
      accessKeyId: env.WEBINAR_ASSET_TEST_ACCESS_KEY_ID,
      secretAccessKey: env.WEBINAR_ASSET_TEST_SECRET_ACCESS_KEY,
    }),
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createDatabase({ actorUserId, family, versions }) {
  const state = { family: structuredClone(family), versions: structuredClone(versions) };

  function versionRow(version) {
    return {
      ...version,
      family_created_by_user_id: state.family.created_by_user_id,
      family_archived_at: state.family.archived_at,
    };
  }

  async function query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.includes('SELECT 1 AS allowed FROM webinar_presentations')) {
      return [[Number(params[0]) === actorUserId ? { allowed: 1 } : null].filter(Boolean)];
    }
    if (normalized.includes('FROM webinar_asset_versions v') && normalized.includes('WHERE v.id = ?')) {
      return [[state.versions.find(version => version.id === params[0])].filter(Boolean).map(versionRow)];
    }
    if (normalized.includes('FROM webinar_asset_versions') && normalized.includes('sha256 = ?')) {
      return [[state.versions.find(version => (
        version.sha256 === params[0] && version.status === 'available' && !version.archived_at
      ))].filter(Boolean)];
    }
    if (normalized.startsWith("UPDATE webinar_asset_versions SET status = 'available'")) {
      const version = state.versions.find(candidate => candidate.id === params[8]);
      if (!version || version.status !== 'processing') return [{ affectedRows: 0 }];
      Object.assign(version, {
        status: 'available',
        sha256: params[0],
        s3_key: params[1],
        media_type: params[2],
        mime_type: params[3],
        byte_size: params[4],
        width: params[5],
        height: params[6],
        duration_ms: params[7],
        rejection_code: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("UPDATE webinar_asset_versions SET status = 'rejected'")) {
      const version = state.versions.find(candidate => candidate.id === params[1]);
      if (!version || version.status !== 'processing') return [{ affectedRows: 0 }];
      Object.assign(version, { status: 'rejected', rejection_code: params[0] });
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes('FROM webinar_assets a') && normalized.includes('JOIN webinar_asset_versions v')) {
      return [state.versions.map(version => ({
        asset_id: state.family.id,
        display_name: state.family.display_name,
        description: state.family.description,
        family_created_by_user_id: state.family.created_by_user_id,
        family_created_at: state.family.created_at,
        family_archived_at: state.family.archived_at,
        version_id: version.id,
        version_number: version.version_number,
        media_type: version.media_type,
        mime_type: version.mime_type,
        byte_size: version.byte_size,
        sha256: version.sha256,
        s3_key: version.s3_key,
        width: version.width,
        height: version.height,
        duration_ms: version.duration_ms,
        status: version.status,
        rejection_code: version.rejection_code,
        uploaded_by_user_id: version.uploaded_by_user_id,
        uploader_name: 'Disposable integration user',
        version_created_at: version.created_at,
        version_archived_at: version.archived_at,
      }))];
    }
    throw new Error(`Unhandled disposable integration query: ${normalized}`);
  }

  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query,
  };
  return {
    query,
    getConnection: async () => connection,
  };
}

describeAssetIntegration(`webinar asset release (${skippedReason})`, () => {
  const actorUserId = 7001;
  const runId = randomUUID();
  const safeVersionId = randomUUID();
  const rejectedVersionId = randomUUID();
  const familyId = randomUUID();
  const safeUploadFilename = 'disposable-safe.png';
  const safeQuarantineKey = `quarantine/${safeVersionId}/${safeUploadFilename}`;
  const rejectedQuarantineKey = `quarantine/integration/${runId}/${rejectedVersionId}.png`;
  const cleanupKeys = new Set([safeQuarantineKey, rejectedQuarantineKey]);
  let config;
  let s3;
  let safeBytes;
  let rejectedBytes;
  let safeApprovedKey;
  let rejectedApprovedKey;
  let catalog;
  let DeleteObjectsCommand;
  let GetObjectCommand;
  let GetObjectTaggingCommand;
  let HeadObjectCommand;
  let PutObjectCommand;
  let PutObjectTaggingCommand;

  beforeAll(async () => {
    config = parseDisposableConfig(process.env);
    const aws = await import('@aws-sdk/client-s3');
    const catalogModule = await import('../../services/webinarAssets/catalog.js');
    const inspectionModule = await import('../../services/webinarAssets/inspection.js');
    const configModule = await import('../../services/webinarAssets/config.js');
    const storageModule = await import('../../services/webinarAssets/storage.js');
    const sharp = require('sharp');
    ({
      DeleteObjectsCommand,
      GetObjectCommand,
      GetObjectTaggingCommand,
      HeadObjectCommand,
      PutObjectCommand,
      PutObjectTaggingCommand,
    } = aws);
    const createCatalogService = catalogModule.createCatalogService
      || catalogModule.default?.createCatalogService;
    const inspectAsset = inspectionModule.inspectAsset || inspectionModule.default?.inspectAsset;
    const makeApprovedKey = configModule.makeApprovedKey || configModule.default?.makeApprovedKey;
    const createAssetS3Client = storageModule.createAssetS3Client
      || storageModule.default?.createAssetS3Client;
    const createUploadUrl = storageModule.createUploadUrl || storageModule.default?.createUploadUrl;
    gatedDependenciesLoaded = true;
    s3 = createAssetS3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: config.credentials,
      forcePathStyle: true,
    });
    configuredS3ClientConstructed = true;
    const pixels = randomBytes(32 * 32 * 3);
    safeBytes = await sharp(pixels, {
      raw: { width: 32, height: 32, channels: 3 },
    }).png().toBuffer();
    rejectedBytes = Buffer.concat([Buffer.from('disposable-rejected-fixture:'), randomBytes(32)]);
    safeApprovedKey = makeApprovedKey(sha256(safeBytes));
    rejectedApprovedKey = makeApprovedKey(sha256(rejectedBytes));
    cleanupKeys.add(safeApprovedKey);
    cleanupKeys.add(rejectedApprovedKey);

    const browserUpload = await performBrowserUploadCanary({
      createUploadUrl,
      storageClient: s3,
      fetchImpl: fetch,
      registerCleanupKey: key => cleanupKeys.add(key),
      HeadObjectCommand,
      bucket: config.bucket,
      config: {
        bucket: config.bucket,
        cdnBaseUrl: config.cdnBaseUrl,
        quarantinePrefix: 'quarantine/',
      },
      versionId: safeVersionId,
      filename: safeUploadFilename,
      mimeType: 'image/png',
      bytes: safeBytes,
      origin: 'http://localhost:3000',
    });
    if (browserUpload.key !== safeQuarantineKey) {
      throw new Error('Disposable browser upload intent returned an unexpected quarantine key');
    }
    await s3.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: rejectedQuarantineKey,
      Body: rejectedBytes,
      ContentType: 'image/png',
    }));

    const versions = [
      {
        id: safeVersionId,
        asset_id: familyId,
        version_number: 1,
        original_filename: 'private-safe-name.png',
        media_type: 'image',
        mime_type: 'image/png',
        byte_size: safeBytes.length,
        sha256: null,
        s3_key: safeQuarantineKey,
        width: null,
        height: null,
        duration_ms: null,
        status: 'processing',
        rejection_code: null,
        uploaded_by_user_id: actorUserId,
        created_at: new Date().toISOString(),
        archived_at: null,
      },
      {
        id: rejectedVersionId,
        asset_id: familyId,
        version_number: 2,
        original_filename: 'private-rejected-name.png',
        media_type: 'image',
        mime_type: 'image/png',
        byte_size: rejectedBytes.length,
        sha256: null,
        s3_key: rejectedQuarantineKey,
        width: null,
        height: null,
        duration_ms: null,
        status: 'processing',
        rejection_code: null,
        uploaded_by_user_id: actorUserId,
        created_at: new Date().toISOString(),
        archived_at: null,
      },
    ];
    const database = createDatabase({
      actorUserId,
      family: {
        id: familyId,
        display_name: 'Disposable integration family',
        description: 'Created only inside the gated integration',
        created_by_user_id: actorUserId,
        created_at: new Date().toISOString(),
        archived_at: null,
      },
      versions,
    });
    const storage = {
      readScanStatus: async ({ key }) => {
        const response = await s3.send(new GetObjectTaggingCommand({ Bucket: config.bucket, Key: key }));
        return response.TagSet?.find(tag => tag.Key === 'GuardDutyMalwareScanStatus')?.Value || null;
      },
      readQuarantineObject: async ({ key }) => {
        const response = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        return response.Body;
      },
      makeApprovedKey,
      putApprovedObject: async ({ approvedKey, body, mimeType, byteSize }) => s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: approvedKey,
        Body: body,
        ContentType: mimeType,
        ContentLength: byteSize,
        CacheControl: 'public, max-age=31536000, immutable',
        IfNoneMatch: '*',
      })),
    };
    catalog = createCatalogService({
      db: database,
      storage,
      inspection: { inspectAsset },
      config: { bucket: config.bucket, cdnBaseUrl: config.cdnBaseUrl, quarantinePrefix: 'quarantine/' },
      recordAuditEvent: async () => {},
      recordOperationalEvent: () => {},
    });
  });

  afterAll(async () => {
    if (!s3 || !config || cleanupKeys.size === 0) return;
    try {
      await cleanupDisposableObjects({
        send: command => s3.send(command),
        bucket: config.bucket,
        keys: [...cleanupKeys],
        DeleteObjectsCommand,
        HeadObjectCommand,
      });
    } finally {
      s3.destroy();
    }
  });

  it('releases only the exact clean scan status and exposes no storage internals', async () => {
    await expect(catalog.confirmUpload({
      actorUserId,
      isAdmin: false,
      versionId: safeVersionId,
    })).resolves.toEqual({ versionId: safeVersionId, status: 'processing' });

    await expect(s3.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: safeApprovedKey,
    }))).rejects.toSatisfy(isMissingObject);

    await s3.send(new PutObjectTaggingCommand({
      Bucket: config.bucket,
      Key: safeQuarantineKey,
      Tagging: { TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }] },
    }));

    await expect(catalog.confirmUpload({
      actorUserId,
      isAdmin: false,
      versionId: safeVersionId,
    })).resolves.toEqual({
      versionId: safeVersionId,
      status: 'available',
      sha256: sha256(safeBytes),
      publicUrl: `${config.cdnBaseUrl}/${safeApprovedKey}`,
    });

    const approved = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: safeApprovedKey }));
    expect(approved.ContentType).toBe('image/png');
    expect(approved.CacheControl).toBe('public, max-age=31536000, immutable');

    const response = await catalog.listCatalog({ actorUserId, isAdmin: false });
    const serialized = JSON.stringify(response);
    expect(serialized).toContain(`${config.cdnBaseUrl}/${safeApprovedKey}`);
    expect(serialized).not.toContain(config.bucket);
    expect(serialized).not.toContain('quarantine/');
    expect(serialized).not.toContain('s3_key');
    expect(serialized).not.toContain('private-safe-name.png');
    expect(serialized).not.toContain('GuardDutyMalwareScanStatus');
  });

  it('never releases a non-clean scan result', async () => {
    await s3.send(new PutObjectTaggingCommand({
      Bucket: config.bucket,
      Key: rejectedQuarantineKey,
      Tagging: { TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'THREATS_FOUND' }] },
    }));

    await expect(catalog.confirmUpload({
      actorUserId,
      isAdmin: false,
      versionId: rejectedVersionId,
    })).resolves.toEqual({
      versionId: rejectedVersionId,
      status: 'rejected',
      rejectionCode: 'MALWARE_DETECTED',
    });
    await expect(s3.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: rejectedApprovedKey,
    }))).rejects.toSatisfy(isMissingObject);
  });
});
