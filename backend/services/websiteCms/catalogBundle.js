/**
 * Catalog bundle: the website-owned hero/content catalogs, exported as files so the
 * dashboard server can load them without importing the website repository.
 *
 * Layout:
 *   <dir>/catalog.json   { schemaVersion, hero: {entries, media}, content: {pages, officers, media} }
 *   <dir>/assets/<path>  bytes for every media file path declared in either catalog
 *
 * The bundle carries no grants and activates nothing. The CMS service re-verifies
 * every asset's size and sha256 against the media manifests when it initializes.
 */
const { mkdir, readFile, writeFile, realpath, lstat } = require('node:fs/promises');
const { join, dirname, isAbsolute, resolve, sep } = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_CATALOG_JSON_BYTES = 16 * 1024 * 1024;

function assetFile(root, assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.startsWith('/')) throw Error('website_catalog_asset_path_invalid');
  const pieces = assetPath.slice(1).split('/');
  // eslint-disable-next-line no-control-regex
  if (pieces.some(piece => !piece || piece === '.' || piece === '..' || /[\\%\x00-\x1f]/.test(piece))) throw Error('website_catalog_asset_path_invalid');
  return join(root, 'assets', ...pieces);
}

function declaredPaths(catalog) {
  return (catalog?.media ?? []).flatMap(set => (set.files ?? []).map(file => file.path));
}

async function writeCatalogBundle(directory, { heroCatalog, contentCatalog }) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw Error('website_catalog_directory_required');
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const root = await realpath(directory);
  const document = {
    schemaVersion: SCHEMA_VERSION,
    hero: { entries: heroCatalog.entries, media: heroCatalog.media },
    content: { pages: contentCatalog.pages, officers: contentCatalog.officers, media: contentCatalog.media },
  };
  let count = 0;
  for (const [catalog, name] of [[heroCatalog, 'hero'], [contentCatalog, 'content']]) {
    for (const path of new Set(declaredPaths(catalog))) {
      const bytes = catalog.assets?.[path];
      if (!bytes) throw Error(`website_catalog_asset_missing:${name}:${path}`);
      const file = assetFile(root, path);
      await mkdir(dirname(file), { recursive: true, mode: 0o755 });
      await writeFile(file, bytes, { mode: 0o644 });
      count += 1;
    }
  }
  await writeFile(join(root, 'catalog.json'), JSON.stringify(document), { mode: 0o644 });
  return { directory: root, assets: count, heroEntries: document.hero.entries.length, pages: document.content.pages.length };
}

async function readCatalogBundle(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw Error('website_catalog_directory_required');
  const root = await realpath(resolve(directory));
  const catalogPath = join(root, 'catalog.json');
  const info = await lstat(catalogPath);
  if (info.isSymbolicLink() || info.size > MAX_CATALOG_JSON_BYTES) throw Error('website_catalog_invalid');
  const document = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (document?.schemaVersion !== SCHEMA_VERSION || !document.hero || !document.content) throw Error('website_catalog_invalid');
  async function load(catalog) {
    const assets = {};
    for (const path of new Set(declaredPaths(catalog))) {
      const file = await realpath(assetFile(root, path));
      if (!file.startsWith(root + sep)) throw Error('website_catalog_asset_path_invalid');
      assets[path] = await readFile(file);
    }
    return assets;
  }
  return {
    heroCatalog: { ...document.hero, assets: await load(document.hero) },
    contentCatalog: { ...document.content, assets: await load(document.content) },
  };
}

module.exports = { readCatalogBundle, writeCatalogBundle };
