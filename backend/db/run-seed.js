#!/usr/bin/env node
// One-time seed runner for processing_links
// Usage: node backend/db/run-seed.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('./connection');

async function executeSeedFile(conn, filePath, label) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(';')
    .map(s => s.replace(/^--.*$/gm, '').trim())
    .filter(s => s.length > 0);

  let totalInserted = 0;
  for (const stmt of statements) {
    await conn.query(stmt);
    if (/VALUES/i.test(stmt)) {
      const count = (stmt.match(/\)\s*,/g) || []).length + 1;
      totalInserted += count;
    }
  }
  console.log(`[${label}] Inserted ${totalInserted} rows`);
}

async function runSeed() {
  const conn = await pool.getConnection();
  try {
    // Seed 1: VOE/AMC/Payoffs/Insurance links
    const [mainRows] = await conn.query(
      "SELECT COUNT(*) as cnt FROM processing_links WHERE section_type IN ('voe','amc','payoffs','insurance')"
    );
    if (mainRows[0].cnt > 0) {
      console.log(`Processing links already has ${mainRows[0].cnt} rows — skipping main seed.`);
    } else {
      const mainSeed = path.join(__dirname, 'seed-processing-links.sql');
      if (fs.existsSync(mainSeed)) {
        await executeSeedFile(conn, mainSeed, 'Processing Links');
      }
    }

    // Seed 2: Quick Links + Statewide Resources
    const [otherRows] = await conn.query(
      "SELECT COUNT(*) as cnt FROM processing_links WHERE section_type IN ('quick_links','statewide')"
    );
    if (otherRows[0].cnt > 0) {
      console.log(`Other tab already has ${otherRows[0].cnt} rows — skipping other seed.`);
    } else {
      const otherSeed = path.join(__dirname, 'seed-other-links.sql');
      if (fs.existsSync(otherSeed)) {
        await executeSeedFile(conn, otherSeed, 'Other Links');
      }
    }

    console.log('Seed complete!');
  } finally {
    conn.release();
    await pool.end();
  }
}

runSeed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
