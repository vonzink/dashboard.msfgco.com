// Zod schemas for API input validation
const { z } = require('zod');

// ── Helpers ─────────────────────────────────────
const trimmedString = (max) => z.string().trim().min(1).max(max);
const optionalString = (max) => z.string().trim().max(max).optional().nullable();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD format');

// ── Chat ────────────────────────────────────────
const chatMessage = z.object({
  message: trimmedString(2000),
  tag_ids: z.array(z.number().int().positive()).optional().default([]),
});

// ── Announcements ───────────────────────────────
const announcement = z.object({
  title: trimmedString(200),
  content: trimmedString(5000),
  link: optionalString(500),
  icon: optionalString(50),
  file_s3_key: optionalString(500),
  file_name: optionalString(255),
  file_size: z.number().int().positive().optional().nullable(),
  file_type: optionalString(100),
});

// ── Pre-Approvals ───────────────────────────────
const preApproval = z.object({
  client_name: trimmedString(200),
  loan_amount: z.number().positive().optional().nullable(),
  pre_approval_date: dateString.optional().nullable(),
  expiration_date: dateString.optional().nullable(),
  status: z.enum(['active', 'expired', 'converted', 'cancelled']).optional().default('active'),
  assigned_lo_id: z.number().int().positive().optional().nullable(),
  assigned_lo_name: optionalString(200),
  property_address: optionalString(500),
  loan_type: optionalString(100),
  notes: optionalString(2000),
  loan_number: optionalString(50),
  lender: optionalString(200),
  subject_property: optionalString(500),
  loan_purpose: optionalString(100),
  occupancy: optionalString(100),
  rate: optionalString(20),
  credit_score: z.number().int().min(300).max(900).optional().nullable(),
  income: z.number().positive().optional().nullable(),
  property_type: optionalString(100),
  referring_agent: optionalString(200),
  contact_date: dateString.optional().nullable(),
});

// ── Pipeline ────────────────────────────────────
const pipelineUpdate = z.object({
  client_name: optionalString(200),
  loan_amount: z.number().positive().optional().nullable(),
  loan_type: optionalString(100),
  stage: optionalString(100),
  target_close_date: dateString.optional().nullable(),
  assigned_lo_id: z.number().int().positive().optional().nullable(),
  assigned_lo_name: optionalString(200),
  investor: optionalString(200),
  investor_id: z.number().int().positive().optional().nullable(),
  status: optionalString(50),
  notes: optionalString(2000),
  loan_number: optionalString(50),
  loan_status: optionalString(100),
  lender: optionalString(200),
  subject_property: optionalString(500),
  rate: optionalString(20),
  appraisal_status: optionalString(100),
  loan_purpose: optionalString(100),
  occupancy: optionalString(100),
  title_status: optionalString(100),
  hoi_status: optionalString(100),
  loan_estimate: optionalString(100),
  application_date: dateString.optional().nullable(),
  lock_expiration_date: dateString.optional().nullable(),
  closing_date: dateString.optional().nullable(),
  funding_date: dateString.optional().nullable(),
  prelims_status: optionalString(100),
  mini_set_status: optionalString(100),
  cd_status: optionalString(100),
  // Full Monday.com mirror fields
  conditions: optionalString(2000),
  lp_loan_number: optionalString(100),
  property_type: optionalString(150),
  assistant_mgr: optionalString(255),
  initial_loan_amount: z.number().positive().optional().nullable(),
  purchase_price: z.number().positive().optional().nullable(),
  appraisal_deadline: dateString.optional().nullable(),
  appraisal_due_date: dateString.optional().nullable(),
  appraised_value: z.number().positive().optional().nullable(),
  title_order_number: optionalString(150),
  payoffs: optionalString(255),
  payoff_date: dateString.optional().nullable(),
  wvoes: optionalString(255),
  vvoes: optionalString(255),
  hoa: optionalString(255),
  cd_info: optionalString(255),
  cd_signed: optionalString(150),
  dpa: optionalString(255),
  closing_details: optionalString(2000),
  estimated_fund_date: dateString.optional().nullable(),
  closing_docs: optionalString(255),
  send_to_compliance: optionalString(255),
}).strict();

// ── Goals ───────────────────────────────────────
const goal = z.object({
  user_id: z.coerce.number().int().positive().optional().nullable(),
  period_type: z.enum(['weekly', 'monthly', 'quarterly', 'yearly', 'all']),
  period_value: trimmedString(20),
  goal_type: z.enum(['loans-closed', 'volume-closed', 'pipeline', 'pre-approvals']),
  current_value: z.coerce.number().optional().nullable(),
  target_value: z.coerce.number().nonnegative(),
});

const goalsUpdate = z.union([goal, z.array(goal).min(1).max(50)]);

// ── Notifications ───────────────────────────
const notification = z.object({
  user_id: z.number().int().positive(),
  reminder_date: dateString,
  reminder_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected HH:MM or HH:MM:SS format'),
  note: trimmedString(500),
  delivery_method: z.enum(['email', 'text', 'both']).optional().default('email'),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).optional().default('none'),
});

// ── Calendar Events ────────────────────────
const calendarEvent = z.object({
  title: trimmedString(200),
  who: optionalString(200),
  start: z.string().min(1, 'start is required'),
  end: z.string().optional().nullable(),
  allDay: z.union([z.boolean(), z.number()]).optional().default(false),
  notes: optionalString(2000),
  color: optionalString(20),
  recurrence_rule: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly']).optional().default('none'),
  recurrence_end: z.string().optional().nullable(),
});

// ── Tasks ──────────────────────────────────
const task = z.object({
  title: trimmedString(200),
  description: optionalString(2000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional().default('todo'),
  due_date: dateString.optional().nullable(),
  due_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
  assigned_to: optionalString(200),
  user_id: z.number().int().positive().optional().nullable(),
});

const taskUpdate = task.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Chat Message Edit ───────────────────────
const chatMessageEdit = z.object({
  message: trimmedString(2000),
});

// ── Chat Message Tags ────────────────────────
const chatMessageTags = z.object({
  tag_ids: z.array(z.number().int().positive()).min(0).max(50),
});

// ── Pre-Approval Update ────────────────────
const preApprovalUpdate = preApproval.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Calendar Event Update ──────────────────
const calendarEventUpdate = calendarEvent.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Investors ──────────────────────────────
const investor = z.object({
  investor_key: optionalString(200),
  name: trimmedString(200),
  account_executive_name: optionalString(200),
  account_executive_email: optionalString(200),
  account_executive_mobile: optionalString(50),
  account_executive_address: optionalString(500),
  states: optionalString(500),
  best_programs: optionalString(2000),
  minimum_fico: optionalString(20),
  in_house_dpa: optionalString(500),
  epo: optionalString(500),
  in_house_servicing: optionalString(255),
  max_comp: optionalString(200),
  underwriting_fee: optionalString(200),
  servicing: z.union([z.boolean(), z.number()]).optional().nullable(),
  manual_underwriting: z.union([z.boolean(), z.number()]).optional().nullable(),
  non_qm: z.union([z.boolean(), z.number()]).optional().nullable(),
  jumbo: z.union([z.boolean(), z.number()]).optional().nullable(),
  subordinate_financing: z.union([z.boolean(), z.number()]).optional().nullable(),
  review_wire_release: z.union([z.boolean(), z.number()]).optional().nullable(),
  usda: z.union([z.boolean(), z.number()]).optional().nullable(),
  land_loans: z.union([z.boolean(), z.number()]).optional().nullable(),
  va_loans: z.union([z.boolean(), z.number()]).optional().nullable(),
  bridge_loans: z.union([z.boolean(), z.number()]).optional().nullable(),
  dscr: z.union([z.boolean(), z.number()]).optional().nullable(),
  conventional: z.union([z.boolean(), z.number()]).optional().nullable(),
  fha: z.union([z.boolean(), z.number()]).optional().nullable(),
  bank_statement: z.union([z.boolean(), z.number()]).optional().nullable(),
  asset_depletion: z.union([z.boolean(), z.number()]).optional().nullable(),
  interest_only: z.union([z.boolean(), z.number()]).optional().nullable(),
  itin_foreign_national: z.union([z.boolean(), z.number()]).optional().nullable(),
  construction: z.union([z.boolean(), z.number()]).optional().nullable(),
  renovation: z.union([z.boolean(), z.number()]).optional().nullable(),
  manufactured: z.union([z.boolean(), z.number()]).optional().nullable(),
  doctor: z.union([z.boolean(), z.number()]).optional().nullable(),
  condo_non_warrantable: z.union([z.boolean(), z.number()]).optional().nullable(),
  heloc_second: z.union([z.boolean(), z.number()]).optional().nullable(),
  scenario_desk: z.union([z.boolean(), z.number()]).optional().nullable(),
  condo_review: z.union([z.boolean(), z.number()]).optional().nullable(),
  exception_desk: z.union([z.boolean(), z.number()]).optional().nullable(),
  website_url: optionalString(500),
  logo_url: optionalString(500),
  login_url: optionalString(500),
  notes: optionalString(5000),
});

const investorUpdate = investor.extend({
  is_active: z.union([z.boolean(), z.number()]).optional(),
  account_executive_photo_url: optionalString(500),
}).partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Monday Board Update ─────────────────────
const mondayBoardUpdate = z.object({
  boardName: optionalString(200),
  targetSection: z.enum(['pipeline', 'pre_approvals', 'funded_loans']).optional(),
  isActive: z.union([z.boolean(), z.number()]).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  assignedUsers: z.array(z.number().int().positive()).optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Admin User Update ───────────────────────
const userUpdate = z.object({
  name: optionalString(200),
  initials: optionalString(10),
  role: z.enum(['admin', 'manager', 'user', 'lo', 'processor', 'external']).optional(),
  is_active: z.union([z.boolean(), z.number()]).optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Content Items (update) ─────────────────
const contentItemUpdate = z.object({
  text_content: optionalString(50000),
  hashtags: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  platform: optionalString(50),
  status: optionalString(50),
  image_s3_key: optionalString(500),
  image_source: optionalString(500),
  video_s3_key: optionalString(500),
  video_source: optionalString(500),
  review_notes: optionalString(5000),
  scheduled_at: z.string().optional().nullable(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Content Generation ─────────────────────
const contentGenerate = z.object({
  suggestion: trimmedString(1000),
  platforms: z.array(z.string().min(1)).min(1, 'platforms[] is required'),
  keyword: optionalString(200),
  template_id: z.number().int().positive().optional().nullable(),
  additional_instructions: optionalString(2000),
  save_drafts: z.boolean().optional().default(false),
});

// ── Content Templates ──────────────────────
const contentTemplate = z.object({
  platform: trimmedString(50),
  name: trimmedString(200),
  system_prompt: trimmedString(10000),
  tone: optionalString(100),
  audience: optionalString(200),
  rules: optionalString(5000),
  example_post: optionalString(5000),
  model: optionalString(50),
  temperature: z.number().min(0).max(2).optional().nullable(),
  is_default: z.boolean().optional().default(false),
  is_company_wide: z.boolean().optional().default(false),
});

const contentTemplateUpdate = contentTemplate.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// ── Content Publish (batch) ────────────────
const contentPublishBatch = z.object({
  item_ids: z.array(z.number().int().positive()).min(1, 'item_ids[] is required').max(20, 'Maximum 20 items per batch'),
  method: z.enum(['direct', 'n8n', 'zapier']).optional(),
});

// ── Guidelines ──────────────────────────────────
const PRODUCT_TYPES = ['conventional', 'fha', 'va', 'usda', 'jumbo', 'non-qm', 'other'];

const guidelineUpload = z.object({
  fileName: trimmedString(500),
  fileType: z.string().trim().max(100).optional().default('application/pdf'),
  fileSize: z.number().int().positive(),
  productType: z.enum(PRODUCT_TYPES),
  versionLabel: optionalString(100),
});

const guidelineProcess = z.object({
  fileId: z.number().int().positive(),
  s3Key: trimmedString(1000),
  productType: z.enum(PRODUCT_TYPES),
});

const guidelineSearch = z.object({
  q: z.string().trim().min(1).max(200),
  product_type: z.enum(PRODUCT_TYPES).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ── Handbook ────────────────────────────────────
const handbookSearch = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const handbookSectionUpdate = z.object({
  title: trimmedString(500),
  content: z.string().trim().max(500000),
});

const handbookSectionCreate = z.object({
  title: trimmedString(500),
  content: z.string().trim().max(500000).optional().default(''),
});

// ── Validate helper ─────────────────────────────
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues[0].message,
        field: result.error.issues[0].path.join('.') || undefined,
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate query parameters (for GET requests).
 * Parses req.query through the Zod schema.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues[0].message,
        field: result.error.issues[0].path.join('.') || undefined,
      });
    }
    req.query = result.data;
    next();
  };
}

module.exports = {
  chatMessage,
  chatMessageEdit,
  chatMessageTags,
  announcement,
  preApproval,
  preApprovalUpdate,
  pipelineUpdate,
  goal,
  goalsUpdate,
  notification,
  calendarEvent,
  calendarEventUpdate,
  task,
  taskUpdate,
  investor,
  investorUpdate,
  mondayBoardUpdate,
  userUpdate,
  contentGenerate,
  contentItemUpdate,
  contentTemplate,
  contentTemplateUpdate,
  contentPublishBatch,
  guidelineUpload,
  guidelineProcess,
  guidelineSearch,
  PRODUCT_TYPES,
  handbookSearch,
  handbookSectionUpdate,
  handbookSectionCreate,
  validate,
  validateQuery,
};
