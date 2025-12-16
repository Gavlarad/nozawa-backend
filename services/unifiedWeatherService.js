/**
 * Unified Weather Service
 *
 * Facade that provides weather data with automatic fallback:
 * - Primary: World Weather Online (ski-specific, more accurate snowfall)
 * - Fallback: Open-Meteo (free, always available)
 *
 * The service automatically falls back to Open-Meteo if:
 * - WWO API key is not configured
 * - WWO API fails or times out
 */

const wwoService = require('./wwoWeatherService');
const openMeteoService = require('./weatherService');

class UnifiedWeatherService {
  constructor() {
    this.useWWO = !!process.env.WWO_API_KEY;

    if (this.useWWO) {
      console.log('[Weather] Using World Weather Online as primary source');
    } else {
      console.log('[Weather] Using Open-Meteo (WWO_API_KEY not set)');
    }
  }

  /**
   * Get current weather - tries WWO first, falls back to Open-Meteo
   */
  async getCurrentWeather() {
    if (this.useWWO) {
      try {
        const data = await wwoService.getCurrentWeather();
        return data;
      } catch (error) {
        console.warn('[Weather] WWO failed, falling back to Open-Meteo:', error.message);
        return this.getOpenMeteoWithFallbackFlag();
      }
    }

    return openMeteoService.getCurrentWeather();
  }

  /**
   * Get forecast - tries WWO first, falls back to Open-Meteo
   */
  async getForecast() {
    if (this.useWWO) {
      try {
        const data = await wwoService.getForecast();
        return data;
      } catch (error) {
        console.warn('[Weather] WWO forecast failed, falling back to Open-Meteo:', error.message);
        return this.getOpenMeteoForecastWithFallbackFlag();
      }
    }

    return openMeteoService.getForecast();
  }

  /**
   * Get Open-Meteo data with fallback indicator
   */
  async getOpenMeteoWithFallbackFlag() {
    const data = await openMeteoService.getCurrentWeather();
    return {
      ...data,
      source: 'open-meteo-fallback',
      fallback: true,
      fallbackReason: 'Primary weather source (WWO) unavailable'
    };
  }

  /**
   * Get Open-Meteo forecast with fallback indicator
   */
  async getOpenMeteoForecastWithFallbackFlag() {
    const data = await openMeteoService.getForecast();
    return {
      ...data,
      source: 'open-meteo-fallback',
      fallback: true,
      fallbackReason: 'Primary weather source (WWO) unavailable'
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    if (this.useWWO) {
      wwoService.clearCache();
    }
    openMeteoService.clearCache();
    console.log('[Weather] All caches cleared');
  }

  /**
   * Get cache status from both services
   */
  getCacheStatus() {
    return {
      primary: this.useWWO ? 'wwo' : 'open-meteo',
      wwo: this.useWWO ? wwoService.getCacheStatus() : { enabled: false },
      openMeteo: openMeteoService.getCacheStatus()
    };
  }

  /**
   * Check which service is active
   */
  getServiceInfo() {
    return {
      primary: this.useWWO ? 'World Weather Online' : 'Open-Meteo',
      fallback: 'Open-Meteo',
      wwoConfigured: !!process.env.WWO_API_KEY
    };
  }
}

module.exports = new UnifiedWeatherService();
