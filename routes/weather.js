/**
 * Weather API Routes
 *
 * Endpoints for fetching weather data from Open-Meteo API with PostgreSQL caching.
 * All endpoints are rate-limited to prevent abuse.
 */

const express = require('express');
const router = express.Router();
const weatherService = require('../services/weatherService');
const { apiLimiter } = require('../middleware/security');

/**
 * GET /api/weather/current
 * Get current weather conditions for all elevation levels
 *
 * Returns:
 * - Current temperature, humidity, wind, precipitation, snowfall
 * - Calculated snow line status
 * - Cache metadata (age, source)
 *
 * Rate Limited: 100 requests per minute
 */
router.get('/current', apiLimiter, async (req, res) => {
  try {
    const weather = await weatherService.getCurrentWeather();

    res.json({
      timestamp: weather.timestamp || new Date().toISOString(),
      snow_line: weather.snow_line,
      levels: weather.levels,
      cached: weather.cached || false,
      source: weather.source || 'open-meteo',
      age: weather.age,
      stale: weather.stale || false,
      warning: weather.warning || null
    });

  } catch (error) {
    console.error('❌ Weather current endpoint error:', error);
    res.status(500).json({
      error: 'Failed to fetch weather data',
      message: error.message,
      hint: 'Open-Meteo API may be unavailable. Please try again later.'
    });
  }
});

/**
 * GET /api/weather/forecast
 * Get 7-day weather forecast for all elevation levels
 *
 * Returns:
 * - Daily temperature max/min
 * - Precipitation and snowfall predictions
 * - Precipitation probability
 *
 * Rate Limited: 100 requests per minute
 */
router.get('/forecast', apiLimiter, async (req, res) => {
  try {
    const forecast = await weatherService.getForecast();

    res.json({
      timestamp: forecast.timestamp,
      forecast: forecast.forecast,
      cached: forecast.cached || false,
      source: forecast.source || 'open-meteo',
      age: forecast.age
    });

  } catch (error) {
    console.error('❌ Weather forecast endpoint error:', error);
    res.status(500).json({
      error: 'Failed to fetch weather forecast',
      message: error.message,
      hint: 'Open-Meteo API may be unavailable. Please try again later.'
    });
  }
});

/**
 * GET /api/weather/cache-status
 * Get cache status for monitoring
 *
 * Returns:
 * - Memory cache status
 * - Cache lifetime configuration
 *
 * Rate Limited: 100 requests per minute
 */
router.get('/cache-status', apiLimiter, (req, res) => {
  try {
    const status = weatherService.getCacheStatus();

    res.json({
      success: true,
      cache: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Cache status error:', error);
    res.status(500).json({
      error: 'Failed to get cache status',
      message: error.message
    });
  }
});

module.exports = router;
