import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { createCatalogService } = require('../../services/webinarAssets/catalog');
const { inspectAsset } = require('../../services/webinarAssets/inspection');
const { makeApprovedKey } = require('../../services/webinarAssets/config');

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

function isMissingObject(error) {
  return error?.name === 'NotFound'
    || error?.name === 'NoSuchKey'
    || error?.$metadata?.httpStatusCode === 404;
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
  const safeQuarantineKey = `quarantine/integration/${runId}/${safeVersionId}.png`;
  const rejectedQuarantineKey = `quarantine/integration/${runId}/${rejectedVersionId}.png`;
  const cleanupKeys = new Set([safeQuarantineKey, rejectedQuarantineKey]);
  let config;
  let s3;
  let safeBytes;
  let rejectedBytes;
  let safeApprovedKey;
  let rejectedApprovedKey;
  let catalog;

  beforeAll(async () => {
    config = parseDisposableConfig(process.env);
    s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: config.credentials,
      forcePathStyle: true,
    });
    const pixels = randomBytes(32 * 32 * 3);
    safeBytes = await sharp(pixels, {
      raw: { width: 32, height: 32, channels: 3 },
    }).png().toBuffer();
    rejectedBytes = Buffer.concat([Buffer.from('disposable-rejected-fixture:'), randomBytes(32)]);
    safeApprovedKey = makeApprovedKey(sha256(safeBytes));
    rejectedApprovedKey = makeApprovedKey(sha256(rejectedBytes));
    cleanupKeys.add(safeApprovedKey);
    cleanupKeys.add(rejectedApprovedKey);

    await s3.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: safeQuarantineKey,
      Body: safeBytes,
      ContentType: 'image/png',
    }));
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
      await s3.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: [...cleanupKeys].map(Key => ({ Key })), Quiet: true },
      }));
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
