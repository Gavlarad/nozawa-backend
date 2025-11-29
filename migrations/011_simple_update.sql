-- ============================================
-- SIMPLE UPDATE - Just add resort_id to groups
-- ============================================
-- This is a minimal, safe update that adds resort support
-- without breaking existing functionality.

-- Step 1: Add resort_id to groups table (if it doesn't exist)
DO $$
DECLARE
  nozawa_resort_id INTEGER;
BEGIN
  -- Get Nozawa resort ID
  SELECT id INTO nozawa_resort_id FROM resorts WHERE slug = 'nozawa';

  -- Add resort_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'groups' AND column_name = 'resort_id'
  ) THEN
    ALTER TABLE groups ADD COLUMN resort_id INTEGER;

    -- Set all existing groups to Nozawa
    UPDATE groups SET resort_id = nozawa_resort_id WHERE resort_id IS NULL;

    -- Make it not null and add foreign key
    ALTER TABLE groups ALTER COLUMN resort_id SET NOT NULL;
    ALTER TABLE groups ADD CONSTRAINT fk_groups_resort
      FOREIGN KEY (resort_id) REFERENCES resorts(id) ON DELETE CASCADE;

    CREATE INDEX idx_groups_resort_id ON groups(resort_id);

    RAISE NOTICE '✅ Added resort_id to groups table';
  ELSE
    RAISE NOTICE '   resort_id already exists in groups table';
  END IF;

  -- Add expires_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'groups' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE groups ADD COLUMN expires_at TIMESTAMP;
    CREATE INDEX idx_groups_expires ON groups(expires_at);
    RAISE NOTICE '✅ Added expires_at to groups table';
  ELSE
    RAISE NOTICE '   expires_at already exists in groups table';
  END IF;

END $$;

-- Recreate the views that failed (using existing table structure)
DROP VIEW IF EXISTS active_checkins;

-- Use checkin_new table (which is what your app currently uses)
CREATE OR REPLACE VIEW active_checkins AS
SELECT
  c.*,
  g.resort_id,
  g.code as group_code_duplicate
FROM checkin_new c
JOIN groups g ON c.group_code = g.code
WHERE c.is_active = true
  AND c.checked_in_at > EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 hour')) * 1000;

COMMENT ON VIEW active_checkins IS 'Active check-ins using current checkin_new table';

-- Success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ ✅ ✅ Migration complete! ✅ ✅ ✅';
  RAISE NOTICE '';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '- Added resort_id to groups table';
  RAISE NOTICE '- All existing groups linked to Nozawa resort';
  RAISE NOTICE '- Created active_checkins view';
  RAISE NOTICE '- Your existing app functionality preserved';
END $$;
