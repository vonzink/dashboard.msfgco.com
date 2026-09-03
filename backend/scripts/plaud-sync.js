#!/usr/bin/env node
/**
 * scripts/plaud-sync.js
 *
 * Copy new Plaud recordings into S3. This is the cron entry point.
 *
 * Usage:
 *   node scripts/plaud-sync.js                 # normal run
 *   node scripts/plaud-sync.js --check         # verify login + bucket config, touch nothing
 *   node scripts/plaud-sync.js --dry-run       # show what would upload, write nothing
 *   node scripts/plaud-sync.js --limit 1       # upload at most N files this run
 *   node scripts/plaud-sync.js --pages 3       # scan more history (default 1 page of 50)
 *
 * Exit codes: 0 ok, 1 something failed (so cron's MAILTO / log shows it),
 * 2 not logged in to Plaud on this machine.
 *
 * Setup and the cron line are in docs/PLAUD_SYNC.md.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const logger = require('../lib/logger');
const s3 = require('../services/s3');
const { PlaudClient, PlaudAuthError, runPlaudSync } = require('../services/plaud');

// ── Args ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, check: false, pages: undefined, limit: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run': args.dryRun = true; break;
      case '--check': args.check = true; break;
      case '--pages': args.pages = Number(argv[++i]); break;
      case '--limit': args.limit = Number(argv[++i]); break;
      case '--help':
      case '-h':
        console.log('Usage: node scripts/plaud-sync.js [--check] [--dry-run] [--pages N] [--limit N]');
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }
  if (args.pages !== undefined && !(args.pages > 0)) throw new Error('--pages must be a positive number');
  if (args.limit !== undefined && !(args.limit > 0)) throw new Error('--limit must be a positive number');
  return args;
}

/** Human-readable size: KB below 1 MB so a short clip doesn't print as "0.0 MB". */
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Commands ─────────────────────────────────────────────────────

/** Prove the wiring without touching the database or S3. */
async function check() {
  const client = new PlaudClient({ logger });
  const user = await client.getCurrentUser();
  const recent = await client.listFiles({ page: 1, pageSize: 10 });

  console.log('\n✅ Plaud login OK');
  console.log(`   Account:   ${user.email || user.nickname || user.id}`);
  console.log(`   Token file: ${client.tokenFile}`);
  console.log(`   Recent recordings visible: ${recent.length}`);
  if (recent[0]) console.log(`   Newest: "${recent[0].name}" (${recent[0].startAt})`);
  console.log(`\n   S3 bucket: ${s3.BUCKETS.plaud}  (PLAUD_S3_BUCKET${process.env.PLAUD_S3_BUCKET ? '' : ' not set, using default'})`);
  console.log(`   AWS creds: ${process.env.AWS_ACCESS_KEY_ID ? 'access key in .env' : 'none in .env (instance role or ~/.aws expected)'}\n`);
}

async function sync(args) {
  const summary = await runPlaudSync({ dryRun: args.dryRun, pages: args.pages, limit: args.limit });

  const label = summary.dryRun ? 'DRY RUN' : 'SYNC';
  console.log(`\n${label}: seen ${summary.seen}, uploaded ${summary.uploaded}, skipped ${summary.skipped}, not ready ${summary.notReady}, failed ${summary.failed}`);
  for (const item of summary.items) {
    const size = item.bytes ? ` (${formatSize(item.bytes)})` : '';
    const detail = item.key ? ` → ${item.key}${size}` : item.error ? ` — ${item.error}` : '';
    console.log(`  [${item.action}] ${item.name || item.id}${detail}`);
  }
  console.log('');
  return summary.failed > 0 ? 1 : 0;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.check) {
    await check();
    return 0;
  }
  return sync(args);
}

main()
  .then(async (code) => {
    // The DB pool is only opened by a real sync; close it if it was touched.
    try { await require('../db/connection').close(); } catch { /* not opened */ }
    process.exit(code);
  })
  .catch(async (err) => {
    if (err instanceof PlaudAuthError) {
      console.error(`\n❌ ${err.message}\n`);
      process.exit(2);
    }
    console.error('\n❌ Plaud sync failed:', err.message || err);
    logger.error({ err }, 'Plaud sync crashed');
    try { await require('../db/connection').close(); } catch { /* not opened */ }
    process.exit(1);
  });
