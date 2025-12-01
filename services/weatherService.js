/**
 * Weather Service
 *
 * Handles weather data fetching from Open-Meteo API with multi-tier caching:
 * - Layer 1: In-memory cache (fastest, ~5ms)
 * - Layer 2: PostgreSQL cache (persistent, ~10ms)
 * - Layer 3: Open-Meteo API (fresh data, ~500ms)
 *
 * Cache lifetime: 10 minutes (configurable via WEATHER_CACHE_MINUTES)
 * Update strategy: On-demand (fetches only when cache expires and user requests)
 */

const { Pool } = require('pg');

class WeatherService {
  constructor() {
    // PostgreSQL connection pool
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // In-memory cache for ultra-fast access
    this.memoryCache = {
      data: null,
      timestamp: null
    };

    // Cache configuration
    this.CACHE_LIFETIME = (parseInt(process.env.WEATHER_CACHE_MINUTES) || 10) * 60 * 1000; // Default 10 minutes

    // Nozawa Onsen elevation points
    this.elevations = [
      { name: 'Village', elevation: 570, lat: 36.9205, lon: 138.4331 },
      { name: 'Mid-Mountain', elevation: 1200, lat: 36.9305, lon: 138.4331 },
      { name: 'Summit', elevation: 1650, lat: 36.9405, lon: 138.4331 }
    ];

    console.log(`🌡️  Weather Service initialized (cache: ${this.CACHE_LIFETIME / 60000} minutes)`);
  }

  /**
   * Get current weather with multi-tier caching
   * @returns {Promise<Object>} Weather data with metadata
   */
  async getCurrentWeather() {
    // 1. Check in-memory cache first (fastest path)
    if (this.isMemoryCacheFresh()) {
      return {
        ...this.memoryCache.data,
        source: 'memory',
        cached: true,
        age: Math.round((Date.now() - this.memoryCache.timestamp) / 1000)
      };
    }

    // 2. Check PostgreSQL cache (persistent, multi-instance)
    const pgCache = await this.loadFromPostgreSQL();
    if (pgCache && !this.isCacheExpired(pgCache.expires_at)) {
      // Store in memory for next request
      this.memoryCache = {
        data: pgCache.weather_data,
        timestamp: new Date(pgCache.fetched_at).getTime()
      };

      return {
        ...pgCache.weather_data,
        source: 'postgresql',
        cached: true,
        age: Math.round((Date.now() - new Date(pgCache.fetched_at)) / 1000)
      };
    }

    // 3. Cache expired/missing - fetch fresh data from Open-Meteo
    try {
      const weatherData = await this.fetchFromOpenMeteo();
      const snowLine = this.calculateSnowLine(weatherData);

      const result = {
        levels: weatherData,
        snow_line: snowLine,
        timestamp: new Date().toISOString()
      };

      // Save to PostgreSQL (if enabled)
      if (process.env.ENABLE_POSTGRES_WRITE !== 'false') {
        await this.saveToPostgreSQL(result, snowLine);
      }

      // Also save to memory
      this.memoryCache = {
        data: result,
        timestamp: Date.now()
      };

      return {
        ...result,
        source: 'open-meteo',
        cached: false,
        age: 0  // Fresh data, age is 0 seconds
      };

    } catch (error) {
      // 4. Fallback to stale cache if Open-Meteo fails
      if (pgCache) {
        console.warn('⚠️  Open-Meteo API failed, returning stale cache');
        return {
          ...pgCache.weather_data,
          source: 'postgresql-stale',
          cached: true,
          stale: true,
          warning: 'Weather data may be outdated due to API failure',
          age: Math.round((Date.now() - new Date(pgCache.fetched_at)) / 1000)
        };
      }

      // No fallback available
      console.error('❌ Weather fetch failed with no fallback:', error.message);
      throw error;
    }
  }

  /**
   * Check if in-memory cache is still fresh
   * @returns {boolean}
   */
  isMemoryCacheFresh() {
    if (!this.memoryCache.timestamp) return false;
    return (Date.now() - this.memoryCache.timestamp) < this.CACHE_LIFETIME;
  }

  /**
   * Check if PostgreSQL cache has expired
   * @param {string} expiresAt - Expiry timestamp
   * @returns {boolean}
   */
  isCacheExpired(expiresAt) {
    return new Date() > new Date(expiresAt);
  }

  /**
   * Load cached weather data from PostgreSQL
   * @returns {Promise<Object|null>}
   */
  async loadFromPostgreSQL() {
    try {
      const result = await this.pool.query(`
        SELECT
          weather_data,
          snow_line,
          fetched_at,
          expires_at,
          village_temp_c,
          summit_temp_c
        FROM weather_cache
        WHERE resort_id = $1
        ORDER BY fetched_at DESC
        LIMIT 1
      `, [1]); // Nozawa Onsen resort_id

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return row;
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to load weather from PostgreSQL:', error.message);
      return null;
    }
  }

  /**
   * Save weather data to PostgreSQL
   * @param {Object} weatherData - Weather data object
   * @param {string} snowLine - Calculated snow line
   */
  async saveToPostgreSQL(weatherData, snowLine) {
    try {
      const expiresAt = new Date(Date.now() + this.CACHE_LIFETIME);

      // Calculate next 24h snowfall for each elevation
      const villageSnow24h = this.calculateNext24HourSnowfall(weatherData.levels[0].hourly);
      const midMountainSnow24h = this.calculateNext24HourSnowfall(weatherData.levels[1].hourly);
      const summitSnow24h = this.calculateNext24HourSnowfall(weatherData.levels[2].hourly);

      await this.pool.query(`
        INSERT INTO weather_cache (
          resort_id,
          weather_data,
          snow_line,
          village_temp_c,
          summit_temp_c,
          village_next_24h_snowfall,
          mid_mountain_next_24h_snowfall,
          summit_next_24h_snowfall,
          fetched_at,
          expires_at,
          source_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
        ON CONFLICT (resort_id)
        DO UPDATE SET
          weather_data = EXCLUDED.weather_data,
          snow_line = EXCLUDED.snow_line,
          village_temp_c = EXCLUDED.village_temp_c,
          summit_temp_c = EXCLUDED.summit_temp_c,
          village_next_24h_snowfall = EXCLUDED.village_next_24h_snowfall,
          mid_mountain_next_24h_snowfall = EXCLUDED.mid_mountain_next_24h_snowfall,
          summit_next_24h_snowfall = EXCLUDED.summit_next_24h_snowfall,
          fetched_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          source_url = EXCLUDED.source_url
      `, [
        1, // resort_id (Nozawa Onsen)
        JSON.stringify(weatherData),
        snowLine,
        weatherData.levels[0].current.temperature_2m,
        weatherData.levels[2].current.temperature_2m,
        villageSnow24h,
        midMountainSnow24h,
        summitSnow24h,
        expiresAt,
        'https://api.open-meteo.com'
      ]);

      console.log(`✅ Weather data saved to PostgreSQL (next 24h: ${summitSnow24h}cm at summit)`);
    } catch (error) {
      console.error('❌ Failed to save weather to PostgreSQL:', error.message);
      // Don't throw - cache save failure shouldn't break the request
    }
  }

  /**
   * Fetch fresh weather data from Open-Meteo API
   * @returns {Promise<Array>} Array of weather data for each elevation
   */
  async fetchFromOpenMeteo() {
    const fetch = (await import('node-fetch')).default;

    try {
      const weatherData = await Promise.all(
        this.elevations.map(async (level) => {
          const url = `https://api.open-meteo.com/v1/forecast?` +
            `latitude=${level.lat}&longitude=${level.lon}&elevation=${level.elevation}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,weather_code,wind_speed_10m,wind_direction_10m` +
            `&hourly=temperature_2m,precipitation,snowfall,weather_code` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max` +
            `&timezone=Asia/Tokyo&forecast_days=7`;

          const response = await fetch(url);

          if (!response.ok) {
            throw new Error(`Open-Meteo API returned ${response.status}`);
          }

          const data = await response.json();

          return {
            location: level.name,
            elevation: level.elevation,
            current: data.current,
            hourly: data.hourly,
            daily: data.daily,
            units: data.current_units
          };
        })
      );

      return weatherData;
    } catch (error) {
      console.error('❌ Open-Meteo fetch error:', error.message);
      throw new Error(`Failed to fetch weather from Open-Meteo: ${error.message}`);
    }
  }

  /**
   * Calculate snow line based on temperature gradient
   * @param {Array} weatherData - Weather data for all elevations
   * @returns {string} Snow line description
   */
  calculateSnowLine(weatherData) {
    const village = weatherData[0].current.temperature_2m;
    const summit = weatherData[2].current.temperature_2m;

    if (village > 2 && summit <= 0) {
      return 'Snow above ~1000m';
    } else if (village <= 0) {
      return 'Snow to village level';
    } else if (summit > 2) {
      return 'No snow (too warm)';
    } else {
      return 'Mixed conditions';
    }
  }

  /**
   * Calculate snowfall for next 24 hours from hourly data
   * @param {Object} hourlyData - Hourly forecast data
   * @returns {number} Total snowfall in cm over next 24 hours
   */
  calculateNext24HourSnowfall(hourlyData) {
    if (!hourlyData || !hourlyData.time || !hourlyData.snowfall) {
      return 0;
    }

    const now = new Date();
    let totalSnowfall = 0;
    let hoursCount = 0;

    for (let i = 0; i < hourlyData.time.length && hoursCount < 24; i++) {
      const forecastTime = new Date(hourlyData.time[i]);

      if (forecastTime >= now) {
        totalSnowfall += hourlyData.snowfall[i] || 0;
        hoursCount++;
      }
    }

    return Math.round(totalSnowfall * 10) / 10; // Round to 1 decimal place
  }

  /**
   * Get forecast data (uses same caching as current weather)
   * @returns {Promise<Object>} Forecast data
   */
  async getForecast() {
    const weather = await this.getCurrentWeather();

    const forecast = weather.levels.map(level => ({
      location: level.location,
      elevation: level.elevation,
      next_24h_snowfall: this.calculateNext24HourSnowfall(level.hourly),
      daily_forecast: level.daily.time.map((date, index) => ({
        date,
        temp_max: level.daily.temperature_2m_max[index],
        temp_min: level.daily.temperature_2m_min[index],
        precipitation: level.daily.precipitation_sum[index],
        snowfall: level.daily.snowfall_sum[index],
        precipitation_probability: level.daily.precipitation_probability_max[index]
      }))
    }));

    return {
      timestamp: weather.timestamp || new Date().toISOString(),
      forecast,
      cached: weather.cached,
      source: weather.source,
      age: weather.age
    };
  }

  /**
   * Clear all caches (for testing/admin use)
   */
  clearCache() {
    this.memoryCache = {
      data: null,
      timestamp: null
    };
    console.log('🧹 Weather cache cleared');
  }

  /**
   * Get cache status (for monitoring)
   * @returns {Object} Cache status information
   */
  getCacheStatus() {
    return {
      memory: {
        hasData: !!this.memoryCache.data,
        age: this.memoryCache.timestamp
          ? Math.round((Date.now() - this.memoryCache.timestamp) / 1000)
          : null,
        fresh: this.isMemoryCacheFresh()
      },
      cacheLifetime: this.CACHE_LIFETIME / 60000 // in minutes
    };
  }
}

// Export singleton instance
module.exports = new WeatherService();
