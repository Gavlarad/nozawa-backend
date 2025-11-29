-- ============================================
-- UPDATE EXISTING TABLES
-- ============================================
-- This migration updates your existing groups and checkins tables
-- to work with the new multi-resort architecture.

-- First, ensure we have the Nozawa resort (should already exist from 001)
DO $$
DECLARE
  nozawa_resort_id INTEGER;
BEGIN
  SELECT id INTO nozawa_resort_id FROM resorts WHERE slug = 'nozawa';

  -- Update groups table: Add resort_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'groups' AND column_name = 'resort_id'
  ) THEN
    -- Add resort_id column
    ALTER TABLE groups ADD COLUMN resort_id INTEGER;

    -- Set all existing groups to Nozawa resort
    UPDATE groups SET resort_id = nozawa_resort_id WHERE resort_id IS NULL;

    -- Make it required and add foreign key
    ALTER TABLE groups ALTER COLUMN resort_id SET NOT NULL;
    ALTER TABLE groups ADD CONSTRAINT fk_groups_resort
      FOREIGN KEY (resort_id) REFERENCES resorts(id) ON DELETE CASCADE;

    -- Add index
    CREATE INDEX IF NOT EXISTS idx_groups_resort_new ON groups(resort_id);

    RAISE NOTICE 'Added resort_id to groups table';
  END IF;

  -- Update groups table: Add expires_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'groups' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE groups ADD COLUMN expires_at TIMESTAMP;
    CREATE INDEX IF NOT EXISTS idx_groups_expires_new ON groups(expires_at);
    RAISE NOTICE 'Added expires_at to groups table';
  END IF;

  -- Update checkins table: Handle both old (checkin_new) and new structure
  -- Check if we should use checkin_new or checkins
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checkin_new') THEN
    -- Rename checkin_new to checkins_old for backup
    ALTER TABLE IF EXISTS checkins RENAME TO checkins_legacy;
    ALTER TABLE checkin_new RENAME TO checkins;
    RAISE NOTICE 'Renamed checkin_new to checkins, old checkins to checkins_legacy';
  END IF;

  -- Now update the checkins table structure if needed
  -- Add place_id foreign key if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkins' AND column_name = 'place_id'
    AND data_type = 'integer'
  ) THEN
    -- If place_id exists as text, we need to handle it differently
    ALTER TABLE checkins ADD COLUMN place_id_new INTEGER REFERENCES places(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_checkins_place_new ON checkins(place_id_new);
    RAISE NOTICE 'Added place_id foreign key to checkins';
  END IF;

  -- Add place_category if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkins' AND column_name = 'place_category'
  ) THEN
    ALTER TABLE checkins ADD COLUMN place_category VARCHAR(50);
    RAISE NOTICE 'Added place_category to checkins';
  END IF;

END $$;

-- Create the active_checkins view (fixed version)
DROP VIEW IF EXISTS active_checkins;
CREATE OR REPLACE VIEW active_checkins AS
SELECT
  c.*,
  g.resort_id,
  g.code as group_code
FROM checkins c
JOIN groups g ON c.group_code = g.code
WHERE c.is_active = true
  AND c.checked_in_at > EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 hour')) * 1000;

COMMENT ON VIEW active_checkins IS 'Only active check-ins (not expired, not checked out)';

-- Verify changes
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 010 complete - existing tables updated';
END $$;
