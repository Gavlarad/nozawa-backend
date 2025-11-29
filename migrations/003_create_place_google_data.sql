-- ============================================
-- PLACE_GOOGLE_DATA (Refreshable Google Places API data)
-- ============================================
-- This table stores ONLY data from Google Places API.
-- It's refreshed during annual updates WITHOUT touching manual edits.
-- Data here can be overridden by place_overrides table.

CREATE TABLE IF NOT EXISTS place_google_data (
  id SERIAL PRIMARY KEY,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,

  -- Google-specific ratings & reviews
  google_rating DECIMAL(2, 1) CHECK (google_rating >= 0 AND google_rating <= 5),
  google_review_count INTEGER DEFAULT 0,
  google_price_range VARCHAR(10),     -- ¥, ¥¥, ¥¥¥, ¥¥¥¥

  -- Contact info
  google_phone VARCHAR(50),
  google_website VARCHAR(500),
  google_maps_url VARCHAR(500),

  -- Opening hours (JSONB for flexibility)
  -- Structure: { "open_now": true, "periods": [...] }
  opening_hours JSONB,

  -- Photos (array of photo objects)
  -- Structure: [{ "url": "...", "width": 800, "height": 600, "attributions": [...] }]
  photos JSONB DEFAULT '[]'::jsonb,

  -- Google metadata
  google_types TEXT[],                -- ['restaurant', 'food', 'point_of_interest']
  editorial_summary TEXT,

  -- Features (JSONB for flexibility)
  -- Structure: { "takeout": true, "delivery": false, "dine_in": true, ... }
  features JSONB DEFAULT '{}'::jsonb,

  -- Sync tracking
  synced_at TIMESTAMP DEFAULT NOW(),
  google_updated_at TIMESTAMP,

  -- Constraints
  UNIQUE(place_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_google_data_place ON place_google_data(place_id);
CREATE INDEX IF NOT EXISTS idx_google_data_synced ON place_google_data(synced_at);

-- Comments
COMMENT ON TABLE place_google_data IS 'Google Places API data - refreshed annually during updates';
COMMENT ON COLUMN place_google_data.opening_hours IS 'Google hours format as JSONB';
COMMENT ON COLUMN place_google_data.photos IS 'Array of Google photo objects';
COMMENT ON COLUMN place_google_data.features IS 'Restaurant features from Google (takeout, delivery, etc.)';
