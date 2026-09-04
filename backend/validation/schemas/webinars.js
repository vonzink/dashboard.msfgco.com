const { z } = require('zod');
const { LIMITS } = require('../../services/webinars/limits');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR = /^[a-z][a-z0-9-]*$/;

function byteString(limit) {
  return z.string().superRefine((value, ctx) => {
    if (Buffer.byteLength(value, 'utf8') > limit) {
      ctx.addIssue({ code: 'custom', message: `Must not exceed ${limit} UTF-8 bytes` });
    }
  });
}

const positiveInteger = z.number().int().positive();
const expectedVersion = z.number().int().nonnegative();
const webinarSlug = z.string().trim().min(1).max(190).regex(SLUG);
const slideAnchor = z.string().trim().min(1).max(190).regex(ANCHOR);
const slideId = z.string().regex(UUID);
const masterHtml = byteString(LIMITS.master_html);
const masterCss = byteString(LIMITS.master_css);
const slideHtml = byteString(LIMITS.slide_html);
const slideCss = byteString(LIMITS.slide_css);
const slideJavascript = byteString(LIMITS.slide_javascript);
const speakerNotes = byteString(LIMITS.speaker_notes);

const slideFields = {
  anchor: slideAnchor,
  title: z.string().trim().min(1).max(255),
  targetSeconds: z.number().int().min(0).max(7200),
  speakerNotes,
  html: slideHtml,
  css: slideCss,
  javascript: slideJavascript,
};

const createWebinar = z.object({
  slug: webinarSlug,
  title: z.string().trim().min(1).max(255),
  primaryOwnerUserId: positiveInteger,
}).strict();

const saveMaster = z.object({
  expectedVersion,
  masterHtml,
  masterCss,
}).strict();

const addSlide = z.object({
  expectedVersion,
  ...slideFields,
}).strict();

const duplicateSlide = z.object({
  expectedVersion,
  sourceSlideId: slideId,
}).strict();

const saveSlide = z.object({
  expectedVersion,
  ...slideFields,
}).strict();

const reorderSlides = z.object({
  expectedVersion,
  slideIds: z.array(slideId).min(1).max(500).superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Slide IDs must be unique' });
    }
  }),
}).strict();

const restoreRevision = z.object({ expectedVersion }).strict();
const changeOwner = z.object({ primaryOwnerUserId: positiveInteger }).strict();
const changeAudienceAccess = z.object({ enabled: z.boolean() }).strict();
const writeNote = z.object({ body: z.string().trim().min(1).max(65535) }).strict();
const writeSettings = z.object({
  shortcuts: z.record(z.string(), z.unknown()),
  preferences: z.record(z.string(), z.unknown()),
}).strict();

module.exports = {
  LIMITS,
  webinarSlug,
  createWebinar,
  saveMaster,
  addSlide,
  duplicateSlide,
  saveSlide,
  reorderSlides,
  restoreRevision,
  changeOwner,
  changeAudienceAccess,
  writeNote,
  writeSettings,
};
