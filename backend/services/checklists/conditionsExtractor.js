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

  if (/Summary of Findings/i.test(text)
    || /Verification Messages\s*\/\s*Approval Conditions/i.test(text)
    || /Desktop Underwriter|DU Version/i.test(text)) {
    return 'du-findings';
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

  if (format === 'du-findings') {
    return parseDuFindings(text);
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
      lines.get(bucket).push({ x: item.transform[4], str: item.str });
    }

    // Sort lines top-to-bottom (descending Y), items left-to-right (ascending X)
    const sortedYs = [...lines.keys()].sort((a, b) => b - a);
    const pageLines = sortedYs.map((y) => {
      const items = lines.get(y).sort((a, b) => a.x - b.x);
      return items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
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
  renderChecklistMarkdown,
  titleFromPdfPath,
  writeMarkdownFile
};
