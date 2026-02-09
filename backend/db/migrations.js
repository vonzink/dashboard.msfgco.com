// Database migrations - creates tables if they don't exist
const db = require('./connection');
const fs = require('fs');
const path = require('path');

/**
 * Execute a SQL file: split by ';' and run each statement.
 */
async function executeSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');

  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

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
          console.warn('⚠ Migration warning:', error.message);
        }
      }
    }
  }
}

async function runMigrations() {
  const connection = await db.getConnection();

  try {
    console.log('Running database migrations...');

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
      console.warn('⚠ DATABASE_SCHEMA.sql not found in any expected location');
      console.warn('⚠ Attempting to create tables directly...');
      await createTablesDirectly(connection);
    } else {
      console.log('✓ Found schema file at:', schemaPath);
      await executeSqlFile(connection, schemaPath);
      console.log('✓ Main schema applied');
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
        console.log(`  Running migration: ${file}`);
        await executeSqlFile(connection, filePath);
      }
      if (files.length > 0) {
        console.log(`✓ ${files.length} migration file(s) applied`);
      }
    }

    console.log('✓ Migrations completed');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// Fallback: Create tables directly if SQL file not found
async function createTablesDirectly(connection) {
  await connection.query('CREATE DATABASE IF NOT EXISTS msfg_mortgage_db');
  await connection.query('USE msfg_mortgage_db');
  console.log('✓ Database ensured');
}

module.exports = { runMigrations };

