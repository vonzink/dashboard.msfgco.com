const {
  CopyObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  MEDIA_RULES,
  loadAssetConfig,
  makeApprovedKey,
  makeQuarantineKey,
} = require('./config');

const UPLOAD_URL_TTL_SECONDS = 10 * 60;
const GUARDDUTY_SCAN_STATUS_TAG = 'GuardDutyMalwareScanStatus';
const s3 = new S3Client({});

function storageError(code) {
  const error = new Error(code === 'ASSET_QUARANTINE_REQUIRED'
    ? 'Webinar asset operation requires a quarantine object'
    : 'Webinar asset storage input is invalid');
  error.code = code;
  return error;
}

function resolveConfig(input) {
  return input?.config || loadAssetConfig();
}

function assertQuarantineKey(config, key) {
  if (typeof key !== 'string' || !key.startsWith(config.quarantinePrefix)) {
    throw storageError('ASSET_QUARANTINE_REQUIRED');
  }
  return key;
}

function assertApprovedKey(key) {
  if (typeof key !== 'string' || !key.startsWith('approved/sha256/')) throw storageError('ASSET_STORAGE_INVALID');
  return key;
}

function resolveKeyInput(input) {
  if (typeof input === 'string') return { config: loadAssetConfig(), key: input };
  return { config: resolveConfig(input), key: input?.key };
}

function assertUploadInput({ mimeType, declaredBytes }) {
  const rule = MEDIA_RULES[mimeType];
  if (!rule || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > rule.maxBytes) {
    throw storageError('ASSET_STORAGE_INVALID');
  }
  return rule;
}

async function createUploadUrl(input) {
  const config = resolveConfig(input);
  assertUploadInput(input || {});
  const key = makeQuarantineKey(input.versionId, input.filename, config.quarantinePrefix);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: input.mimeType,
    ContentLength: input.declaredBytes,
    Metadata: { declaredBytes: String(input.declaredBytes) },
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return { uploadUrl, key, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

async function headQuarantineObject(input) {
  const { config, key } = resolveKeyInput(input);
  return s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: assertQuarantineKey(config, key) }));
}

async function readScanStatus(input) {
  const { config, key } = resolveKeyInput(input);
  const result = await s3.send(new GetObjectTaggingCommand({
    Bucket: config.bucket,
    Key: assertQuarantineKey(config, key),
  }));
  return result.TagSet?.find(tag => tag.Key === GUARDDUTY_SCAN_STATUS_TAG)?.Value || null;
}

async function readQuarantineObject(input) {
  const { config, key } = resolveKeyInput(input);
  const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: assertQuarantineKey(config, key) }));
  return result.Body;
}

async function putApprovedObject(input) {
  const config = resolveConfig(input);
  const approvedKey = assertApprovedKey(input?.approvedKey || makeApprovedKey(input?.sha256, input?.filename));
  return s3.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: approvedKey,
    Body: input?.body ?? input?.approvedBody,
    ContentType: input?.mimeType,
    ContentLength: input?.byteSize,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

function encodeCopySource(bucket, key) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function copyApprovedObject(input) {
  const config = resolveConfig(input);
  const sourceKey = assertQuarantineKey(config, input?.sourceKey);
  const approvedKey = assertApprovedKey(input?.approvedKey || makeApprovedKey(input?.sha256, input?.filename));
  return s3.send(new CopyObjectCommand({
    Bucket: config.bucket,
    Key: approvedKey,
    CopySource: encodeCopySource(config.bucket, sourceKey),
    ContentType: input?.mimeType,
    MetadataDirective: input?.mimeType ? 'REPLACE' : undefined,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

module.exports = {
  UPLOAD_URL_TTL_SECONDS,
  createUploadUrl,
  headQuarantineObject,
  readScanStatus,
  readQuarantineObject,
  putApprovedObject,
  copyApprovedObject,
  makeApprovedKey,
};
