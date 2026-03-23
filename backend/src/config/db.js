const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:      parseInt(process.env.DB_POOL_MAX, 10)    || 10,
  idleTimeoutMillis:    parseInt(process.env.DB_POOL_IDLE, 10)    || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE, 10) || 60000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * Run a query using the pool.
 * @param {string} text - SQL query string
 * @param {Array}  params - Query parameters
 */
const query = (text, params) => pool.query(text, params);

/**
 * Get a dedicated client for transactions.
 * Always call client.release() in a finally block.
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
