/**
 * services/guidelineParser.js
 *
 * Downloads a guideline PDF from S3, extracts text per page using pdfjs-dist,
 * detects section boundaries (e.g. B2-1.2-01, A3-5-02) and inserts chunks
 * into the guideline_chunks table for FULLTEXT search.
 */

const db = require('../db/connection');
const { getObject, BUCKETS } = require('./s3');
const logger = require('../lib/logger');

// pdfjs-dist legacy build works in Node.js without canvas
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

// ── Constants ────────────────────────────────────────────────────
const MAX_CHUNK_CHARS = 10000;
const BATCH_INSERT_SIZE = 100;

// Section ID patterns found in Fannie Mae Selling Guide, HUD Handbook, VA Handbook, etc.
// Examples: B2-1.2-01, A3-5-02, Chapter 3, Part II, Section 4155.1
const SECTION_REGEX = /^([A-Z]\d+-\d+(?:\.\d+)?-\d+),\s*(.+?)(?:\s*\(\d{2}\/\d{2}\/\d{4}\))?$/gm;

/**
 * Extract text from every page of a PDF buffer.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Array<{ pageNum: number, text: string }>>}
 */
async function extractPages(pdfBuffer) {
  const data = new Uint8Array(pdfBuffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    pages.push({ pageNum: i, text });
  }

  return pages;
}

/**
 * Detect section boundaries from page-level text and return an array of section objects.
 *
 * @param {Array<{ pageNum: number, text: string }>} pages
 * @returns {Array<{ sectionId: string|null, sectionTitle: string|null, pageNumber: number, content: string }>}
 */
function detectSections(pages) {
  // Combine all pages into a single text with page markers
  const combined = [];
  for (const { pageNum, text } of pages) {
    combined.push({ pageNum, text });
  }

  // First pass: find all section header positions across all pages
  const sectionHeaders = [];
  for (const { pageNum, text } of combined) {
    SECTION_REGEX.lastIndex = 0;
    let match;
    while ((match = SECTION_REGEX.exec(text)) !== null) {
      sectionHeaders.push({
        sectionId: match[1],
        sectionTitle: match[2].trim(),
        pageNum,
        matchIndex: match.index,
        matchEnd: match.index + match[0].length,
      });
    }
  }

  // If no sections detected, treat entire document as one chunk per page
  if (sectionHeaders.length === 0) {
    return pages.map(p => ({
      sectionId: null,
      sectionTitle: null,
      pageNumber: p.pageNum,
      content: p.text,
    }));
  }

  // Build a flat text with page markers to slice by section
  const sections = [];
  const pageTexts = new Map(); // pageNum -> text
  for (const p of pages) {
    pageTexts.set(p.pageNum, p.text);
  }

  // For each section header, collect text from its position to the next section header
  for (let i = 0; i < sectionHeaders.length; i++) {
    const header = sectionHeaders[i];
    const nextHeader = sectionHeaders[i + 1] || null;

    let content = '';

    if (nextHeader && nextHeader.pageNum === header.pageNum) {
      // Same page — slice between the two match positions
      const pageText = pageTexts.get(header.pageNum) || '';
      content = pageText.substring(header.matchEnd, nextHeader.matchIndex).trim();
    } else {
      // Different pages — get remainder of current page + full pages until next header's page
      const currentPageText = pageTexts.get(header.pageNum) || '';
      content = currentPageText.substring(header.matchEnd).trim();

      const endPage = nextHeader ? nextHeader.pageNum : pages[pages.length - 1].pageNum + 1;
      for (let p = header.pageNum + 1; p < endPage; p++) {
        const pText = pageTexts.get(p);
        if (pText) content += '\n' + pText;
      }

      // If next header is on the last collected page, only take up to its position
      if (nextHeader) {
        const nextPageText = pageTexts.get(nextHeader.pageNum) || '';
        content += '\n' + nextPageText.substring(0, nextHeader.matchIndex).trim();
      }
    }

    sections.push({
      sectionId: header.sectionId,
      sectionTitle: header.sectionTitle,
      pageNumber: header.pageNum,
      content: content.trim(),
    });
  }

  // Also capture any text BEFORE the first section header (preamble / table of contents)
  const firstHeader = sectionHeaders[0];
  let preambleContent = '';
  for (let p = 1; p < firstHeader.pageNum; p++) {
    const pText = pageTexts.get(p);
    if (pText) preambleContent += pText + '\n';
  }
  const firstPageText = pageTexts.get(firstHeader.pageNum) || '';
  preambleContent += firstPageText.substring(0, firstHeader.matchIndex);
  preambleContent = preambleContent.trim();

  if (preambleContent.length > 50) {
    sections.unshift({
      sectionId: 'PREAMBLE',
      sectionTitle: 'Table of Contents / Introduction',
      pageNumber: 1,
      content: preambleContent,
    });
  }

  return sections;
}

/**
 * Sub-chunk sections that exceed MAX_CHUNK_CHARS by splitting on paragraph breaks.
 *
 * @param {Array} sections
 * @returns {Array<{ sectionId, sectionTitle, pageNumber, chunkIndex, content }>}
 */
function subChunk(sections) {
  const chunks = [];

  for (const sec of sections) {
    if (sec.content.length <= MAX_CHUNK_CHARS) {
      chunks.push({ ...sec, chunkIndex: 0 });
      continue;
    }

    // Split on double-newline (paragraph break) or single newline
    const paragraphs = sec.content.split(/\n{2,}|\n/);
    let current = '';
    let idx = 0;

    for (const para of paragraphs) {
      if (current.length + para.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
        chunks.push({
          sectionId: sec.sectionId,
          sectionTitle: sec.sectionTitle,
          pageNumber: sec.pageNumber,
          chunkIndex: idx++,
          content: current.trim(),
        });
        current = '';
      }
      current += para + '\n';
    }

    if (current.trim().length > 0) {
      chunks.push({
        sectionId: sec.sectionId,
        sectionTitle: sec.sectionTitle,
        pageNumber: sec.pageNumber,
        chunkIndex: idx,
        content: current.trim(),
      });
    }
  }

  return chunks;
}

/**
 * Process a guideline PDF: download from S3, parse, and insert chunks.
 *
 * @param {number} fileId      — guideline_files.id
 * @param {string} s3Key       — object key in the forms bucket
 * @param {string} productType — e.g. 'conventional', 'fha'
 */
async function processGuideline(fileId, s3Key, productType) {
  try {
    logger.info({ fileId, s3Key, productType }, 'Starting guideline processing');

    // 1. Download PDF from S3
    const pdfBuffer = await getObject(BUCKETS.forms, s3Key);
    logger.info({ fileId, bytes: pdfBuffer.length }, 'Downloaded PDF from S3');

    // 2. Extract text per page
    const pages = await extractPages(pdfBuffer);
    logger.info({ fileId, totalPages: pages.length }, 'Extracted page text');

    // 3. Detect section boundaries
    const sections = detectSections(pages);
    logger.info({ fileId, sections: sections.length }, 'Detected sections');

    // 4. Sub-chunk long sections
    const chunks = subChunk(sections);
    logger.info({ fileId, chunks: chunks.length }, 'Sub-chunked sections');

    // 5. Clear any previous chunks for this file (in case of re-processing)
    await db.query('DELETE FROM guideline_chunks WHERE file_id = ?', [fileId]);

    // 6. Batch insert chunks
    for (let i = 0; i < chunks.length; i += BATCH_INSERT_SIZE) {
      const batch = chunks.slice(i, i + BATCH_INSERT_SIZE);
      const values = batch.map(c => [
        fileId,
        c.sectionId,
        c.sectionTitle,
        c.pageNumber,
        c.chunkIndex,
        c.content,
        productType,
      ]);

      await db.query(
        `INSERT INTO guideline_chunks
         (file_id, section_id, section_title, page_number, chunk_index, content, product_type)
         VALUES ?`,
        [values]
      );
    }

    // 7. Update file status to ready
    await db.query(
      `UPDATE guideline_files
       SET status = 'ready', total_pages = ?, total_sections = ?, error_message = NULL
       WHERE id = ?`,
      [pages.length, chunks.length, fileId]
    );

    logger.info({ fileId, totalPages: pages.length, totalChunks: chunks.length }, 'Guideline processing complete');
    return { totalPages: pages.length, totalChunks: chunks.length };
  } catch (err) {
    logger.error({ fileId, err }, 'Guideline processing failed');

    // Mark file as error
    await db.query(
      `UPDATE guideline_files SET status = 'error', error_message = ? WHERE id = ?`,
      [err.message?.substring(0, 1000) || 'Unknown error', fileId]
    ).catch(() => {});

    throw err;
  }
}

module.exports = { processGuideline };
