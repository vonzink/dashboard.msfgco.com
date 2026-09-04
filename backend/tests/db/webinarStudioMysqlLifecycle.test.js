import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runner = path.resolve(
  import.meta.dirname,
  '../integration/runWebinarStudioFoundationMysql.sh',
);

describe('Webinar Studio disposable MySQL container lifecycle', () => {
  it('removes its unique validated container when create succeeds but start fails', () => {
    const testDirectory = mkdtempSync(path.join(tmpdir(), 'webinar-mysql-lifecycle-'));
    try {
      const binDirectory = path.join(testDirectory, 'bin');
      const dockerLog = path.join(testDirectory, 'docker.log');
      mkdirSync(binDirectory);
      const fakeDocker = path.join(binDirectory, 'docker');
      writeFileSync(fakeDocker, `#!/bin/sh
printf '%s\\n' "$*" >> "$WEBINAR_FAKE_DOCKER_LOG"
case "$1" in
  container) exit 1 ;;
  create) printf '%s\\n' 'fake-container-id'; exit 0 ;;
  start) exit 42 ;;
  rm) exit 0 ;;
  *) exit 64 ;;
esac
`, { mode: 0o700 });

      const result = spawnSync('/bin/sh', [runner], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          TMPDIR: testDirectory,
          WEBINAR_FAKE_DOCKER_LOG: dockerLog,
        },
      });
      const dockerCalls = (() => {
        try {
          return readFileSync(dockerLog, 'utf8').trim().split('\n');
        } catch {
          return [];
        }
      })();
      const createCall = dockerCalls.find(call => call.startsWith('create '));
      const containerName = createCall?.match(/--name (webinar-studio-it-[a-f0-9]{24})(?: |$)/)?.[1];

      expect(result.status).toBe(42);
      expect(containerName).toMatch(/^webinar-studio-it-[a-f0-9]{24}$/);
      expect(dockerCalls).toContain(`start ${containerName}`);
      expect(dockerCalls).toContain(`rm --force ${containerName}`);
      expect(dockerCalls.indexOf(`start ${containerName}`))
        .toBeLessThan(dockerCalls.indexOf(`rm --force ${containerName}`));
      expect(readdirSync(testDirectory).filter(name => name.startsWith('webinar-studio-it.')))
        .toEqual([]);
    } finally {
      rmSync(testDirectory, { recursive: true, force: true });
    }
  });
});
