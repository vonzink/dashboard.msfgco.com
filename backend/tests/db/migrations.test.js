import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WEBINAR_STUDIO_SCHEMA,
  executeNumberedMigration,
  executeSqlFile,
  executeSqlStatements,
  runMigrations,
  splitSqlStatements,
  verifyWebinarStudioSchema,
} = require('../../db/migrations');

const quietLogger = Object.freeze({ info() {}, warn() {}, error() {} });

function migrationError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function healthySchemaResults() {
  const tableRows = WEBINAR_STUDIO_SCHEMA.tables.map(tableName => ({ table_name: tableName }));
  const columnRows = Object.entries(WEBINAR_STUDIO_SCHEMA.columns).flatMap(
    ([tableName, columnNames]) => columnNames.map(columnName => ({
      table_name: tableName,
      column_name: columnName,
      is_nullable: tableName === 'users' && columnName === 'is_active' ? 'NO' : 'YES',
      column_default: tableName === 'users' && columnName === 'is_active' ? '1' : null,
      column_type: tableName === 'users' && columnName === 'is_active'
        ? 'tinyint(1)'
        : tableName === 'webinar_slides' && columnName === 'active_anchor'
          ? 'varchar(190)'
          : 'text',
      extra: tableName === 'webinar_slides' && columnName === 'active_anchor'
        ? 'STORED GENERATED'
        : '',
      generation_expression: tableName === 'webinar_slides' && columnName === 'active_anchor'
        ? 'case when (`archived_at` is null) then `anchor` else NULL end'
        : '',
    })),
  );
  const indexRows = Object.entries(WEBINAR_STUDIO_SCHEMA.uniqueIndexes).flatMap(
    ([qualifiedName, columnNames]) => {
      const [tableName, indexName] = qualifiedName.split('.');
      return columnNames.map((columnName, index) => ({
        table_name: tableName,
        index_name: indexName,
        non_unique: 0,
        column_name: columnName,
        seq_in_index: index + 1,
      }));
    },
  );
  const foreignKeyRows = Object.entries(WEBINAR_STUDIO_SCHEMA.foreignKeys).map(
    ([qualifiedName, reference]) => {
      const [tableName, constraintName] = qualifiedName.split('.');
      return {
        table_name: tableName,
        constraint_name: constraintName,
        column_name: reference.column,
        referenced_table_name: reference.referencedTable,
        referenced_column_name: reference.referencedColumn,
      };
    },
  );
  return { tableRows, columnRows, indexRows, foreignKeyRows };
}

function schemaConnection(results = healthySchemaResults()) {
  return {
    query: vi.fn(async sql => {
      if (sql.includes('information_schema.TABLES')) return [results.tableRows];
      if (sql.includes('information_schema.COLUMNS')) return [results.columnRows];
      if (sql.includes('information_schema.STATISTICS')) return [results.indexRows];
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [results.foreignKeyRows];
      throw new Error(`Unexpected schema query: ${sql}`);
    }),
  };
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
      '092_webinar_studio_foundation.sql',
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
        return filePath.includes('091_') ? 'SELECT legacy_failure;' : 'SELECT studio_success;';
      },
    };

    await executeNumberedMigration(connection, '/migrations/091_plaud_recordings.sql', {
      fileSystem,
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger,
    });
    await executeNumberedMigration(connection, '/migrations/092_webinar_studio_foundation.sql', {
      fileSystem,
      intendedDatabase: 'webinar_studio_it_disposable',
      migrationLogger,
    });

    expect(connection.query.mock.calls).toEqual([
      ['SELECT legacy_failure'],
      ['SELECT studio_success'],
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
    '092_webinar_studio_foundation.sql',
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

describe('Webinar Studio schema verification', () => {
  it('rejects a partially applied schema with stable missing-object details', async () => {
    const results = healthySchemaResults();
    results.columnRows = results.columnRows.filter(row => !(
      row.table_name === 'users' && row.column_name === 'is_active'
    ));
    results.indexRows = results.indexRows.filter(row => row.index_name !== 'uq_webinar_slide_active_anchor');
    const connection = schemaConnection(results);

    await expect(verifyWebinarStudioSchema(connection, 'studio_test')).rejects.toMatchObject({
      code: 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE',
      issues: [
        'missing column users.is_active',
        'missing unique index webinar_slides.uq_webinar_slide_active_anchor',
      ],
    });
  });

  it('rejects the obsolete global slide-anchor uniqueness constraint', async () => {
    const results = healthySchemaResults();
    results.indexRows.push({
      table_name: 'webinar_slides', index_name: 'uq_webinar_slide_anchor', non_unique: 0,
      column_name: 'webinar_id', seq_in_index: 1,
    });
    const connection = schemaConnection(results);

    await expect(verifyWebinarStudioSchema(connection, 'studio_test')).rejects.toMatchObject({
      code: 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE',
      issues: ['forbidden unique index webinar_slides.uq_webinar_slide_anchor'],
    });
  });

  it.each([
    ['nullable', { is_nullable: 'YES' }],
    ['disabled by default', { column_default: '0' }],
    ['the wrong type', { column_type: 'int' }],
  ])('rejects users.is_active when it is %s', async (_description, replacement) => {
    const results = healthySchemaResults();
    const activeColumn = results.columnRows.find(row => (
      row.table_name === 'users' && row.column_name === 'is_active'
    ));
    Object.assign(activeColumn, replacement);

    await expect(verifyWebinarStudioSchema(schemaConnection(results), 'studio_test'))
      .rejects.toMatchObject({ code: 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE' });
  });

  it.each([
    ['not stored generated', { extra: '', generation_expression: '' }],
    ['generated from the wrong fields', {
      extra: 'STORED GENERATED',
      generation_expression: 'case when archived_at is not null then anchor else null end',
    }],
  ])('rejects active_anchor when it is %s', async (_description, replacement) => {
    const results = healthySchemaResults();
    const activeAnchor = results.columnRows.find(row => (
      row.table_name === 'webinar_slides' && row.column_name === 'active_anchor'
    ));
    Object.assign(activeAnchor, replacement);

    await expect(verifyWebinarStudioSchema(schemaConnection(results), 'studio_test'))
      .rejects.toMatchObject({ code: 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE' });
  });

  it('rejects named indexes and foreign keys whose actual definitions are wrong', async () => {
    const results = healthySchemaResults();
    const activeAnchorIndex = results.indexRows.find(row => (
      row.index_name === 'uq_webinar_slide_active_anchor' && row.seq_in_index === 2
    ));
    activeAnchorIndex.column_name = 'anchor';
    const ownerForeignKey = results.foreignKeyRows.find(row => row.constraint_name === 'fk_webinar_owner');
    ownerForeignKey.referenced_column_name = 'email';

    await expect(verifyWebinarStudioSchema(schemaConnection(results), 'studio_test'))
      .rejects.toMatchObject({
        code: 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE',
        issues: expect.arrayContaining([
          'invalid unique index webinar_slides.uq_webinar_slide_active_anchor',
          'invalid foreign key webinar_presentations.fk_webinar_owner',
        ]),
      });
  });

  it('accepts the complete healthy schema', async () => {
    const connection = schemaConnection();

    await expect(verifyWebinarStudioSchema(connection, 'studio_test')).resolves.toBeUndefined();
    expect(connection.query).toHaveBeenCalledTimes(4);
    for (const call of connection.query.mock.calls) {
      expect(call[1]).toEqual(['studio_test']);
    }
  });

  it('makes startup fail when post-migration schema verification fails', async () => {
    const verificationFailure = Object.assign(new Error('partial schema'), {
      code: 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE',
    });
    const release = vi.fn();
    const connection = {
      query: vi.fn(async sql => (
        sql === 'SELECT DATABASE() AS database_name' ? [[{ database_name: 'configured_schema' }]] : [[]]
      )),
      release,
    };
    const connectionPool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const fileSystem = {
      existsSync: vi.fn().mockReturnValue(false),
      readdirSync: vi.fn().mockReturnValue([]),
    };

    const schemaVerifier = vi.fn().mockRejectedValue(verificationFailure);
    await expect(runMigrations({
      connectionPool,
      fileSystem,
      migrationLogger: quietLogger,
      schemaVerifier,
    })).rejects.toBe(verificationFailure);
    expect(schemaVerifier).toHaveBeenCalledWith(connection, 'configured_schema');
    expect(release).toHaveBeenCalledOnce();
  });
});
