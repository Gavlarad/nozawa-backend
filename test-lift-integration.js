// Test lift scraping PostgreSQL integration
require('dotenv').config();
const scheduler = require('./services/scheduler');

async function testLiftIntegration() {
  console.log('\n=== Testing Lift Scraping PostgreSQL Integration ===\n');

  try {
    // Trigger a manual scrape
    console.log('1. Triggering manual scrape...');
    await scheduler.performScheduledScrape();

    // Wait a moment for scrape to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if data is in memory
    console.log('\n2. Checking in-memory cache...');
    const memoryData = scheduler.getLatestScrapeResults();
    if (memoryData) {
      console.log(`   ✅ Memory cache: ${memoryData.lifts.length} lifts`);
      console.log(`   ✅ Off-season: ${memoryData.isOffSeason}`);
      console.log(`   ✅ Scraped at: ${memoryData.scrapedAt}`);
    } else {
      console.log('   ❌ No data in memory cache');
    }

    // Check if data is in PostgreSQL
    console.log('\n3. Checking PostgreSQL...');
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    const result = await pool.query(`
      SELECT scraped_at, is_off_season,
             jsonb_array_length((lift_data->>'lifts')::jsonb) as lift_count
      FROM lift_status_cache
      WHERE resort_id = 1
      ORDER BY scraped_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`   ✅ PostgreSQL: ${row.lift_count} lifts`);
      console.log(`   ✅ Off-season: ${row.is_off_season}`);
      console.log(`   ✅ Scraped at: ${row.scraped_at}`);
    } else {
      console.log('   ❌ No data in PostgreSQL');
    }

    await pool.end();

    console.log('\n=== Test Complete ===\n');
    console.log('Now try:');
    console.log('  curl http://localhost:3000/api/lifts/status | jq \'.source\'');
    console.log('  curl http://localhost:3000/api/v2/lifts | jq \'.success\'');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testLiftIntegration();
