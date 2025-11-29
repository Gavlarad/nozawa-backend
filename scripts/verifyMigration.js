#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  console.log('🔍 Verifying migration...\n');

  try {
    // Count places
    const placesResult = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM places
      WHERE resort_id = 1
      GROUP BY category
      ORDER BY category
    `);

    console.log('📊 Places migrated:');
    let total = 0;
    placesResult.rows.forEach(row => {
      console.log(`   ${row.category}: ${row.count}`);
      total += parseInt(row.count);
    });
    console.log(`   TOTAL: ${total}/97`);

    // Count Google data
    const googleResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM place_google_data
    `);
    console.log(`\n📡 Places with Google data: ${googleResult.rows[0].count}`);

    // Count overrides
    const overridesResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM place_overrides
    `);
    console.log(`✏️  Places with manual overrides: ${overridesResult.rows[0].count}`);

    // Count local knowledge
    const knowledgeResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM place_local_knowledge
    `);
    console.log(`💡 Places with local knowledge: ${knowledgeResult.rows[0].count}`);

    // Check manual photos
    const manualPhotosResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM place_overrides
      WHERE manual_photos = true
    `);
    console.log(`📸 Places with protected photos: ${manualPhotosResult.rows[0].count}`);

    // Sample some places
    console.log(`\n📋 Sample places:`);
    const sampleResult = await pool.query(`
      SELECT p.name, p.category, p.external_id
      FROM places p
      WHERE p.resort_id = 1
      ORDER BY p.id
      LIMIT 5
    `);
    sampleResult.rows.forEach(row => {
      console.log(`   - ${row.name} (${row.category})`);
    });

    console.log('\n✅ Migration verification complete!');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

verify();
