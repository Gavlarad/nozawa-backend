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
  console.log('📦 Running migration: 013_add_next_24h_snowfall_columns.sql\n');

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'migrations', '013_add_next_24h_snowfall_columns.sql'),
      'utf8'
    );

    await pool.query(sql);
    console.log('✅ Migration completed successfully\n');

    // Verify columns were added
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'weather_cache'
      AND column_name LIKE '%next_24h%'
      ORDER BY column_name
    `);

    console.log('✅ New columns added:');
    result.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });

    console.log('\n🎉 Done! Weather service will now store 24h snowfall predictions in these columns.');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
