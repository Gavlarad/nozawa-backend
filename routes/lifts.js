const express = require('express');
const router = express.Router();
const NozawaLiftScraper = require('../services/liftScraper');
const scheduler = require('../services/scheduler');
const { apiLimiter } = require('../middleware/security');
const scraper = new NozawaLiftScraper();
let cachedData = null;
let cacheTime = null;

// Helper to check cache freshness
const isCacheFresh = (minutes = 10) => {
  if (!cacheTime) return false;
  const age = Date.now() - cacheTime;
  return age < minutes * 60 * 1000;
};

// Get lift status (rate limited)
router.get('/status', apiLimiter, async (req, res) => {
  try {
    // 1. Check scheduler cache first (primary source)
    const schedulerData = scheduler.getLatestScrapeResults();
    if (schedulerData && schedulerData.lifts) {
      return res.json({
        ...schedulerData,
        cached: true,
        source: 'scheduler'
      });
    }
    
    // 2. Check local route cache (backup)
    if (cachedData && isCacheFresh(10)) {
      return res.json({
        ...cachedData,
        cached: true,
        source: 'route-cache'
      });
    }
    
    // 3. NO CACHE AVAILABLE - Return test data (DO NOT SCRAPE!)
    console.log('⚠️  No cached lift data available, returning test data');
    const testData = scraper.generateTestData();
    return res.json({
      ...testData,
      cached: false,
      source: 'test-data',
      message: 'No cached data available - showing test data'
    });
    
  } catch (error) {
    console.error('Error in /status endpoint:', error);
    const testData = scraper.generateTestData();
    res.json({
      ...testData,
      error: true,
      source: 'test-data'
    });
  }
});


// Get scheduler and system status (rate limited)
router.get('/status-info', apiLimiter, (req, res) => {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  
  // Check if we're in ski season
  const month = jst.getMonth();
  const day = jst.getDate();
  const isSkiSeason = (month === 11 && day >= 10) ||  // Dec 10-31
                      (month >= 0 && month <= 2) ||   // Jan-March
                      (month === 3 && day <= 30);     // April 1-30
  
  res.json({
    system: {
      currentTimeUTC: now.toISOString(),
      currentTimeJST: jst.toISOString(),
      jstFormatted: jst.toLocaleString("en-US", {timeZone: "Asia/Tokyo"})
    },
    season: {
      isCurrentlySkiSeason: isSkiSeason,
      currentMonth: jst.toLocaleString('en-US', {month: 'long', timeZone: "Asia/Tokyo"}),
      seasonDates: 'December 10 - April 30',
      daysUntilSeason: !isSkiSeason ? 'Season ended or not started' : 'Currently in season'
    },
    cache: {
      hasCachedData: !!cachedData,
      cacheAge: cacheTime ? Math.floor((Date.now() - cacheTime) / 1000) + ' seconds' : 'No cache',
      cacheExpired: cacheTime ? !isCacheFresh(10) : true,
      lastScrapeTime: cachedData?.scrapedAt || null
    },
    endpoints: {
      liveStatus: '/api/lifts/status',
      testData: '/api/lifts/test',
      manualScrape: '/api/lifts/scrape (POST with apiKey)',
      statusInfo: '/api/lifts/status-info'
    }
  });
});

module.exports = router;
