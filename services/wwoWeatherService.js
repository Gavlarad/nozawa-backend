/**
 * World Weather Online Ski Weather Service
 *
 * Fetches ski-specific weather data from World Weather Online API.
 * Provides more accurate snowfall predictions than generic weather APIs.
 *
 * Features:
 * - Ski-specific data (chance of snow, freeze level, snowfall)
 * - Top/Mid/Bottom elevation forecasts
 * - 7-day forecast
 */

const { pool } = require('../db/pool');

class WWOWeatherService {
  constructor() {
    this.pool = pool;
    this.apiKey = process.env.WWO_API_KEY;
    this.baseUrl = 'https://api.worldweatheronline.com/premium/v1/ski.ashx';

    // In-memory cache
    this.memoryCache = {
      data: null,
      timestamp: null
    };

    // Cache configuration (10 minutes default)
    this.CACHE_LIFETIME = (parseInt(process.env.WEATHER_CACHE_MINUTES) || 10) * 60 * 1000;

    // Nozawa Onsen coordinates and elevations
    this.location = {
      lat: 36.9205,
      lon: 138.4331,
      elevations: {
        village: 570,
        mid: 1200,
        summit: 1650
      }
    };

    if (this.apiKey) {
      console.log('[WWO Weather] Service initialized with API key');
    } else {
      console.warn('[WWO Weather] No API key found - set WWO_API_KEY env var');
    }
  }

  /**
   * Check if in-memory cache is still fresh
   */
  isMemoryCacheFresh() {
    if (!this.memoryCache.timestamp) return false;
    return (Date.now() - this.memoryCache.timestamp) < this.CACHE_LIFETIME;
  }

  /**
   * Get current weather with caching
   */
  async getCurrentWeather() {
    // 1. Check in-memory cache first
    if (this.isMemoryCacheFresh()) {
      return {
        ...this.memoryCache.data,
        source: 'wwo-memory',
        cached: true,
        age: Math.round((Date.now() - this.memoryCache.timestamp) / 1000)
      };
    }

    // 2. Check PostgreSQL cache
    const pgCache = await this.loadFromPostgreSQL();
    if (pgCache && !this.isCacheExpired(pgCache.expires_at)) {
      this.memoryCache = {
        data: pgCache.weather_data,
        timestamp: new Date(pgCache.fetched_at).getTime()
      };

      return {
        ...pgCache.weather_data,
        source: 'wwo-postgresql',
        cached: true,
        age: Math.round((Date.now() - new Date(pgCache.fetched_at)) / 1000)
      };
    }

    // 3. Fetch fresh data from WWO
    try {
      const wwoData = await this.fetchFromWWO();
      const transformedData = this.transformWWOResponse(wwoData);

      // Save to PostgreSQL
      if (process.env.ENABLE_POSTGRES_WRITE !== 'false') {
        await this.saveToPostgreSQL(transformedData);
      }

      // Save to memory
      this.memoryCache = {
        data: transformedData,
        timestamp: Date.now()
      };

      return {
        ...transformedData,
        source: 'wwo-api',
        cached: false,
        age: 0
      };

    } catch (error) {
      // Fallback to stale cache if WWO fails
      if (pgCache) {
        console.warn('[WWO Weather] API failed, returning stale cache');
        return {
          ...pgCache.weather_data,
          source: 'wwo-postgresql-stale',
          cached: true,
          stale: true,
          warning: 'Weather data may be outdated due to API failure',
          age: Math.round((Date.now() - new Date(pgCache.fetched_at)) / 1000)
        };
      }

      console.error('[WWO Weather] Fetch failed with no fallback:', error.message);
      throw error;
    }
  }

  /**
   * Fetch data from World Weather Online Ski API
   */
  async fetchFromWWO() {
    if (!this.apiKey) {
      throw new Error('WWO_API_KEY not configured');
    }

    const fetch = (await import('node-fetch')).default;

    const url = `${this.baseUrl}?key=${this.apiKey}&q=${this.location.lat},${this.location.lon}&format=json&num_of_days=7`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`WWO API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.data?.error) {
      throw new Error(data.data.error[0]?.msg || 'WWO API error');
    }

    return data;
  }

  /**
   * Transform WWO response to match existing frontend format
   */
  transformWWOResponse(wwoData) {
    const rawWeather = wwoData.data.weather;

    // WWO returns multiple entries per date (each with 1 hourly slot)
    // We need to MERGE them into one entry per date with all hourly slots
    const weatherByDate = new Map();
    rawWeather.forEach(entry => {
      if (!weatherByDate.has(entry.date)) {
        // First entry for this date - keep all daily-level fields
        weatherByDate.set(entry.date, {
          ...entry,
          hourly: [...(entry.hourly || [])]
        });
      } else {
        // Merge hourly data into existing entry
        const existing = weatherByDate.get(entry.date);
        if (entry.hourly) {
          existing.hourly.push(...entry.hourly);
        }
      }
    });

    // Sort hourly data by time within each day
    weatherByDate.forEach(day => {
      day.hourly.sort((a, b) => parseInt(a.time) - parseInt(b.time));
    });

    const weather = Array.from(weatherByDate.values());
    const today = weather[0];

    // Get current conditions from first hourly slot
    const currentHour = this.getCurrentHourIndex();
    const currentHourly = today.hourly[currentHour] || today.hourly[0];

    // Build levels array matching Open-Meteo format
    const levels = [
      this.buildLevelData('Village', this.location.elevations.village, weather, 'bottom'),
      this.buildLevelData('Mid-Mountain', this.location.elevations.mid, weather, 'mid'),
      this.buildLevelData('Summit', this.location.elevations.summit, weather, 'top')
    ];

    // Calculate snow line
    const snowLine = this.calculateSnowLine(currentHourly, today);

    return {
      levels,
      snow_line: snowLine,
      timestamp: new Date().toISOString(),
      // WWO-specific extras
      chance_of_snow: parseInt(today.chanceofsnow) || 0,
      freeze_level: parseInt(currentHourly.freezeLevel) || null
    };
  }

  /**
   * Build level data for a specific elevation (Village/Mid/Summit)
   */
  buildLevelData(locationName, elevation, weatherDays, wwoLevel) {
    const today = weatherDays[0];
    const currentHour = this.getCurrentHourIndex();
    const currentHourly = today.hourly[currentHour] || today.hourly[0];
    const levelData = currentHourly[wwoLevel]?.[0] || {};
    const dailyLevel = today[wwoLevel]?.[0] || {};

    // Build hourly data for next 7 days
    const hourlyTimes = [];
    const hourlyTemps = [];
    const hourlyPrecip = [];
    const hourlySnowfall = [];
    const hourlyWeatherCodes = [];

    weatherDays.forEach(day => {
      day.hourly.forEach(hour => {
        const hourLevel = hour[wwoLevel]?.[0] || {};
        hourlyTimes.push(this.convertWWOTime(day.date, hour.time));
        hourlyTemps.push(parseFloat(hourLevel.tempC) || 0);
        hourlyPrecip.push(parseFloat(hour.precipMM) || 0);
        hourlySnowfall.push(parseFloat(hour.snowfall_cm) || 0);
        hourlyWeatherCodes.push(this.mapWWOWeatherCode(parseInt(hourLevel.weatherCode) || 0));
      });
    });

    // Build daily data
    const dailyData = {
      time: weatherDays.map(d => d.date),
      temperature_2m_max: weatherDays.map(d => parseFloat(d[wwoLevel]?.[0]?.maxtempC) || 0),
      temperature_2m_min: weatherDays.map(d => parseFloat(d[wwoLevel]?.[0]?.mintempC) || 0),
      precipitation_sum: weatherDays.map(d => {
        return d.hourly.reduce((sum, h) => sum + (parseFloat(h.precipMM) || 0), 0);
      }),
      snowfall_sum: weatherDays.map(d => parseFloat(d.totalSnowfall_cm) || 0),
      precipitation_probability_max: weatherDays.map(d => parseInt(d.chanceofsnow) || 0)
    };

    // Calculate wind chill for apparent temperature
    const temp = parseFloat(levelData.tempC) || 0;
    const wind = parseFloat(levelData.windspeedKmph) || 0;
    const feelsLike = this.calculateWindChill(temp, wind);

    return {
      location: locationName,
      elevation: elevation,
      current: {
        time: new Date().toISOString(),
        temperature_2m: temp,
        relative_humidity_2m: parseInt(currentHourly.humidity) || 0,
        apparent_temperature: feelsLike,
        precipitation: parseFloat(currentHourly.precipMM) || 0,
        snowfall: parseFloat(currentHourly.snowfall_cm) || 0,
        weather_code: this.mapWWOWeatherCode(parseInt(levelData.weatherCode) || 0),
        wind_speed_10m: wind,
        wind_direction_10m: parseInt(levelData.winddirDegree) || 0,
        // WWO extras
        weather_desc: levelData.weatherDesc?.[0]?.value || 'Unknown',
        chance_of_snow: parseInt(today.chanceofsnow) || 0,
        freeze_level: parseInt(currentHourly.freezeLevel) || null
      },
      hourly: {
        time: hourlyTimes,
        temperature_2m: hourlyTemps,
        precipitation: hourlyPrecip,
        snowfall: hourlySnowfall,
        weather_code: hourlyWeatherCodes
      },
      daily: dailyData,
      units: {
        temperature_2m: '°C',
        precipitation: 'mm',
        snowfall: 'cm',
        wind_speed_10m: 'km/h',
        wind_direction_10m: '°'
      }
    };
  }

  /**
   * Get current hour index in JST (WWO uses 0, 300, 600, etc for time)
   */
  getCurrentHourIndex() {
    // Get current hour in JST (UTC+9) since WWO data is in JST
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    // WWO hourly is every 3 hours: 0, 3, 6, 9, 12, 15, 18, 21
    return Math.floor(jstHour / 3);
  }

  /**
   * Calculate wind chill (feels like) temperature
   * Uses Environment Canada formula, valid for T <= 10°C and V >= 4.8 km/h
   * @param {number} tempC - Temperature in Celsius
   * @param {number} windKmh - Wind speed in km/h
   * @returns {number} Wind chill temperature in Celsius
   */
  calculateWindChill(tempC, windKmh) {
    // Wind chill only applies when temp <= 10°C and wind >= 4.8 km/h
    if (tempC > 10 || windKmh < 4.8) {
      return tempC;
    }

    // Environment Canada wind chill formula
    const windChill = 13.12 +
      (0.6215 * tempC) -
      (11.37 * Math.pow(windKmh, 0.16)) +
      (0.3965 * tempC * Math.pow(windKmh, 0.16));

    return Math.round(windChill);
  }

  /**
   * Convert WWO time format to ISO string with JST timezone
   * WWO returns times in local timezone of the queried location (JST for Nozawa)
   */
  convertWWOTime(date, time) {
    // WWO time is like "0", "100", "300", "600" etc (HHMM without leading zeros)
    const timeStr = time.padStart(4, '0');
    const hours = timeStr.slice(0, 2);
    const minutes = timeStr.slice(2, 4);
    // Add JST timezone offset (+09:00) so Date parsing works correctly
    return `${date}T${hours}:${minutes}:00+09:00`;
  }

  /**
   * Map WWO weather code to WMO code (used by frontend)
   */
  mapWWOWeatherCode(wwoCode) {
    // WWO codes to WMO approximation
    // https://www.worldweatheronline.com/weather-api/api/docs/weather-icons.aspx
    if (wwoCode === 113) return 0;  // Clear/Sunny
    if (wwoCode === 116) return 2;  // Partly cloudy
    if (wwoCode === 119) return 3;  // Cloudy
    if (wwoCode === 122) return 3;  // Overcast
    if (wwoCode >= 143 && wwoCode <= 248) return 45; // Fog/Mist
    if (wwoCode >= 176 && wwoCode <= 263) return 51; // Light rain/drizzle
    if (wwoCode >= 266 && wwoCode <= 296) return 61; // Rain
    if (wwoCode >= 299 && wwoCode <= 314) return 63; // Heavy rain
    if (wwoCode >= 317 && wwoCode <= 350) return 71; // Snow
    if (wwoCode >= 353 && wwoCode <= 377) return 73; // Heavy snow
    if (wwoCode >= 386 && wwoCode <= 395) return 95; // Thunder
    return 0;
  }

  /**
   * Calculate snow line description
   */
  calculateSnowLine(currentHourly, today) {
    const freezeLevel = parseInt(currentHourly.freezeLevel) || 0;
    const chanceOfSnow = parseInt(today.chanceofsnow) || 0;

    if (freezeLevel <= this.location.elevations.village) {
      return 'Snow to village level';
    } else if (freezeLevel <= this.location.elevations.mid) {
      return `Snow above ~${freezeLevel}m`;
    } else if (freezeLevel <= this.location.elevations.summit) {
      return `Snow above ~${freezeLevel}m (summit only)`;
    } else if (chanceOfSnow > 0) {
      return 'Mixed conditions';
    } else {
      return 'No snow (too warm)';
    }
  }

  /**
   * Check if cache has expired
   */
  isCacheExpired(expiresAt) {
    return new Date() > new Date(expiresAt);
  }

  /**
   * Load from PostgreSQL cache
   */
  async loadFromPostgreSQL() {
    try {
      const result = await this.pool.query(`
        SELECT weather_data, fetched_at, expires_at
        FROM weather_cache
        WHERE resort_id = $1
        ORDER BY fetched_at DESC
        LIMIT 1
      `, [1]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('[WWO Weather] Failed to load from PostgreSQL:', error.message);
      return null;
    }
  }

  /**
   * Save to PostgreSQL cache
   */
  async saveToPostgreSQL(weatherData) {
    try {
      const expiresAt = new Date(Date.now() + this.CACHE_LIFETIME);

      // Calculate snowfall totals
      const summitLevel = weatherData.levels[2];
      const villageLevel = weatherData.levels[0];
      const summitSnow24h = this.calculateSnowfallForHours(summitLevel.hourly, 24);

      await this.pool.query(`
        INSERT INTO weather_cache (
          resort_id, weather_data, snow_line,
          village_temp_c, summit_temp_c,
          summit_next_24h_snowfall,
          fetched_at, expires_at, source_url
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
        ON CONFLICT (resort_id)
        DO UPDATE SET
          weather_data = EXCLUDED.weather_data,
          snow_line = EXCLUDED.snow_line,
          village_temp_c = EXCLUDED.village_temp_c,
          summit_temp_c = EXCLUDED.summit_temp_c,
          summit_next_24h_snowfall = EXCLUDED.summit_next_24h_snowfall,
          fetched_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          source_url = EXCLUDED.source_url
      `, [
        1,
        JSON.stringify(weatherData),
        weatherData.snow_line,
        villageLevel.current.temperature_2m,
        summitLevel.current.temperature_2m,
        summitSnow24h,
        expiresAt,
        'https://api.worldweatheronline.com'
      ]);

      console.log(`[WWO Weather] Saved to PostgreSQL (24h snow: ${summitSnow24h}cm)`);
    } catch (error) {
      console.error('[WWO Weather] Failed to save to PostgreSQL:', error.message);
    }
  }

  /**
   * Calculate snowfall for given hours from hourly data
   */
  calculateSnowfallForHours(hourlyData, hours) {
    if (!hourlyData?.time || !hourlyData?.snowfall) return 0;

    const now = new Date();
    let total = 0;
    let count = 0;

    for (let i = 0; i < hourlyData.time.length && count < hours; i++) {
      const forecastTime = new Date(hourlyData.time[i]);
      if (forecastTime >= now) {
        total += hourlyData.snowfall[i] || 0;
        count++;
      }
    }

    return Math.round(total * 10) / 10;
  }

  /**
   * Get forecast data (uses same caching as current weather)
   */
  async getForecast() {
    const weather = await this.getCurrentWeather();

    const forecast = weather.levels.map(level => ({
      location: level.location,
      elevation: level.elevation,
      next_24h_snowfall: this.calculateSnowfallForHours(level.hourly, 24),
      next_48h_snowfall: this.calculateSnowfallForHours(level.hourly, 48),
      next_72h_snowfall: this.calculateSnowfallForHours(level.hourly, 72),
      snowfall_6hourly: this.get6HourlySnowfall(level.hourly),
      daily_forecast: level.daily.time.map((date, index) => ({
        date,
        temp_max: level.daily.temperature_2m_max[index],
        temp_min: level.daily.temperature_2m_min[index],
        precipitation: level.daily.precipitation_sum[index],
        snowfall: level.daily.snowfall_sum[index],
        precipitation_probability: level.daily.precipitation_probability_max[index]
      })),
      // WWO extras
      chance_of_snow: level.current.chance_of_snow,
      freeze_level: level.current.freeze_level
    }));

    return {
      timestamp: weather.timestamp,
      forecast,
      cached: weather.cached,
      source: weather.source,
      age: weather.age,
      // WWO extras
      chance_of_snow: weather.chance_of_snow,
      freeze_level: weather.freeze_level
    };
  }

  /**
   * Get 6-hourly snowfall breakdown
   */
  get6HourlySnowfall(hourlyData) {
    if (!hourlyData?.time || !hourlyData?.snowfall) return [];

    const now = new Date();
    const result = [];
    let blockSnowfall = 0;
    let hoursInBlock = 0;
    let blockStartTime = null;
    let totalHours = 0;

    for (let i = 0; i < hourlyData.time.length && totalHours < 72; i++) {
      const forecastTime = new Date(hourlyData.time[i]);

      if (forecastTime >= now) {
        if (!blockStartTime) blockStartTime = forecastTime.toISOString();

        blockSnowfall += hourlyData.snowfall[i] || 0;
        hoursInBlock++;
        totalHours++;

        if (hoursInBlock === 6) {
          result.push({
            time: blockStartTime,
            snowfall: Math.round(blockSnowfall * 10) / 10
          });
          blockSnowfall = 0;
          hoursInBlock = 0;
          blockStartTime = null;
        }
      }
    }

    if (hoursInBlock > 0) {
      result.push({
        time: blockStartTime,
        snowfall: Math.round(blockSnowfall * 10) / 10
      });
    }

    return result;
  }

  /**
   * Clear cache (memory and PostgreSQL)
   */
  async clearCache() {
    this.memoryCache = { data: null, timestamp: null };

    // Also clear PostgreSQL cache
    try {
      await this.pool.query('DELETE FROM weather_cache WHERE resort_id = $1', [1]);
      console.log('[WWO Weather] Memory and PostgreSQL cache cleared');
    } catch (error) {
      console.error('[WWO Weather] Failed to clear PostgreSQL cache:', error.message);
      console.log('[WWO Weather] Memory cache cleared');
    }
  }

  /**
   * Get cache status
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
      cacheLifetime: this.CACHE_LIFETIME / 60000,
      apiKeyConfigured: !!this.apiKey
    };
  }
}

module.exports = new WWOWeatherService();
