import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const root = resolve(process.cwd(), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
async function navigation(request) {
  const link = { hidden: true };
  const calls = [];
  const context = { document: { getElementById: () => link }, window: { ServerAPI: { request: async (...args) => { calls.push(args); return request(); } } } };
  await vm.runInNewContext(read('js/website-cms/navigation.js'), context);
  return { link, calls };
}
describe('website editor dashboard integration', () => {
  it('requires server-approved access before exposing navigation', async () => {
    const { link, calls } = await navigation(() => ({ entities: [], publication: {} }));
    expect(link.hidden).toBe(false);
    expect(calls[0][0]).toBe('/website-cms/entities');
    expect(calls[0][1].cache).toBe('no-store');
  });
  it.each([401,403,404,503])('keeps navigation hidden for %s', async status => {
    expect((await navigation(() => { throw Object.assign(Error('denied'), {status}); })).link.hidden).toBe(true);
  });
  it('does not expose navigation on an unexpected response', async () => {
    expect((await navigation(() => '<html>login</html>')).link.hidden).toBe(true);
  });
  it('loads the existing synchronous auth gate and API client before editor code', () => {
    const html = read('website-cms.html');
    const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map(match => match[1]);
    expect(scripts).toEqual(['/js/auth-gate.js','/js/config.js','/js/api-server.js','/js/website-cms/content-fields.js','/js/website-cms/editor.js']);
    expect(html).toMatch(/<script data-dashboard-auth src="\/js\/auth-gate.js"><\/script>/);
    expect(html).toContain('href="/"');
    const dashboard = read('index.html');
    expect(dashboard).toMatch(/id="website-cms-link"[^>]*hidden/);
    expect(dashboard.indexOf('js/website-cms/navigation.js')).toBeGreaterThan(dashboard.indexOf('js/api-server.js'));
  });
});
