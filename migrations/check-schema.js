#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  console.log('🔍 Checking existing database schema...\n');

  try {
    // Check groups table
    const groupsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'groups'
      ORDER BY ordinal_position
    `);

    console.log('📋 GROUPS table structure:');
    groupsColumns.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'nullable'}`);
    });

    // Check checkins/checkin_new tables
    const checkinsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name IN ('checkins', 'checkin_new')
      ORDER BY table_name, ordinal_position
    `);

    console.log('\n📋 CHECKINS table structure:');
    let currentTable = '';
    checkinsColumns.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'nullable'}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSchema();
