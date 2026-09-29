import { afterEach, describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('../../server');
let server;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } });
async function start(user, service) {
  const app = createApp({
    inboxAuthenticate(req, _res, next) { req.user = user; next(); },
    inboxService: service || { list: async () => ({ items: [{ subject: 'Rates' }], total: 1 }), get: async () => ({ text: 'Rates' }) },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}/api/info-inbox`;
}
describe('private inbox access', () => {
  it.each([
    [null, 401], [{ db: { id: 1, role: 'external', is_active: 1 } }, 403],
    [{ db: { id: 1, role: 'admin', is_active: 0 } }, 403],
    [{ db: { id: 1, role: 'user', is_active: 1 } }, 200],
  ])('enforces employee access for %j', async (user, status) => {
    const url = await start(user);
    for (const path of ['', '/message?key=info_emails/a']) {
      const response = await fetch(url + path);
      expect(response.status).toBe(status);
      if (status === 200) expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('does not return upstream errors containing message data', async () => {
    const url = await start({ db: { id: 1, role: 'user', is_active: 1 } }, { list: async () => { throw new Error('private mail'); } });
    const response = await fetch(url);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private mail');
  });
});
