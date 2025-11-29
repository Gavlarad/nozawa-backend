const cron = require('node-cron');
const NozawaLiftScraper = require('./liftScraper');
const { Pool } = require('pg');

const scraper = new NozawaLiftScraper();
let scrapeResults = null;

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Store results for access by routes
function getLatestScrapeResults() {
  return scrapeResults;
}

async function setLatestScrapeResults(results) {
  // Store in memory (for fast access)
  scrapeResults = results;

  // ALSO store in PostgreSQL for persistence
  try {
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
      1,  // Nozawa Onsen resort_id
      JSON.stringify(results),
      results.isOffSeason || false,
      '1.0',
      'https://en.nozawaski.com/the-mountain/moutain-info/slopes-lifts/'
    ]);

    console.log('✅ Lift status saved to PostgreSQL');
  } catch (error) {
    console.error('❌ Failed to save lift status to PostgreSQL:', error.message);
    // Don't throw - memory cache still works
  }
}

// Load last known status from PostgreSQL on startup
async function loadCachedLiftStatus() {
  try {
    const result = await pool.query(`
      SELECT lift_data, scraped_at, is_off_season
      FROM lift_status_cache
      WHERE resort_id = $1
      ORDER BY scraped_at DESC
      LIMIT 1
    `, [1]);

    if (result.rows.length > 0) {
      scrapeResults = result.rows[0].lift_data;
      const ageMinutes = Math.round((Date.now() - new Date(result.rows[0].scraped_at)) / 60000);
      console.log(`✅ Loaded cached lift data from PostgreSQL (${ageMinutes} minutes old)`);
      return true;
    } else {
      console.log('No cached lift data found in PostgreSQL');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to load cached lift data from PostgreSQL:', error.message);
    return false;
  }
}

// Safety: Prevent scraping more than once per 5 minutes
let lastScrapeAttempt = null;
const MIN_SCRAPE_INTERVAL = 5 * 60 * 1000; // 5 minutes minimum

// Scraping function
async function performScheduledScrape() {
  // Safety check: Don't scrape more than once per 5 minutes
  if (lastScrapeAttempt && (Date.now() - lastScrapeAttempt < MIN_SCRAPE_INTERVAL)) {
    console.log('[SCHEDULER] Skipping scrape - too soon since last attempt (< 5 min)');
    return;
  }

  lastScrapeAttempt = Date.now();

  if (!scraper.checkIfSkiSeason()) {
    console.log('Outside ski season (Dec 10 - Apr 30), skipping scheduled scrape');
    return;
  }

  try {
    console.log(`[SCHEDULER] Running scheduled scrape at ${new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"})} JST`);
    const results = await scraper.scrape({ forceRun: true });
    await setLatestScrapeResults(results);  // Now async with PostgreSQL write
    console.log(`[SCHEDULER] Scrape successful, found ${results.lifts.length} lifts`);
  } catch (error) {
    console.error('[SCHEDULER] Scrape failed:', error.message);
  }
}

// Schedule scraping times (ALL IN JST)
async function initializeScheduler() {
  console.log('Initializing lift status scheduler for Dec 10 - Apr 30');

  // Try to load last known status from PostgreSQL first
  await loadCachedLiftStatus();

  // Morning updates: Every 15 minutes from 6:00 - 9:30 JST
  cron.schedule('*/15 6-9 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });

  // Midday updates: Every 30 minutes from 10:00 - 14:30 JST
  cron.schedule('0,30 10-14 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });

  // Afternoon updates: Every 15 minutes from 15:00 - 16:30 JST
  cron.schedule('*/15 15-16 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });

  // Evening final update: Once at 17:00 JST
  cron.schedule('0 17 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });

  console.log('Scheduler initialized with JST timezone');

  // Run once on startup if in season (and no cached data)
  if (scraper.checkIfSkiSeason() && !scrapeResults) {
    console.log('No cached data and in season - running initial scrape');
    performScheduledScrape();
  }
}

module.exports = {
  initializeScheduler,
  getLatestScrapeResults,
  performScheduledScrape,
  loadCachedLiftStatus
};
