import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  executeNumberedMigration,
  executeSqlFile,
  executeSqlStatements,
  splitSqlStatements,
} = require('../../db/migrations');

const quietLogger = Object.freeze({ info() {}, warn() {}, error() {} });

function migrationError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

describe('migration execution', () => {
  it.each([
    [
      'double-dash comments',
      '-- context before the statement; SELECT SHOULD_NOT_EXECUTE\nSELECT 1;\n-- trailing; DROP TABLE users\nSELECT 2;',
    ],
    [
      'hash comments',
      '# context before the statement; SELECT SHOULD_NOT_EXECUTE\nSELECT 1;\n# trailing; DROP TABLE users\nSELECT 2;',
    ],
    [
      'block comments',
      '/* context before the statement; SELECT SHOULD_NOT_EXECUTE */ SELECT 1;\n/* trailing; DROP TABLE users */ SELECT 2;',
    ],
  ])('keeps semicolons in %s from creating executable fragments', (_description, source) => {
    const statements = splitSqlStatements(source);

    expect(statements.map(statement => statement.replace(/\s+/g, ' '))).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
    expect(statements.join(' ')).not.toContain('SHOULD_NOT_EXECUTE');
    expect(statements.join(' ')).not.toContain('DROP TABLE');
  });

  it('keeps semicolons and comment markers inside quoted values and identifiers', () => {
    const source = [
      "INSERT INTO example (a, b, c) VALUES ('single; -- # /* value', 'it\\'s; escaped', 'doubled''; quote')",
      ';',
      'SELECT "double; -- # /* value", "doubled""; quote", `identifier; -- # /* value`, `doubled``; identifier`',
      ';',
      'SELECT 3;',
    ].join('');

    expect(splitSqlStatements(source)).toEqual([
      "INSERT INTO example (a, b, c) VALUES ('single; -- # /* value', 'it\\'s; escaped', 'doubled''; quote')",
      'SELECT "double; -- # /* value", "doubled""; quote", `identifier; -- # /* value`, `doubled``; identifier`',
      'SELECT 3',
    ]);
  });

  it('treats double-dash as a MySQL comment only when followed by whitespace', () => {
    expect(splitSqlStatements('SELECT 4--2; SELECT 5;')).toEqual([
      'SELECT 4--2',
      'SELECT 5',
    ]);
  });

  it.each([
    ['single-quoted string', "SELECT 'unterminated"],
    ['double-quoted string', 'SELECT "unterminated'],
    ['backtick identifier', 'SELECT `unterminated'],
    ['block comment', 'SELECT 1 /* unterminated'],
  ])('rejects an unterminated %s with a stable parse error', (context, source) => {
    let failure;
    try {
      splitSqlStatements(source);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 'MIGRATION_SQL_PARSE_ERROR',
      message: `Migration SQL parse error: unterminated ${context}`,
      context,
    });
  });

  it('executes nothing when parsing a migration file fails', async () => {
    const connection = { query: vi.fn() };

    await expect(executeSqlFile(connection, '/migrations/unsafe.sql', {
      fileSystem: { readFileSync: () => "SELECT 1; SELECT 'unterminated" },
      migrationLogger: quietLogger,
    })).rejects.toMatchObject({ code: 'MIGRATION_SQL_PARSE_ERROR' });
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('keeps the historical database-selection statement on the configured database', async () => {
    const connection = { query: vi.fn().mockResolvedValue([[]]) };

    await executeSqlStatements(connection, [
      'USE msfg_mortgage_db',
      'SELECT DATABASE()',
    ], {
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger: quietLogger,
      sourceName: '002_goals_funded_permissions.sql',
    });

    expect(connection.query.mock.calls).toEqual([['SELECT DATABASE()']]);
  });

  it('rejects any other migration-authored database switch', async () => {
    const connection = { query: vi.fn() };

    await expect(executeSqlStatements(connection, ['USE unrelated_database'], {
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger: quietLogger,
    })).rejects.toMatchObject({
      code: 'MIGRATION_DATABASE_SWITCH_FORBIDDEN',
      message: 'Migration SQL attempted to change the configured database',
    });
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('rejects the legacy database selector outside its exact historical sources', async () => {
    const connection = { query: vi.fn() };

    await expect(executeSqlStatements(connection, ['USE msfg_mortgage_db'], {
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger: quietLogger,
      sourceName: 'future_migration.sql',
    })).rejects.toMatchObject({ code: 'MIGRATION_DATABASE_SWITCH_FORBIDDEN' });
    expect(connection.query).not.toHaveBeenCalled();
  });

  it.each([
    [
      '038_pipeline_lo_display.sql',
      'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
      'ALTER TABLE pipeline ADD COLUMN lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    ],
    [
      '039_investor_in_house_servicing.sql',
      'ALTER TABLE investors ADD COLUMN IF NOT EXISTS in_house_servicing VARCHAR(255) DEFAULT NULL AFTER epo',
      'ALTER TABLE investors ADD COLUMN in_house_servicing VARCHAR(255) DEFAULT NULL AFTER epo',
    ],
  ])('adapts only the exact historical MySQL 8 statement in %s', async (
    sourceName,
    authoredStatement,
    expectedStatement,
  ) => {
    const connection = { query: vi.fn().mockResolvedValue([[]]) };

    await executeSqlStatements(connection, [authoredStatement], {
      migrationLogger: quietLogger,
      sourceName,
    });

    expect(connection.query).toHaveBeenCalledWith(expectedStatement);
  });

  it.each([
    [
      '095_future.sql',
      'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    ],
    [
      'unversioned_future.sql',
      'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    ],
    [
      '096_webinar_slide_edits.sql',
      'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    ],
    [
      'DATABASE_SCHEMA.sql',
      'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    ],
    [
      '038_pipeline_lo_display.sql',
      'ALTER TABLE investors ADD COLUMN IF NOT EXISTS in_house_servicing VARCHAR(255) DEFAULT NULL AFTER epo',
    ],
    [
      '039_investor_in_house_servicing.sql',
      'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    ],
  ])('leaves incompatible syntax unchanged and fails closed for %s', async (
    sourceName,
    authoredStatement,
  ) => {
    const failure = migrationError('ER_PARSE_ERROR');
    const connection = { query: vi.fn().mockRejectedValue(failure) };

    await expect(executeSqlStatements(connection, [authoredStatement], {
      migrationLogger: quietLogger,
      sourceName,
    })).rejects.toBe(failure);
    expect(connection.query).toHaveBeenCalledWith(authoredStatement);
  });

  it('binds migration 002 schema checks to the configured database', async () => {
    const connection = { query: vi.fn().mockResolvedValue([[]]) };

    await executeSqlStatements(connection, [
      "SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'msfg_mortgage_db' AND TABLE_NAME = 'users')",
    ], {
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger: quietLogger,
      sourceName: '002_goals_funded_permissions.sql',
    });

    expect(connection.query).toHaveBeenCalledWith(
      'SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'users\')',
    );
  });

  it('logs an unexpected legacy migration error and continues with the next migration', async () => {
    const failure = migrationError('ER_FK_CANNOT_DROP_PARENT');
    const warnings = [];
    const migrationLogger = {
      ...quietLogger,
      warn(details, message) { warnings.push({ details, message }); },
    };
    const connection = {
      query: vi.fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce([[]]),
    };
    const fileSystem = {
      readFileSync(filePath) {
        return filePath.includes('091_') ? 'SELECT legacy_failure;' : 'SELECT strict_success;';
      },
    };

    await executeNumberedMigration(connection, '/migrations/091_plaud_recordings.sql', {
      fileSystem,
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger,
    });
    await executeNumberedMigration(connection, '/migrations/096_webinar_slide_edits.sql', {
      fileSystem,
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger,
    });

    expect(connection.query.mock.calls).toEqual([
      ['SELECT legacy_failure'],
      ['SELECT strict_success'],
    ]);
    expect(warnings).toEqual([{
      details: {
        code: 'ER_FK_CANNOT_DROP_PARENT',
        file: '091_plaud_recordings.sql',
      },
      message: 'Legacy migration failed; continuing at the compatibility boundary',
    }]);
  });

  it.each([
    '096_webinar_slide_edits.sql',
    '095_future_migration.sql',
    'unversioned_migration.sql',
  ])('aborts on an unexpected error from strict migration %s', async file => {
    const failure = migrationError('ER_PARSE_ERROR');
    const connection = { query: vi.fn().mockRejectedValue(failure) };

    await expect(executeNumberedMigration(connection, `/migrations/${file}`, {
      fileSystem: { readFileSync: () => 'SELECT strict_failure;' },
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger: quietLogger,
    })).rejects.toBe(failure);
  });

  it('rethrows arbitrary failures even when their messages look idempotent', async () => {
    const deceptive = migrationError('ER_DUP_ENTRY', 'Duplicate entry already exists');
    const connection = { query: vi.fn().mockRejectedValue(deceptive) };

    await expect(executeSqlStatements(connection, [
      'ALTER TABLE users ADD COLUMN is_active TINYINT(1)',
    ], { migrationLogger: quietLogger })).rejects.toBe(deceptive);
  });

  it.each([
    ['ER_DUP_FIELDNAME', 'ALTER TABLE users ADD COLUMN is_active TINYINT(1)'],
    ['ER_DUP_KEYNAME', 'ALTER TABLE webinar_slides ADD UNIQUE KEY uq_example (webinar_id, anchor)'],
    ['ER_DUP_KEYNAME', 'CREATE INDEX idx_example ON webinar_slides (webinar_id)'],
    ['ER_DUP_KEYNAME', 'CREATE UNIQUE INDEX uq_example ON webinar_slides (webinar_id, anchor)'],
    ['ER_CANT_DROP_FIELD_OR_KEY', 'ALTER TABLE webinar_slides DROP INDEX uq_old_anchor'],
  ])('ignores exact known rerun code %s only for its matching DDL', async (code, statement) => {
    const connection = {
      query: vi.fn()
        .mockRejectedValueOnce(migrationError(code))
        .mockResolvedValueOnce([[]]),
    };

    await expect(executeSqlStatements(connection, [statement, 'SELECT 1'], {
      migrationLogger: quietLogger,
    })).resolves.toBeUndefined();
    expect(connection.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ER_DUP_FIELDNAME', 'SELECT 1'],
    ['ER_DUP_FIELDNAME', 'ALTER TABLE users MODIFY COLUMN email VARCHAR(255), ADD COLUMN is_active TINYINT(1)'],
    ['ER_DUP_FIELDNAME', 'ALTER TABLE users ADD COLUMN is_active TINYINT(1), DROP COLUMN email'],
    ['ER_DUP_KEYNAME', 'ALTER TABLE webinar_slides DROP INDEX uq_example'],
    ['ER_DUP_KEYNAME', 'ALTER TABLE webinar_slides ADD INDEX idx_example (webinar_id), DROP COLUMN title'],
    ['ER_DUP_KEYNAME', 'CREATE TABLE example (id INT, INDEX idx_example (id))'],
    ['ER_DUP_KEYNAME', 'SELECT "CREATE INDEX idx_example ON webinar_slides (webinar_id)"'],
    ['ER_CANT_DROP_FIELD_OR_KEY', 'ALTER TABLE webinar_slides ADD COLUMN missing_column INT'],
    ['ER_CANT_DROP_FIELD_OR_KEY', 'ALTER TABLE webinar_slides MODIFY COLUMN title TEXT, DROP INDEX uq_example'],
    ['ER_CANT_DROP_FIELD_OR_KEY', 'ALTER TABLE webinar_slides DROP INDEX uq_example, ADD COLUMN extra INT'],
    ['ER_TABLE_EXISTS_ERROR', 'CREATE TABLE users (id INT)'],
    ['ER_FK_DUP_NAME', 'ALTER TABLE webinar_slides ADD CONSTRAINT fk_example FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)'],
  ])('rejects code %s outside the exact safe rerun operation', async (code, statement) => {
    const failure = migrationError(code);
    const connection = { query: vi.fn().mockRejectedValue(failure) };

    await expect(executeSqlStatements(connection, [statement], {
      migrationLogger: quietLogger,
    })).rejects.toBe(failure);
  });

  it('supports a healthy first execution and exact-code rerun without hiding later statements', async () => {
    const statements = [
      'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE webinar_slides ADD UNIQUE KEY uq_example (webinar_id, anchor)',
      'ALTER TABLE webinar_slides DROP INDEX uq_old_anchor',
    ];
    const fresh = { query: vi.fn().mockResolvedValue([[]]) };
    const rerun = {
      query: vi.fn()
        .mockRejectedValueOnce(migrationError('ER_DUP_FIELDNAME'))
        .mockRejectedValueOnce(migrationError('ER_DUP_KEYNAME'))
        .mockRejectedValueOnce(migrationError('ER_CANT_DROP_FIELD_OR_KEY')),
    };

    await expect(executeSqlStatements(fresh, statements, {
      migrationLogger: quietLogger,
    })).resolves.toBeUndefined();
    await expect(executeSqlStatements(rerun, statements, {
      migrationLogger: quietLogger,
    })).resolves.toBeUndefined();
    expect(fresh.query).toHaveBeenCalledTimes(3);
    expect(rerun.query).toHaveBeenCalledTimes(3);
  });
});
