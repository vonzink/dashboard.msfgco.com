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
  loan_amount: z.number().positive(),
  pre_approval_date: dateString,
  expiration_date: dateString,
  status: z.enum(['active', 'expired', 'used', 'cancelled']).optional().default('active'),
  assigned_lo_id: z.number().int().positive().optional().nullable(),
  assigned_lo_name: optionalString(200),
  property_address: optionalString(500),
  loan_type: optionalString(100),
  notes: optionalString(2000),
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
}).strict();

// ── Goals ───────────────────────────────────────
const goal = z.object({
  user_id: z.number().int().positive().optional().nullable(),
  period_type: z.enum(['monthly', 'quarterly', 'yearly']),
  period_value: trimmedString(20),
  goal_type: z.enum(['units', 'volume']),
  current_value: z.number().optional().nullable(),
  target_value: z.number().nonnegative(),
});

const goalsUpdate = z.union([goal, z.array(goal).min(1).max(50)]);

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

module.exports = {
  chatMessage,
  announcement,
  preApproval,
  pipelineUpdate,
  goal,
  goalsUpdate,
  validate,
};
