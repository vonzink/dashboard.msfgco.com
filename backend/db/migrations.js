// Database migrations - creates tables if they don't exist
const db = require('./connection');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const connection = await db.getConnection();
  
  try {
    console.log('Running database migrations...');
    
    // Read the SQL schema file
    // Try multiple possible locations
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
      return;
    }
    
    console.log('✓ Found schema file at:', schemaPath);
    
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    // Split SQL into individual statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await connection.query(statement);
        } catch (error) {
          // Ignore "table already exists" errors
          if (!error.message.includes('already exists')) {
            console.warn('⚠ Migration warning:', error.message);
          }
        }
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
  // This is a simplified version - full schema is in DATABASE_SCHEMA.sql
  // For now, just create database if needed
  await connection.query('CREATE DATABASE IF NOT EXISTS msfg_mortgage_db');
  await connection.query('USE msfg_mortgage_db');
  console.log('✓ Database ensured');
}

module.exports = { runMigrations };

