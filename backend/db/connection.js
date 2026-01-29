// Database connection pool
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test connection
pool.ping = async function() {
  try {
    const connection = await this.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    throw new Error(`Database ping failed: ${error.message}`);
  }
};

// Close all connections
pool.close = async function() {
  await this.end();
};

module.exports = pool;

