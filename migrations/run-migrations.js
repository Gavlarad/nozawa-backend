#!/usr/bin/env node

/**
 * Database Migration Runner
 *
 * Executes all SQL migration files in order against Railway PostgreSQL.
 * Safe to run multiple times - uses CREATE TABLE IF NOT EXISTS.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});

// Migration files in order
const MIGRATIONS = [
  '001_create_resorts.sql',
  '002_create_places_core.sql',
  '003_create_place_google_data.sql',
  '004_create_place_overrides.sql',
  '005_create_place_local_knowledge.sql',
  '006_create_groups_checkins.sql',
  '007_create_admin_auth.sql',
  '008_create_lift_status_cache.sql',
  '009_create_views.sql'
];

async function runMigrations() {
  console.log('🚀 Starting database migrations...\n');

  // Test database connection
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful\n');
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('\n💡 Make sure DATABASE_URL is set in your .env file');
    process.exit(1);
  }

  // Run each migration
  for (const filename of MIGRATIONS) {
    const filePath = path.join(__dirname, filename);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ Migration file not found: ${filename}`);
      process.exit(1);
    }

    console.log(`📄 Running migration: ${filename}`);

    try {
      const sql = fs.readFileSync(filePath, 'utf8');
      await pool.query(sql);
      console.log(`✅ ${filename} completed\n`);
    } catch (error) {
      console.error(`❌ Migration failed: ${filename}`);
      console.error(`Error: ${error.message}\n`);

      // Don't exit - continue with remaining migrations
      // Most errors will be "already exists" which is fine
      if (!error.message.includes('already exists')) {
        console.error('❗ This error may need attention\n');
      }
    }
  }

  // Verify schema
  console.log('🔍 Verifying schema...\n');

  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('📋 Tables created:');
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    const viewResult = await pool.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('\n📋 Views created:');
    viewResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // Check if Nozawa resort was seeded
    const resortCheck = await pool.query('SELECT * FROM resorts WHERE slug = $1', ['nozawa']);
    if (resortCheck.rows.length > 0) {
      console.log('\n✅ Nozawa Onsen resort seeded successfully');
    }

  } catch (error) {
    console.error('❌ Schema verification failed:', error.message);
  }

  console.log('\n✨ Migration complete!\n');
  console.log('Next steps:');
  console.log('1. Run: node scripts/migrateJsonToPostgres.js (to import existing data)');
  console.log('2. Run: node scripts/createAdminUser.js (to create your first admin)');

  await pool.end();
}

// Run migrations
runMigrations().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
