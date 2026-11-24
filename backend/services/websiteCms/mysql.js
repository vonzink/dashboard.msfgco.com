const { createHash } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const { parseSiteSnapshot } = require('../../contracts/website/v1');
const { authorizeWebsiteAction } = require('./authz');
const { CmsError, fail } = require('./errors');
const { same, allEntities } = require('./contentEntities');

const allowed = new Set(['website.edit', 'website.publish', 'website.profile.self', 'website.roles.manage']);
const invalid = () => fail(409, 'website_editorial_state_conflict');
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const digest = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function userId(value) {
  if (!/^[1-9][0-9]{0,9}$/.test(String(value)) || Number(value) > 2147483647) fail(400, 'website_user_invalid');
  return String(value);
}
function appendOnly(before, after) {
  if (after.length < before.length || !before.every((item, index) => equal(item, after[index]))) invalid();
  return after.slice(before.length);
}
async function grantsFor(c) {
  // Lock only staff with an explicit grant. Their active flag stays stable until commit.
  const [rows] = await c.query('SELECT g.user_id, g.capability, u.is_active FROM website_cms_grants g JOIN users u ON u.id=g.user_id ORDER BY g.user_id, g.capability FOR SHARE');
  const grants = new Map();
  for (const row of rows) {
    if (!allowed.has(row.capability)) fail(503, 'website_grants_invalid');
    if (row.is_active !== 1) continue;
    const id = String(row.user_id);
    if (!grants.has(id)) grants.set(id, { userId: id, capabilities: [] });
    grants.get(id).capabilities.push(row.capability);
  }
  return [...grants.values()];
}
async function authority(c) {
  const [[row]] = await c.query('SELECT seed_sha256, roles_bootstrapped FROM website_cms_authority WHERE singleton=1');
  if (!row) fail(503, 'website_editorial_uninitialized');
  return row;
}
async function addRevision(c, revision) {
  const { kind, id } = revision.entity ?? {};
  if (!['page', 'site', 'officer'].includes(kind) || (kind !== 'site' && revision.content?.id !== id)) invalid();
  if (kind === 'page') await c.execute('INSERT INTO website_cms_revisions (revision_id,page_id,payload) VALUES (?,?,?)', [revision.revisionId, id, JSON.stringify(revision)]);
  else await c.execute('INSERT INTO website_cms_content_revisions (revision_id,entity_kind,entity_id,payload) VALUES (?,?,?,?)', [revision.revisionId, kind, id, JSON.stringify(revision)]);
}
async function addHead(c, row) {
  if (row.kind === 'page') await c.execute('INSERT INTO website_cms_latest (page_id,revision_id) VALUES (?,?)', [row.id, row.revisionId]);
  else await c.execute('INSERT INTO website_cms_content_latest (entity_kind,entity_id,revision_id) VALUES (?,?,?)', [row.kind, row.id, row.revisionId]);
}
async function audit(c, entry) {
  await c.execute('INSERT INTO website_cms_audit (payload) VALUES (?)', [JSON.stringify(entry)]);
}
async function loadState(c) {
  const grants = await grantsFor(c);
  const [revisions] = await c.query('SELECT payload FROM website_cms_revisions ORDER BY sequence_id');
  const [latest] = await c.query("SELECT 'page' AS kind, page_id AS id, revision_id AS revisionId FROM website_cms_latest ORDER BY page_id");
  const [contentRevisions] = await c.query('SELECT payload FROM website_cms_content_revisions ORDER BY sequence_id');
  const [contentLatest] = await c.query('SELECT entity_kind AS kind, entity_id AS id, revision_id AS revisionId FROM website_cms_content_latest ORDER BY entity_kind, entity_id');
  const [requests] = await c.query('SELECT intent, phase, result FROM website_cms_requests ORDER BY sequence_id');
  const [heroRevisions] = await c.query('SELECT payload FROM website_cms_hero_revisions ORDER BY sequence_id');
  const [heroLatest] = await c.query('SELECT hero_id AS id, revision_id AS revisionId FROM website_cms_hero_latest ORDER BY hero_id');
  const [history] = await c.query('SELECT payload FROM website_cms_audit ORDER BY sequence_id');
  return { version: 1, grants, heroRevisions: heroRevisions.map(r => json(r.payload)), heroLatest, revisions: [...revisions, ...contentRevisions].map(r => json(r.payload)), latest: [...latest, ...contentLatest], requests: requests.map(r => ({ ...json(r.intent), phase: r.phase, ...(r.result === null ? {} : { result: json(r.result) }) })), audit: history.map(r => json(r.payload)) };
}
async function writeDelta(c, before, state) {
  if (state.version !== 1 || !equal(before.grants, state.grants) || state.requests.length < before.requests.length) invalid();
  const revisions = appendOnly(before.revisions, state.revisions);
  for (const revision of revisions) await addRevision(c, revision);
  const heads = new Map(before.latest.map(row => [`${row.kind ?? 'page'}:${row.id}`, row]));
  if (new Set(state.latest.map(row => `${row.kind ?? 'page'}:${row.id}`)).size !== state.latest.length || before.latest.some(row => !state.latest.some(next => same(next, { kind: row.kind ?? 'page', id: row.id })))) invalid();
  for (const row of state.latest) {
    const entity = { kind: row.kind ?? 'page', id: row.id };
    const old = heads.get(`${entity.kind}:${entity.id}`);
    if (old && equal(old, row)) continue;
    if (old && !equal(old, { ...row, revisionId: old.revisionId })) invalid();
    if (!revisions.some(rev => same(rev.entity, entity) && rev.revisionId === row.revisionId)) invalid();
    if (!old) { await addHead(c, { ...row, kind: entity.kind }); continue; }
    const [updated] = entity.kind === 'page'
      ? await c.execute('UPDATE website_cms_latest SET revision_id=? WHERE page_id=? AND revision_id=?', [row.revisionId, row.id, old.revisionId])
      : await c.execute('UPDATE website_cms_content_latest SET revision_id=? WHERE entity_kind=? AND entity_id=? AND revision_id=?', [row.revisionId, entity.kind, row.id, old.revisionId]);
    if (updated.affectedRows !== 1) invalid();
  }
  for (const [i, record] of state.requests.entries()) {
    const prior = before.requests[i];
    if (equal(prior, record)) continue;
    const { phase, result, ...intent } = record;
    if (!prior) {
      if (phase !== 'pending' || result !== undefined) invalid();
      await c.execute('INSERT INTO website_cms_requests (request_id,phase,intent) VALUES (?,?,?)', [intent.requestId, phase, JSON.stringify(intent)]);
    } else {
      if (!equal(prior, { ...intent, phase: 'pending' })) invalid();
      if (phase === 'active') {
        if (!equal(result, { status: 'active', generation: prior.pointer.generation, publicationId: prior.pointer.publicationId })) invalid();
      } else if (phase !== 'conflict' || result !== undefined) invalid();
      const [updated] = await c.execute("UPDATE website_cms_requests SET phase=?, result=? WHERE request_id=? AND phase='pending'", [phase, result ? JSON.stringify(result) : null, intent.requestId]);
      if (updated.affectedRows !== 1) invalid();
    }
  }
  const heroRevisions = appendOnly(before.heroRevisions ?? [], state.heroRevisions ?? []);
  const previousHeroes = new Map((before.heroLatest ?? []).map(row => [row.id, row]));
  const nextHeroes = state.heroLatest ?? [];
  if (new Set(nextHeroes.map(row => row.id)).size !== nextHeroes.length || [...previousHeroes.keys()].some(id => !nextHeroes.some(row => row.id === id))) invalid();
  for (const revision of heroRevisions) {
    if (typeof revision.id !== 'string' || revision.content?.hero?.id !== revision.id) invalid();
    await c.execute('INSERT INTO website_cms_hero_revisions (revision_id,hero_id,payload) VALUES (?,?,?)', [revision.revisionId, revision.id, JSON.stringify(revision)]);
  }
  for (const row of nextHeroes) {
    const old = previousHeroes.get(row.id);
    if (old && equal(old, row)) continue;
    if (!heroRevisions.some(revision => revision.id === row.id && revision.revisionId === row.revisionId)) invalid();
    if (old) {
      const [updated] = await c.execute('UPDATE website_cms_hero_latest SET revision_id=? WHERE hero_id=? AND revision_id=?', [row.revisionId, row.id, old.revisionId]);
      if (updated.affectedRows !== 1) invalid();
    } else await c.execute('INSERT INTO website_cms_hero_latest (hero_id,revision_id) VALUES (?,?)', [row.id, row.revisionId]);
  }
  for (const entry of appendOnly(before.audit, state.audit)) await audit(c, entry);
}

function createMysqlCmsRepository({ pool, lockTimeoutSeconds = 5 } = {}) {
  if (typeof pool?.getConnection !== 'function' || !Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 0 || lockTimeoutSeconds > 30) throw Error('website_mysql_configuration_invalid');
  async function locked(operation) {
    const c = await pool.getConnection();
    let safe = false;
    let acquired = false;
    let inTransaction = false;
    let lock;
    async function cleanUp() {
      try {
        if (inTransaction) await c.rollback();
        if (acquired) {
          const [[{ released }]] = await c.query('SELECT RELEASE_LOCK(?) AS released', [lock]);
          if (released !== 1) throw Error('website_editorial_lock_lost');
        }
      } catch (error) {
        safe = false;
        throw error;
      } finally {
        if (safe) c.release(); else c.destroy();
      }
    }
    try {
      const [[{ db }]] = await c.query('SELECT DATABASE() AS db');
      if (!db) throw Error('website_mysql_database_required');
      lock = 'website_cms:' + digest(db.toLowerCase()).slice(0, 52);
      const [[{ obtained }]] = await c.query('SELECT GET_LOCK(?, ?) AS obtained', [lock, lockTimeoutSeconds]);
      if (obtained !== 1) { safe = obtained === 0; fail(503, 'website_storage_busy'); }
      acquired = true;
      async function verify() {
        const [[{ owned }]] = await c.query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned', [lock]);
        if (owned !== 1) throw Error('website_editorial_lock_lost');
      }
      async function begin() {
        await c.beginTransaction();
        inTransaction = true;
        await verify();
      }
      async function commit() {
        await verify();
        await c.commit();
        inTransaction = false;
      }
      await begin();
      const result = await operation(c, { begin, commit, verify });
      await commit();
      safe = true;
      return result;
    } catch (error) {
      if (acquired && error instanceof CmsError) safe = true;
      throw error;
    } finally {
      await cleanUp();
    }
  }
  return {
    async initialize({ snapshot }) {
      snapshot = parseSiteSnapshot(structuredClone(snapshot));
      const seed = digest(JSON.stringify(canonical(snapshot)));
      return locked(async c => {
        const [[existing]] = await c.query('SELECT seed_sha256 FROM website_cms_authority WHERE singleton=1');
        if (existing) {
          if (existing.seed_sha256 !== seed) fail(409, 'website_editorial_seed_conflict');
          return;
        }
        for (const table of ['latest', 'revisions', 'requests', 'audit', 'grants', 'hero_latest', 'hero_revisions', 'content_latest', 'content_revisions']) {
          const [rows] = await c.query('SELECT 1 FROM website_cms_' + table + ' LIMIT 1');
          if (rows.length) invalid();
        }
        await c.execute('INSERT INTO website_cms_authority (singleton,seed_sha256) VALUES (1,?)', [seed]);
        for (const { entity, revisionId, content } of allEntities(snapshot)) {
          await addRevision(c, { entity, revisionId, content, createdAt: snapshot.createdAt, createdBy: 'system-bootstrap' });
          await addHead(c, { ...entity, revisionId });
        }
        await audit(c, { action: 'initialize', actorId: 'system-bootstrap', publicationId: snapshot.publicationId, at: new Date().toISOString() });
      });
    },
    async bootstrapRoleManager({ userId: target }) {
      target = userId(target);
      return locked(async c => {
        const row = await authority(c);
        if (row.roles_bootstrapped) fail(409, 'website_roles_bootstrapped');
        const [existing] = await c.query('SELECT 1 FROM website_cms_grants LIMIT 1');
        if (existing.length) invalid();
        await activeTarget(c, target);
        await c.execute('INSERT INTO website_cms_grants (user_id,capability) VALUES (?,?)', [target, 'website.roles.manage']);
        await c.query('UPDATE website_cms_authority SET roles_bootstrapped=1 WHERE singleton=1');
        await grantAudit(c, 'system-bootstrap', target, [], ['website.roles.manage']);
      });
    },
    async setGrants({ actor, userId: target, capabilities }) {
      target = userId(target);
      if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length || !capabilities.every(cap => allowed.has(cap))) fail(400, 'website_grants_invalid');
      capabilities = [...capabilities].sort();
      return locked(async c => {
        await authority(c);
        const grants = await grantsFor(c);
        authorizeWebsiteAction(actor, 'website.roles.manage', grants);
        await activeTarget(c, target, capabilities.length > 0);
        const [stored] = await c.execute('SELECT capability FROM website_cms_grants WHERE user_id=? ORDER BY capability FOR SHARE', [target]);
        const prior = stored.map(row => row.capability);
        if (equal(prior, capabilities)) return;
        await c.execute('DELETE FROM website_cms_grants WHERE user_id=?', [target]);
        for (const capability of capabilities) await c.execute('INSERT INTO website_cms_grants (user_id,capability) VALUES (?,?)', [target, capability]);
        await grantAudit(c, String(actor.id), target, prior, capabilities);
      });
    },
    async transaction(operation) {
      return locked(async (c, session) => {
        await authority(c);
        const state = await loadState(c);
        let before = structuredClone(state);
        async function persist() {
          await session.verify();
          await writeDelta(c, before, state);
          await session.commit();
          await session.begin();
          if (!equal(state.grants, await grantsFor(c))) fail(403, 'website_authority_changed');
          before = structuredClone(state);
        }
        const result = await operation(state, persist);
        await session.verify();
        await writeDelta(c, before, state);
        return result;
      });
    },
  };
}
async function activeTarget(c, target, requireActive = true) {
  const [[user]] = await c.execute('SELECT is_active FROM users WHERE id=? FOR SHARE', [target]);
  if (!user || (requireActive && user.is_active !== 1)) fail(400, 'website_active_user_required');
}
async function grantAudit(c, actorId, userId, prior, capabilities) {
  await audit(c, { action: 'set-website-grants', actorId, userId, prior, capabilities, at: new Date().toISOString() });
}
module.exports = { createMysqlCmsRepository };
