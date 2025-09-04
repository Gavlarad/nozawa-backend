const express = require('express');
const router = express.Router();
const NozawaLiftScraper = require('../services/liftScraper');
const scheduler = require('../services/scheduler');
const scraper = new NozawaLiftScraper();
let cachedData = null;
let cacheTime = null;

// Helper to check cache freshness
const isCacheFresh = (minutes = 10) => {
  if (!cacheTime) return false;
  const age = Date.now() - cacheTime;
  return age < minutes * 60 * 1000;
};

// Get lift status
router.get('/status', async (req, res) => {
  try {
    // Check scheduler cache first
    const schedulerData = scheduler.getLatestScrapeResults();
    if (schedulerData && schedulerData.lifts) {
      return res.json({
        ...schedulerData,
        cached: true,
        source: 'scheduler'
      });
    }
    
    // Fallback to regular cache/scraping
    if (cachedData && isCacheFresh(10)) {
      return res.json({
        ...cachedData,
        cached: true
      });
    }
    
    // Scrape new data
    const data = await scraper.scrape();
    
    if (data.success) {
      cachedData = data;
      cacheTime = Date.now();
    }
    
    res.json(data);
  } catch (error) {
    // Return test data as fallback
    const testData = scraper.generateTestData();
    res.json(testData);
  }
});

// Test data endpoint
router.get('/test', async (req, res) => {
  const testData = scraper.generateTestData();
  res.json(testData);
});

// Manual scrape endpoint
router.post('/scrape', async (req, res) => {
  const { apiKey } = req.body;
  
  // Check API key for security
  const validKey = process.env.ADMIN_API_KEY || 'nozawa-admin-2024';
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Valid API key required' 
    });
  }
  
  try {
    console.log('Manual scrape triggered with valid API key');
    const data = await scraper.scrape({ forceRun: true });
    
    // Update cache
    cachedData = data;
    cacheTime = Date.now();
    
    res.json({ 
      success: true, 
      message: 'Manual scrape completed',
      data 
    });
  } catch (error) {
    console.error('Manual scrape failed:', error);
    res.status(500).json({ 
      error: 'Manual scrape failed',
      message: error.message 
    });
  }  // <- ADD THIS CLOSING BRACKET FOR CATCH
});  // <- ADD THIS CLOSING BRACKET FOR /scrape ROUTE

// Get scheduler and system status
router.get('/status-info', (req, res) => {
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
