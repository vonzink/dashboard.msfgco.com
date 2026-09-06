const { z } = require('zod');
const { MEDIA_RULES } = require('../../services/webinarAssets/config');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEDIA_TYPES = ['image', 'svg', 'font', 'audio', 'video'];
const ASSET_STATUSES = ['processing', 'available', 'rejected', 'archived'];
const CONTENT_TYPES = Object.keys(MEDIA_RULES);

const assetId = z.string().regex(UUID);
const versionId = z.string().regex(UUID);
const displayName = z.string().trim().min(1).max(255);
const description = z.string().trim().superRefine((value, context) => {
  if (Buffer.byteLength(value, 'utf8') > 65535) {
    context.addIssue({ code: 'custom', message: 'Must not exceed 65535 UTF-8 bytes' });
  }
}).nullable();
const filename = z.string().trim().min(1).max(255);

const uploadFields = {
  filename,
  contentType: z.enum(CONTENT_TYPES),
  byteSize: z.number().int().positive(),
};

function validateDeclaredSize(value, context) {
  const rule = MEDIA_RULES[value.contentType];
  if (rule && value.byteSize > rule.maxBytes) {
    context.addIssue({
      code: 'custom',
      path: ['byteSize'],
      message: `Must not exceed ${rule.maxBytes} bytes for ${value.contentType}`,
    });
  }
}

const listCatalog = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  mediaType: z.enum(MEDIA_TYPES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
}).strict();

const createUploadIntent = z.object({
  displayName,
  description: description.optional(),
  ...uploadFields,
}).strict().superRefine(validateDeclaredSize);

const createVersionIntent = z.object(uploadFields).strict().superRefine(validateDeclaredSize);

const confirmUpload = z.object({}).strict();

const updateFamily = z.object({
  displayName: displayName.optional(),
  description: description.optional(),
  archive: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  const hasLabels = value.displayName !== undefined || value.description !== undefined;
  if (!hasLabels && value.archive !== true) {
    context.addIssue({ code: 'custom', message: 'At least one family change is required' });
  }
  if (hasLabels && value.archive === true) {
    context.addIssue({ code: 'custom', message: 'Archive cannot be combined with label changes' });
  }
});

const archiveVersion = z.object({ archive: z.literal(true) }).strict();

module.exports = {
  assetId,
  versionId,
  listCatalog,
  createUploadIntent,
  createVersionIntent,
  confirmUpload,
  updateFamily,
  archiveVersion,
};
