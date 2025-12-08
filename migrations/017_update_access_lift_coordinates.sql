-- ============================================
-- UPDATE ACCESS LIFT COORDINATES
-- ============================================
-- Corrects the coordinates for the three main access lifts
-- based on accurate Google Maps data.
--
-- Nagasaka Gondola: Base station entrance
-- Hikage Gondola: Base station entrance
-- Yu Road: Moving walkway entrance from village

-- Nagasaka Gondola
UPDATE places
SET latitude = 36.92007129585832,
    longitude = 138.4523722203726,
    updated_at = NOW()
WHERE external_id = 'nozawa_nagasaka_gondola';

-- Hikage Gondola
UPDATE places
SET latitude = 36.92577674323889,
    longitude = 138.453303819734,
    updated_at = NOW()
WHERE external_id = 'nozawa_hikage_gondola';

-- Yu Road (Moving Walkway)
UPDATE places
SET latitude = 36.924352341394304,
    longitude = 138.44889916260203,
    updated_at = NOW()
WHERE external_id = 'nozawa_yu_road_moving_walkway';

-- Verify updates
SELECT name, latitude, longitude, updated_at
FROM places
WHERE category = 'lift'
ORDER BY name;
