// Seed test lift data into PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');
const NozawaLiftScraper = require('./services/liftScraper');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function seedTestData() {
  console.log('\n=== Seeding Test Lift Data ===\n');

  try {
    const scraper = new NozawaLiftScraper();
    const testData = scraper.generateTestData();

    console.log('Generated test data:');
    console.log(`  - ${testData.lifts.length} lifts`);
    console.log(`  - Off-season: ${testData.isOffSeason}`);
    console.log(`  - Scraped at: ${testData.scrapedAt}`);

    console.log('\nInserting into PostgreSQL...');

    await pool.query(`
      INSERT INTO lift_status_cache (
        resort_id,
        lift_data,
        is_off_season,
        scraped_at,
        scraper_version,
        source_url
      ) VALUES ($1, $2, $3, NOW(), $4, $5)
      ON CONFLICT (resort_id)
      DO UPDATE SET
        lift_data = EXCLUDED.lift_data,
        is_off_season = EXCLUDED.is_off_season,
        scraped_at = NOW(),
        scraper_version = EXCLUDED.scraper_version,
        source_url = EXCLUDED.source_url
    `, [
      1,  // Nozawa resort_id
      JSON.stringify(testData),
      testData.isOffSeason || false,
      '1.0-test',
      'test-data-seed'
    ]);

    console.log('✅ Test data inserted successfully!\n');

    // Verify
    const result = await pool.query(`
      SELECT
        scraped_at,
        is_off_season,
        scraper_version,
        jsonb_array_length((lift_data->>'lifts')::jsonb) as lift_count
      FROM lift_status_cache
      WHERE resort_id = 1
    `);

    console.log('Verification:');
    console.log(`  - Lift count: ${result.rows[0].lift_count}`);
    console.log(`  - Scraped at: ${result.rows[0].scraped_at}`);
    console.log(`  - Version: ${result.rows[0].scraper_version}`);

    console.log('\nNow test the endpoints:');
    console.log('  curl http://localhost:3000/api/v2/lifts | jq \'.success, .lifts | length\'');
    console.log('  curl http://localhost:3000/api/lifts/status | jq \'.source\'');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error seeding data:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

seedTestData();
