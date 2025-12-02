-- Migration 015: Fix scheduled_for column timezone handling
-- Issue: TIMESTAMP (without timezone) was causing pg library to apply local timezone conversion
-- Fix: Change to TIMESTAMPTZ to preserve UTC timestamps correctly

-- Change column type from TIMESTAMP to TIMESTAMPTZ
-- USING clause interprets existing timestamps as UTC (correct for our use case)
ALTER TABLE checkin_new
ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ
USING scheduled_for AT TIME ZONE 'UTC';

-- Update comment to reflect new type
COMMENT ON COLUMN checkin_new.scheduled_for IS 'NULL = check-in now, timestamptz = future meetup time (stored with timezone, always use UTC/ISO 8601)';

-- Verify the change
DO $$
DECLARE
    col_type text;
BEGIN
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_name = 'checkin_new'
    AND column_name = 'scheduled_for';

    IF col_type = 'timestamp with time zone' THEN
        RAISE NOTICE '✅ Migration successful: scheduled_for is now TIMESTAMPTZ';
    ELSE
        RAISE EXCEPTION '❌ Migration failed: scheduled_for is still %', col_type;
    END IF;
END $$;
