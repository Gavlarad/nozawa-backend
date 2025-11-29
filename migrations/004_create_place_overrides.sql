-- ============================================
-- PLACE_OVERRIDES (Manual edits by admin)
-- ============================================
-- This is where admin panel changes go.
-- These values ALWAYS take precedence over google_data.
-- NEVER touched by annual Google updates.

CREATE TABLE IF NOT EXISTS place_overrides (
  id SERIAL PRIMARY KEY,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,

  -- Override fields (NULL = no override, use Google data)
  name_override VARCHAR(255),
  rating_override DECIMAL(2, 1) CHECK (rating_override >= 0 AND rating_override <= 5),
  price_range_override VARCHAR(10),
  phone_override VARCHAR(50),
  website_override VARCHAR(500),
  address_override TEXT,

  -- Opening hours override (JSONB format same as Google)
  hours_override JSONB,

  -- Photos management
  manual_photos BOOLEAN DEFAULT false,  -- If true, NEVER update photos from Google
  photo_urls JSONB DEFAULT '[]'::jsonb,

  -- Enhanced data (admin-added info not in Google)
  cuisine VARCHAR(100),
  budget_range VARCHAR(50),
  english_menu BOOLEAN,
  accepts_cards BOOLEAN,

  -- Custom fields for non-restaurants (onsens, lifts, etc.)
  -- Structure: { "temperature": "Very hot", "capacity": 20, ... }
  custom_fields JSONB DEFAULT '{}'::jsonb,

  -- Tracking
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(100),

  -- Constraints
  UNIQUE(place_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_overrides_place ON place_overrides(place_id);
CREATE INDEX IF NOT EXISTS idx_overrides_manual_photos ON place_overrides(manual_photos);

-- Comments
COMMENT ON TABLE place_overrides IS 'Admin manual edits - NEVER touched by Google updates';
COMMENT ON COLUMN place_overrides.manual_photos IS 'If true, photos are protected from annual updates';
COMMENT ON COLUMN place_overrides.custom_fields IS 'Flexible JSON for onsen temps, lift types, etc.';
COMMENT ON COLUMN place_overrides.name_override IS 'NULL = use Google name, otherwise use this';
