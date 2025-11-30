/**
 * Migrate Review Analysis Data to PostgreSQL
 *
 * Extracts enhanced_data.review_analysis from JSON and populates PostgreSQL
 * with review snippets, ratings, and insights.
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrateReviewData() {
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATING REVIEW ANALYSIS DATA TO POSTGRESQL');
  console.log('='.repeat(60) + '\n');

  const jsonPath = path.join(__dirname, 'nozawa_places_unified.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Step 1: Run migration to add column
    console.log('Step 1: Adding review_analysis column to database...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'migrations/015_add_review_analysis.sql'),
      'utf8'
    );
    await pool.query(migrationSQL);
    console.log('✅ Column added successfully\n');

    // Step 2: Migrate review data for each place
    console.log('Step 2: Migrating review data from JSON...\n');

    for (const place of data.places) {
      const reviewData = place.enhanced_data?.review_analysis;

      // Skip if no review data
      if (!reviewData) {
        skipped++;
        continue;
      }

      try {
        // Find place by google_place_id or external_id
        let placeId = null;

        if (place.google_place_id) {
          const result = await pool.query(
            'SELECT id FROM places WHERE google_place_id = $1',
            [place.google_place_id]
          );
          if (result.rows.length > 0) {
            placeId = result.rows[0].id;
          }
        } else if (place.external_id) {
          const result = await pool.query(
            'SELECT id FROM places WHERE external_id = $1',
            [place.external_id]
          );
          if (result.rows.length > 0) {
            placeId = result.rows[0].id;
          }
        }

        if (!placeId) {
          console.log(`⚠️  ${place.name} - not found in database`);
          skipped++;
          continue;
        }

        // Update place with review analysis data
        await pool.query(
          'UPDATE places SET review_analysis = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(reviewData), placeId]
        );

        const reviewCount = reviewData.insights?.recent_reviews?.length || 0;
        console.log(`✅ ${place.name} → ${reviewCount} reviews`);
        updated++;

      } catch (err) {
        console.error(`❌ Error processing ${place.name}:`, err.message);
        errors++;
      }
    }

    // Step 3: Verify migration
    console.log('\n' + '-'.repeat(60));
    console.log('MIGRATION SUMMARY');
    console.log('-'.repeat(60));
    console.log(`✅ Updated: ${updated} places`);
    console.log(`⏭️  Skipped: ${skipped} places (no review data)`);
    if (errors > 0) {
      console.log(`❌ Errors: ${errors} places`);
    }

    // Check database stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(review_analysis) as with_reviews,
        COUNT(*) - COUNT(review_analysis) as without_reviews
      FROM places
    `);

    console.log('\nDATABASE STATS:');
    console.log(`  Total places: ${stats.rows[0].total}`);
    console.log(`  With reviews: ${stats.rows[0].with_reviews}`);
    console.log(`  Without reviews: ${stats.rows[0].without_reviews}`);

    // Sample review data
    const sample = await pool.query(`
      SELECT name, review_analysis->'review_count' as review_count
      FROM places
      WHERE review_analysis IS NOT NULL
      LIMIT 3
    `);

    console.log('\nSAMPLE DATA:');
    sample.rows.forEach(row => {
      console.log(`  - ${row.name}: ${row.review_count} reviews analyzed`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ MIGRATION COMPLETE');
    console.log('='.repeat(60) + '\n');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

migrateReviewData();
