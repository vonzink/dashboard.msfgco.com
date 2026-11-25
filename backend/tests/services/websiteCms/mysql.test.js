import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMysqlCmsRepository } = require('../../../services/websiteCms/mysql');
describe('MySQL repository session boundaries', () => {
  it.each([undefined, {}, { pool: {} }, { pool: { getConnection() {} }, lockTimeoutSeconds: 120 }])('requires a pool and bounded wait', config => {
    expect(() => createMysqlCmsRepository(config)).toThrow();
  });
  it('discards an ambiguous session when lock acquisition throws', async () => {
    const conn = { query: vi.fn().mockResolvedValueOnce([[{ db: 'sandbox' }]]).mockRejectedValueOnce(Error('transport')), destroy: vi.fn(), release: vi.fn() };
    const operation = vi.fn();
    const repository = createMysqlCmsRepository({ pool: { getConnection: async () => conn } });
    await expect(repository.transaction(operation)).rejects.toThrow();
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
});

function simulatedSession({ loseLockOnSecondBegin = false } = {}) {
  const events = [];
  let transactionCount = 0;
  const connection = {
    async query(sql) {
      if (sql.includes('DATABASE()')) return [[{ db: 'test' }]];
      if (sql.includes('GET_LOCK(')) { events.push('acquire'); return [[{ obtained: 1 }]]; }
      if (sql.includes('RELEASE_LOCK')) { events.push('unlock'); return [[{ released: 1 }]]; }
      if (sql.includes('IS_USED_LOCK')) return [[{ owned: loseLockOnSecondBegin && transactionCount === 2 ? 0 : 1 }]];
      if (sql.includes('website_cms_authority')) return [[{ seed_sha256: 'test' }]];
      return [[]];
    },
    execute: async () => { events.push('write'); return [{ affectedRows: 1 }]; },
    beginTransaction: async () => { transactionCount++; events.push('begin'); },
    commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); },
    release: () => events.push('release'),
    destroy: () => events.push('destroy'),
  };
  const pool = { getConnection: async () => connection };
  return { events, repository: createMysqlCmsRepository({ pool }) };
}
it('checkpoints before activation and keeps one lock until the last rollback', async () => {
  const { events, repository } = simulatedSession();
  await expect(repository.transaction(async (state, persist) => {
    state.audit.push({ action: 'intent' });
    await persist();
    events.push('activation');
    throw Error('ambiguous activation');
  })).rejects.toThrow('ambiguous activation');
  expect(events).toEqual(['acquire','begin','write','commit','begin','activation','rollback','unlock','destroy']);
});
it('stops before external activation when the session loses its lock after the durable checkpoint', async () => {
  const { events, repository } = simulatedSession({ loseLockOnSecondBegin: true });
  const activate = vi.fn();
  await expect(repository.transaction(async (state, persist) => {
    state.audit.push({ action: 'intent' });
    await persist();
    await activate();
  })).rejects.toThrow('website_editorial_lock_lost');
  expect(activate).not.toHaveBeenCalled();
  expect(events).toEqual(['acquire','begin','write','commit','begin','rollback','unlock','destroy']);
});
it('finishes a read without issuing an editorial DML statement', async () => {
  const { events, repository } = simulatedSession();
  await repository.transaction(state => state.latest);
  expect(events).toEqual(['acquire','begin','commit','unlock','release']);
});
