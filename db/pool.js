/**
 * Centralized Database Pool
 *
 * Single shared PostgreSQL connection pool for the entire application.
 * All modules should import from this file instead of creating their own pools.
 *
 * This prevents connection exhaustion on Railway's PostgreSQL (limited connections).
 */

const { Pool } = require('pg');

// Create a single shared pool with explicit connection limits
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Connection pool settings optimized for Railway
  max: 10,                    // Maximum 10 connections (Railway hobby has ~20 limit)
  idleTimeoutMillis: 30000,   // Close idle connections after 30 seconds
  connectionTimeoutMillis: 10000, // Timeout connection attempts after 10 seconds
});

// Log pool errors (don't crash the server)
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

// Log when pool connects (useful for debugging)
pool.on('connect', () => {
  // Only log in development to reduce noise
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DB Pool] New client connected');
  }
});

/**
 * Test the database connection
 * Call this on server startup to verify connectivity
 */
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('[DB Pool] Database connected successfully');
    client.release();
    return true;
  } catch (err) {
    console.error('[DB Pool] Database connection failed:', err.message);
    return false;
  }
}

/**
 * Gracefully close all pool connections
 * Call this on server shutdown
 */
async function closePool() {
  console.log('[DB Pool] Closing all connections...');
  await pool.end();
  console.log('[DB Pool] All connections closed');
}

module.exports = {
  pool,
  testConnection,
  closePool
};
