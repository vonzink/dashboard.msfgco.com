// Database migrations - creates tables if they don't exist
const db = require('./connection');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

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
const MYSQL8_ADD_COLUMN_COMPATIBILITY = new Map([
  ['038_pipeline_lo_display.sql', Object.freeze({
    authored: 'ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
    executable: 'ALTER TABLE pipeline ADD COLUMN lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name',
  })],
  ['039_investor_in_house_servicing.sql', Object.freeze({
    authored: 'ALTER TABLE investors ADD COLUMN IF NOT EXISTS in_house_servicing VARCHAR(255) DEFAULT NULL AFTER epo',
    executable: 'ALTER TABLE investors ADD COLUMN in_house_servicing VARCHAR(255) DEFAULT NULL AFTER epo',
  })],
]);
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
    const mysql8Compatibility = MYSQL8_ADD_COLUMN_COMPATIBILITY.get(sourceName);
    const mysql8CompatibleStatement = mysql8Compatibility?.authored === executableStatement
      ? mysql8Compatibility.executable
      : executableStatement;
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

async function runMigrations({
  connectionPool = db,
  fileSystem = fs,
  pathModule = path,
  migrationLogger = logger,
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
  executeNumberedMigration,
  executeSqlFile,
  executeSqlStatements,
  isKnownIdempotencyError,
  runMigrations,
  splitSqlStatements,
};
