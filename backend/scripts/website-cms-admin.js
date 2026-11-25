#!/usr/bin/env node
/**
 * scripts/website-cms-admin.js
 *
 * Operator commands for the dashboard website CMS. Never exposed over HTTP.
 * Uses the same settings as the server: DB_* plus WEBSITE_CMS_PUBLICATION_DIR and
 * WEBSITE_CMS_CATALOG_DIR (see services/websiteCms/compose.js).
 *
 * Usage:
 *   node scripts/website-cms-admin.js export-catalog <websiteRepo> <outDir>
 *       Export the website-owned hero/content catalogs into a bundle directory.
 *   node scripts/website-cms-admin.js initialize
 *       Seed editorial history from the active publication (once; identical rerun is a no-op).
 *   node scripts/website-cms-admin.js bootstrap-manager <email>
 *       One-time: grant website.roles.manage to an active dashboard user.
 *   node scripts/website-cms-admin.js grant <managerEmail> <userEmail> <capabilities|none>
 *       Replace a user's website capabilities (comma list), audited as the manager.
 *       Capabilities: website.edit, website.publish, website.profile.self, website.roles.manage
 *   node scripts/website-cms-admin.js show-grants
 *
 * Exit codes: 0 ok, 1 failed, 2 usage error.
 */
const { createRequire } = require('node:module');
const { isAbsolute, join } = require('node:path');
const { createWebsiteCmsAdapters } = require('../services/websiteCms/compose');
const { writeCatalogBundle } = require('../services/websiteCms/catalogBundle');

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: website-cms-admin.js export-catalog <websiteRepo> <outDir> | initialize | bootstrap-manager <email> | grant <managerEmail> <userEmail> <caps|none> | show-grants');
  process.exit(2);
}

async function userByEmail(pool, email) {
  const [[user]] = await pool.query('SELECT id, is_active FROM users WHERE email = ?', [email]);
  if (!user) throw Error(`No dashboard user with email ${email}`);
  return user;
}

async function exportCatalog(websiteRepo, outDir) {
  if (!websiteRepo || !outDir || !isAbsolute(websiteRepo) || !isAbsolute(outDir)) usage('export-catalog needs absolute <websiteRepo> and <outDir>');
  const websiteRequire = createRequire(join(websiteRepo, 'package.json'));
  const { createHeroLibraryCatalog } = websiteRequire('./scripts/lib/hero-library-catalog.cjs');
  const { createContentCatalog } = websiteRequire('./scripts/lib/content-catalog.cjs');
  const result = await writeCatalogBundle(outDir, { heroCatalog: await createHeroLibraryCatalog(), contentCatalog: await createContentCatalog() });
  console.log(`Catalog bundle written: ${result.directory} (${result.heroEntries} heroes, ${result.pages} pages, ${result.assets} assets)`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'export-catalog') return exportCatalog(...args);
  if (!['initialize', 'bootstrap-manager', 'grant', 'show-grants'].includes(command)) usage();

  const { pool, repository, publicationStore } = await createWebsiteCmsAdapters();
  try {
    if (command === 'initialize') {
      const { snapshot } = await publicationStore.readCurrent();
      await repository.initialize({ snapshot });
      console.log(`Editorial history initialized from publication ${snapshot.publicationId}`);
    } else if (command === 'bootstrap-manager') {
      if (!args[0]) usage('bootstrap-manager needs <email>');
      const user = await userByEmail(pool, args[0]);
      await repository.bootstrapRoleManager({ userId: user.id });
      console.log(`Granted website.roles.manage to user ${user.id}`);
    } else if (command === 'grant') {
      const [managerEmail, userEmail, list] = args;
      if (!managerEmail || !userEmail || !list) usage('grant needs <managerEmail> <userEmail> <capabilities|none>');
      const manager = await userByEmail(pool, managerEmail);
      const target = await userByEmail(pool, userEmail);
      const capabilities = list === 'none' ? [] : list.split(',').map(value => value.trim()).filter(Boolean);
      await repository.setGrants({ actor: { id: manager.id, is_active: manager.is_active }, userId: target.id, capabilities });
      console.log(`User ${target.id} website capabilities: ${capabilities.length ? capabilities.sort().join(', ') : '(none)'}`);
    } else if (command === 'show-grants') {
      const [rows] = await pool.query('SELECT g.user_id, u.email, u.is_active, GROUP_CONCAT(g.capability ORDER BY g.capability) AS capabilities FROM website_cms_grants g JOIN users u ON u.id = g.user_id GROUP BY g.user_id, u.email, u.is_active ORDER BY g.user_id');
      for (const row of rows) console.log(`${row.user_id}\t${row.email}\tactive=${row.is_active}\t${row.capabilities}`);
      if (!rows.length) console.log('(no website grants)');
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.code && error.code !== error.message ? `${error.code}: ${error.message}` : error.message);
  process.exit(1);
});
