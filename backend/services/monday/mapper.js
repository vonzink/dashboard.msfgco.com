// Monday.com field mapping — constants + item-to-row conversion
const { mondayQuery } = require('./client');

// Fields we can map from Monday.com into each section's table
const VALID_PIPELINE_FIELDS = [
  'loan_number', 'lender', 'subject_property',
  'loan_amount', 'rate', 'appraisal_status', 'loan_purpose',
  'loan_type', 'occupancy', 'title_status', 'hoi_status',
  'loan_estimate', 'application_date', 'lock_expiration_date',
  'closing_date', 'funding_date', 'stage', 'notes',
  'prelims_status', 'mini_set_status', 'cd_status',
  'assigned_lo_name',
];

const VALID_PRE_APPROVAL_FIELDS = [
  'client_name', 'loan_amount', 'pre_approval_date', 'expiration_date',
  'status', 'assigned_lo_name', 'property_address', 'loan_type', 'notes',
];

const VALID_FUNDED_LOAN_FIELDS = [
  'assigned_lo_name', 'loan_amount', 'loan_type',
  'funded_date', 'investor', 'property_address',
];

const VALID_FIELDS_BY_SECTION = {
  pipeline: VALID_PIPELINE_FIELDS,
  pre_approvals: VALID_PRE_APPROVAL_FIELDS,
  funded_loans: VALID_FUNDED_LOAN_FIELDS,
};

const FIELD_LABELS = {
  client_name: 'Client Name',
  loan_number: 'Loan #',
  lender: 'Lender',
  subject_property: 'Subject Property',
  assigned_lo_name: 'Loan Officer',
  loan_amount: 'Loan Amount',
  rate: 'Rate',
  appraisal_status: 'Appraisal',
  loan_purpose: 'Loan Purpose',
  loan_type: 'Loan Type',
  occupancy: 'Occupancy',
  title_status: 'Title',
  hoi_status: 'HOI',
  loan_estimate: 'Loan Estimate',
  application_date: 'App Date',
  lock_expiration_date: 'Lock Exp',
  closing_date: 'Closing Date',
  funding_date: 'Funding Date',
  stage: 'Stage',
  notes: 'Notes',
  prelims_status: 'Prelims',
  mini_set_status: 'Mini Set',
  cd_status: 'CD',
  pre_approval_date: 'Pre-Approval Date',
  expiration_date: 'Expiration Date',
  status: 'Status',
  property_address: 'Property Address',
  funded_date: 'Funded Date',
  investor: 'Investor',
  group_name: 'Group',
};

const FIELD_LABELS_BY_SECTION = {
  pipeline: Object.fromEntries(VALID_PIPELINE_FIELDS.map(f => [f, FIELD_LABELS[f] || f])),
  pre_approvals: Object.fromEntries(VALID_PRE_APPROVAL_FIELDS.map(f => [f, FIELD_LABELS[f] || f])),
  funded_loans: Object.fromEntries(VALID_FUNDED_LOAN_FIELDS.map(f => [f, FIELD_LABELS[f] || f])),
};

// Default column-title → field mapping
const DEFAULT_TITLE_MAP = {
  'lender':               'lender',
  'loan number':          'loan_number',
  'subject property':     'subject_property',
  'loan officer':         'assigned_lo_name',
  'loan amount':          'loan_amount',
  'rate':                 'rate',
  'appraisal status':     'appraisal_status',
  'loan purpose':         'loan_purpose',
  'loan type':            'loan_type',
  'occupancy':            'occupancy',
  'title':                'title_status',
  'hoi':                  'hoi_status',
  'loan estimate':        'loan_estimate',
  'application date':     'application_date',
  'lock expiration date': 'lock_expiration_date',
  'lock expiration':      'lock_expiration_date',
  'closing date':         'closing_date',
  'closing data':         'closing_date',
  'funding date':         'funding_date',
  'prelims':              'prelims_status',
  'prelims status':       'prelims_status',
  'mini set':             'mini_set_status',
  'mini set status':      'mini_set_status',
  'cd':                   'cd_status',
  'cd status':            'cd_status',
  'pre approval date':    'pre_approval_date',
  'expiration date':      'expiration_date',
  'property address':     'property_address',
  'funded date':          'funded_date',
  'status':               'status',
  'investor':             'investor',
  'product':              'loan_type',
  'product type':         'loan_type',
  'property':             'property_address',
  'fund date':            'funded_date',
  'funding date':         'funded_date',
  'funding amount':       'loan_amount',
  'sbj address':          'property_address',
  'subject address':      'property_address',
};

const DATE_FIELDS = [
  'application_date', 'lock_expiration_date', 'closing_date', 'funding_date',
  'target_close_date', 'pre_approval_date', 'expiration_date', 'funded_date',
];

function mapItemToRow(item, columnMap, userNameMap) {
  const row = {
    client_name: item.name || 'Unnamed',
    monday_item_id: String(item.id),
  };

  if (item.group?.title) {
    row.stage = item.group.title;
  }

  for (const cv of (item.column_values || [])) {
    const field = columnMap[cv.id];
    if (!field) continue;

    const text = (cv.text || '').trim();
    if (!text) continue;

    if (field === 'loan_amount') {
      const num = parseFloat(text.replace(/[$,\s]/g, ''));
      row.loan_amount = isNaN(num) ? null : num;
    } else if (field === 'assigned_lo_name') {
      row.assigned_lo_name = text;
      const loId = userNameMap[text.toLowerCase().trim()];
      if (loId) row.assigned_lo_id = loId;
    } else if (DATE_FIELDS.includes(field)) {
      let dateVal = null;
      try {
        if (cv.value) {
          const parsed = JSON.parse(cv.value);
          dateVal = parsed.date || parsed;
        }
      } catch {
        dateVal = text;
      }
      if (dateVal && typeof dateVal === 'string') {
        const d = new Date(dateVal);
        row[field] = isNaN(d.getTime()) ? null : dateVal;
      }
    } else {
      row[field] = text;
    }
  }

  if (row.loan_amount === undefined) row.loan_amount = 0;
  if (!row.stage) row.stage = 'Unknown';

  return row;
}

async function autoMapColumns(token, boardId) {
  const data = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      columns { id title type }
    }
  }`);

  const columns = data.boards?.[0]?.columns || [];
  const mappings = [];

  for (const col of columns) {
    const normalizedTitle = col.title.toLowerCase().trim();
    const field = DEFAULT_TITLE_MAP[normalizedTitle];
    if (field) {
      mappings.push({ monday_column_id: col.id, pipeline_field: field });
    }
  }

  return mappings;
}

module.exports = {
  VALID_PIPELINE_FIELDS,
  VALID_PRE_APPROVAL_FIELDS,
  VALID_FUNDED_LOAN_FIELDS,
  VALID_FIELDS_BY_SECTION,
  FIELD_LABELS,
  FIELD_LABELS_BY_SECTION,
  DEFAULT_TITLE_MAP,
  DATE_FIELDS,
  mapItemToRow,
  autoMapColumns,
};
