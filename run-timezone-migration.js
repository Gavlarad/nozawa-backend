#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  console.log('\n📦 Running migration: 015_fix_scheduled_for_timezone.sql');
  console.log('=' .repeat(60));
  console.log('Purpose: Fix TIMESTAMP → TIMESTAMPTZ for scheduled_for column');
  console.log('Impact: Fixes 13-hour timezone offset bug in meetups');
  console.log('=' .repeat(60) + '\n');

  try {
    // Read migration file
    const sql = fs.readFileSync(
      path.join(__dirname, 'migrations', '015_fix_scheduled_for_timezone.sql'),
      'utf8'
    );

    // Show current column type
    console.log('🔍 BEFORE migration:');
    const beforeResult = await pool.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'checkin_new'
      AND column_name = 'scheduled_for'
    `);
    console.log('   Column:', beforeResult.rows[0].column_name);
    console.log('   Type:', beforeResult.rows[0].data_type);
    console.log('   UDT:', beforeResult.rows[0].udt_name);
    console.log('');

    // Run migration
    console.log('⚙️  Running migration...\n');
    await pool.query(sql);

    // Verify result
    console.log('\n✅ AFTER migration:');
    const afterResult = await pool.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'checkin_new'
      AND column_name = 'scheduled_for'
    `);
    console.log('   Column:', afterResult.rows[0].column_name);
    console.log('   Type:', afterResult.rows[0].data_type);
    console.log('   UDT:', afterResult.rows[0].udt_name);
    console.log('');

    // Test the fix
    console.log('🧪 Testing timezone handling:');
    const testResult = await pool.query(`
      SELECT
        '2025-12-03T09:00:00.000Z'::timestamptz as test_value,
        current_setting('TIMEZONE') as session_tz
    `);
    console.log('   Input: 2025-12-03T09:00:00.000Z');
    console.log('   Stored as:', testResult.rows[0].test_value);
    console.log('   Session TZ:', testResult.rows[0].session_tz);
    console.log('');

    console.log('🎉 Migration completed successfully!\n');
    console.log('Next steps:');
    console.log('  1. Test creating a meetup from frontend');
    console.log('  2. Verify scheduled_for stores correctly');
    console.log('  3. Confirm meetup appears in future (not expired)');
    console.log('');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nStack trace:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
