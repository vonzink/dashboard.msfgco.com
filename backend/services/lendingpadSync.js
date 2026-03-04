// LendingPad → Monday.com sync service
// When a funded loan comes in, push it to the correct LO's Monday.com board

const logger = require('../lib/logger');
const { getMondayToken } = require('./monday/sync');
const { createItem, updateItem, findItemByColumnValue } = require('./monday/writer');
const db = require('../db/connection');

// ================================================================
// LO → Monday.com Board Mapping (hardcoded per user request)
// Key: LO name (lowercase) → { boardId, dropdownLabel }
// ================================================================
const LO_BOARD_MAP = {
  'zachary zink':       { boardId: '18401678760', dropdownId: 1 },
  'zach zink':          { boardId: '18401678760', dropdownId: 1 },
  'kray olson':         { boardId: '18396387330', dropdownId: 14 },
  'tracy roberts':      { boardId: '18402413332', dropdownId: 18 },
  'laura schloer':      { boardId: '18401678864', dropdownId: 17 },
  'michael hauglie':    { boardId: '18401678967', dropdownId: 20 },
  'jessica haukeness':  { boardId: '18401679005', dropdownId: 4 },
  'josh sourial':       { boardId: '18401678890', dropdownId: 3 },
  'seth angell':        { boardId: '18402205824', dropdownId: 16 },
  'tanya long':         { boardId: '18401678790', dropdownId: 19 },
};

// ================================================================
// Extract nested data from LendingPad payload
// Collections can be objects or arrays depending on the payload
// ================================================================

function extractLO(loanData) {
  // Try multiple paths for LO name
  const lo = loanData.loanOfficerCollection || loanData.loanOfficer || {};
  return {
    name: lo.name || lo.fullName || null,
    email: lo.email || null,
    nmlsId: lo.nmlsId || lo.nmlsld || null,
  };
}

function extractBorrower(loanData, index = 0) {
  const borrowers = loanData.borrowersArray || loanData.borrowers || [];
  const b = Array.isArray(borrowers) ? borrowers[index] : null;
  if (!b) return {};

  return {
    firstName: b.firstName || b.borrowerFirstName || null,
    lastName: b.lastName || b.borrowerLastName || null,
    email: b.email || b.emailAddress || null,
    phone: b.phone || b.homePhone || b.cellPhone || null,
    dob: b.dateOfBirth || b.dob || null,
  };
}

function extractAddress(loanData) {
  const addr = loanData.subjectPropertyAddressCollection || loanData.subjectPropertyAddress || {};
  return {
    street: addr.street || addr.addressLine1 || addr.address || null,
    city: addr.city || null,
    state: addr.state || null,
    county: addr.county || null,
    zip: addr.zip || addr.zipCode || addr.postalCode || null,
  };
}

function extractPurpose(loanData) {
  const p = loanData.purposeCollection || loanData.purpose || {};
  return p.name || p.type || null;
}

function extractOccupancy(loanData) {
  const o = loanData.occupancyCollection || loanData.occupancy || {};
  return o.name || o.type || null;
}

function extractLoanType(loanData) {
  const lt = loanData.loanTypeCollection || loanData.loanType || {};
  return lt.name || lt.type || null;
}

function extractPropertyType(loanData) {
  const pt = loanData.propertyTypeCollection || loanData.propertyType || {};
  return pt.name || pt.type || null;
}

function extractFundDate(loanData) {
  // Check multiple possible locations for funded date
  const funding = loanData.fundingCollection || loanData.funding || {};
  if (funding.fundDate || funding.fundedDate || funding.date) {
    return funding.fundDate || funding.fundedDate || funding.date;
  }

  const dates = loanData.datesCollection || loanData.dates || {};
  if (dates.fundDate || dates.fundedDate || dates.fundingDate) {
    return dates.fundDate || dates.fundedDate || dates.fundingDate;
  }

  return null;
}

function extractClosingDate(loanData) {
  const dates = loanData.datesCollection || loanData.dates || {};
  return dates.closingDate || dates.estimatedClosingDate || dates.schedClosingDate || null;
}

function extractFirstPaymentDate(loanData) {
  const dates = loanData.datesCollection || loanData.dates || {};
  return dates.firstPaymentDate || null;
}

function extractLoanStatus(loanData) {
  const status = loanData.loanStatusCollection || loanData.loanStatus || {};
  return status.name || status.status || status.currentStatus || null;
}

// ================================================================
// Check if loan qualifies for Monday.com push (has funded date)
// ================================================================
function isFundedLoan(loanData) {
  const fundDate = extractFundDate(loanData);
  const status = extractLoanStatus(loanData);

  // Has a funded date
  if (fundDate) return true;

  // Status indicates funded
  if (status && /funded/i.test(status)) return true;

  return false;
}

// ================================================================
// Map LO name to board config
// ================================================================
function getLOBoardConfig(loName) {
  if (!loName) return null;
  const key = loName.toLowerCase().trim();
  return LO_BOARD_MAP[key] || null;
}

// ================================================================
// Build Monday.com column values from LendingPad data
// ================================================================
function buildColumnValues(loanData) {
  const borrower = extractBorrower(loanData, 0);
  const coBorrower = extractBorrower(loanData, 1);
  const address = extractAddress(loanData);
  const lo = extractLO(loanData);
  const fundDate = extractFundDate(loanData);
  const closingDate = extractClosingDate(loanData);
  const firstPaymentDate = extractFirstPaymentDate(loanData);
  const boardConfig = getLOBoardConfig(lo.name);

  const cols = {};

  // Loan Officer dropdown
  if (boardConfig) {
    cols['dropdown_2'] = { ids: [boardConfig.dropdownId] };
  }

  // Loan Status
  cols['status2'] = { label: 'Funded' };

  // Dates
  if (closingDate) cols['date7'] = { date: formatDate(closingDate) };
  if (fundDate) cols['date2'] = { date: formatDate(fundDate) };
  if (firstPaymentDate) cols['date_mkzst8m2'] = { date: formatDate(firstPaymentDate) };

  // Loan numbers
  if (loanData.loanNumber) cols['text9'] = loanData.loanNumber;
  if (loanData.loanNumber) cols['text_mkzt5jk0'] = loanData.loanNumber;

  // Money fields
  if (loanData.loanAmount) cols['numbers7'] = parseFloat(loanData.loanAmount) || 0;
  if (loanData.purchasePrice) cols['numbers30'] = parseFloat(loanData.purchasePrice) || 0;
  if (loanData.appraisalValue) cols['numbers3'] = parseFloat(loanData.appraisalValue) || 0;

  // Rate & terms
  if (loanData.noteRate) cols['numeric_mkzsv8x9'] = parseFloat(loanData.noteRate) || 0;
  if (loanData.combinedLtvRatioPercent) cols['numeric_mkzs48pt'] = parseFloat(loanData.combinedLtvRatioPercent) || 0;
  if (loanData.term) cols['numeric_mkzsn18m'] = parseInt(loanData.term) || 0;
  if (loanData.pmi) cols['numeric_mkzst1eh'] = parseFloat(loanData.pmi) || 0;

  // Borrower 1
  if (borrower.firstName) cols['text_mkzsgnhw'] = borrower.firstName;
  if (borrower.lastName) cols['text_mkzs6498'] = borrower.lastName;
  if (borrower.email) cols['text_mkzsvwzj'] = borrower.email;
  if (borrower.phone) cols['phone_mkzs4mph'] = { phone: borrower.phone, countryShortName: 'US' };
  if (borrower.dob) cols['date_mkzs2qx'] = { date: formatDate(borrower.dob) };

  // Borrower 2 (co-borrower)
  if (coBorrower.firstName) cols['text_mkzs712n'] = coBorrower.firstName;
  if (coBorrower.lastName) cols['text_mkzss2by'] = coBorrower.lastName;
  if (coBorrower.email) cols['text_mkzsgh7g'] = coBorrower.email;
  if (coBorrower.phone) cols['phone_mkzttnpx'] = { phone: coBorrower.phone, countryShortName: 'US' };
  if (coBorrower.dob) cols['date_mkzsa3q'] = { date: formatDate(coBorrower.dob) };

  // Property address
  if (address.street) cols['text_mkzsv94q'] = address.street;
  if (address.city) cols['text_mkzswjg9'] = address.city;
  if (address.state) cols['text_mkzskmj3'] = address.state;
  if (address.county) cols['text_mkzszngx'] = address.county;
  if (address.zip) cols['text_mkztgmat'] = address.zip;

  // Loan details
  const occupancy = extractOccupancy(loanData);
  const loanType = extractLoanType(loanData);
  const propertyType = extractPropertyType(loanData);
  const purpose = extractPurpose(loanData);

  if (occupancy) cols['text_mkzsws2p'] = occupancy;
  if (occupancy) cols['text_mkzsx6w7'] = occupancy;
  if (loanType) cols['text_mkzs5ntk'] = loanType;
  if (propertyType) cols['text_mkztq4wp'] = propertyType;
  if (purpose) cols['text_mkzsnfrr'] = purpose;
  if (purpose) cols['text_mkztrnm1'] = purpose;

  // Lender
  if (loanData.lender) cols['text_mkzsg595'] = loanData.lender;

  // Escrow waiver
  if (loanData.escrowWaiver !== undefined) {
    cols['text_mkzsmqg2'] = loanData.escrowWaiver ? 'True' : 'False';
  }

  return cols;
}

/**
 * Format a date string to YYYY-MM-DD for Monday.com
 */
function formatDate(dateStr) {
  if (!dateStr) return null;
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Try parsing
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// ================================================================
// Main sync function: Push funded loan to Monday.com
// ================================================================
async function syncToMonday(loanData, lendingpadLoanDbId = null) {
  const lo = extractLO(loanData);
  const boardConfig = getLOBoardConfig(lo.name);

  if (!boardConfig) {
    logger.warn({ loName: lo.name }, 'LendingPad sync: No board mapping found for LO');
    return { synced: false, reason: `No board mapping for LO: ${lo.name}` };
  }

  // Get Monday.com token
  // Try env var first since this runs from a webhook (no user session)
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    logger.error('LendingPad sync: MONDAY_API_TOKEN not set in environment');
    return { synced: false, reason: 'Monday.com API token not configured' };
  }

  const borrower = extractBorrower(loanData, 0);
  const itemName = [borrower.firstName, borrower.lastName].filter(Boolean).join(' ') || loanData.loanNumber || 'Unknown Borrower';

  const columnValues = buildColumnValues(loanData);

  try {
    // Check if item already exists by LP Loan Number
    let mondayItemId = null;

    // First check our DB for a stored Monday item ID
    if (lendingpadLoanDbId) {
      const [rows] = await db.query(
        'SELECT monday_item_id FROM lendingpad_loans WHERE id = ?',
        [lendingpadLoanDbId]
      );
      if (rows.length > 0 && rows[0].monday_item_id) {
        mondayItemId = rows[0].monday_item_id;
      }
    }

    // Fallback: search Monday.com by LP Loan Number
    if (!mondayItemId && loanData.loanNumber) {
      mondayItemId = await findItemByColumnValue(
        token, boardConfig.boardId, 'text_mkzt5jk0', loanData.loanNumber
      );
    }

    let action;
    if (mondayItemId) {
      // UPDATE existing item
      await updateItem(token, boardConfig.boardId, mondayItemId, columnValues);
      action = 'updated';
    } else {
      // CREATE new item
      mondayItemId = await createItem(token, boardConfig.boardId, itemName, columnValues);
      action = 'created';
    }

    // Store the Monday.com item ID in our DB
    if (lendingpadLoanDbId && mondayItemId) {
      await db.query(
        'UPDATE lendingpad_loans SET monday_item_id = ? WHERE id = ?',
        [mondayItemId, lendingpadLoanDbId]
      );
    }

    logger.info({
      action,
      mondayItemId,
      boardId: boardConfig.boardId,
      loName: lo.name,
      loanNumber: loanData.loanNumber,
    }, 'LendingPad → Monday.com sync complete');

    return { synced: true, action, mondayItemId, boardId: boardConfig.boardId };

  } catch (error) {
    logger.error({ error: error.message, loName: lo.name, loanNumber: loanData.loanNumber },
      'LendingPad → Monday.com sync failed');
    return { synced: false, reason: error.message };
  }
}

module.exports = {
  syncToMonday,
  isFundedLoan,
  extractLO,
  extractBorrower,
  extractAddress,
  extractFundDate,
  getLOBoardConfig,
  LO_BOARD_MAP,
};
