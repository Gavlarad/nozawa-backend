#!/usr/bin/env node

/**
 * Data Migration Script: JSON → PostgreSQL
 *
 * Migrates all places from nozawa_places_unified.json into PostgreSQL
 * with proper data separation:
 * - places (core data)
 * - place_google_data (refreshable from Google)
 * - place_overrides (manual edits - NEVER overwritten)
 * - place_local_knowledge (tips, warnings - NEVER overwritten)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Statistics
const stats = {
  total: 0,
  restaurants: 0,
  onsens: 0,
  lifts: 0,
  withGoogleData: 0,
  withOverrides: 0,
  withLocalKnowledge: 0,
  manualPhotos: 0,
  errors: []
};

/**
 * Migrate a single place
 */
async function migratePlace(placeJson, resortId, client) {
  const externalId = placeJson.id || placeJson.google_place_id;

  try {
    // 1. INSERT INTO PLACES (core data)
    const placeResult = await client.query(`
      INSERT INTO places (
        resort_id, external_id, name, name_local, category, subcategory,
        latitude, longitude, address, status, visible_in_app,
        data_source, google_place_id, last_google_sync, last_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (resort_id, external_id) DO UPDATE SET
        name = EXCLUDED.name,
        last_verified = EXCLUDED.last_verified
      RETURNING id
    `, [
      resortId,
      externalId,
      placeJson.name,
      placeJson.name_jp || placeJson.name_local,
      placeJson.category,
      placeJson.subcategory || null,
      placeJson.coordinates ? placeJson.coordinates[1] : (placeJson.location?.lat || null),
      placeJson.coordinates ? placeJson.coordinates[0] : (placeJson.location?.lng || null),
      placeJson.address || placeJson.location?.address || null,
      placeJson.status || 'active',
      placeJson.visible_in_app !== false, // Default true
      placeJson.google_data ? 'google' : 'manual',
      placeJson.google_place_id || null,
      placeJson.last_google_sync || null,
      placeJson.last_verified || new Date().toISOString()
    ]);

    const placeId = placeResult.rows[0].id;

    // 2. INSERT INTO PLACE_GOOGLE_DATA (if Google data exists)
    if (placeJson.google_data) {
      await client.query(`
        INSERT INTO place_google_data (
          place_id, google_rating, google_review_count, google_price_range,
          google_phone, google_website, google_maps_url,
          opening_hours, photos, google_types, features, synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (place_id) DO UPDATE SET
          google_rating = EXCLUDED.google_rating,
          google_review_count = EXCLUDED.google_review_count,
          google_price_range = EXCLUDED.google_price_range,
          google_phone = EXCLUDED.google_phone,
          google_website = EXCLUDED.google_website,
          opening_hours = EXCLUDED.opening_hours,
          photos = EXCLUDED.photos,
          synced_at = NOW()
      `, [
        placeId,
        placeJson.google_data.rating || placeJson.rating || null,
        placeJson.google_data.review_count || placeJson.review_count || null,
        placeJson.google_data.price_range || placeJson.price_range || null,
        placeJson.google_data.phone || null,
        placeJson.google_data.website || null,
        placeJson.google_data.maps_url || null,
        JSON.stringify(placeJson.google_data.hours || placeJson.opening_hours || null),
        JSON.stringify(placeJson.google_data.photos || placeJson.photos || []),
        placeJson.google_data.types || null,
        JSON.stringify({
          takeout: placeJson.google_data.takeout,
          delivery: placeJson.google_data.delivery,
          dine_in: placeJson.google_data.dine_in,
          reservable: placeJson.google_data.reservable,
          serves_beer: placeJson.google_data.serves_beer,
          serves_wine: placeJson.google_data.serves_wine,
          wheelchair_accessible: placeJson.google_data.wheelchair_accessible,
          vegetarian_friendly: placeJson.google_data.vegetarian_friendly
        })
      ]);
      stats.withGoogleData++;
    }

    // 3. INSERT INTO PLACE_OVERRIDES (if manual edits exist)
    const hasOverrides = placeJson.manual_overrides ||
                        placeJson.enhanced_data ||
                        placeJson.manual_photos ||
                        placeJson.local_info; // For onsens

    if (hasOverrides) {
      await client.query(`
        INSERT INTO place_overrides (
          place_id, manual_photos, photo_urls, cuisine, budget_range,
          english_menu, custom_fields, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (place_id) DO UPDATE SET
          manual_photos = EXCLUDED.manual_photos,
          photo_urls = EXCLUDED.photo_urls,
          cuisine = EXCLUDED.cuisine,
          custom_fields = EXCLUDED.custom_fields
      `, [
        placeId,
        placeJson.manual_photos === true,
        JSON.stringify(placeJson.photos || []),
        placeJson.enhanced_data?.cuisine || null,
        placeJson.enhanced_data?.budget || null,
        placeJson.enhanced_data?.english_menu || null,
        JSON.stringify(placeJson.local_info || {}),
        'json_migration'
      ]);
      stats.withOverrides++;

      if (placeJson.manual_photos) {
        stats.manualPhotos++;
      }
    }

    // 4. INSERT INTO PLACE_LOCAL_KNOWLEDGE (if tips/warnings exist)
    const hasLocalKnowledge = placeJson.local_knowledge ||
                              placeJson.description ||
                              (placeJson.local_info && placeJson.local_info.local_tips);

    if (hasLocalKnowledge) {
      const tips = [];
      const warnings = [];
      const navigationTips = [];

      // Extract from local_knowledge structure
      if (placeJson.local_knowledge) {
        if (placeJson.local_knowledge.tips) tips.push(placeJson.local_knowledge.tips);
        if (placeJson.local_knowledge.warnings) warnings.push(placeJson.local_knowledge.warnings);
        if (placeJson.local_knowledge.navigation_tips) navigationTips.push(placeJson.local_knowledge.navigation_tips);
      }

      // Extract from local_info (onsens)
      if (placeJson.local_info?.local_tips) {
        tips.push(placeJson.local_info.local_tips);
      }

      await client.query(`
        INSERT INTO place_local_knowledge (
          place_id, tips, warnings, navigation_tips,
          description_override, insider_notes, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (place_id, language_code) DO UPDATE SET
          tips = EXCLUDED.tips,
          warnings = EXCLUDED.warnings,
          description_override = EXCLUDED.description_override
      `, [
        placeId,
        tips.length > 0 ? tips : null,
        warnings.length > 0 ? warnings : null,
        navigationTips.length > 0 ? navigationTips : null,
        placeJson.description || null,
        null,
        'json_migration'
      ]);
      stats.withLocalKnowledge++;
    }

    // Update category stats
    if (placeJson.category === 'restaurant') stats.restaurants++;
    if (placeJson.category === 'onsen') stats.onsens++;
    if (placeJson.category === 'lift') stats.lifts++;

    return { success: true, placeId, name: placeJson.name };

  } catch (error) {
    stats.errors.push({
      place: externalId,
      name: placeJson.name,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('🚀 Starting JSON → PostgreSQL migration...\n');

  const client = await pool.connect();

  try {
    // Load JSON file
    const jsonPath = path.join(__dirname, '../nozawa_places_unified.json');
    console.log(`📂 Loading data from: ${jsonPath}`);

    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(rawData);
    const places = data.places || [];

    console.log(`📊 Found ${places.length} places to migrate\n`);
    stats.total = places.length;

    // Get Nozawa resort ID
    const resortResult = await client.query(
      "SELECT id FROM resorts WHERE slug = 'nozawa'"
    );

    if (resortResult.rows.length === 0) {
      throw new Error('Nozawa resort not found! Run migrations first.');
    }

    const resortId = resortResult.rows[0].id;
    console.log(`✅ Nozawa resort ID: ${resortId}\n`);

    console.log('🔄 Migrating places (batch commit every 10)...\n');

    // Migrate each place with batch commits
    let successCount = 0;
    const BATCH_SIZE = 10;

    for (let i = 0; i < places.length; i++) {
      // Start transaction for batch
      if (i % BATCH_SIZE === 0) {
        await client.query('BEGIN');
      }

      const place = places[i];
      const result = await migratePlace(place, resortId, client);

      if (result.success) {
        successCount++;
        if ((i + 1) % 10 === 0 || i === places.length - 1) {
          console.log(`   Progress: ${i + 1}/${places.length} - ${result.name}`);
        }
      } else {
        console.error(`   ❌ Failed: ${place.name} - ${result.error}`);
      }

      // Commit batch
      if ((i + 1) % BATCH_SIZE === 0 || i === places.length - 1) {
        await client.query('COMMIT');
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ MIGRATION COMPLETE! ✨');
    console.log('='.repeat(60));
    console.log('\n📊 Migration Statistics:');
    console.log(`   Total places: ${stats.total}`);
    console.log(`   Successfully migrated: ${successCount}`);
    console.log(`   Failed: ${stats.errors.length}`);
    console.log(`\n📂 By Category:`);
    console.log(`   🍴 Restaurants: ${stats.restaurants}`);
    console.log(`   ♨️  Onsens: ${stats.onsens}`);
    console.log(`   🎿 Lifts: ${stats.lifts}`);
    console.log(`\n📝 Data Breakdown:`);
    console.log(`   With Google data: ${stats.withGoogleData}`);
    console.log(`   With manual overrides: ${stats.withOverrides}`);
    console.log(`   With local knowledge: ${stats.withLocalKnowledge}`);
    console.log(`   Protected photos (manual): ${stats.manualPhotos}`);

    if (stats.errors.length > 0) {
      console.log(`\n❌ Errors (${stats.errors.length}):`);
      stats.errors.forEach(err => {
        console.log(`   - ${err.name}: ${err.error}`);
      });
    }

    // Verification query
    console.log('\n🔍 Verification:');
    const verifyResult = await client.query(`
      SELECT
        category,
        COUNT(*) as count
      FROM places
      WHERE resort_id = $1
      GROUP BY category
      ORDER BY category
    `, [resortId]);

    console.log('   Database counts:');
    verifyResult.rows.forEach(row => {
      console.log(`   - ${row.category}: ${row.count}`);
    });

    console.log('\n✅ Next steps:');
    console.log('   1. Verify data in Railway dashboard');
    console.log('   2. Run: node scripts/createAdminUser.js');
    console.log('   3. Test API endpoints\n');

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // Ignore rollback errors
    }
    console.error('\n❌ Migration failed:', error.message);
    console.error('   Some data may have been committed in batches');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
