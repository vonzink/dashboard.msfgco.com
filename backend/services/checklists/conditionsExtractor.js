'use strict';

const fs = require('fs/promises');
const path = require('path');

// pdfjs-dist legacy build runs in Node.js without canvas. We use it instead
// of Poppler's pdftotext so the backend doesn't need a system package.
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const DEFAULT_STATUS = 'Not Started';

const CONDITIONS_SHEET_STAGES = new Set([
  'Prior to Submission',
  'Final Approval',
  'Prior to Closing',
  'Prior to Funding',
  'Shipping/Post-Close'
]);

const DU_INCLUDE_HEADINGS = new Set([
  'Risk / Eligibility',
  'Verification Messages / Approval Conditions',
  'Credit and Liabilities',
  'Employment and Income',
  'Property and Appraisal Information'
]);

const DU_STOP_HEADINGS = new Set([
  'Observations',
  'Underwriting Analysis Report'
]);

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitTextLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\f/g, '\n')
    .split('\n');
}

function normalizeConditionText(lines) {
  const value = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
  return splitTextLines(value)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((line) => !isGlobalNoiseLine(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();
}

function isGlobalNoiseLine(line) {
  return [
    /^Copyright \(c\) \d{4} Fannie Mae\./i,
    /^Underwriting Conditional Approval p\d+\s+of\s+\d+/i,
    /^Mountain State Financial Group, LLC(?:,\s*NMLS#.*)?$/i,
    /^Underwriter Name:/i,
    /^Underwriter Signature:/i,
    /^ID Code:?$/i,
    /^Page \d+ of \d+$/i,
    /^f3365\b/i,
    /^\d{6,}-\d{4}-\d-\d-\d+$/i,
    /^Findings$/i
  ].some((pattern) => pattern.test(line));
}

function makeCondition(lines, contextParts) {
  const body = normalizeConditionText(lines);
  if (!body) return null;

  const context = (contextParts || [])
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join(' - ');

  return {
    name: context ? `${context}: ${body}` : body
  };
}

function dedupeConditions(conditions) {
  const seen = new Set();
  const result = [];

  for (const condition of conditions) {
    const key = condition.name.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(condition);
  }

  return result;
}

function detectFormat(text) {
  if (/Conditions Sheet/i.test(text) && /Underwriting Conditions/i.test(text)) {
    return 'conditions-sheet';
  }

  if (/Section\s+2\s+[–-]\s+Underwriting Conditions/i.test(text)
    || /Underwriting Conditional Approval/i.test(text)) {
    return 'conditional-approval';
  }

  if (/LOAN APPROVAL CONDITIONS/i.test(text)
    || (/Conditional Approval/i.test(text) && /UW\s*-?\s*Prior To Final/i.test(text))
    || (/Borrower conditions to be satisfied/i.test(text) && /\d{4}\s+\w+/.test(text))) {
    return 'uwm-approval';
  }

  if (/Summary of Findings/i.test(text)
    || /Verification Messages\s*\/\s*Approval Conditions/i.test(text)
    || /Desktop Underwriter|DU Version/i.test(text)) {
    return 'du-findings';
  }

  if (/UTRACK/i.test(text)
    || (/\(PTD\)/i.test(text) && /\d{4}\s+\w+:/i.test(text))
    || (/ease\.uwm\.com/i.test(text))) {
    return 'uwm-ease';
  }

  return 'generic';
}

function parseConditionsFromText(text, options = {}) {
  const format = options.format || detectFormat(text);

  if (format === 'conditions-sheet') {
    return parseConditionsSheet(text);
  }

  if (format === 'conditional-approval') {
    return parseConditionalApproval(text);
  }

  if (format === 'uwm-approval') {
    return parseUwmApproval(text);
  }

  if (format === 'du-findings') {
    return parseDuFindings(text);
  }

  if (format === 'uwm-ease') {
    return parseUwmEase(text);
  }

  return parseGenericNumberedConditions(text);
}

function parseConditionalApproval(text) {
  const lines = splitTextLines(text);
  const startIndex = lines.findIndex((line) => /Section\s+2\s+[–-]\s+Underwriting Conditions/i.test(line));
  const scopedLines = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  const conditions = [];
  let stage = '';
  let category = '';
  let currentLines = null;

  const flush = () => {
    if (!currentLines) return;
    const condition = makeCondition(currentLines, [stage, category]);
    if (condition) conditions.push(condition);
    currentLines = null;
  };

  for (const rawLine of scopedLines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    if (isConditionalApprovalNoiseLine(line)) {
      flush();
      continue;
    }

    const stageMatch = line.match(/^(Prior to .+?)(?: Conditions)?:$/i);
    if (stageMatch) {
      flush();
      stage = normalizeHeading(stageMatch[1]);
      category = '';
      continue;
    }

    if (/^[A-Za-z][A-Za-z /&-]+:$/.test(line)) {
      flush();
      category = normalizeHeading(line.replace(/:$/, ''));
      continue;
    }

    const itemMatch = line.match(/^\d+\.\s+(.+)$/);
    if (itemMatch) {
      flush();
      currentLines = [itemMatch[1]];
      continue;
    }

    if (currentLines) {
      currentLines.push(line);
    }
  }

  flush();
  return dedupeConditions(conditions);
}

function isConditionalApprovalNoiseLine(line) {
  return isGlobalNoiseLine(line)
    || /^Section\s+2\s+[–-]\s+Underwriting Conditions/i.test(line)
    || /^Borrower:\s/i.test(line)
    || /^Co-borrower:\s/i.test(line);
}

const UWM_APPROVAL_SECTIONS = new Set([
  'UW PRIOR TO FINAL APPROVAL (PTD)',
  'UW - PRIOR TO FINAL APPROVAL (PTD)',
  'UNDERWRITER TO OBTAIN AND CLEAR',
  'CLOSING (PTF)',
  'CLOSING (PTD)',
]);

const UWM_APPROVAL_CATEGORIES = new Set([
  'APPRAISAL', 'APPRAISAL (CONV)', 'ASSETS', 'BORROWER', 'CLOSING',
  'CREDIT', 'HOI', 'INCOME', 'INVOICE', 'PROPERTY', 'TC', 'TITLE',
]);

function parseUwmApproval(text) {
  const lines = splitTextLines(text);
  const borrowerConditions = [];
  const codedConditions = [];

  // Phase 1: "Borrower conditions to be satisfied:" section (no 4-digit codes)
  let inBorrowerSection = false;
  let currentCategory = '';
  let currentLines = null;

  const flush = () => {
    if (!currentLines) return;
    const cond = makeCondition(currentLines, [currentCategory].filter(Boolean));
    if (cond) borrowerConditions.push(cond);
    currentLines = null;
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    if (/Borrower conditions to be satisfied/i.test(line)) {
      inBorrowerSection = true;
      continue;
    }

    if (!inBorrowerSection) continue;

    if (/^LOAN APPROVAL CONDITIONS/i.test(line)
      || /^p\s+\d{3}[- ]\d{3}[- ]\d{4}/i.test(line)) {
      flush();
      break;
    }

    if (isGlobalNoiseLine(line)) continue;

    // Category + description on same line: "Income Provide a W2..."
    // Also handles compound categories like "Appraisal (Conv)"
    // Description must start with an uppercase letter (a real sentence start)
    const catMatch = line.match(/^((?:Appraisal\s*\([^)]+\))|[A-Za-z]+)\s+([A-Z].{10,})$/);
    if (catMatch && UWM_APPROVAL_CATEGORIES.has(catMatch[1].replace(/\s*\([^)]+\)/, '').toUpperCase())) {
      flush();
      currentCategory = normalizeHeading(catMatch[1]);
      currentLines = [catMatch[2]];
      continue;
    }

    if (currentLines) {
      currentLines.push(line);
    }
  }
  flush();

  // Phase 2: "CONDITIONS" section with 4-digit codes and section headers
  let inConditionsSection = false;
  let section = '';
  currentLines = null;
  let currentCode = '';

  const flush2 = () => {
    if (!currentLines) return;
    const ctx = [section, currentCode ? `#${currentCode}` : ''].filter(Boolean);
    const cond = makeCondition(currentLines, ctx);
    if (cond) codedConditions.push(cond);
    currentLines = null;
    currentCode = '';
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    if (/^CONDITIONS$/i.test(line)) {
      inConditionsSection = true;
      continue;
    }

    if (!inConditionsSection) continue;

    if (/^EXPIR(ATION|ING) (DATES|DOCUMENTS)/i.test(line)) {
      flush2();
      break;
    }
    if (/^Mortgagee Clause:/i.test(line)
      || /^p\s+\d{3}[- ]\d{3}[- ]\d{4}/i.test(line)
      || /^UWM\.COM/i.test(line)) {
      continue;
    }

    if (isGlobalNoiseLine(line)) continue;

    // Section headers like "UW Prior To Final Approval (PTD)"
    const upper = line.toUpperCase().replace(/\s+/g, ' ').trim();
    if (UWM_APPROVAL_SECTIONS.has(upper)) {
      flush2();
      section = normalizeHeading(line);
      continue;
    }

    // 4-digit code + category + description: "3463 Appraisal (Conv) Appraisal on Form..."
    const codeMatch = line.match(/^(\d{4})\s+((?:Appraisal\s*\([^)]+\))|[A-Za-z]+)\s+([A-Z].{5,})$/);
    if (codeMatch && UWM_APPROVAL_CATEGORIES.has(codeMatch[2].replace(/\s*\([^)]+\)/, '').toUpperCase())) {
      flush2();
      currentCode = codeMatch[1];
      currentLines = [codeMatch[3]];
      continue;
    }
    // 4-digit code without recognized category — still a condition start
    const codeOnly = line.match(/^(\d{4})\s+(.{10,})$/);
    if (codeOnly && !codeMatch) {
      flush2();
      currentCode = codeOnly[1];
      currentLines = [codeOnly[2]];
      continue;
    }

    // 4-digit code alone on a line
    if (/^\d{4}$/.test(line)) {
      flush2();
      currentCode = line;
      continue;
    }

    if (currentLines) {
      currentLines.push(line);
    }
  }
  flush2();

  // Prefer the coded CONDITIONS section; fall back to borrower section
  if (codedConditions.length > 0) {
    return dedupeConditions(codedConditions);
  }
  return dedupeConditions(borrowerConditions);
}

const UWM_SECTION_RE = /^\d+\s*\/\s*\d+\s+(.+?)\s+\d+%$/;
const UWM_SECTION_ALT_RE = /^\d+\s+(.+?)$/;
const UWM_KNOWN_SECTIONS = new Set([
  'SENIOR UNDERWRITER (PTD)',
  'UNDERWRITER II (PTD)',
  'UNDERWRITER TO OBTAIN AND CLEAR',
  'CLOSING (PTF)',
  'CLOSING (PTD)',
  'PROJECT REVIEW (PTD)',
  'DISCLOSURES/COMPLIANCE (PTD)',
]);
const UWM_ITEM_RE = /^(\d{4})\s+(.+)$/;

function parseUwmEase(text) {
  const lines = splitTextLines(text);
  const conditions = [];

  // Pass 1: identify sections and tagged lines. Each line becomes a record
  // with its section context and, if it contains/is a 4-digit code, that code.
  const tagged = [];
  let section = '';
  let active = false;

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;
    if (isUwmNoiseLine(line)) continue;

    const sectionMatch = line.match(UWM_SECTION_RE);
    if (sectionMatch) {
      section = normalizeHeading(sectionMatch[1]);
      active = true;
      continue;
    }
    if (!active) {
      const altMatch = line.match(UWM_SECTION_ALT_RE);
      if (altMatch && UWM_KNOWN_SECTIONS.has(altMatch[1].toUpperCase())) {
        section = normalizeHeading(altMatch[1]);
        active = true;
        continue;
      }
    }
    if (!active) continue;

    if (/^EXPIRING DOCUMENTS/i.test(line)
      || /^Comments$/i.test(line)
      || /^About UWM$/i.test(line)
      || /^Why UWM$/i.test(line)) {
      active = false;
      continue;
    }

    // Section header with count prefix: "0 CLOSING (PTF)", "0 UNDERWRITER TO OBTAIN AND CLEAR"
    const altMatch2 = line.match(UWM_SECTION_ALT_RE);
    if (altMatch2 && UWM_KNOWN_SECTIONS.has(altMatch2[1].toUpperCase())) {
      section = normalizeHeading(altMatch2[1]);
      continue;
    }

    // Inline code+text on same line
    const itemMatch = line.match(UWM_ITEM_RE);
    if (itemMatch) {
      tagged.push({ section, code: itemMatch[1], text: itemMatch[2] });
      continue;
    }
    // Standalone 4-digit code
    if (/^\d{4}$/.test(line)) {
      tagged.push({ section, code: line, text: '' });
      continue;
    }
    // Plain text line (belongs to nearest code)
    tagged.push({ section, code: null, text: line });
  }

  // Pass 2: walk the tagged array and assign plain-text lines to the correct
  // code. For standalone codes, text lines immediately before the code (back
  // to the previous code) are the condition's first portion, and text lines
  // after it are the continuation.
  let i = 0;
  while (i < tagged.length) {
    const rec = tagged[i];

    // Inline code+text: collect following plain text as continuation, but
    // stop if the next code after those lines is standalone (code-only) —
    // that means the intervening text belongs to the standalone code, not
    // this inline one.
    if (rec.code && rec.text) {
      const bodyLines = [rec.text];
      rec._claimed = true;
      let j = i + 1;
      while (j < tagged.length && !tagged[j].code) {
        j++;
      }
      const nextIsStandalone = j < tagged.length && tagged[j].code && !tagged[j].text;
      if (!nextIsStandalone) {
        // Safe to consume continuation lines
        j = i + 1;
        while (j < tagged.length && !tagged[j].code) {
          bodyLines.push(tagged[j].text);
          tagged[j]._claimed = true;
          j++;
        }
      } else {
        j = i + 1;
      }
      const ctx = [rec.section, `#${rec.code}`];
      const cond = makeCondition(bodyLines, ctx);
      if (cond) conditions.push(cond);
      i = j;
      continue;
    }

    // Standalone code: the PDF column layout puts the code on its own Y
    // coordinate, with text lines above (before) and below (after) it.
    // Look backward for unclaimed before-text and forward for after-text.
    // When the NEXT code is also standalone, the plain-text lines between
    // the two codes must be split: the first portion is after-text for
    // THIS code, the trailing portion is before-text for the next.
    if (rec.code && !rec.text) {
      const beforeLines = [];
      for (let b = i - 1; b >= 0; b--) {
        if (tagged[b].code || tagged[b]._claimed) break;
        beforeLines.unshift(tagged[b].text);
        tagged[b]._claimed = true;
      }

      // Collect candidate after-lines up to the next code
      const afterCandidates = [];
      let j = i + 1;
      while (j < tagged.length && !tagged[j].code) {
        afterCandidates.push({ idx: j, text: tagged[j].text });
        j++;
      }

      // If the next code is also standalone, leave trailing lines for
      // its backward scan. Split at the last sentence-ending period.
      let afterLines;
      const nextIsStandalone = j < tagged.length && tagged[j].code && !tagged[j].text;
      if (nextIsStandalone && afterCandidates.length > 1) {
        let splitAt = afterCandidates.length;
        for (let s = afterCandidates.length - 2; s >= 0; s--) {
          if (/\.\s*$/.test(afterCandidates[s].text)) {
            splitAt = s + 1;
            break;
          }
        }
        if (splitAt === afterCandidates.length) splitAt = 1;
        afterLines = afterCandidates.slice(0, splitAt);
        afterLines.forEach((a) => { tagged[a.idx]._claimed = true; });
        j = i + 1 + splitAt;
      } else {
        afterLines = afterCandidates;
        afterLines.forEach((a) => { tagged[a.idx]._claimed = true; });
      }

      const bodyLines = [...beforeLines, ...afterLines.map((a) => a.text)];
      const ctx = [rec.section, `#${rec.code}`];
      const cond = makeCondition(bodyLines, ctx);
      if (cond) conditions.push(cond);
      i = j;
      continue;
    }

    // Unclaimed plain text — skip (happens before the first code in a section)
    i++;
  }

  return dedupeConditions(conditions);
}

function isUwmNoiseLine(line) {
  return isGlobalNoiseLine(line)
    || /^CONDITIONS$/i.test(line)
    || /^Loan Number:/i.test(line)
    || /^Closing Date:/i.test(line)
    || /^Account Executive:/i.test(line)
    || /^Loan Product:/i.test(line)
    || /^NOT CLEARED CONDITIONS/i.test(line)
    || /^CLEARED CONDITIONS/i.test(line)
    || /^ALL CONDITIONS/i.test(line)
    || /^UTRACK$/i.test(line)
    || /^Category \/ Document Type/i.test(line)
    || /^-- SELECT ONE --$/i.test(line)
    || /^NOTE:\s/i.test(line)
    || /^By submitting an email/i.test(line)
    || /^Email Address$/i.test(line)
    || /^Please select an option/i.test(line)
    || /^https?:\/\//i.test(line)
    || /^\d+\/\d+\/\d+,\s+\d+:\d+/i.test(line)
    || /^Expires$/i.test(line)
    || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line);
}

function parseConditionsSheet(text) {
  const lines = splitTextLines(text);
  const conditions = [];
  let stage = '';
  let currentLines = null;
  let currentId = '';
  let sawConditionsHeader = false;
  let ignoreDebtTable = false;

  const flush = () => {
    if (!currentLines) return;
    const context = currentId ? [stage, `ID ${currentId}`] : [stage];
    const condition = makeCondition(currentLines, context);
    if (condition) conditions.push(condition);
    currentLines = null;
    currentId = '';
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    if (/^Underwriting Conditions$/i.test(line)
      || /^ID\s+Code\s+Signoff\s+Underwriting Conditions$/i.test(line)) {
      sawConditionsHeader = true;
      ignoreDebtTable = false;
      continue;
    }

    if (!sawConditionsHeader) continue;

    if (/^Debts to be paid directly from proceeds:/i.test(line)) {
      flush();
      ignoreDebtTable = true;
      continue;
    }

    if (ignoreDebtTable) {
      continue;
    }

    if (isConditionsSheetHardBoundaryLine(line)) {
      flush();
      continue;
    }

    const sectionHeading = normalizeHeading(line);
    if (CONDITIONS_SHEET_STAGES.has(sectionHeading)) {
      flush();
      stage = sectionHeading;
      continue;
    }

    const rowMatch = line.match(/^(?:(\d+)\s+)?([TSAFCP])\s+(.+)$/);
    if (rowMatch) {
      flush();
      currentId = rowMatch[1] || '';
      currentLines = [rowMatch[3]];
      continue;
    }

    if (currentLines) {
      currentLines.push(line);
    }
  }

  flush();
  return dedupeConditions(conditions);
}

function isConditionsSheetHardBoundaryLine(line) {
  return isGlobalNoiseLine(line)
    || /^Conditions Sheet$/i.test(line)
    || /^Code:\s/i.test(line)
    || /^ID\s+Code\s+Signoff\s+Underwriting Conditions$/i.test(line)
    || /^[A-Z]=/.test(line);
}

function parseDuFindings(text) {
  const lines = splitTextLines(text);
  const conditions = [];
  let active = false;
  let section = '';
  let currentNumber = '';
  let currentLines = null;

  const flush = () => {
    if (!currentLines) return;
    const condition = makeCondition(currentLines, [section, currentNumber ? `MSG ${currentNumber}` : '']);
    if (condition && shouldKeepDuCondition(condition.name)) {
      conditions.push(condition);
    }
    currentLines = null;
    currentNumber = '';
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    const heading = normalizeHeading(line);
    if (DU_STOP_HEADINGS.has(heading)) {
      flush();
      active = false;
      section = '';
      continue;
    }

    if (DU_INCLUDE_HEADINGS.has(heading)) {
      flush();
      active = true;
      section = heading;
      continue;
    }

    if (isDuHardBoundaryLine(line)) {
      continue;
    }

    if (!active) continue;

    const itemMatch = line.match(/^(\d{1,3})\s+(.+)$/);
    if (itemMatch) {
      flush();
      currentNumber = itemMatch[1];
      currentLines = [itemMatch[2]];
      continue;
    }

    if (currentLines) {
      currentLines.push(line);
    }
  }

  flush();
  return dedupeConditions(conditions);
}

function isDuHardBoundaryLine(line) {
  return isGlobalNoiseLine(line)
    || /^Summary of Findings$/i.test(line)
    || /^Mortgage Information$/i.test(line)
    || /^Property Information$/i.test(line)
    || /^Day 1 Certainty$/i.test(line)
    || /^Valuation Option$/i.test(line)
    || /^FACTOR\(S\)$/i.test(line);
}

function shouldKeepDuCondition(name) {
  return !/represent strengths in the borrower's loan application/i.test(name);
}

function parseGenericNumberedConditions(text) {
  const lines = splitTextLines(text);
  const conditions = [];
  let active = false;
  let currentLines = null;

  const flush = () => {
    if (!currentLines) return;
    const condition = makeCondition(currentLines, []);
    if (condition) conditions.push(condition);
    currentLines = null;
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    if (/conditions?/i.test(line)) {
      active = true;
      continue;
    }

    if (!active || isGlobalNoiseLine(line)) continue;

    const itemMatch = line.match(/^\d+[\).]\s+(.+)$/);
    if (itemMatch) {
      flush();
      currentLines = [itemMatch[1]];
      continue;
    }

    if (currentLines) {
      currentLines.push(line);
    }
  }

  flush();
  return dedupeConditions(conditions);
}

function normalizeHeading(line) {
  return normalizeWhitespace(line)
    .replace(/\s*:\s*$/, '')
    .replace(/\s+/g, ' ');
}

function markdownEscapeCell(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function yamlDoubleQuote(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function renderChecklistMarkdown({ title, description, conditions }) {
  const safeTitle = title || 'Loan Conditions Checklist';
  const safeDescription = description || 'Conditions extracted from PDF';
  const rows = (conditions || []).map((condition) => {
    return `| ${markdownEscapeCell(condition.name)} | ${DEFAULT_STATUS} | |`;
  });

  return [
    '---',
    'type: checklist-template',
    `name: "${yamlDoubleQuote(safeTitle)}"`,
    `description: "${yamlDoubleQuote(safeDescription)}"`,
    'version: 1',
    '---',
    '',
    `# ${safeTitle}`,
    '',
    '| Name | Status | Date |',
    '|---|---|---|',
    ...rows,
    ''
  ].join('\n');
}

/**
 * Extract text from a PDF using pdfjs-dist, approximating pdftotext's layout
 * mode by grouping text items by Y coordinate (so each printed line becomes
 * one output line) and inserting a form-feed between pages — the formatter's
 * line-based parsers rely on those boundaries.
 *
 * Accepts either a filesystem path (string) or a Node Buffer of PDF bytes.
 */
async function extractTextFromPdf(input) {
  let data;
  if (Buffer.isBuffer(input)) {
    data = new Uint8Array(input);
  } else {
    const buf = await fs.readFile(input);
    data = new Uint8Array(buf);
  }

  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pageStrings = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // Group items by Y coordinate (transform[5]) within a tolerance. pdfjs Y
    // grows upward, so larger Y = higher on the page. Round to bucket.
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      // Pick the closest existing bucket within 2 units to absorb minor jitter
      let bucket = y;
      for (const key of lines.keys()) {
        if (Math.abs(key - y) <= 2) { bucket = key; break; }
      }
      if (!lines.has(bucket)) lines.set(bucket, []);
      lines.get(bucket).push({ x: item.transform[4], w: item.width || 0, str: item.str });
    }

    // Sort lines top-to-bottom (descending Y), items left-to-right (ascending X)
    const sortedYs = [...lines.keys()].sort((a, b) => b - a);
    const pageLines = sortedYs.map((y) => {
      const items = lines.get(y).sort((a, b) => a.x - b.x);
      // Join items with a space, but omit the space when two items are
      // adjacent with no gap — this rejoins broken PDF ligatures (fi, ff,
      // fl, ffi) that pdfjs splits into separate text items.
      let result = items[0].str;
      for (let k = 1; k < items.length; k++) {
        const prev = items[k - 1];
        const cur = items[k];
        const gap = cur.x - (prev.x + prev.w);
        result += (gap < 1 ? '' : ' ') + cur.str;
      }
      return result.replace(/\s+/g, ' ').trim();
    }).filter((s) => s.length > 0);

    pageStrings.push(pageLines.join('\n'));
  }

  return pageStrings.join('\f');
}

function titleFromPdfPath(pdfPath) {
  const base = path.basename(pdfPath, path.extname(pdfPath));
  return `${base.replace(/[-_]+/g, ' ')} Conditions Checklist`;
}

async function convertPdfToMarkdown(pdfPath, options = {}) {
  const text = await extractTextFromPdf(pdfPath);
  const conditions = parseConditionsFromText(text, options);
  const title = options.title || titleFromPdfPath(pdfPath);
  const description = options.description || `Conditions extracted from ${path.basename(pdfPath)}`;

  return {
    text,
    conditions,
    markdown: renderChecklistMarkdown({ title, description, conditions }),
    format: options.format || detectFormat(text)
  };
}

async function writeMarkdownFile(outputPath, markdown) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf8');
}

module.exports = {
  DEFAULT_STATUS,
  convertPdfToMarkdown,
  detectFormat,
  extractTextFromPdf,
  parseConditionsFromText,
  parseConditionalApproval,
  parseConditionsSheet,
  parseDuFindings,
  parseGenericNumberedConditions,
  parseUwmApproval,
  parseUwmEase,
  renderChecklistMarkdown,
  titleFromPdfPath,
  writeMarkdownFile
};
