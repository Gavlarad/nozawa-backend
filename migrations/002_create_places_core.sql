-- ============================================
-- PLACES TABLE (Core place data)
-- ============================================
-- Central table for all places: restaurants, onsens, lifts, etc.
-- This contains only the core, non-changing data.
-- Google-refreshable data and manual overrides are in separate tables.

CREATE TABLE IF NOT EXISTS places (
  id SERIAL PRIMARY KEY,
  resort_id INTEGER NOT NULL REFERENCES resorts(id) ON DELETE CASCADE,

  -- Identity
  external_id VARCHAR(255) NOT NULL,  -- Google place_id OR custom 'nozawa_oyu'
  name VARCHAR(255) NOT NULL,
  name_local VARCHAR(255),            -- Japanese name (e.g., 野沢温泉)

  -- Classification
  category VARCHAR(50) NOT NULL,      -- restaurant, onsen, lift
  subcategory VARCHAR(100),           -- Cafe, public_bath, gondola, etc.

  -- Location
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  address TEXT,

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
    'active',
    'closed_temporarily',
    'closed_permanently',
    'off-season'
  )),
  visible_in_app BOOLEAN DEFAULT true,

  -- Data source tracking
  data_source VARCHAR(20) DEFAULT 'manual' CHECK (data_source IN (
    'google',
    'manual',
    'scraped'
  )),
  google_place_id VARCHAR(255),       -- Link to Google Places API
  last_google_sync TIMESTAMP,
  last_verified TIMESTAMP,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(100),
  updated_by VARCHAR(100),

  -- Constraints
  UNIQUE(resort_id, external_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_places_resort ON places(resort_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(resort_id, category);
CREATE INDEX IF NOT EXISTS idx_places_location ON places(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_places_google_id ON places(google_place_id);
CREATE INDEX IF NOT EXISTS idx_places_visible ON places(resort_id, visible_in_app);
CREATE INDEX IF NOT EXISTS idx_places_status ON places(status);

-- GiST index for geo queries (optional, advanced)
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- CREATE INDEX idx_places_geo ON places USING GIST (
--   ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
-- );

-- Comments
COMMENT ON TABLE places IS 'Core place data (restaurants, onsens, lifts)';
COMMENT ON COLUMN places.external_id IS 'Unique identifier: Google place_id or custom ID like nozawa_oyu';
COMMENT ON COLUMN places.visible_in_app IS 'Admin control: show/hide from mobile app';
COMMENT ON COLUMN places.data_source IS 'Where data came from: google, manual, or scraped';
