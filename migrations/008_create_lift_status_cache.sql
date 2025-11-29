-- ============================================
-- LIFT_STATUS_CACHE TABLE (Scraped lift data)
-- ============================================
-- Stores the latest scraped lift status data.
-- Refreshed by scheduler during ski season.

CREATE TABLE IF NOT EXISTS lift_status_cache (
  id SERIAL PRIMARY KEY,
  resort_id INTEGER NOT NULL REFERENCES resorts(id) ON DELETE CASCADE,

  -- Scraped lift data (JSONB for flexibility)
  -- Structure: { "lifts": [...], "scrapedAt": "...", "isOffSeason": false }
  lift_data JSONB NOT NULL,
  is_off_season BOOLEAN DEFAULT false,

  -- Scrape metadata
  scraped_at TIMESTAMP DEFAULT NOW(),
  scraper_version VARCHAR(20),
  source_url VARCHAR(500),

  -- Keep only latest per resort
  UNIQUE(resort_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lift_cache_resort ON lift_status_cache(resort_id);
CREATE INDEX IF NOT EXISTS idx_lift_cache_scraped ON lift_status_cache(scraped_at DESC);

-- Comments
COMMENT ON TABLE lift_status_cache IS 'Latest scraped lift status - one row per resort';
COMMENT ON COLUMN lift_status_cache.lift_data IS 'Full lift status response as JSONB';
COMMENT ON COLUMN lift_status_cache.is_off_season IS 'True when outside ski season';
