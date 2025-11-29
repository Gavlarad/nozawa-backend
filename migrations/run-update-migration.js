#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});

async function runUpdate() {
  console.log('🔧 Running update migration for existing tables...\n');

  try {
    const sql = fs.readFileSync(path.join(__dirname, '011_simple_update.sql'), 'utf8');

    const result = await pool.query(sql);

    console.log('✅ Update migration completed successfully!\n');

    // Verify the changes
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('📋 Current tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // Check groups table structure
    const groupsColumns = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'groups'
      ORDER BY ordinal_position
    `);

    console.log('\n📋 Groups table columns:');
    groupsColumns.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });

  } catch (error) {
    console.error('❌ Update migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runUpdate().catch(console.error);
