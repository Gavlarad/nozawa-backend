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
  idleTimeoutMillis: 60000,   // Keep idle connections for 60 seconds
  connectionTimeoutMillis: 15000, // Allow 15 seconds for slow cold starts
});

// Database keepalive interval (5 minutes)
let keepaliveInterval = null;

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
 * Keepalive ping - keeps connections warm to prevent Railway cold starts
 */
async function keepalivePing() {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.log(`[DB Pool] Keepalive ping: ${duration}ms (slow)`);
    }
  } catch (err) {
    console.error('[DB Pool] Keepalive ping failed:', err.message);
  }
}

/**
 * Start the keepalive timer (call after server starts)
 */
function startKeepalive() {
  if (keepaliveInterval) return; // Already running

  // Run every 5 minutes to keep connections warm
  keepaliveInterval = setInterval(keepalivePing, 5 * 60 * 1000);
  console.log('[DB Pool] Keepalive started (every 5 minutes)');
}

/**
 * Stop the keepalive timer
 */
function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
    console.log('[DB Pool] Keepalive stopped');
  }
}

/**
 * Test the database connection
 * Call this on server startup to verify connectivity
 */
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('[DB Pool] Database connected successfully');
    client.release();
    // Start keepalive after successful connection
    startKeepalive();
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
  stopKeepalive();
  console.log('[DB Pool] Closing all connections...');
  await pool.end();
  console.log('[DB Pool] All connections closed');
}

module.exports = {
  pool,
  testConnection,
  closePool,
  startKeepalive,
  stopKeepalive
};
