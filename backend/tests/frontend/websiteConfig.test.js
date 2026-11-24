import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve(process.cwd(), '..', 'js/config.js'), 'utf8');
function websiteOrigin(hostname) {
  const window = { location: { hostname } };
  vm.runInNewContext(source, { window });
  return window.CONFIG.website.origin;
}

describe('dashboard website origin', () => {
  it('uses the staging website from the staging dashboard', () => {
    expect(websiteOrigin('staging-dashboard.msfgco.com')).toBe('https://staging.msfg.us');
  });
  it('stays empty in production until the production release sets it', () => {
    expect(websiteOrigin('dashboard.msfgco.com')).toBe('');
  });
  it('stays empty for unknown hosts', () => {
    expect(websiteOrigin('localhost')).toBe('');
    expect(websiteOrigin('')).toBe('');
  });
  it('is frozen', () => {
    const window = { location: { hostname: 'staging-dashboard.msfgco.com' } };
    vm.runInNewContext(source, { window });
    expect(Object.isFrozen(window.CONFIG.website)).toBe(true);
  });
});
