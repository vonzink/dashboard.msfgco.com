'use strict';

/**
 * Seed script: populates handbook_documents and handbook_sections from extracted PDF text.
 *
 * Usage:  node db/seed-handbook.js
 *
 * Idempotent — uses INSERT ... ON DUPLICATE KEY UPDATE.
 * Text files in db/handbook-data/ must already exist (extracted from PDFs).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'handbook-data');

// ── Document & section definitions ──────────────────────────────────────────

const documents = [
  {
    slug: 'employee-handbook',
    title: 'MSFG Employee Handbook',
    file: 'main-handbook.txt',
    sections: [
      'Welcome',
      'About Our Company',
      'Mission, Vision, and Values',
      'Purpose of Employee Handbook',
      'Contact Page',
      'Employment At-Will',
      'Equal Employment Opportunity',
      'Disability Accommodation',
      'Religious Accommodation',
      'Sexual and Other Unlawful Harassment',
      'Employment Classification',
      'Employment Eligibility and Work Authorization',
      'Access to Personnel Files',
      'Personal Data Changes',
      'Voluntary Open-Door Policy',
      'Performance Reviews',
      'Standards of Conduct',
      'Reporting and Anti-Retaliation Policy',
      'Confidential Company Information',
      'Personal Appearance',
      'Attendance and Punctuality',
      'Personal Electronic Devices',
      'Contact With the Media',
      'Conflicts of Interest',
      'Outside Employment',
      'Social Media',
      'Time Off and Leaves of Absence',
      'Holidays',
      'npaid Unlimited Time Off (UTO) Policy',
      'Other Leaves of Absence',
      'Military Leave',
      'Eligibility for Leave',
      'Notice of Leave',
      'Reinstatement',
      'Jury and Witness Duty Leave',
      'Time Off to Vote',
      'Bereavement Leave',
      'Payment of Wages',
      'Time Keeping',
      'Meal and Rest Breaks',
      'Overtime',
      'Lactation Accommodation',
      'Workplace Violence',
      'Workplace Bullying',
      'Smoke-Free Workplace',
      'Emergency Evacuation',
      'Drug-Free Workplace',
      "Company's Right to Search",
      'Cameras and Video Surveillance',
      'Use of Company Equipment and Resources',
      'Electronic Resources',
      'Motor Vehicle Policy',
      'Inclement Weather/Office Closing',
      'No Solicitation / Distribution of Literature',
      "Workers' Compensation",
      'Work-Related Injuries or Illnesses',
      'Separation from Employment',
      'Return of Company Property',
      'References / Verifications of Employment',
      'Exit Interviews',
      'Acknowledgement and Receipt',
      '401K Matching Program'
    ]
  },
  {
    slug: 'co-supplement',
    title: 'Colorado Supplement',
    file: 'co-supplement.txt',
    sections: [
      'About This Colorado Supplement',
      'Equal Employment Opportunity',
      'Equal Pay for Equal Work Act',
      'Pregnancy Accommodation',
      'Access to Personnel Files',
      'Adoption Leave',
      'Paid Family Medical Leave',
      'Jury Duty Leave',
      'Crime Victim Leave',
      'Domestic Violence Victim Leave',
      'Time Off to Vote',
      'Military Leave',
      'Civil Air Patrol Leave',
      'Volunteer Firefighters Leave',
      'Qualified Volunteers Leave',
      'Paid Sick and Safe Leave and Public Health Emergency Leave',
      'Meal and Rest Breaks',
      'Overtime',
      'Lactation Accommodation',
      'Discussion of Wages',
      'Smoke-Free Workplace',
      'Cell Phone Use/Texting While Driving'
    ]
  },
  {
    slug: 'mn-supplement',
    title: 'Minnesota Supplement',
    file: 'mn-supplement.txt',
    sections: [
      'About This Minnesota Supplement',
      'Equal Employment Opportunity',
      'Pregnancy Accommodation',
      'Wage Disclosure Protection',
      'Access to Personnel Files',
      'Captive Audience Meeting Protections',
      'Lactation Accommodation',
      'Meal and Rest Breaks',
      'Pregnancy and Parenting Leave',
      'Adoption Leave',
      'Family Military Leave',
      'School Conferences and Activities Leave',
      'Bone Marrow Donor Leave',
      'Military Leave',
      'Civil Air Patrol Leave',
      'Quarantine Leave',
      'Jury Duty Leave',
      'Crime Victim or Witness Leave',
      'Time Off to Vote',
      'Political Leave',
      'Election Judge Leave',
      'Legislative Leave',
      'Time Off to Obtain a Restraining Order',
      'Paid Sick Leave',
      'Smoke-Free Workplace',
      'Cell Phone Use/Texting While Driving'
    ]
  },
  {
    slug: 'nd-supplement',
    title: 'North Dakota Supplement',
    file: 'nd-supplement.txt',
    sections: [
      'About This North Dakota Supplement',
      'Equal Employment Opportunity',
      'Pregnancy Accommodation',
      'Emergency Responder Leave',
      'Jury or Witness Duty Leave',
      'Lactation Accommodation',
      'Meal Breaks',
      'Smoke-Free Workplace',
      'Cell Phone Use/Texting While Driving'
    ]
  },
  {
    slug: 'tx-supplement',
    title: 'Texas Supplement',
    file: 'tx-supplement.txt',
    sections: [
      'About This Texas Supplement',
      'Equal Employment Opportunity',
      'Military Leave',
      'Time Off to Vote',
      'Political Leave',
      'Jury Duty Leave',
      'Time Off to Appear In Court or Attend Proceedings',
      'Participation in Emergency Evacuations',
      'Lactation Accommodation',
      'Smoke-Free Workplace',
      'Cell Phone Use/Texting While Driving'
    ]
  }
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const TITLE_OVERRIDES = {
  'npaid Unlimited Time Off (UTO) Policy': 'Unpaid Unlimited Time Off (UTO) Policy',
  '401K Matching Program': '401(k) Matching Program'
};

function slugify(str) {
  const display = TITLE_OVERRIDES[str] || str;
  return display
    .toLowerCase()
    .replace(/[''()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function cleanText(text) {
  text = text.replace(/\d+\s*\|\s*Page\s*\n\s*Property of Mountain State Financial Group\s*[–-]\s*\w+\s*\d+\s*\n?/g, '\n');
  text = text.replace(/^\d+\s*$/gm, '');
  text = text.replace(/(\w)-\s*\n\s*(\w)/g, '$1-$2');
  text = text.replace(/([a-z])\n([a-z])/g, '$1$2');
  text = text.replace(/Smoke\s+-\s*Free/g, 'Smoke-Free');
  text = text.replace(/Workpla\s*\n\s*ce/g, 'Workplace');
  return text;
}

function extractSections(text, headings) {
  const cleaned = cleanText(text);
  const sections = [];

  const positions = [];
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const pattern = new RegExp('^\\s*' + escaped.replace(/\s+/g, '\\s+') + '\\s*$', 'mi');
    const match = cleaned.match(pattern);
    if (match) {
      positions.push({ heading, index: match.index, matchLen: match[0].length });
    } else {
      console.warn(`  Warning: heading not found: "${heading}"`);
    }
  }

  positions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].matchLen;
    const end = i + 1 < positions.length ? positions[i + 1].index : cleaned.length;
    let content = cleaned.substring(start, end).trim();
    content = content.replace(/^\n+/, '').replace(/\n+$/, '');
    content = content.replace(/\n{3,}/g, '\n\n');

    const displayTitle = TITLE_OVERRIDES[positions[i].heading] || positions[i].heading;
    sections.push({
      title: displayTitle,
      slug: slugify(positions[i].heading),
      content
    });
  }

  return sections;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function seed() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2
  });

  const conn = await pool.getConnection();

  try {
    let totalSections = 0;

    for (let di = 0; di < documents.length; di++) {
      const doc = documents[di];
      const filePath = path.join(DATA_DIR, doc.file);

      if (!fs.existsSync(filePath)) {
        console.error(`Missing text file: ${filePath}`);
        continue;
      }

      console.log(`\nProcessing: ${doc.title}`);

      // Insert/update document
      await conn.query(
        `INSERT INTO handbook_documents (slug, title, sort_order)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), sort_order = VALUES(sort_order)`,
        [doc.slug, doc.title, di]
      );

      // Get document ID
      const [[docRow]] = await conn.query(
        'SELECT id FROM handbook_documents WHERE slug = ?',
        [doc.slug]
      );
      const docId = docRow.id;

      // Read text and extract sections
      const text = fs.readFileSync(filePath, 'utf-8');
      const sections = extractSections(text, doc.sections);

      console.log(`  Found ${sections.length} / ${doc.sections.length} sections`);

      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        await conn.query(
          `INSERT INTO handbook_sections (document_id, slug, title, content, sort_order)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), sort_order = VALUES(sort_order)`,
          [docId, sec.slug, sec.title, sec.content, si]
        );
      }

      totalSections += sections.length;
    }

    console.log(`\nDone: ${documents.length} documents, ${totalSections} sections total.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
