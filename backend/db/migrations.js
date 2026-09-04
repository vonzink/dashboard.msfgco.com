// Database migrations - creates tables if they don't exist
const db = require('./connection');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

const WEBINAR_STUDIO_SCHEMA = Object.freeze({
  tables: Object.freeze([
    'users',
    'webinar_presentations',
    'webinar_slides',
    'webinar_revisions',
    'webinar_presenter_settings',
    'webinar_presenter_notes',
    'webinar_audit_events',
  ]),
  columns: Object.freeze({
    users: Object.freeze(['is_active']),
    webinar_presentations: Object.freeze([
      'id', 'slug', 'title', 'primary_owner_user_id', 'master_html', 'master_css',
      'live_version', 'audience_enabled', 'created_by_user_id', 'updated_by_user_id',
      'created_at', 'updated_at', 'archived_at',
    ]),
    webinar_slides: Object.freeze([
      'id', 'webinar_id', 'position', 'anchor', 'active_anchor', 'title', 'target_seconds',
      'speaker_notes', 'html', 'css', 'javascript', 'created_by_user_id',
      'updated_by_user_id', 'created_at', 'updated_at', 'archived_at',
    ]),
    webinar_revisions: Object.freeze([
      'id', 'webinar_id', 'version', 'snapshot', 'change_type', 'change_summary',
      'created_by_user_id', 'created_at',
    ]),
    webinar_presenter_settings: Object.freeze([
      'user_id', 'shortcuts', 'preferences', 'created_at', 'updated_at',
    ]),
    webinar_presenter_notes: Object.freeze([
      'id', 'user_id', 'webinar_id', 'slide_id', 'body', 'source_system',
      'source_record_id', 'created_at', 'updated_at',
    ]),
    webinar_audit_events: Object.freeze([
      'id', 'webinar_id', 'actor_user_id', 'event_type', 'target_type', 'target_id',
      'metadata', 'created_at',
    ]),
  }),
  uniqueIndexes: Object.freeze({
    'webinar_presentations.uq_webinar_slug': Object.freeze(['slug']),
    'webinar_slides.uq_webinar_slide_active_anchor': Object.freeze(['webinar_id', 'active_anchor']),
    'webinar_slides.uq_webinar_slide_position': Object.freeze(['webinar_id', 'position']),
    'webinar_revisions.uq_webinar_revision_version': Object.freeze(['webinar_id', 'version']),
    'webinar_presenter_settings.PRIMARY': Object.freeze(['user_id']),
    'webinar_presenter_notes.uq_webinar_note_legacy_source': Object.freeze([
      'source_system', 'source_record_id',
    ]),
  }),
  forbiddenUniqueIndexes: Object.freeze([
    'webinar_slides.uq_webinar_slide_anchor',
  ]),
  foreignKeys: Object.freeze({
    'webinar_presentations.fk_webinar_owner': Object.freeze({
      column: 'primary_owner_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_presentations.fk_webinar_created_by': Object.freeze({
      column: 'created_by_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_presentations.fk_webinar_updated_by': Object.freeze({
      column: 'updated_by_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_slides.fk_webinar_slide_webinar': Object.freeze({
      column: 'webinar_id', referencedTable: 'webinar_presentations', referencedColumn: 'id',
    }),
    'webinar_slides.fk_webinar_slide_created_by': Object.freeze({
      column: 'created_by_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_slides.fk_webinar_slide_updated_by': Object.freeze({
      column: 'updated_by_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_revisions.fk_webinar_revision_webinar': Object.freeze({
      column: 'webinar_id', referencedTable: 'webinar_presentations', referencedColumn: 'id',
    }),
    'webinar_revisions.fk_webinar_revision_user': Object.freeze({
      column: 'created_by_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_presenter_settings.fk_webinar_settings_user': Object.freeze({
      column: 'user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_presenter_notes.fk_webinar_note_user': Object.freeze({
      column: 'user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
    'webinar_presenter_notes.fk_webinar_note_webinar': Object.freeze({
      column: 'webinar_id', referencedTable: 'webinar_presentations', referencedColumn: 'id',
    }),
    'webinar_presenter_notes.fk_webinar_note_slide': Object.freeze({
      column: 'slide_id', referencedTable: 'webinar_slides', referencedColumn: 'id',
    }),
    'webinar_audit_events.fk_webinar_audit_webinar': Object.freeze({
      column: 'webinar_id', referencedTable: 'webinar_presentations', referencedColumn: 'id',
    }),
    'webinar_audit_events.fk_webinar_audit_actor': Object.freeze({
      column: 'actor_user_id', referencedTable: 'users', referencedColumn: 'id',
    }),
  }),
});

function migrationSqlParseError(context) {
  const error = new Error(`Migration SQL parse error: unterminated ${context}`);
  error.code = 'MIGRATION_SQL_PARSE_ERROR';
  error.context = context;
  return error;
}

function splitSqlStatements(sql) {
  const statements = [];
  let statement = '';
  let state = 'normal';

  function finishStatement() {
    const trimmed = statement.trim();
    if (trimmed) statements.push(trimmed);
    statement = '';
  }

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (state === 'line comment') {
      if (character === '\n' || character === '\r') {
        statement += character;
        state = 'normal';
      }
      continue;
    }

    if (state === 'block comment') {
      if (character === '*' && next === '/') {
        statement += ' ';
        state = 'normal';
        index += 1;
      }
      continue;
    }

    if (state !== 'normal') {
      statement += character;
      if (character === '\\') {
        if (next !== undefined) {
          statement += next;
          index += 1;
        }
        continue;
      }

      const delimiter = state === 'single-quoted string'
        ? "'"
        : state === 'double-quoted string'
          ? '"'
          : '`';
      if (character !== delimiter) continue;
      if (next === delimiter) {
        statement += next;
        index += 1;
      } else {
        state = 'normal';
      }
      continue;
    }

    if (character === ';') {
      finishStatement();
    } else if (character === "'") {
      statement += character;
      state = 'single-quoted string';
    } else if (character === '"') {
      statement += character;
      state = 'double-quoted string';
    } else if (character === '`') {
      statement += character;
      state = 'backtick identifier';
    } else if (character === '#') {
      statement += ' ';
      state = 'line comment';
    } else if (
      character === '-'
      && next === '-'
      && (sql[index + 2] === undefined || /\s/.test(sql[index + 2]))
    ) {
      statement += ' ';
      state = 'line comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      statement += ' ';
      state = 'block comment';
      index += 1;
    } else {
      statement += character;
    }
  }

  if (state !== 'normal' && state !== 'line comment') {
    throw migrationSqlParseError(state);
  }
  finishStatement();
  return statements;
}

const SQL_IDENTIFIER = '(?:`(?:``|[^`])+`|[A-Za-z_$][A-Za-z0-9_$]*)';
const SQL_TABLE_IDENTIFIER = `${SQL_IDENTIFIER}(?:\\s*\\.\\s*${SQL_IDENTIFIER})?`;
const ALTER_ADD_COLUMN = new RegExp(
  `^ALTER\\s+TABLE\\s+${SQL_TABLE_IDENTIFIER}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${SQL_IDENTIFIER}\\b`,
  'i',
);
const ALTER_ADD_INDEX = new RegExp(
  `^ALTER\\s+TABLE\\s+${SQL_TABLE_IDENTIFIER}\\s+ADD\\s+(?:UNIQUE\\s+)?(?:INDEX|KEY)\\s+${SQL_IDENTIFIER}\\s*\\(`,
  'i',
);
const CREATE_INDEX = new RegExp(
  `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${SQL_IDENTIFIER}\\s+ON\\s+${SQL_TABLE_IDENTIFIER}\\s*\\(`,
  'i',
);
const ALTER_DROP_FIELD_OR_KEY = new RegExp(
  `^ALTER\\s+TABLE\\s+${SQL_TABLE_IDENTIFIER}\\s+DROP\\s+(?:COLUMN|INDEX|KEY)\\s+(?:IF\\s+EXISTS\\s+)?${SQL_IDENTIFIER}\\b`,
  'i',
);
const MYSQL8_ADD_COLUMN_IF_NOT_EXISTS = new RegExp(
  `^(\\s*ALTER\\s+TABLE\\s+${SQL_TABLE_IDENTIFIER}\\s+ADD\\s+COLUMN)\\s+IF\\s+NOT\\s+EXISTS\\b`,
  'i',
);
const LEGACY_DATABASE_SELECTOR_SOURCES = new Set([
  '002_goals_funded_permissions.sql',
  'ADDITIONAL_TABLES.sql',
]);
const LEGACY_SCHEMA_CHECK_SOURCE = '002_goals_funded_permissions.sql';
const LEGACY_SCHEMA_CHECK = /TABLE_SCHEMA\s*=\s*'msfg_mortgage_db'/gi;

function hasTopLevelComma(statement) {
  let delimiter = null;
  let parenthesisDepth = 0;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    const next = statement[index + 1];
    if (delimiter) {
      if (character === '\\') {
        index += 1;
      } else if (character === delimiter) {
        if (next === delimiter) index += 1;
        else delimiter = null;
      }
    } else if (character === "'" || character === '"' || character === '`') {
      delimiter = character;
    } else if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')' && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    } else if (character === ',' && parenthesisDepth === 0) {
      return true;
    }
  }
  return false;
}

function isKnownIdempotencyError(error, statement) {
  if (!error || typeof error.code !== 'string') return false;
  const normalizedStatement = statement.trim().replace(/\s+/g, ' ');
  const isSingleOperation = !hasTopLevelComma(normalizedStatement);

  if (error.code === 'ER_DUP_FIELDNAME') {
    return isSingleOperation && ALTER_ADD_COLUMN.test(normalizedStatement);
  }
  if (error.code === 'ER_DUP_KEYNAME') {
    return isSingleOperation
      && (ALTER_ADD_INDEX.test(normalizedStatement) || CREATE_INDEX.test(normalizedStatement));
  }
  if (error.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
    return isSingleOperation && ALTER_DROP_FIELD_OR_KEY.test(normalizedStatement);
  }
  return false;
}

async function executeSqlStatements(
  connection,
  statements,
  { intendedDatabase, migrationLogger = logger, sourceName = 'SQL migration' } = {},
) {
  for (const statement of statements) {
    const normalizedStatement = statement.trim().replace(/\s+/g, ' ');
    if (intendedDatabase && /^USE\b/i.test(normalizedStatement)) {
      if (
        /^USE\s+`?msfg_mortgage_db`?$/i.test(normalizedStatement)
        && LEGACY_DATABASE_SELECTOR_SOURCES.has(sourceName)
      ) {
        migrationLogger.warn(
          { sourceName },
          'Ignoring legacy database selection and retaining configured database',
        );
        continue;
      }
      const error = new Error('Migration SQL attempted to change the configured database');
      error.code = 'MIGRATION_DATABASE_SWITCH_FORBIDDEN';
      throw error;
    }
    let executableStatement = statement;
    if (intendedDatabase && sourceName === LEGACY_SCHEMA_CHECK_SOURCE) {
      const configuredDatabaseStatement = executableStatement.replace(
        LEGACY_SCHEMA_CHECK,
        'TABLE_SCHEMA = DATABASE()',
      );
      if (configuredDatabaseStatement !== executableStatement) {
        migrationLogger.warn(
          { sourceName },
          'Binding historical schema check to configured database',
        );
        executableStatement = configuredDatabaseStatement;
      }
    }
    const mysql8CompatibleStatement = executableStatement.replace(
      MYSQL8_ADD_COLUMN_IF_NOT_EXISTS,
      '$1',
    );
    if (mysql8CompatibleStatement !== executableStatement) {
      migrationLogger.warn(
        { sourceName },
        'Adapting historical ADD COLUMN IF NOT EXISTS syntax for MySQL 8',
      );
      executableStatement = mysql8CompatibleStatement;
    }
    try {
      await connection.query(executableStatement);
    } catch (error) {
      if (!isKnownIdempotencyError(error, executableStatement)) throw error;
      migrationLogger.warn(
        { code: error.code, sourceName },
        'Ignoring exact idempotent migration rerun error',
      );
    }
  }
}

/**
 * Parse and execute every statement in a SQL file.
 */
async function executeSqlFile(
  connection,
  filePath,
  { fileSystem = fs, intendedDatabase, migrationLogger = logger } = {},
) {
  const sql = fileSystem.readFileSync(filePath, 'utf8');
  await executeSqlStatements(connection, splitSqlStatements(sql), {
    intendedDatabase,
    migrationLogger,
    sourceName: path.basename(filePath),
  });
}

const LEGACY_MIGRATION_MAX_ORDINAL = 91;

function isLegacyBestEffortMigration(fileName) {
  const match = /^(\d{3})_.+\.sql$/.exec(fileName);
  return Boolean(match) && Number(match[1]) <= LEGACY_MIGRATION_MAX_ORDINAL;
}

async function executeNumberedMigration(
  connection,
  filePath,
  { fileSystem = fs, intendedDatabase, migrationLogger = logger } = {},
) {
  const file = path.basename(filePath);
  try {
    await executeSqlFile(connection, filePath, {
      fileSystem,
      intendedDatabase,
      migrationLogger,
    });
  } catch (error) {
    if (!isLegacyBestEffortMigration(file)) throw error;
    migrationLogger.warn(
      { code: error?.code || 'UNKNOWN', file },
      'Legacy migration failed; continuing at the compatibility boundary',
    );
  }
}

function rowValue(row, lowerName, upperName) {
  return row?.[lowerName] ?? row?.[upperName];
}

function schemaVerificationError(issues) {
  const error = new Error(`Webinar Studio schema verification failed: ${issues.join(', ')}`);
  error.code = 'WEBINAR_STUDIO_SCHEMA_INCOMPLETE';
  error.issues = issues;
  return error;
}

async function currentDatabaseName(connection) {
  const [rows] = await connection.query('SELECT DATABASE() AS database_name');
  const databaseName = rowValue(rows?.[0], 'database_name', 'DATABASE_NAME');
  if (typeof databaseName !== 'string' || !databaseName) {
    const error = new Error('Unable to determine configured database before migrations');
    error.code = 'MIGRATION_DATABASE_UNAVAILABLE';
    throw error;
  }
  return databaseName;
}

async function verifyWebinarStudioSchema(connection, databaseName) {
  const intendedDatabase = databaseName || await currentDatabaseName(connection);
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?`,
    [intendedDatabase],
  );
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
            COLUMN_TYPE AS column_type, EXTRA AS extra,
            GENERATION_EXPRESSION AS generation_expression
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?`,
    [intendedDatabase],
  );
  const [indexRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name,
            SEQ_IN_INDEX AS seq_in_index
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?`,
    [intendedDatabase],
  );
  const [foreignKeyRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
            COLUMN_NAME AS column_name, REFERENCED_TABLE_NAME AS referenced_table_name,
            REFERENCED_COLUMN_NAME AS referenced_column_name
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [intendedDatabase],
  );

  const issues = [];
  const tables = new Set(tableRows.map(row => rowValue(row, 'table_name', 'TABLE_NAME')));
  for (const tableName of WEBINAR_STUDIO_SCHEMA.tables) {
    if (!tables.has(tableName)) issues.push(`missing table ${tableName}`);
  }

  const columns = new Map(columnRows.map(row => [
    `${rowValue(row, 'table_name', 'TABLE_NAME')}.${rowValue(row, 'column_name', 'COLUMN_NAME')}`,
    row,
  ]));
  for (const [tableName, columnNames] of Object.entries(WEBINAR_STUDIO_SCHEMA.columns)) {
    for (const columnName of columnNames) {
      if (!columns.has(`${tableName}.${columnName}`)) {
        issues.push(`missing column ${tableName}.${columnName}`);
      }
    }
  }

  const usersActive = columns.get('users.is_active');
  if (usersActive && (
    String(rowValue(usersActive, 'is_nullable', 'IS_NULLABLE')).toUpperCase() !== 'NO'
    || String(rowValue(usersActive, 'column_default', 'COLUMN_DEFAULT')) !== '1'
    || String(rowValue(usersActive, 'column_type', 'COLUMN_TYPE')).toLowerCase() !== 'tinyint(1)'
  )) {
    issues.push('invalid column users.is_active');
  }

  const activeAnchor = columns.get('webinar_slides.active_anchor');
  if (activeAnchor) {
    const extra = String(rowValue(activeAnchor, 'extra', 'EXTRA') || '').toUpperCase();
    const expression = String(
      rowValue(activeAnchor, 'generation_expression', 'GENERATION_EXPRESSION') || '',
    )
      .toLowerCase()
      .replace(/[`()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      String(rowValue(activeAnchor, 'column_type', 'COLUMN_TYPE')).toLowerCase() !== 'varchar(190)'
      || !extra.includes('STORED GENERATED')
      || !/\barchived_at\s+is\s+null\b/.test(expression)
      || !/\bthen\s+anchor\b/.test(expression)
      || !/\belse\s+null\b/.test(expression)
    ) {
      issues.push('invalid column webinar_slides.active_anchor');
    }
  }

  const indexes = new Map();
  for (const row of indexRows) {
    const key = `${rowValue(row, 'table_name', 'TABLE_NAME')}.${rowValue(row, 'index_name', 'INDEX_NAME')}`;
    if (!indexes.has(key)) indexes.set(key, []);
    indexes.get(key).push(row);
  }
  for (const [qualifiedName, expectedColumns] of Object.entries(WEBINAR_STUDIO_SCHEMA.uniqueIndexes)) {
    const rows = indexes.get(qualifiedName);
    if (!rows) {
      issues.push(`missing unique index ${qualifiedName}`);
      continue;
    }
    const orderedRows = [...rows].sort((left, right) => (
      Number(rowValue(left, 'seq_in_index', 'SEQ_IN_INDEX'))
      - Number(rowValue(right, 'seq_in_index', 'SEQ_IN_INDEX'))
    ));
    const actualColumns = orderedRows.map(row => rowValue(row, 'column_name', 'COLUMN_NAME'));
    const isUnique = orderedRows.every(row => Number(rowValue(row, 'non_unique', 'NON_UNIQUE')) === 0);
    if (!isUnique || JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
      issues.push(`invalid unique index ${qualifiedName}`);
    }
  }
  for (const qualifiedName of WEBINAR_STUDIO_SCHEMA.forbiddenUniqueIndexes) {
    if (indexes.has(qualifiedName)) issues.push(`forbidden unique index ${qualifiedName}`);
  }

  const foreignKeys = new Map();
  for (const row of foreignKeyRows) {
    const key = `${rowValue(row, 'table_name', 'TABLE_NAME')}.${rowValue(row, 'constraint_name', 'CONSTRAINT_NAME')}`;
    if (!foreignKeys.has(key)) foreignKeys.set(key, []);
    foreignKeys.get(key).push(row);
  }
  for (const [qualifiedName, expected] of Object.entries(WEBINAR_STUDIO_SCHEMA.foreignKeys)) {
    const rows = foreignKeys.get(qualifiedName);
    if (!rows) {
      issues.push(`missing foreign key ${qualifiedName}`);
      continue;
    }
    const valid = rows.length === 1
      && rowValue(rows[0], 'column_name', 'COLUMN_NAME') === expected.column
      && rowValue(rows[0], 'referenced_table_name', 'REFERENCED_TABLE_NAME') === expected.referencedTable
      && rowValue(rows[0], 'referenced_column_name', 'REFERENCED_COLUMN_NAME') === expected.referencedColumn;
    if (!valid) issues.push(`invalid foreign key ${qualifiedName}`);
  }

  if (issues.length) throw schemaVerificationError(issues.sort());
}

async function runMigrations({
  connectionPool = db,
  fileSystem = fs,
  pathModule = path,
  migrationLogger = logger,
  schemaVerifier = verifyWebinarStudioSchema,
} = {}) {
  const connection = await connectionPool.getConnection();

  try {
    migrationLogger.info('Running database migrations...');
    const intendedDatabase = await currentDatabaseName(connection);

    // ── 1. Run the main schema file ──────────────────────────────
    const possiblePaths = [
      pathModule.join(__dirname, '../../DATABASE_SCHEMA.sql'),
      pathModule.join(__dirname, '../DATABASE_SCHEMA.sql'),
      pathModule.join(__dirname, '../../msfg-dashboard/DATABASE_SCHEMA.sql'),
      './DATABASE_SCHEMA.sql',
    ];

    let schemaPath = null;
    for (const possiblePath of possiblePaths) {
      if (fileSystem.existsSync(possiblePath)) {
        schemaPath = possiblePath;
        break;
      }
    }

    if (!schemaPath) {
      migrationLogger.warn('DATABASE_SCHEMA.sql not found in any expected location');
      migrationLogger.warn('Attempting to create tables directly...');
      await createTablesDirectly(connection, migrationLogger);
    } else {
      migrationLogger.info({ schemaPath }, 'Found schema file');
      await executeSqlFile(connection, schemaPath, {
        fileSystem,
        intendedDatabase,
        migrationLogger,
      });
      migrationLogger.info('Main schema applied');
    }

    // ── 2. Run numbered migration files in order ───────────────
    const migrationsDir = pathModule.join(__dirname, 'migrations');
    if (fileSystem.existsSync(migrationsDir)) {
      const files = fileSystem
        .readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const filePath = pathModule.join(migrationsDir, file);
        migrationLogger.info({ file }, 'Running migration');
        await executeNumberedMigration(connection, filePath, {
          fileSystem,
          intendedDatabase,
          migrationLogger,
        });
      }
      if (files.length > 0) {
        migrationLogger.info({ count: files.length }, 'Migration files applied');
      }
    }

    await schemaVerifier(connection, intendedDatabase);
    migrationLogger.info('Migrations completed');
  } catch (error) {
    migrationLogger.error({ err: error }, 'Migration failed');
    throw error;
  } finally {
    connection.release();
  }
}

// Fallback: Create tables directly if SQL file not found
async function createTablesDirectly(connection, migrationLogger = logger) {
  await connection.query('CREATE DATABASE IF NOT EXISTS msfg_mortgage_db');
  await connection.query('USE msfg_mortgage_db');
  migrationLogger.info('Database ensured');
}

module.exports = {
  WEBINAR_STUDIO_SCHEMA,
  executeNumberedMigration,
  executeSqlFile,
  executeSqlStatements,
  isKnownIdempotencyError,
  runMigrations,
  splitSqlStatements,
  verifyWebinarStudioSchema,
};
