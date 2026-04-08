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
  'lo_display',
  // Full Monday.com mirror fields
  'conditions', 'lp_loan_number', 'property_type', 'assistant_mgr',
  'initial_loan_amount', 'purchase_price',
  'appraisal_deadline', 'appraisal_due_date', 'appraised_value',
  'title_order_number', 'payoffs', 'payoff_date',
  'wvoes', 'vvoes', 'hoa',
  'cd_info', 'cd_signed', 'dpa',
  'closing_details', 'estimated_fund_date', 'closing_docs',
  'send_to_compliance',
];

const VALID_PRE_APPROVAL_FIELDS = [
  'client_name', 'loan_amount', 'pre_approval_date', 'expiration_date',
  'status', 'assigned_lo_name', 'property_address', 'loan_type', 'notes',
  'loan_number', 'lender', 'subject_property', 'loan_purpose', 'occupancy',
  'rate', 'credit_score', 'income', 'property_type', 'referring_agent',
  'contact_date',
  // Full Monday.com mirror fields
  'next_steps', 'special_request', 'stage', 'partners',
  'borrower_email', 'borrower_phone',
  'coborrower_first_name', 'coborrower_last_name', 'coborrower_phone', 'coborrower_email',
  'current_address', 'city', 'state', 'zip',
  'borrower_dob', 'citizenship', 'borrower_first_name', 'borrower_last_name',
  'coborrower_dob', 'credit_report_date', 'coborrower_name', 'campaign',
];

const VALID_FUNDED_LOAN_FIELDS = [
  'assigned_lo_name', 'loan_amount', 'loan_type',
  'funded_date', 'investor', 'property_address',
  'client_name', 'notes', 'loan_number', 'status',
  'group_name',
  'closing_date', 'loan_status', 'purchase_price', 'appraised_value',
  'rate', 'occupancy', 'lender', 'loan_purpose', 'credit_score',
  'subject_property', 'referring_agent',
  // Full Monday.com mirror fields
  'borrower_email', 'borrower_phone', 'borrower_dob',
  'coborrower_email', 'coborrower_dob',
  'sbj_city', 'sbj_state', 'sbj_county', 'sbj_zip',
  'buyer_agent', 'seller_agent', 'title_company',
  'hazard_insurance_company', 'hazard_insurance_amount',
  'cltv', 'ltv', 'first_payment_date', 'mortgage_payment',
  'taxes', 'borrower_first_name', 'borrower_last_name', 'term',
  'borrower2_first_name', 'borrower2_last_name', 'borrower2_phone',
  'seller_comp', 'mortgage_insurance', 'escrow_waiver',
  'occupancy_type', 'lp_loan_number', 'property_type',
  'lender_or_broker_pd', 'application_date', 'lien_status',
  'state', 'broker_fee',
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
  lo_display: 'LO',
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
  credit_score: 'Credit Score',
  income: 'Income',
  property_type: 'Property Type',
  referring_agent: 'Referring Agent',
  contact_date: 'Contact Date',
  loan_status: 'Loan Status',
  purchase_price: 'Purchase Price',
  appraised_value: 'Appraised Value',
  conditions: 'Conditions',
  lp_loan_number: 'LP Loan #',
  assistant_mgr: 'Assistant/Mgr',
  initial_loan_amount: 'Initial Loan Amt',
  appraisal_deadline: 'Appraisal Deadline',
  appraisal_due_date: 'Appraisal Due Date',
  title_order_number: 'Title Order #',
  payoffs: 'Payoffs',
  payoff_date: 'Payoff Date',
  wvoes: 'WVOEs',
  vvoes: 'VVOEs',
  hoa: 'HOA',
  cd_info: 'CD Info',
  cd_signed: 'CD Signed',
  dpa: 'DPA',
  closing_details: 'Closing Details',
  estimated_fund_date: 'Est. Fund Date',
  closing_docs: 'Closing Docs',
  send_to_compliance: 'Send to Compliance',
  // Funded loan full mirror fields
  borrower_email: 'Borrower Email',
  borrower_phone: 'Borrower Phone',
  borrower_dob: 'Borrower DOB',
  coborrower_email: 'Co-Borrower Email',
  coborrower_dob: 'Co-Borrower DOB',
  sbj_city: 'City',
  sbj_state: 'State',
  sbj_county: 'County',
  sbj_zip: 'Zip',
  buyer_agent: 'Buyer Agent',
  seller_agent: 'Seller Agent',
  title_company: 'Title',
  hazard_insurance_company: 'Hazard Ins. Company',
  hazard_insurance_amount: 'Hazard Ins. Amount',
  cltv: 'CLTV',
  ltv: 'LTV',
  first_payment_date: 'First Payment Date',
  mortgage_payment: 'Mortgage Payment',
  taxes: 'Taxes',
  borrower_first_name: 'Borrower First Name',
  borrower_last_name: 'Borrower Last Name',
  term: 'Term',
  borrower2_first_name: 'Borrower 2 First Name',
  borrower2_last_name: 'Borrower 2 Last Name',
  borrower2_phone: 'Borrower 2 Phone',
  seller_comp: 'Seller Comp',
  mortgage_insurance: 'Mortgage Insurance',
  escrow_waiver: 'Escrow Waiver',
  occupancy_type: 'Occupancy Type',
  lender_or_broker_pd: 'Lender/Broker Pd',
  lien_status: 'Lien Status',
  state: 'State',
  broker_fee: 'Broker Fee',
  // Pre-approval full mirror fields
  next_steps: 'Next Steps / Tasks',
  special_request: 'Special Request',
  stage: 'Stage',
  partners: 'Partners',
  coborrower_first_name: 'Co-Borrower First Name',
  coborrower_last_name: 'Co-Borrower Last Name',
  coborrower_phone: 'Co-Borrower Phone',
  coborrower_name: 'Co-Borrower Name',
  current_address: 'Current Address',
  city: 'City',
  zip: 'Zip',
  citizenship: 'Citizenship',
  credit_report_date: 'Credit Report Date',
  campaign: 'Campaign',
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
  'client name':          'client_name',
  'client':               'client_name',
  'borrower':             'client_name',
  'borrower name':        'client_name',
  'loan #':               'loan_number',
  'loan no':              'loan_number',
  'notes':                'notes',
  'notes on loan':        'notes',
  'app date':             'application_date',
  'interest rate':        'rate',
  'loan occupancy':       'occupancy',
  'loan status':          'stage',
  'subject property address': 'subject_property',
  'lock date':            'lock_expiration_date',
  'lo':                   'lo_display',
  'pre-approval date':    'pre_approval_date',
  'pre approval':         'pre_approval_date',
  'funded':               'funded_date',
  'funded amount':        'loan_amount',
  'address':              'property_address',
  'credit score':         'credit_score',
  'fico':                 'credit_score',
  'fico score':           'credit_score',
  'credit':               'credit_score',
  'income':               'income',
  'monthly income':       'income',
  'property type':        'property_type',
  'prop type':            'property_type',
  'contact date':         'contact_date',
  'referring agent':      'referring_agent',
  'referral agent':       'referring_agent',
  'referral partner':     'referring_agent',
  'realtor':              'referring_agent',
  'purchase price':       'purchase_price',
  'sales price':          'purchase_price',
  'appraised value':      'appraised_value',
  'appraisal value':      'appraised_value',
  'purpose':              'loan_purpose',
  'sbj property':         'subject_property',
  // Full Monday.com board field mappings
  'conditions':           'conditions',
  'lp loan number':       'lp_loan_number',
  'assistant/mgr':        'assistant_mgr',
  'assistant':            'assistant_mgr',
  'initial loan amount':  'initial_loan_amount',
  'appraisal deadline':   'appraisal_deadline',
  'appraisal due date':   'appraisal_due_date',
  'title order number':   'title_order_number',
  'title order':          'title_order_number',
  'payoffs':              'payoffs',
  'payoff date':          'payoff_date',
  'payoff':               'payoffs',
  'wvoes':                'wvoes',
  'vvoes':                'vvoes',
  'hoa':                  'hoa',
  'cd info':              'cd_info',
  'cd signed':            'cd_signed',
  'dpa':                  'dpa',
  'closing details':      'closing_details',
  'estimated fund date':  'estimated_fund_date',
  'est fund date':        'estimated_fund_date',
  'closing docs':         'closing_docs',
  'send to compliance':   'send_to_compliance',
  'compliance':           'send_to_compliance',
  'lock date.':           'lock_expiration_date',
  // Funded loan board field mappings
  'borrower email':       'borrower_email',
  'borrower phone':       'borrower_phone',
  'borrower date of birth': 'borrower_dob',
  'coborrower email':     'coborrower_email',
  'coborrower date of birth': 'coborrower_dob',
  'sbj city':             'sbj_city',
  'sbj state':            'sbj_state',
  'sbj county':           'sbj_county',
  'sbj zip':              'sbj_zip',
  'buyer agent':          'buyer_agent',
  'seller agent':         'seller_agent',
  'hazard insurance company': 'hazard_insurance_company',
  'hazard insurance amount': 'hazard_insurance_amount',
  'cltv':                 'cltv',
  'ltv':                  'ltv',
  'first payment date':   'first_payment_date',
  'mortgage payment':     'mortgage_payment',
  'taxes':                'taxes',
  'borrower first name':  'borrower_first_name',
  'borrower last name':   'borrower_last_name',
  'term':                 'term',
  'borrower 2 first name': 'borrower2_first_name',
  'borrower 2 last name': 'borrower2_last_name',
  'borrower 2 phone':     'borrower2_phone',
  'seller':               'seller_agent',
  'comp':                 'seller_comp',
  'mortgage insurance':   'mortgage_insurance',
  'escrow waiver':        'escrow_waiver',
  'occupancy type':       'occupancy_type',
  'lender or broker pd':  'lender_or_broker_pd',
  'first name':           'borrower_first_name',
  'last name':            'borrower_last_name',
  'lien status':          'lien_status',
  'broker fee':           'broker_fee',
  'state':                'state',
  // Pre-approval board field mappings
  'next steps / tasks':   'next_steps',
  'next steps':           'next_steps',
  'special request':      'special_request',
  'stage':                'stage',
  'assignments':          'assigned_lo_name',
  'partners':             'partners',
  'b1 email':             'borrower_email',
  'b1 phone':             'borrower_phone',
  'co b first':           'coborrower_first_name',
  'co b last':            'coborrower_last_name',
  'co b phone':           'coborrower_phone',
  'co b email':           'coborrower_email',
  'current address':      'current_address',
  'city':                 'city',
  'zip':                  'zip',
  'b1 birth date':        'borrower_dob',
  'citizenship':          'citizenship',
  'b1 first name':        'borrower_first_name',
  'b1 last name':         'borrower_last_name',
  'full name':            'client_name',
  'credit report date':   'credit_report_date',
  'co borrower name':     'coborrower_name',
  'remove from pipeline': 'status',
  'campaign':             'campaign',
  'date':                 'contact_date',
};

const DATE_FIELDS = [
  'application_date', 'lock_expiration_date', 'closing_date', 'funding_date',
  'target_close_date', 'pre_approval_date', 'expiration_date', 'funded_date',
  'contact_date',
  'appraisal_deadline', 'appraisal_due_date', 'payoff_date', 'estimated_fund_date',
  'borrower_dob', 'coborrower_dob', 'first_payment_date',
  'credit_report_date',
];

function mapItemToRow(item, columnMap, userNameMap) {
  const row = {
    client_name: item.name || 'Unnamed',
    monday_item_id: String(item.id),
  };

  if (item.group?.title) {
    row.stage = item.group.title;
    row._board_group = item.group.title;  // preserve actual board group (not overwritten by column mappings)
  }

  for (const cv of (item.column_values || [])) {
    const field = columnMap[cv.id];
    if (!field) continue;

    const text = (cv.text || '').trim();
    if (!text) continue;

    if (['loan_amount', 'income', 'purchase_price', 'appraised_value', 'initial_loan_amount',
         'hazard_insurance_amount', 'mortgage_payment', 'seller_comp', 'mortgage_insurance', 'broker_fee'].includes(field)) {
      const num = parseFloat(text.replace(/[$,\s]/g, ''));
      row[field] = isNaN(num) ? null : num;
    } else if (field === 'credit_score') {
      const num = parseInt(text.replace(/[^0-9]/g, ''));
      row[field] = isNaN(num) ? null : num;
    } else if (field === 'assigned_lo_name') {
      // Monday People columns may return multiple names comma-separated
      // e.g. "Laura Schloer, Seth Angell" — take the first as the primary LO
      const primaryName = text.includes(',') ? text.split(',')[0].trim() : text;
      row.assigned_lo_name = primaryName;
      // Try name match first, then email match
      const loId = userNameMap[primaryName.toLowerCase().trim()]
        || userNameMap['email:' + primaryName.toLowerCase().trim()];
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

// Columns where a more specific title should take priority over a shorter alias.
// e.g. "Loan Officer" should win over "LO" for assigned_lo_name.
const PREFERRED_TITLES = {
  assigned_lo_name: 'loan officer',
};

// Section-specific overrides: some column titles mean different things per section.
// e.g. "Title" = title_status (pipeline) vs title_company (funded_loans)
const SECTION_TITLE_OVERRIDES = {
  funded_loans: {
    'title': 'title_company',
    'loan status': 'loan_status',  // funded_loans uses loan_status, not stage
  },
  pre_approvals: {
    'stage': 'stage',              // explicit stage column, not from groups
    'status': 'status',
  },
};

async function autoMapColumns(token, boardId, section = 'pipeline') {
  const data = await mondayQuery(token, `query {
    boards(ids: [${boardId}]) {
      columns { id title type }
    }
  }`);

  const columns = data.boards?.[0]?.columns || [];
  const mappings = [];
  const usedFields = new Set();
  // Track fields that have a preferred title so we can upgrade them
  const fieldToMapping = {};

  for (const col of columns) {
    const normalizedTitle = col.title.toLowerCase().trim();
    // Skip columns explicitly marked as unused
    if (normalizedTitle === 'do not use') continue;
    // Skip Monday.com internal doc columns
    if (normalizedTitle.startsWith('monday doc')) continue;

    // Check section-specific overrides first, then fall back to default map
    const overrides = SECTION_TITLE_OVERRIDES[section] || {};
    const field = overrides[normalizedTitle] || DEFAULT_TITLE_MAP[normalizedTitle];
    if (!field) continue;

    if (usedFields.has(field)) {
      // If this title is the preferred one for the field, replace the earlier mapping
      const preferred = PREFERRED_TITLES[field];
      if (preferred && normalizedTitle === preferred) {
        const oldMapping = fieldToMapping[field];
        if (oldMapping) {
          const idx = mappings.indexOf(oldMapping);
          if (idx !== -1) mappings.splice(idx, 1);
        }
        const newMapping = { monday_column_id: col.id, pipeline_field: field };
        mappings.push(newMapping);
        fieldToMapping[field] = newMapping;
      }
      continue;
    }

    usedFields.add(field);
    const mapping = { monday_column_id: col.id, pipeline_field: field };
    mappings.push(mapping);
    fieldToMapping[field] = mapping;
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
  SECTION_TITLE_OVERRIDES,
  DATE_FIELDS,
  mapItemToRow,
  autoMapColumns,
};
