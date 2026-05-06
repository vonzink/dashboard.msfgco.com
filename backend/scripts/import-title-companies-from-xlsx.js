#!/usr/bin/env node
// One-shot importer for title companies extracted from
// ~/Downloads/Title ND.xlsx + ~/Downloads/Colorado Title.xlsx (May 2026 batch).
//
// Source rows live in `title-companies-import-data.json` (sibling file).
// Idempotent: skips any row whose (company_name, contact_name, email)
// case-insensitive trim key already exists in title_companies.
//
// Usage:
//   cd backend
//   node scripts/import-title-companies-from-xlsx.js [--dry-run]

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../db/connection');

const ROWS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'title-companies-import-data.json'), 'utf8')
);

const dryRun = process.argv.includes('--dry-run');

function key(company, contact, email) {
  return [
    String(company || '').trim().toLowerCase(),
    String(contact || '').trim().toLowerCase(),
    String(email || '').trim().toLowerCase(),
  ].join('|');
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      'SELECT company_name, contact_name, email FROM title_companies'
    );
    const existingKeys = new Set(existing.map(r => key(r.company_name, r.contact_name, r.email)));

    const toInsert = [];
    const skipped = [];
    for (const row of ROWS) {
      const k = key(row.company_name, row.contact_name, row.email);
      if (existingKeys.has(k)) {
        skipped.push(row);
        continue;
      }
      existingKeys.add(k); // also dedupe within batch
      toInsert.push(row);
    }

    console.log('Title companies xlsx import');
    console.log(`  rows in data file: ${ROWS.length}`);
    console.log(`  existing rows:     ${existing.length}`);
    console.log(`  already in DB:     ${skipped.length}`);
    console.log(`  to insert:         ${toInsert.length}`);

    if (dryRun) {
      console.log('\n--dry-run set; no inserts performed.');
      if (toInsert.length) {
        console.log('Would insert:');
        for (const r of toInsert.slice(0, 10)) {
          console.log(`  - ${r.company_name} | ${r.contact_name || '∅'} | ${r.email || '∅'} (${r.state || '?'})`);
        }
        if (toInsert.length > 10) console.log(`  …and ${toInsert.length - 10} more`);
      }
      return;
    }

    if (toInsert.length === 0) {
      console.log('\nNothing to insert.');
      return;
    }

    const values = toInsert.map(r => [
      r.company_name,
      r.contact_name,
      r.email,
      r.work_phone,
      r.mobile_phone,
      r.street,
      r.city,
      r.state,
      r.zip_code,
      r.fax,
    ]);

    const [result] = await conn.query(
      `INSERT INTO title_companies (company_name, contact_name, email, work_phone, mobile_phone, street, city, state, zip_code, fax) VALUES ?`,
      [values]
    );
    console.log(`\nInserted: ${result.affectedRows}`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
