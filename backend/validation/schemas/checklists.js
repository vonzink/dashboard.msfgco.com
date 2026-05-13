// Zod schemas for the checklists feature.
//
// Each new feature should add a file like this under backend/validation/schemas/
// and re-export from backend/validation/schemas.js. Existing schemas living
// directly in schemas.js can be migrated incrementally.

const { z } = require('zod');

const trimmedString = (max) => z.string().trim().min(1).max(max);
const optionalString = (max) => z.string().trim().max(max).optional().nullable();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD format');

const checklistStatus = z.enum(['not_started', 'in_progress', 'done', 'issue', 'na']);
const checklistImportance = z.enum(['normal', 'important', 'urgent']);

const checklistSubitemInput = z.object({
  name: trimmedString(500),
  default_status: checklistStatus.optional().default('not_started'),
  status: checklistStatus.optional().default('not_started'),
  date: dateString.optional().nullable(),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

const checklistItemInput = z.object({
  name: trimmedString(500),
  default_status: checklistStatus.optional().default('not_started'),
  status: checklistStatus.optional().default('not_started'),
  date: dateString.optional().nullable(),
  sort_order: z.number().int().nonnegative().optional().default(0),
  subitems: z.array(checklistSubitemInput).max(100).optional().default([]),
});

const checklistTemplate = z.object({
  name: trimmedString(200),
  description: optionalString(500),
  items: z.array(checklistItemInput).max(200).optional().default([]),
});

const checklistTemplateUpdate = z.object({
  name: trimmedString(200).optional(),
  description: optionalString(500),
  items: z.array(checklistItemInput).max(200).optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' },
);

const loanChecklistAssign = z.object({
  template_id: z.number().int().positive(),
});

const loanChecklistItemUpdate = z.object({
  name: trimmedString(500).optional(),
  status: checklistStatus.optional(),
  importance: checklistImportance.optional(),
  date: dateString.optional().nullable(),
  due_date: dateString.optional().nullable(),
  sort_order: z.number().int().nonnegative().optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' },
);

// Batch reorder (drag-to-reorder applies to multiple items at once)
const loanChecklistReorder = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    sort_order: z.number().int().nonnegative(),
  })).min(1).max(500),
});

const loanChecklistItemCreate = z.object({
  name: trimmedString(500),
  status: checklistStatus.optional().default('not_started'),
  date: dateString.optional().nullable(),
  due_date: dateString.optional().nullable(),
  sort_order: z.number().int().nonnegative().optional().default(0),
  subitems: z.array(checklistSubitemInput).max(100).optional().default([]),
});

const loanChecklistSubitemCreate = z.object({
  name: trimmedString(500),
  status: checklistStatus.optional().default('not_started'),
  date: dateString.optional().nullable(),
  sort_order: z.number().int().nonnegative().optional().default(0),
});

const loanChecklistImport = z.object({
  items: z.array(checklistItemInput).min(1).max(200),
  mode: z.enum(['replace', 'merge']).optional().default('replace'),
  name: optionalString(200),
});

module.exports = {
  checklistStatus,
  checklistImportance,
  checklistTemplate,
  checklistTemplateUpdate,
  loanChecklistAssign,
  loanChecklistItemUpdate,
  loanChecklistItemCreate,
  loanChecklistSubitemCreate,
  loanChecklistImport,
  loanChecklistReorder,
};
