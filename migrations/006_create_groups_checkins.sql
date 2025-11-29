-- ============================================
-- GROUPS TABLE (User groups for check-ins)
-- ============================================
-- Upgraded from current system to support multi-resort.
-- Groups allow friends to share their location at the resort.

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  resort_id INTEGER NOT NULL REFERENCES resorts(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,           -- 6-digit numeric code

  -- Auto-expiration
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,               -- Auto-expire after season ends

  -- Constraints
  UNIQUE(code),                       -- Code must be globally unique
  UNIQUE(resort_id, code)             -- Also unique within resort
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_groups_code ON groups(code);
CREATE INDEX IF NOT EXISTS idx_groups_resort ON groups(resort_id);
CREATE INDEX IF NOT EXISTS idx_groups_expires ON groups(expires_at);

-- Comments
COMMENT ON TABLE groups IS 'User groups for sharing location with friends';
COMMENT ON COLUMN groups.code IS '6-digit numeric code for joining group';
COMMENT ON COLUMN groups.expires_at IS 'Auto-expire groups after ski season ends';


-- ============================================
-- CHECKINS TABLE (User check-ins to places)
-- ============================================
-- Enhanced from current system with better accommodation support.

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,  -- Null if place deleted

  -- User identity (anonymous via device ID)
  device_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(100) NOT NULL,

  -- Place details (denormalized for history preservation)
  place_external_id VARCHAR(255),
  place_name VARCHAR(255),
  place_category VARCHAR(50),

  -- Check-in timing (Unix timestamp in milliseconds)
  checked_in_at BIGINT NOT NULL,
  checked_out_at BIGINT,
  is_active BOOLEAN DEFAULT true,

  -- Accommodation sharing (optional)
  accommodation_place_id VARCHAR(255),
  accommodation_coords JSONB,         -- [lng, lat]
  accommodation_name VARCHAR(255),
  display_accommodation_to_group BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_checkins_group ON checkins(group_id);
CREATE INDEX IF NOT EXISTS idx_checkins_place ON checkins(place_id);
CREATE INDEX IF NOT EXISTS idx_checkins_device ON checkins(device_id);
CREATE INDEX IF NOT EXISTS idx_checkins_active ON checkins(group_id, is_active);
CREATE INDEX IF NOT EXISTS idx_checkins_time ON checkins(checked_in_at);

-- Comments
COMMENT ON TABLE checkins IS 'User check-ins to places within groups';
COMMENT ON COLUMN checkins.device_id IS 'Anonymous device identifier - no user accounts needed';
COMMENT ON COLUMN checkins.checked_in_at IS 'Unix timestamp in milliseconds';
COMMENT ON COLUMN checkins.is_active IS 'False if checked out or auto-expired after 1 hour';
COMMENT ON COLUMN checkins.place_external_id IS 'Denormalized for history if place is deleted';
