-- Migration 012: Create Weather Cache Table
-- Description: Cache for Open-Meteo weather data with 10-minute expiry
-- Date: 2025-11-29

-- Weather forecast cache
CREATE TABLE weather_cache (
  id SERIAL PRIMARY KEY,
  resort_id INTEGER NOT NULL REFERENCES resorts(id),
  weather_data JSONB NOT NULL,
  snow_line TEXT,
  village_temp_c NUMERIC(4,1),
  summit_temp_c NUMERIC(4,1),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  source_url TEXT DEFAULT 'https://api.open-meteo.com',
  UNIQUE(resort_id)
);

-- Index for efficient expiry checks
CREATE INDEX idx_weather_cache_expires ON weather_cache(expires_at);
CREATE INDEX idx_weather_cache_resort ON weather_cache(resort_id);

-- Comments for documentation
COMMENT ON TABLE weather_cache IS 'Cached weather forecasts from Open-Meteo API with 10-minute expiry';
COMMENT ON COLUMN weather_cache.weather_data IS 'Full JSON response from Open-Meteo (levels array with current/daily data)';
COMMENT ON COLUMN weather_cache.snow_line IS 'Calculated snow line status (e.g., "Snow above ~1000m")';
COMMENT ON COLUMN weather_cache.village_temp_c IS 'Village elevation temperature for quick queries';
COMMENT ON COLUMN weather_cache.summit_temp_c IS 'Summit elevation temperature for quick queries';
COMMENT ON COLUMN weather_cache.expires_at IS 'Cache expiry time (typically 10 minutes from fetch)';
COMMENT ON COLUMN weather_cache.source_url IS 'Open-Meteo API base URL for reference';
