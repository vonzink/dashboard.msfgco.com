import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const authPath = require.resolve('../../../middleware/auth');
const original = require.cache[authPath];
// Only the existing auth module boundary is replaced. No JWT, DB or external calls.
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authenticate(req, res, next) {
  if (req.headers.authorization !== 'Bearer isolated-mount-test') return res.status(401).json({error:'test_session_required'});
  req.user = {db:{id:1,is_active:1}}; next();
} } };
const { createApp } = require('../../../server');
if (original) require.cache[authPath] = original; else delete require.cache[authPath];
const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
const service = { listEntities: async () => ({entities:[]}), getEntity: async () => ({}), saveRevision: async () => ({}), publishSelection: async () => ({status:'active'}), getPublication: async () => ({}), rollbackPublication: async () => ({}) };
async function start(enabled) {
  // The factory lazily resolves the same existing authentication boundary.
  const prior = require.cache[authPath];
  require.cache[authPath] = { id:authPath, filename:authPath, loaded:true, exports:{authenticate(req,res,next) {
    if (req.headers.authorization !== 'Bearer isolated-mount-test') return res.status(401).json({error:'test_session_required'});
    req.user={db:{id:1,is_active:1}}; next();
  }} };
  let app;
  try { app=createApp(enabled ? {websiteCmsService:service} : {}); }
  finally { if (prior) require.cache[authPath]=prior; else delete require.cache[authPath]; }
  const server=app.listen(0,'127.0.0.1'); servers.push(server);
  await new Promise(resolve=>server.once('listening',resolve));
  return `http://127.0.0.1:${server.address().port}/api/website-cms`;
}
describe('CMS in actual dashboard createApp composition', () => {
  it('leaves CMS unavailable by default', async () => {
    expect((await fetch(`${await start(false)}/entities`)).status).toBe(404);
  });
  it('authenticates before parsing malformed CMS payloads', async () => {
    const response=await fetch(`${await start(true)}/publications`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{invalid-json'});
    expect(response.status).toBe(401);
  });
  it('retains the CMS256kb cap despite the general dashboard10mb parser', async () => {
    const response=await fetch(`${await start(true)}/publications`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer isolated-mount-test'},body:JSON.stringify({value:'x'.repeat(300000)})});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error:'website_request_invalid'});
  });
  it('serves an authenticated small request through the supplied service', async () => {
    const response=await fetch(`${await start(true)}/entities`,{headers:{Authorization:'Bearer isolated-mount-test'}});
    expect(response.status).toBe(200); expect(await response.json()).toEqual({entities:[]});
  });
});
