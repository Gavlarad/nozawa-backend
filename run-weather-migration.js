// Quick script to run weather cache migration
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  console.log('\n=== Running Weather Cache Migration ===\n');

  try {
    // Read migration file
    const sql = fs.readFileSync('./migrations/012_create_weather_cache.sql', 'utf8');

    // Execute migration
    await pool.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('   Created weather_cache table');
    console.log('   Created indexes');

    // Verify table
    const result = await pool.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'weather_cache'
      ORDER BY ordinal_position
    `);

    console.log('\nTable structure:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
