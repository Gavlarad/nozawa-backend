-- Migration: Create group_members table
-- Purpose: Explicit group membership tracking instead of inferring from checkin_new

-- Create the group_members table
CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_code VARCHAR(10) NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  user_name VARCHAR(100),
  joined_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),

  -- Accommodation fields (single source of truth)
  accommodation_place_id VARCHAR(100),
  accommodation_name VARCHAR(200),
  accommodation_coords DOUBLE PRECISION[],
  display_accommodation_to_group BOOLEAN DEFAULT false,

  -- Constraints
  UNIQUE(group_code, device_id)
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_group_members_group_code ON group_members(group_code);
CREATE INDEX IF NOT EXISTS idx_group_members_device_id ON group_members(device_id);

-- Backfill from existing checkin_new data
-- This inserts distinct members with their latest accommodation data
INSERT INTO group_members (
  group_code,
  device_id,
  user_name,
  joined_at,
  last_seen_at,
  accommodation_place_id,
  accommodation_name,
  accommodation_coords,
  display_accommodation_to_group
)
SELECT DISTINCT ON (group_code, device_id)
  group_code,
  device_id,
  user_name,
  MIN(to_timestamp(checked_in_at / 1000.0)) OVER (PARTITION BY group_code, device_id) as joined_at,
  MAX(to_timestamp(checked_in_at / 1000.0)) OVER (PARTITION BY group_code, device_id) as last_seen_at,
  accommodation_place_id,
  accommodation_name,
  CASE
    WHEN accommodation_coords IS NOT NULL AND accommodation_coords != ''
    THEN (accommodation_coords::jsonb->>0)::double precision || ARRAY[(accommodation_coords::jsonb->>1)::double precision]
    ELSE NULL
  END as accommodation_coords,
  COALESCE(display_accommodation_to_group, false)
FROM checkin_new
WHERE group_code IS NOT NULL
ORDER BY group_code, device_id, checked_in_at DESC
ON CONFLICT (group_code, device_id) DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE group_members IS 'Explicit group membership tracking. Members persist until they explicitly leave.';
