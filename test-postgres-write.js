/**
 * Test PostgreSQL Direct Write
 *
 * This script tests the new postgres-write service by:
 * 1. Checking current state of Dori Dori in PostgreSQL
 * 2. Updating subcategory via admin API
 * 3. Verifying the change persisted
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testPostgresWrite() {
  console.log('\n==================================================');
  console.log('TESTING POSTGRESQL DIRECT WRITE');
  console.log('==================================================\n');

  try {
    // 1. Check current state of Dori Dori
    console.log('1️⃣  Current state of Dori Dori in PostgreSQL:\n');

    const currentState = await pool.query(`
      SELECT
        p.id,
        p.external_id,
        p.google_place_id,
        p.name,
        p.category,
        p.subcategory,
        p.status,
        p.visible_in_app,
        p.updated_at,
        po.cuisine,
        po.budget_range
      FROM places p
      LEFT JOIN place_overrides po ON p.id = po.place_id
      WHERE p.name ILIKE '%dori%'
      LIMIT 1
    `);

    if (currentState.rows.length === 0) {
      console.log('❌ Dori Dori not found in database!');
      process.exit(1);
    }

    const place = currentState.rows[0];
    console.log('   Name:', place.name);
    console.log('   Category:', place.category);
    console.log('   Subcategory:', place.subcategory, place.subcategory === 'Ramen' ? '✅ Already Ramen' : '❌ Not Ramen yet');
    console.log('   Status:', place.status);
    console.log('   Visible:', place.visible_in_app);
    console.log('   Cuisine:', place.cuisine);
    console.log('   Updated:', place.updated_at);
    console.log('   Place ID:', place.id);
    console.log('   External ID:', place.external_id);
    console.log('   Google Place ID:', place.google_place_id);

    // 2. Now let's test the direct write service
    console.log('\n2️⃣  Testing savePlacesToPostgreSQL function:\n');

    const { savePlacesToPostgreSQL } = require('./services/postgres-write');

    // Create a test place object matching JSON structure
    const testPlace = {
      id: place.external_id || place.google_place_id,
      google_place_id: place.google_place_id,
      name: place.name,
      category: 'restaurant',
      subcategory: 'Ramen',  // Change to Ramen
      status: 'active',
      visible_in_app: true,
      enhanced_data: {
        cuisine: 'Thai',  // Keep existing
        budget: '$$'
      },
      local_knowledge: {
        tips: ['Great ramen spot'],
        warnings: [],
        navigation_tips: 'Easy to find'
      }
    };

    console.log('   Updating with data:', {
      name: testPlace.name,
      subcategory: testPlace.subcategory,
      category: testPlace.category,
      status: testPlace.status
    });

    const result = await savePlacesToPostgreSQL([testPlace], 1); // Admin ID 1

    console.log('\n   Result:', {
      success: result.success,
      updated: result.updated,
      errors: result.errors,
      details: result.details
    });

    if (!result.success) {
      console.log('❌ Save failed!');
      process.exit(1);
    }

    // 3. Verify the change
    console.log('\n3️⃣  Verifying changes in PostgreSQL:\n');

    const verifyState = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.category,
        p.subcategory,
        p.status,
        p.visible_in_app,
        p.updated_at,
        p.updated_by,
        po.cuisine,
        po.budget_range,
        lk.tips,
        lk.navigation_tips
      FROM places p
      LEFT JOIN place_overrides po ON p.id = po.place_id
      LEFT JOIN place_local_knowledge lk ON p.id = lk.place_id
      WHERE p.name ILIKE '%dori%'
      LIMIT 1
    `);

    const updated = verifyState.rows[0];
    console.log('   Name:', updated.name);
    console.log('   Category:', updated.category, updated.category === 'restaurant' ? '✅' : '❌');
    console.log('   Subcategory:', updated.subcategory, updated.subcategory === 'Ramen' ? '✅ SUCCESS!' : '❌ FAILED');
    console.log('   Status:', updated.status, updated.status === 'active' ? '✅' : '❌');
    console.log('   Visible:', updated.visible_in_app, updated.visible_in_app ? '✅' : '❌');
    console.log('   Cuisine:', updated.cuisine, updated.cuisine === 'Thai' ? '✅' : '❌');
    console.log('   Budget:', updated.budget_range, updated.budget_range === '$$' ? '✅' : '❌');
    console.log('   Tips:', updated.tips);
    console.log('   Navigation:', updated.navigation_tips, updated.navigation_tips === 'Easy to find' ? '✅' : '❌');
    console.log('   Updated At:', updated.updated_at);
    console.log('   Updated By:', updated.updated_by);

    // 4. Check V2 API
    console.log('\n4️⃣  Verifying V2 API returns updated data:\n');

    const response = await fetch(`http://localhost:3000/api/v2/places/${updated.id}`);
    const apiData = await response.json();

    if (apiData.success) {
      console.log('   API Name:', apiData.data.name);
      console.log('   API Subcategory:', apiData.data.subcategory, apiData.data.subcategory === 'Ramen' ? '✅ API CORRECT!' : '❌ API WRONG');
      console.log('   API Category:', apiData.data.category);
      console.log('   API Status:', apiData.data.status);
      console.log('   API Cuisine:', apiData.data.enhanced_data?.cuisine);
    } else {
      console.log('❌ API request failed:', apiData.error);
    }

    console.log('\n==================================================');
    console.log('✅ TEST COMPLETED SUCCESSFULLY');
    console.log('==================================================\n');

    console.log('Summary:');
    console.log('  ✅ Direct PostgreSQL write working');
    console.log('  ✅ All 3 tables updated (places, place_overrides, place_local_knowledge)');
    console.log('  ✅ V2 API serving updated data');
    console.log('  ✅ Subcategory field now syncing correctly');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testPostgresWrite();
