-- Add meetup functionality to checkin_new table
-- Migration: 014

-- Add scheduled_for timestamp for future meetups
-- NULL = check-in now (default behavior)
-- Value = future meetup time
ALTER TABLE checkin_new
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP NULL;

-- Add optional note/message for meetups
ALTER TABLE checkin_new
ADD COLUMN IF NOT EXISTS meetup_note VARCHAR(200) NULL;

-- Index for querying future meetups efficiently
CREATE INDEX IF NOT EXISTS idx_checkin_scheduled_future
ON checkin_new(group_code, is_active, scheduled_for)
WHERE scheduled_for IS NOT NULL AND is_active = true;

-- Index for finding current check-ins (scheduled_for IS NULL)
CREATE INDEX IF NOT EXISTS idx_checkin_current_only
ON checkin_new(group_code, is_active, place_id)
WHERE scheduled_for IS NULL AND is_active = true;

-- Index for cleanup queries (finding expired meetups)
CREATE INDEX IF NOT EXISTS idx_checkin_expired_meetups
ON checkin_new(scheduled_for, is_active)
WHERE scheduled_for IS NOT NULL AND is_active = true;

-- Comments for documentation
COMMENT ON COLUMN checkin_new.scheduled_for IS 'NULL = check-in now, timestamp = future meetup time (stored in UTC, display as JST)';
COMMENT ON COLUMN checkin_new.meetup_note IS 'Optional message for meetups (max 200 chars). Example: "Lets meet for lunch!"';
