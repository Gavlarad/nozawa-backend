-- ============================================
-- RESORTS TABLE (Multi-tenancy foundation)
-- ============================================
-- This table allows the system to support multiple ski resorts
-- while sharing the same codebase and database.

CREATE TABLE IF NOT EXISTS resorts (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,  -- 'nozawa', 'hakuba', etc.
  name VARCHAR(255) NOT NULL,
  name_local VARCHAR(255),            -- Japanese/local language name
  country_code CHAR(2) NOT NULL,      -- 'JP', 'US', 'CH'
  timezone VARCHAR(50) NOT NULL,       -- 'Asia/Tokyo'

  -- Geographic bounds for API queries (Google Places radius)
  center_lat DECIMAL(10, 7) NOT NULL,
  center_lng DECIMAL(10, 7) NOT NULL,
  radius_km INTEGER DEFAULT 5,

  -- Ski season configuration
  season_start_month INTEGER,         -- 12 (December)
  season_start_day INTEGER,           -- 10
  season_end_month INTEGER,           -- 4 (April)
  season_end_day INTEGER,             -- 30

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Resort-specific settings (JSONB for flexibility)
  settings JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_resorts_slug ON resorts(slug);
CREATE INDEX IF NOT EXISTS idx_resorts_status ON resorts(status);

-- Comments
COMMENT ON TABLE resorts IS 'Ski resorts - supports multi-resort deployment';
COMMENT ON COLUMN resorts.slug IS 'URL-friendly identifier, e.g., nozawa, hakuba';
COMMENT ON COLUMN resorts.settings IS 'Resort-specific configuration as JSON';

-- Seed Nozawa Onsen resort
INSERT INTO resorts (
  slug, name, name_local, country_code, timezone,
  center_lat, center_lng, radius_km,
  season_start_month, season_start_day,
  season_end_month, season_end_day,
  status
) VALUES (
  'nozawa',
  'Nozawa Onsen',
  '野沢温泉',
  'JP',
  'Asia/Tokyo',
  36.923005,
  138.446971,
  5,
  12,
  10,
  4,
  30,
  'active'
) ON CONFLICT (slug) DO NOTHING;
