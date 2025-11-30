/**
 * Run Review Migration in Production
 *
 * This script runs migrations 015 and 016 to add review_analysis to PostgreSQL.
 * Can be called via admin HTTP endpoint.
 */

const fs = require('fs');
const path = require('path');

async function runReviewMigration(pool) {
  console.log('\n' + '='.repeat(60));
  console.log('RUNNING REVIEW MIGRATION IN PRODUCTION');
  console.log('='.repeat(60) + '\n');

  const results = {
    success: false,
    steps: [],
    updated: 0,
    skipped: 0
  };

  try {
    // Step 1: Run migration 015 (add column)
    console.log('Step 1: Adding review_analysis column...');
    const migration015 = fs.readFileSync(
      path.join(__dirname, 'migrations/015_add_review_analysis.sql'),
      'utf8'
    );
    await pool.query(migration015);
    results.steps.push({ step: 1, name: 'Add column', status: 'success' });
    console.log('✅ Column added\n');

    // Step 2: Migrate data from JSON
    console.log('Step 2: Migrating review data from JSON...');
    const jsonPath = path.join(__dirname, 'nozawa_places_unified.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    for (const place of data.places) {
      const reviewData = place.enhanced_data?.review_analysis;
      if (!reviewData) {
        results.skipped++;
        continue;
      }

      let placeId = null;
      if (place.google_place_id) {
        const result = await pool.query('SELECT id FROM places WHERE google_place_id = $1', [place.google_place_id]);
        if (result.rows.length > 0) placeId = result.rows[0].id;
      } else if (place.external_id) {
        const result = await pool.query('SELECT id FROM places WHERE external_id = $1', [place.external_id]);
        if (result.rows.length > 0) placeId = result.rows[0].id;
      }

      if (placeId) {
        await pool.query('UPDATE places SET review_analysis = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(reviewData), placeId]);
        results.updated++;
      } else {
        results.skipped++;
      }
    }

    results.steps.push({ step: 2, name: 'Migrate data', status: 'success', updated: results.updated });
    console.log(`✅ Migrated ${results.updated} places\n`);

    // Step 3: Update view
    console.log('Step 3: Updating places_with_merged_data view...');
    const migration016 = fs.readFileSync(
      path.join(__dirname, 'migrations/016_update_view_with_reviews.sql'),
      'utf8'
    );
    await pool.query(migration016);
    results.steps.push({ step: 3, name: 'Update view', status: 'success' });
    console.log('✅ View updated\n');

    results.success = true;
    console.log('='.repeat(60));
    console.log('✅ MIGRATION COMPLETE');
    console.log(`   Updated: ${results.updated} places`);
    console.log(`   Skipped: ${results.skipped} places`);
    console.log('='.repeat(60) + '\n');

    return results;

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    results.error = error.message;
    results.steps.push({ step: 'error', status: 'failed', error: error.message });
    return results;
  }
}

module.exports = { runReviewMigration };

// If run directly (not via require)
if (require.main === module) {
  const { Pool } = require('pg');
  require('dotenv').config();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  runReviewMigration(pool).then(results => {
    console.log('Results:', JSON.stringify(results, null, 2));
    pool.end();
    process.exit(results.success ? 0 : 1);
  });
}
