import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createDeferredWebsiteCmsService, createWebsiteCmsAdapters, websiteCmsEnabled, ROUTER_METHODS } = require('../../../services/websiteCms/compose');
const { readCatalogBundle, writeCatalogBundle } = require('../../../services/websiteCms/catalogBundle');

const temporary = [];
async function tempDir() { const dir = await mkdtemp(join(tmpdir(), 'cms-compose-')); temporary.push(dir); return dir; }
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const baseEnv = dirs => ({
  WEBSITE_CMS_ENABLED: '1', DB_HOST: '127.0.0.1', DB_USER: 'u', DB_NAME: 'd', DB_PASSWORD: 'p',
  WEBSITE_CMS_PUBLICATION_DIR: dirs.publication, WEBSITE_CMS_CATALOG_DIR: dirs.catalog,
});

describe('website CMS composition', () => {
  it('is disabled unless WEBSITE_CMS_ENABLED is exactly 1', () => {
    expect(websiteCmsEnabled({})).toBe(false);
    expect(websiteCmsEnabled({ WEBSITE_CMS_ENABLED: 'true' })).toBe(false);
    expect(websiteCmsEnabled({ WEBSITE_CMS_ENABLED: '1' })).toBe(true);
    expect(createDeferredWebsiteCmsService({ env: {} })).toBeNull();
  });

  it.each([
    ['WEBSITE_CMS_PUBLICATION_DIR', 'relative/path'],
    ['WEBSITE_CMS_CATALOG_DIR', undefined],
    ['DB_HOST', ''],
    ['WEBSITE_CMS_LOCK_TIMEOUT_SECONDS', '31'],
    ['WEBSITE_CMS_DB_POOL_LIMIT', '0'],
  ])('rejects invalid %s before creating a pool', async (name, value) => {
    const dirs = { publication: await tempDir(), catalog: await tempDir() };
    let pools = 0;
    const env = { ...baseEnv(dirs), [name]: value };
    await expect(createWebsiteCmsAdapters({ env, createPool: () => { pools += 1; return {}; } })).rejects.toMatchObject({ code: 'website_cms_config_invalid' });
    expect(pools).toBe(0);
  });

  it('builds a dedicated pool and binds the publication directory to the database owner', async () => {
    const dirs = { publication: await tempDir(), catalog: await tempDir() };
    let options;
    const adapters = await createWebsiteCmsAdapters({ env: { ...baseEnv(dirs), DB_PORT: '33307' }, createPool: value => { options = value; return { getConnection() {} }; } });
    expect(options).toMatchObject({ host: '127.0.0.1', port: 33307, user: 'u', password: 'p', database: 'd', connectionLimit: 4 });
    expect(typeof adapters.repository.transaction).toBe('function');
    expect(typeof adapters.publicationStore.readCurrent).toBe('function');
    expect(await readFile(join(dirs.publication, '.website-cms-owner'), 'utf8')).toBe('mysql:127.0.0.1:33307/d');
    // A second editorial authority on the same publication directory fails closed.
    await expect(createWebsiteCmsAdapters({ env: { ...baseEnv(dirs), DB_NAME: 'other' }, createPool: () => ({ getConnection() {} }) })).rejects.toMatchObject({ status: 409 });
  });

  it('selects the S3 store, claims the bucket owner, and needs a bucket name', async () => {
    const dirs = { publication: await tempDir(), catalog: await tempDir() };
    const s3Env = { ...baseEnv(dirs), WEBSITE_CMS_PUBLICATION_DIR: undefined, WEBSITE_CMS_PUBLICATION_STORE: 's3', WEBSITE_CMS_PUBLICATION_BUCKET: 'msfg-website-publications-staging' };
    await expect(createWebsiteCmsAdapters({ env: { ...s3Env, WEBSITE_CMS_PUBLICATION_BUCKET: '' }, createPool: () => ({ getConnection() {} }) })).rejects.toMatchObject({ code: 'website_cms_config_invalid' });
    await expect(createWebsiteCmsAdapters({ env: { ...s3Env, WEBSITE_CMS_PUBLICATION_STORE: 'ftp' }, createPool: () => ({ getConnection() {} }) })).rejects.toMatchObject({ code: 'website_cms_config_invalid' });
    const sent = [];
    let clientOptions;
    const adapters = await createWebsiteCmsAdapters({
      env: s3Env,
      createPool: () => ({ getConnection() {} }),
      createS3Client: options => { clientOptions = options; return { send: async command => { sent.push(command.input); return {}; } }; },
    });
    expect(clientOptions).toEqual({ region: 'us-east-1' });
    expect(sent[0]).toMatchObject({ Bucket: 'msfg-website-publications-staging', Key: '.website-cms-owner', IfNoneMatch: '*' });
    expect(Buffer.from(sent[0].Body).toString()).toBe('mysql:127.0.0.1:3306/d');
    expect(typeof adapters.publicationStore.activate).toBe('function');
  });

  it('deferred service answers 503 until started, then delegates', async () => {
    let built = 0;
    const real = Object.fromEntries(ROUTER_METHODS.map(name => [name, async args => ({ name, args })]));
    const deferred = createDeferredWebsiteCmsService({ env: { WEBSITE_CMS_ENABLED: '1' }, build: async () => { built += 1; return { service: real, pool: { end: async () => {} } }; } });
    expect(Object.keys(deferred.service).sort()).toEqual([...ROUTER_METHODS].sort());
    await expect(deferred.service.listEntities({})).rejects.toMatchObject({ status: 503 });
    await deferred.start();
    await deferred.start();
    expect(built).toBe(1);
    await expect(deferred.service.listEntities({ kind: 'page' })).resolves.toEqual({ name: 'listEntities', args: { kind: 'page' } });
  });

  it('deferred service answers 503 when startup failed', async () => {
    const deferred = createDeferredWebsiteCmsService({ env: { WEBSITE_CMS_ENABLED: '1' }, build: async () => { throw Error('boom'); } });
    await expect(deferred.start()).rejects.toThrow('boom');
    await expect(deferred.service.saveRevision({})).rejects.toMatchObject({ status: 503, code: 'website_dependency_unavailable' });
  });
});

describe('catalog bundle', () => {
  const catalogs = () => ({
    heroCatalog: { entries: [{ id: 'hero-a', content: {} }], media: [{ name: 'a', files: [{ path: '/heroes/a/poster.jpg' }] }], assets: { '/heroes/a/poster.jpg': Buffer.from('poster') } },
    contentCatalog: { pages: [{ id: 'p' }], officers: [], media: [{ name: 'b', files: [{ path: '/images/b.png' }] }], assets: { '/images/b.png': Buffer.from('png') } },
  });

  it('round-trips catalogs and asset bytes', async () => {
    const dir = await tempDir();
    const summary = await writeCatalogBundle(dir, catalogs());
    expect(summary).toMatchObject({ assets: 2, heroEntries: 1, pages: 1 });
    const loaded = await readCatalogBundle(dir);
    expect(loaded.heroCatalog.entries).toEqual([{ id: 'hero-a', content: {} }]);
    expect(loaded.heroCatalog.assets['/heroes/a/poster.jpg'].toString()).toBe('poster');
    expect(loaded.contentCatalog.assets['/images/b.png'].toString()).toBe('png');
  });

  it('rejects traversal paths and missing assets', async () => {
    const bad = catalogs();
    bad.heroCatalog.media[0].files[0].path = '/heroes/../../etc/passwd';
    bad.heroCatalog.assets = { '/heroes/../../etc/passwd': Buffer.from('x') };
    await expect(writeCatalogBundle(await tempDir(), bad)).rejects.toThrow('website_catalog_asset_path_invalid');
    const missing = catalogs();
    missing.contentCatalog.assets = {};
    await expect(writeCatalogBundle(await tempDir(), missing)).rejects.toThrow('website_catalog_asset_missing');
  });

  it('rejects an unknown schema version', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'catalog.json'), JSON.stringify({ schemaVersion: 2, hero: {}, content: {} }));
    await expect(readCatalogBundle(dir)).rejects.toThrow('website_catalog_invalid');
  });
});
