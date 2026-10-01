import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { parseArgs, run } = require('../../scripts/importWebinarBundle');

const DRY_RUN = [
  '--dry-run',
  '--bundle', '/deck/migration/source-bundle.json',
  '--assets', '/deck/migration/asset-manifest.json',
  '--asset-root', '/deck/deck',
  '--owner-email', 'seth.angell@msfg.us',
  '--actor-email', 'zachary.zink@msfg.us',
  '--plan-out', '/deck/migration/runtime/deck-import-plan.json',
];
const HASH = 'a'.repeat(64);
const APPLY = ['--apply', '--plan', '/deck/migration/runtime/deck-import-plan.json', '--plan-sha256', HASH];

function harness(service = {}) {
  const printed = [];
  const writePlan = vi.fn(async () => {});
  return { printed, writePlan, dependencies: { service, print: value => printed.push(value), writePlan } };
}

describe('importWebinarBundle command', () => {
  it('reads a dry run', () => {
    expect(parseArgs(DRY_RUN)).toEqual({
      mode: 'dry-run',
      bundlePath: '/deck/migration/source-bundle.json',
      assetsPath: '/deck/migration/asset-manifest.json',
      assetRoot: '/deck/deck',
      ownerEmail: 'seth.angell@msfg.us',
      actorEmail: 'zachary.zink@msfg.us',
      planOut: '/deck/migration/runtime/deck-import-plan.json',
    });
  });

  it('reads an apply', () => {
    expect(parseArgs(APPLY)).toEqual({ mode: 'apply', planPath: '/deck/migration/runtime/deck-import-plan.json', expectedPlanSha256: HASH });
  });

  it.each([
    ['no mode', DRY_RUN.slice(1)],
    ['both modes', ['--apply', ...DRY_RUN]],
    ['a missing option', DRY_RUN.slice(0, -2)],
    ['a relative path', DRY_RUN.map(value => (value === '/deck/deck' ? 'deck' : value))],
    ['an unknown flag', [...DRY_RUN, '--force']],
    ['a flag with no value', ['--apply', '--plan']],
    ['an apply without the approved hash', APPLY.slice(0, 3)],
    ['an apply with a malformed hash', [...APPLY.slice(0, 4), 'abc']],
    ['an apply that also names a bundle', [...APPLY, '--bundle', '/deck/migration/source-bundle.json']],
  ])('refuses %s', (_name, argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it('writes the plan and prints its hash on a dry run, and nothing else', async () => {
    const planImport = vi.fn(async () => ({
      plan: { summary: { slug: 'first-home', slides: 15 }, assets: [{ key: 'brand-logo-svg', action: 'upload', byteSize: 1210, sha256: 'b'.repeat(64) }] },
      planJson: '{"plan":true}\n',
      planSha256: HASH,
    }));
    const applyImport = vi.fn();
    const { printed, writePlan, dependencies } = harness({ planImport, applyImport });

    await expect(run(DRY_RUN, dependencies)).resolves.toBe(0);

    expect(writePlan).toHaveBeenCalledWith('/deck/migration/runtime/deck-import-plan.json', '{"plan":true}\n');
    expect(applyImport).not.toHaveBeenCalled();
    expect(printed).toEqual([{
      mode: 'dry-run',
      planPath: '/deck/migration/runtime/deck-import-plan.json',
      planSha256: HASH,
      summary: { slug: 'first-home', slides: 15 },
      assets: [{ key: 'brand-logo-svg', action: 'upload', byteSize: 1210 }],
    }]);
  });

  it('applies only the plan and hash it was given', async () => {
    const applyImport = vi.fn(async () => ({ slug: 'first-home', webinarId: 20, liveVersion: 1, audienceEnabled: false, slides: 15, assets: [] }));
    const { printed, writePlan, dependencies } = harness({ planImport: vi.fn(), applyImport });

    await expect(run(APPLY, dependencies)).resolves.toBe(0);

    expect(applyImport).toHaveBeenCalledWith(expect.objectContaining({ planPath: '/deck/migration/runtime/deck-import-plan.json', expectedPlanSha256: HASH }));
    expect(writePlan).not.toHaveBeenCalled();
    expect(printed[0]).toMatchObject({ mode: 'apply', webinarId: 20, audienceEnabled: false });
  });

  it('reports a refusal with its code and exits 1 without leaking internals', async () => {
    const refusal = Object.assign(new Error('The plan is not the one that was approved'), { code: 'IMPORT_PLAN_DRIFT', s3Key: 'quarantine/secret', stackHint: 'x' });
    const { printed, dependencies } = harness({ applyImport: vi.fn().mockRejectedValue(refusal) });

    await expect(run(APPLY, dependencies)).resolves.toBe(1);
    expect(printed).toEqual([{ error: 'IMPORT_PLAN_DRIFT', message: 'The plan is not the one that was approved' }]);
  });

  it('passes through the details that say which asset or check failed', async () => {
    const refusal = Object.assign(new Error('Asset was rejected'), { code: 'IMPORT_ASSET_REJECTED', key: 'brand-logo-svg', rejectionCode: 'MALWARE_DETECTED' });
    const { printed, dependencies } = harness({ applyImport: vi.fn().mockRejectedValue(refusal) });

    await run(APPLY, dependencies);
    expect(printed[0]).toEqual({ error: 'IMPORT_ASSET_REJECTED', message: 'Asset was rejected', key: 'brand-logo-svg', rejectionCode: 'MALWARE_DETECTED' });
  });

  it('exits 2 with usage for bad arguments and calls nothing', async () => {
    const planImport = vi.fn();
    const { printed, dependencies } = harness({ planImport, applyImport: vi.fn() });

    await expect(run(['--dry-run'], dependencies)).resolves.toBe(2);
    expect(planImport).not.toHaveBeenCalled();
    expect(printed[0]).toMatchObject({ error: 'USAGE' });
  });
});
