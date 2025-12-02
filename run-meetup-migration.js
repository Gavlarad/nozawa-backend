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
  console.log('📦 Running migration: 014_add_meetup_fields_to_checkin.sql\n');

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'migrations', '014_add_meetup_fields_to_checkin.sql'),
      'utf8'
    );

    await pool.query(sql);
    console.log('✅ Migration completed successfully\n');

    // Verify columns were added
    const result = await pool.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'checkin_new'
      AND column_name IN ('scheduled_for', 'meetup_note')
      ORDER BY column_name
    `);

    console.log('✅ New columns added:');
    result.rows.forEach(row => {
      const length = row.character_maximum_length ? `(${row.character_maximum_length})` : '';
      console.log(`   - ${row.column_name} (${row.data_type}${length})`);
    });

    // Check indexes
    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'checkin_new'
      AND indexname LIKE '%scheduled%'
      OR indexname LIKE '%meetup%'
    `);

    console.log('\n✅ Indexes created:');
    indexes.rows.forEach(row => {
      console.log(`   - ${row.indexname}`);
    });

    console.log('\n🎉 Done! Meetup feature is now ready in the database.');
    console.log('\nNext: Deploy backend code to use these new fields.');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
