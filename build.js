#!/usr/bin/env node
/**
 * build.js — content-hash fingerprinting for the dashboard frontend.
 *
 * Why this exists
 * ───────────────
 * Before this script, every js/css change required hand-bumping a ?v=...
 * query string in every HTML page that referenced it. Misses caused stale
 * caches and silent breakage. The audit (§3.1) called this out as the
 * single highest-leverage fix.
 *
 * What it does
 * ────────────
 * For every js/**\/*.js and css/**\/*.css file in the source tree:
 *   1. Compute sha256(content), take the first 10 hex chars.
 *   2. Copy to dist/<original-path>.<hash>.<ext>.
 *
 * For every *.html file in the source tree (root + Calculators/**):
 *   3. Read it.
 *   4. Replace every <script src="js/X.js?v=..."> and <link href="css/X.css?v=...">
 *      with a reference to the hashed name (absolute path: /js/X.<hash>.js).
 *   5. Write the rewritten copy to dist/.
 *
 * Everything else the site needs (vendor/, assets/, Calculators/ subassets,
 * other static files) is passed through to dist/ unchanged.
 *
 * Result: dist/ is what deploy.sh syncs to S3. Each asset URL changes when
 * the content changes. Browsers cache forever; clients always see the
 * latest. The whole class of "I refreshed but it didn't update" bugs goes
 * away.
 *
 * Run with: `node build.js` (no npm dependencies needed).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Top-level directories we never copy into dist/ — none of these are served.
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.planning', '.worktrees', '.claude',
  '.superpowers', '.understand-anything', 'dist', 'backend',
  'docs', 'deploy', 'tools', '.cache', '.idea', '.vscode',
]);

// Files we pass through unmodified (alongside hashed js/css + rewritten html).
function isPassthrough(rel) {
  if (rel.startsWith('vendor/')) return true;
  if (rel.startsWith('assets/')) return true;
  if (rel.startsWith('Calculators/')) return true;
  // Anything else at the root that the site might serve directly (favicons,
  // robots.txt, manifest.json, etc.) is also passthrough as long as it's
  // not in an excluded dir.
  const parts = rel.split(path.sep);
  if (parts.length === 1) {
    if (rel.endsWith('.html')) return false; // HTML handled by rewriter
    if (rel === 'build.js') return false;    // build script itself
    if (rel === 'deploy.sh') return false;
    if (rel === 'package.json') return false;
    if (rel === '.gitignore') return false;
    if (rel === 'README.md') return false;
    if (rel === 'sync-scanner.sh') return false;
    return true;
  }
  return false;
}

// ES-module island + its Web Worker. These reference EACH OTHER by relative
// `import './scanner-util.js'` and `new Worker('js/scanner-worker.js')` — paths
// a hash-only fingerprinter can't rewrite (the rewriter only touches HTML), so
// hashing them 404s the whole scanner. Keep them un-hashed (passthrough) so
// their existing ?v= versioning + relative imports keep resolving exactly as
// before. TODO(path-B): bundle these with esbuild and drop this carve-out.
function isUnbundledModule(rel) {
  return /^js\/scanner-[^/]+\.js$/.test(rel);
}

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { continue; }
    if (stat.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function shortHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function copyToDist(srcAbs, destRel) {
  const dest = path.join(DIST, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcAbs, dest);
}

function writeToDist(destRel, content) {
  const dest = path.join(DIST, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

// 1. Wipe dist/ so deletes propagate (orphaned old files don't linger).
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 2. Scan the source tree.
const allFiles = walk(ROOT);
const manifest = {}; // logical path → hashed path  (e.g. "js/utils.js" → "js/utils.abc123.js")

// 3. Hash + copy js + css (only the top-level js/ and css/ trees — Calculators
// subtree has its own JS files but is currently unmanaged; leaving its
// versioning alone for this pass).
const versionable = allFiles.filter(f => {
  const rel = path.relative(ROOT, f);
  if (rel.includes('node_modules')) return false;
  if (!(rel.startsWith('js' + path.sep) || rel.startsWith('css' + path.sep))) return false;
  if (isUnbundledModule(rel.split(path.sep).join('/'))) return false; // scanner island stays un-hashed
  return f.endsWith('.js') || f.endsWith('.css');
});

for (const file of versionable) {
  const content = fs.readFileSync(file);
  const hash = shortHash(content);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const ext = path.extname(rel);
  const base = rel.slice(0, -ext.length);
  const hashedRel = `${base}.${hash}${ext}`;
  writeToDist(hashedRel, content);
  manifest[rel] = hashedRel;
}

// 4. Rewrite + copy HTML pages. The regex matches:
//    src="js/foo.js"   src="/js/foo.js"   src="js/foo.js?v=anything"
//    href="css/foo.css"   href="/css/foo.css"   href="css/foo.css?v=..."
// Only paths whose target is in the manifest are rewritten.
function rewriteHtml(content) {
  return content.replace(
    /(src|href)="(\/?(?:js|css)\/[^"?]+\.(?:js|css))(\?[^"]*)?"/g,
    (match, attr, urlPath /* unused: queryString */) => {
      const cleanPath = urlPath.replace(/^\//, '');
      const hashed = manifest[cleanPath];
      if (!hashed) return match;
      return `${attr}="/${hashed}"`;
    }
  );
}

const htmlFiles = allFiles.filter(f => f.endsWith('.html'));
for (const file of htmlFiles) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, 'utf8');
  writeToDist(rel, rewriteHtml(content));
}

// 5. Passthrough copy (vendor/, assets/, Calculators/ non-html files, root
// static files like favicons).
for (const file of allFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (file.endsWith('.html')) continue; // already handled
  if (manifest[rel]) continue;          // already hashed
  if (!isPassthrough(rel) && !isUnbundledModule(rel)) continue; // scanner island copies un-hashed
  // For Calculators subdirs, copy *.js and *.css as-is (their own version
  // strings still apply; this pass doesn't migrate them).
  copyToDist(file, rel);
}

// 6. Write the manifest for observability / future tooling.
writeToDist('manifest.json', JSON.stringify(manifest, null, 2));

// 7. Summary.
const sizes = versionable.reduce((sum, f) => sum + fs.statSync(f).size, 0);
console.log('build.js complete:');
console.log(`  hashed assets:   ${Object.keys(manifest).length} files, ${(sizes / 1024).toFixed(1)} KB total`);
console.log(`  html rewritten:  ${htmlFiles.length} files`);
console.log(`  output:          dist/`);
console.log(`  manifest:        dist/manifest.json`);
