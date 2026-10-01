#!/usr/bin/env node
/**
 * scripts/importWebinarBundle.js
 *
 * Import a reviewed Webinar Studio source bundle. Two steps, bound by a hash:
 *
 *   node scripts/importWebinarBundle.js --dry-run \
 *     --bundle /abs/source-bundle.json --assets /abs/asset-manifest.json \
 *     --asset-root /abs/deck --owner-email owner@msfg.us --actor-email admin@msfg.us \
 *     --plan-out /abs/runtime/deck-import-plan.json
 *
 *   node scripts/importWebinarBundle.js --apply \
 *     --plan /abs/runtime/deck-import-plan.json --plan-sha256 <hash printed by the dry run>
 *
 * The dry run checks everything and writes only the plan file. The apply step
 * accepts only that exact plan, uploads each asset through the normal scan,
 * and creates the webinar with the audience switched off. Run it where the
 * backend runs, so it uses the same database, bucket and resource policy.
 *
 * Exit codes: 0 ok, 1 the import was refused or failed, 2 bad arguments.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const USAGE = [
  'Usage:',
  '  node scripts/importWebinarBundle.js --dry-run --bundle <abs> --assets <abs> --asset-root <abs> \\',
  '       --owner-email <email> --actor-email <email> --plan-out <abs>',
  '  node scripts/importWebinarBundle.js --apply --plan <abs> --plan-sha256 <sha256>',
].join('\n');

const VALUE_FLAGS = {
  '--bundle': 'bundlePath',
  '--assets': 'assetsPath',
  '--asset-root': 'assetRoot',
  '--owner-email': 'ownerEmail',
  '--actor-email': 'actorEmail',
  '--plan-out': 'planOut',
  '--plan': 'planPath',
  '--plan-sha256': 'expectedPlanSha256',
};
const REQUIRED = {
  'dry-run': ['bundlePath', 'assetsPath', 'assetRoot', 'ownerEmail', 'actorEmail', 'planOut'],
  apply: ['planPath', 'expectedPlanSha256'],
};
const PATH_OPTIONS = ['bundlePath', 'assetsPath', 'assetRoot', 'planOut', 'planPath'];
const SAFE_ERROR_FIELDS = ['key', 'slug', 'matches', 'status', 'rejectionCode', 'issues'];

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { mode: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run' || flag === '--apply') {
      if (args.mode) throw new UsageError('Choose one of --dry-run or --apply');
      args.mode = flag.slice(2);
    } else if (VALUE_FLAGS[flag]) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      args[VALUE_FLAGS[flag]] = value;
      index += 1;
    } else {
      throw new UsageError(`Unknown argument: ${flag}`);
    }
  }
  if (!args.mode) throw new UsageError('Choose --dry-run or --apply');
  const allowed = new Set(REQUIRED[args.mode]);
  for (const name of REQUIRED[args.mode]) {
    if (!args[name]) throw new UsageError(`--${args.mode} is missing a required option`);
  }
  for (const name of Object.values(VALUE_FLAGS)) {
    if (args[name] !== undefined && !allowed.has(name)) throw new UsageError(`An option does not belong to --${args.mode}`);
  }
  for (const name of PATH_OPTIONS) {
    if (args[name] !== undefined && !path.isAbsolute(args[name])) throw new UsageError('Paths must be absolute');
  }
  if (args.mode === 'apply' && !/^[a-f0-9]{64}$/.test(args.expectedPlanSha256)) {
    throw new UsageError('--plan-sha256 must be the 64-character hash printed by the dry run');
  }
  return args;
}

function describeFailure(error) {
  const failure = { error: typeof error?.code === 'string' ? error.code : 'IMPORT_FAILED', message: error?.message || 'Webinar import failed' };
  for (const field of SAFE_ERROR_FIELDS) if (error?.[field] !== undefined) failure[field] = error[field];
  return failure;
}

/* Runs one import step and returns the process exit code. The service and the
   output sink are injected so the command can be tested without a database. */
async function run(argv, { service, print, writePlan }) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    print({ error: 'USAGE', message: error.message, usage: USAGE });
    return 2;
  }
  try {
    if (args.mode === 'dry-run') {
      const { plan, planJson, planSha256 } = await service.planImport(args);
      await writePlan(args.planOut, planJson);
      print({
        mode: 'dry-run',
        planPath: args.planOut,
        planSha256,
        summary: plan.summary,
        assets: plan.assets.map(asset => ({ key: asset.key, action: asset.action, byteSize: asset.byteSize })),
      });
    } else {
      print({ mode: 'apply', ...(await service.applyImport(args)) });
    }
    return 0;
  } catch (error) {
    print(describeFailure(error));
    return 1;
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  const db = require('../db/connection');
  const { createImportService } = require('../services/webinars/importBundle');
  const code = await run(process.argv.slice(2), {
    service: createImportService(),
    print: value => console.log(JSON.stringify(value, null, 2)),
    writePlan: async (file, contents) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);
    },
  });
  await db.close();
  process.exit(code);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { parseArgs, run, UsageError };
