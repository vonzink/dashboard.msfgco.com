/**
 * Startup composition for the dashboard website CMS.
 *
 * Disabled unless WEBSITE_CMS_ENABLED=1. When enabled it builds:
 *   - a dedicated mysql2 pool on the dashboard database (DB_* settings), used by the
 *     durable MySQL editorial repository (migrations 097-099);
 *   - the publication store the public website reads (release manifests, assets, active
 *     pointer): WEBSITE_CMS_PUBLICATION_STORE=directory (WEBSITE_CMS_PUBLICATION_DIR) or
 *     s3 (WEBSITE_CMS_PUBLICATION_BUCKET, WEBSITE_CMS_PUBLICATION_REGION, default us-east-1);
 *   - the website-owned hero/content catalogs from the bundle at WEBSITE_CMS_CATALOG_DIR.
 *
 * Grants are never configured here. They are managed with scripts/website-cms-admin.js.
 * Authentication stays in routes/websiteCms/dashboard.js (existing dashboard auth).
 */
const { isAbsolute } = require('node:path');
const { createMysqlCmsRepository } = require('./mysql');
const { createLocalPublicationStore } = require('./local');
const { createS3PublicationStore } = require('./s3Store');
const { createWebsiteCmsService } = require('./service');
const { readCatalogBundle } = require('./catalogBundle');

// Methods the HTTP router calls. The deferred service exposes exactly these.
const ROUTER_METHODS = [
  'listHeroes', 'getHero', 'saveHeroRevision', 'assignHero', 'importPageContent',
  'listEntities', 'getEntity', 'saveRevision', 'publishSelection', 'getPublication', 'rollbackPublication',
];

function configError(name) {
  return Object.assign(Error(`website_cms_config_invalid: ${name}`), { code: 'website_cms_config_invalid' });
}

function readConfig(env) {
  const absolute = name => {
    const value = env[name];
    if (typeof value !== 'string' || !isAbsolute(value)) throw configError(`${name} must be an absolute path`);
    return value;
  };
  for (const name of ['DB_HOST', 'DB_USER', 'DB_NAME']) if (!env[name]) throw configError(`${name} is required`);
  const integer = (name, fallback, min, max) => {
    const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw configError(`${name} must be an integer ${min}-${max}`);
    return value;
  };
  const storeKind = env.WEBSITE_CMS_PUBLICATION_STORE || 'directory';
  if (!['directory', 's3'].includes(storeKind)) throw configError('WEBSITE_CMS_PUBLICATION_STORE must be directory or s3');
  let publication;
  if (storeKind === 's3') {
    if (!env.WEBSITE_CMS_PUBLICATION_BUCKET) throw configError('WEBSITE_CMS_PUBLICATION_BUCKET is required for s3');
    publication = { kind: 's3', bucket: env.WEBSITE_CMS_PUBLICATION_BUCKET, region: env.WEBSITE_CMS_PUBLICATION_REGION || 'us-east-1' };
  } else {
    publication = { kind: 'directory', directory: absolute('WEBSITE_CMS_PUBLICATION_DIR') };
  }
  return {
    publication,
    catalogDirectory: absolute('WEBSITE_CMS_CATALOG_DIR'),
    database: {
      host: env.DB_HOST,
      port: integer('DB_PORT', 3306, 1, 65535),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    },
    poolLimit: integer('WEBSITE_CMS_DB_POOL_LIMIT', 4, 1, 20),
    lockTimeoutSeconds: integer('WEBSITE_CMS_LOCK_TIMEOUT_SECONDS', 5, 0, 30),
  };
}

function websiteCmsEnabled(env = process.env) {
  return env.WEBSITE_CMS_ENABLED === '1';
}

async function createPublicationStore(publication, owner, createS3Client) {
  if (publication.kind === 'directory') {
    return (await createLocalPublicationStore({ publicationDirectory: publication.directory, owner })).publicationStore;
  }
  const store = createS3PublicationStore({ client: createS3Client({ region: publication.region }), bucket: publication.bucket });
  await store.claimOwner(owner);
  return store.publicationStore;
}

/** Build repository + publication store (no catalogs). Used by the server and the admin script. */
async function createWebsiteCmsAdapters({
  env = process.env,
  createPool = options => require('mysql2/promise').createPool(options),
  createS3Client = options => new (require('@aws-sdk/client-s3').S3Client)(options),
} = {}) {
  const config = readConfig(env);
  const pool = createPool({
    ...config.database,
    waitForConnections: true,
    connectionLimit: config.poolLimit,
    queueLimit: 0,
    connectTimeout: 10000,
  });
  const repository = createMysqlCmsRepository({ pool, lockTimeoutSeconds: config.lockTimeoutSeconds });
  const owner = `mysql:${config.database.host}:${config.database.port}/${config.database.database}`;
  try {
    const publicationStore = await createPublicationStore(config.publication, owner, createS3Client);
    return { config, pool, repository, publicationStore };
  } catch (error) {
    await pool.end?.().catch(() => {});
    throw error;
  }
}

/** Full service: adapters + catalogs, then add any missing catalog IDs (never overwrites saved heads). */
async function createWebsiteCmsServiceFromEnv(options = {}) {
  const adapters = await createWebsiteCmsAdapters(options);
  try {
    const { heroCatalog, contentCatalog } = await readCatalogBundle(adapters.config.catalogDirectory);
    const service = createWebsiteCmsService({ repository: adapters.repository, publicationStore: adapters.publicationStore, heroCatalog, contentCatalog });
    try {
      await service.initializeHeroLibrary();
      await service.initializeContentCatalog();
    } catch (error) {
      if (error.code === 'website_editorial_uninitialized') {
        throw Object.assign(Error('website_editorial_uninitialized: run scripts/website-cms-admin.js initialize'), { code: error.code });
      }
      throw error;
    }
    return { service, pool: adapters.pool };
  } catch (error) {
    await adapters.pool.end().catch(() => {});
    throw error;
  }
}

/**
 * For server.js: returns null when disabled. Otherwise returns a service the router can
 * mount immediately; its calls wait for start(). If start() fails, calls reject with 503.
 */
function createDeferredWebsiteCmsService({ env = process.env, build = createWebsiteCmsServiceFromEnv } = {}) {
  if (!websiteCmsEnabled(env)) return null;
  let ready = null;
  let pool = null;
  const unavailable = () => Object.assign(Error('website_dependency_unavailable'), { status: 503, code: 'website_dependency_unavailable' });
  const resolveService = async () => {
    if (!ready) throw unavailable();
    try { return await ready; } catch { throw unavailable(); }
  };
  const service = Object.fromEntries(ROUTER_METHODS.map(name => [name, async (...args) => (await resolveService())[name](...args)]));
  return {
    service,
    start() {
      if (!ready) {
        ready = build({ env }).then(result => { pool = result.pool; return result.service; });
        ready.catch(() => {}); // Surfaced by the awaiting caller and as 503s; never unhandled.
      }
      return ready;
    },
    async close() { if (pool) await pool.end(); },
  };
}

module.exports = {
  createDeferredWebsiteCmsService,
  createWebsiteCmsAdapters,
  createWebsiteCmsServiceFromEnv,
  websiteCmsEnabled,
  ROUTER_METHODS,
};
