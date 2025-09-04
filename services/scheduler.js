const cron = require('node-cron');
const NozawaLiftScraper = require('./liftScraper');

const scraper = new NozawaLiftScraper();
let scrapeResults = null;

// Store results for access by routes
function getLatestScrapeResults() {
  return scrapeResults;
}

function setLatestScrapeResults(results) {
  scrapeResults = results;
}

// Scraping function
async function performScheduledScrape() {
  if (!scraper.checkIfSkiSeason()) {
    console.log('Outside ski season (Dec 10 - Apr 30), skipping scheduled scrape');
    return;
  }
  
  try {
    console.log(`[SCHEDULER] Running scheduled scrape at ${new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"})} JST`);
    const results = await scraper.scrape({ forceRun: true });
    setLatestScrapeResults(results);
    console.log(`[SCHEDULER] Scrape successful, found ${results.lifts.length} lifts`);
  } catch (error) {
    console.error('[SCHEDULER] Scrape failed:', error.message);
  }
}

// Schedule scraping times (ALL IN JST)
function initializeScheduler() {
  console.log('Initializing lift status scheduler for Dec 10 - Apr 30');
  
  // Morning updates: Every 15 minutes from 6:00 - 9:30 JST
  cron.schedule('*/15 6-9 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });
  
  // Midday updates: Every 30 minutes from 10:00 - 14:30 JST  
  cron.schedule('0,30 10-14 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });
  
  // Afternoon updates: Every 15 minutes from 15:00 - 16:30 JST
  cron.schedule('*/15 15-16 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });
  
  // Evening final update: Once at 17:00 JST
  cron.schedule('0 17 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });
  
  console.log('Scheduler initialized with JST timezone');
  
  // Run once on startup if in season
  if (scraper.checkIfSkiSeason()) {
    performScheduledScrape();
  }
}

module.exports = {
  initializeScheduler,
  getLatestScrapeResults,
  performScheduledScrape
};
