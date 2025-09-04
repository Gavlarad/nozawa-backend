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
  try {
    const data = await scraper.scrape({ forceRun: true });
    cachedData = data;
    cacheTime = Date.now();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ 
      error: 'Manual scrape failed',
      message: error.message 
    });
  }
});

module.exports = router;
