-- Add next 24h snowfall columns for quick querying and alerts
-- Migration: 013

ALTER TABLE weather_cache
ADD COLUMN IF NOT EXISTS village_next_24h_snowfall DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS mid_mountain_next_24h_snowfall DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS summit_next_24h_snowfall DECIMAL(5,2);

-- Create index for snow alert queries
CREATE INDEX IF NOT EXISTS idx_weather_cache_summit_snowfall
ON weather_cache(summit_next_24h_snowfall DESC, fetched_at DESC)
WHERE summit_next_24h_snowfall > 0;

-- Comment for documentation
COMMENT ON COLUMN weather_cache.village_next_24h_snowfall IS 'Calculated snowfall (cm) for next 24 hours at village elevation (570m)';
COMMENT ON COLUMN weather_cache.mid_mountain_next_24h_snowfall IS 'Calculated snowfall (cm) for next 24 hours at mid-mountain (1200m)';
COMMENT ON COLUMN weather_cache.summit_next_24h_snowfall IS 'Calculated snowfall (cm) for next 24 hours at summit (1650m)';
