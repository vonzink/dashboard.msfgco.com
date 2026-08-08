import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

// The engine is a browser classic script that assigns to a global, so it is
// loaded in a VM with just enough of a window to evaluate. Only conflictName is
// exercised here: it is pure, and it produces filenames the user actually sees.

const here = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.join(here, '../../../js/file-sync.js');

function loadEngine() {
  const context = {
    setInterval: () => {},
    setTimeout,
    addEventListener: () => {},
    navigator: {},
    Date,
    FileSyncLocal: { isSupported: () => false },
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(enginePath, 'utf8'), context);
  return context.FileSync;
}

const { conflictName } = loadEngine();
const STAMP = /\(conflict \d{4}-\d{2}-\d{2} \d{4}\)/;

describe('conflictName', () => {
  it('inserts the marker before the extension', () => {
    const result = conflictName('offer.pdf');
    expect(result).toMatch(STAMP);
    expect(result.startsWith('offer (conflict ')).toBe(true);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('keeps the file in its own folder', () => {
    expect(conflictName('deals/2026/offer.pdf').startsWith('deals/2026/offer (conflict ')).toBe(true);
  });

  it('appends the marker when there is no extension', () => {
    const result = conflictName('README');
    expect(result.startsWith('README (conflict ')).toBe(true);
    expect(result.endsWith(')')).toBe(true);
  });

  it('produces a name the backend path validator accepts', () => {
    // No backslashes, control characters, or segments over 255 chars.
    const result = conflictName('deals/offer.pdf');
    expect(result).not.toMatch(/\\/);
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/[\x00-\x1f\x7f]/);
    result.split('/').forEach((segment) => expect(segment.length).toBeLessThanOrEqual(255));
  });
});
