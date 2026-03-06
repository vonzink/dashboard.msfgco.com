// Database migrations - creates tables if they don't exist
const db = require('./connection');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

/**
 * Execute a SQL file: split by ';' and run each statement.
 */
async function executeSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');

  const statements = sql
    .split(';')
    .map(s => s.replace(/^--.*$/gm, '').trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await connection.query(statement);
      } catch (error) {
        // Ignore "table already exists" / duplicate key errors
        if (
          !error.message.includes('already exists') &&
          !error.message.includes('Duplicate')
        ) {
          logger.warn({ msg: error.message }, 'Migration warning');
        }
      }
    }
  }
}

async function runMigrations() {
  const connection = await db.getConnection();

  try {
    logger.info('Running database migrations...');

    // ── 1. Run the main schema file ─────────────────────────────
    const possiblePaths = [
      path.join(__dirname, '../../DATABASE_SCHEMA.sql'),
      path.join(__dirname, '../DATABASE_SCHEMA.sql'),
      path.join(__dirname, '../../msfg-dashboard/DATABASE_SCHEMA.sql'),
      './DATABASE_SCHEMA.sql',
    ];

    let schemaPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        schemaPath = p;
        break;
      }
    }

    if (!schemaPath) {
      logger.warn('DATABASE_SCHEMA.sql not found in any expected location');
      logger.warn('Attempting to create tables directly...');
      await createTablesDirectly(connection);
    } else {
      logger.info({ schemaPath }, 'Found schema file');
      await executeSqlFile(connection, schemaPath);
      logger.info('Main schema applied');
    }

    // ── 2. Run numbered migration files in order ────────────────
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort(); // lexicographic sort — 001_, 002_, 003_ etc.

      for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        logger.info({ file }, 'Running migration');
        await executeSqlFile(connection, filePath);
      }
      if (files.length > 0) {
        logger.info({ count: files.length }, 'Migration files applied');
      }
    }

    logger.info('Migrations completed');
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    throw error;
  } finally {
    connection.release();
  }
}

// Fallback: Create tables directly if SQL file not found
async function createTablesDirectly(connection) {
  await connection.query('CREATE DATABASE IF NOT EXISTS msfg_mortgage_db');
  await connection.query('USE msfg_mortgage_db');
  logger.info('Database ensured');
}

module.exports = { runMigrations };

