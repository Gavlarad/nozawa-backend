/**
 * Weather API Routes
 *
 * Endpoints for fetching weather data with PostgreSQL caching.
 * Primary source: World Weather Online (ski-specific)
 * Fallback: Open-Meteo (if WWO unavailable)
 *
 * All endpoints are rate-limited to prevent abuse.
 */

const express = require('express');
const router = express.Router();
const weatherService = require('../services/unifiedWeatherService');
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
      hint: 'Weather API may be unavailable. Please try again later.'
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
      hint: 'Weather API may be unavailable. Please try again later.'
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

/**
 * GET /api/weather/service-info
 * Get information about which weather service is active
 *
 * Returns:
 * - Primary service name
 * - Fallback service name
 * - Whether WWO is configured
 */
router.get('/service-info', apiLimiter, (req, res) => {
  try {
    const info = weatherService.getServiceInfo();

    res.json({
      success: true,
      ...info,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Service info error:', error);
    res.status(500).json({
      error: 'Failed to get service info',
      message: error.message
    });
  }
});

module.exports = router;
