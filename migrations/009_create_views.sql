-- ============================================
-- CONVENIENCE VIEWS
-- ============================================
-- These views merge data from multiple tables for easier querying.
-- Used by API endpoints to avoid complex joins in application code.

-- View: places_with_merged_data
-- Combines place, google_data, overrides, and local_knowledge into single row
CREATE OR REPLACE VIEW places_with_merged_data AS
SELECT
  p.id,
  p.resort_id,
  p.external_id,
  p.category,
  p.subcategory,
  p.status,
  p.visible_in_app,
  p.data_source,
  p.google_place_id,
  p.last_google_sync,
  p.last_verified,

  -- Name (override takes precedence)
  COALESCE(po.name_override, p.name) as name,
  p.name_local,

  -- Location
  p.latitude,
  p.longitude,
  COALESCE(po.address_override, p.address) as address,

  -- Rating (override takes precedence)
  COALESCE(po.rating_override, gd.google_rating) as rating,
  gd.google_review_count as review_count,

  -- Contact (override takes precedence)
  COALESCE(po.phone_override, gd.google_phone) as phone,
  COALESCE(po.website_override, gd.google_website) as website,
  COALESCE(po.price_range_override, gd.google_price_range) as price_range,

  -- Hours (override takes precedence)
  COALESCE(po.hours_override, gd.opening_hours) as opening_hours,

  -- Photos (use manual if protected, otherwise Google)
  CASE
    WHEN po.manual_photos = true THEN po.photo_urls
    ELSE gd.photos
  END as photos,
  po.manual_photos,

  -- Enhanced data (admin-added)
  po.cuisine,
  po.budget_range,
  po.english_menu,
  po.accepts_cards,
  po.custom_fields,

  -- Local knowledge
  lk.tips,
  lk.warnings,
  lk.navigation_tips,
  lk.description_override,
  lk.insider_notes,
  lk.features_verified,

  -- Google metadata
  gd.google_types,
  gd.editorial_summary,
  gd.features as google_features,
  gd.google_maps_url,

  -- Audit tracking
  p.created_at,
  p.updated_at,
  gd.synced_at as last_google_sync_date,
  po.updated_at as last_manual_edit,
  po.updated_by as last_edited_by,

  -- Flags for admin UI
  (po.id IS NOT NULL) as has_overrides,
  (lk.id IS NOT NULL) as has_local_knowledge,
  (gd.id IS NOT NULL) as has_google_data

FROM places p
LEFT JOIN place_google_data gd ON p.id = gd.place_id
LEFT JOIN place_overrides po ON p.id = po.place_id
LEFT JOIN place_local_knowledge lk ON p.id = lk.place_id;

COMMENT ON VIEW places_with_merged_data IS 'Merged view of all place data with override precedence';


-- View: active_checkins
-- Shows only currently active check-ins (not expired, not checked out)
CREATE OR REPLACE VIEW active_checkins AS
SELECT
  c.*,
  g.resort_id,
  g.code as group_code,
  p.name as current_place_name,
  p.category as current_place_category,
  p.latitude as current_place_lat,
  p.longitude as current_place_lng
FROM checkins c
JOIN groups g ON c.group_id = g.id
LEFT JOIN places p ON c.place_id = p.id
WHERE c.is_active = true
  AND c.checked_in_at > EXTRACT(EPOCH FROM (NOW() - INTERVAL '1 hour')) * 1000;

COMMENT ON VIEW active_checkins IS 'Only active check-ins (not expired, not checked out)';


-- View: resort_stats
-- Statistics for each resort (admin dashboard)
CREATE OR REPLACE VIEW resort_stats AS
SELECT
  r.id as resort_id,
  r.slug,
  r.name,
  r.status,
  COUNT(DISTINCT p.id) as total_places,
  COUNT(DISTINCT p.id) FILTER (WHERE p.category = 'restaurant') as restaurant_count,
  COUNT(DISTINCT p.id) FILTER (WHERE p.category = 'onsen') as onsen_count,
  COUNT(DISTINCT p.id) FILTER (WHERE p.category = 'lift') as lift_count,
  COUNT(DISTINCT p.id) FILTER (WHERE p.visible_in_app = false) as hidden_count,
  COUNT(DISTINCT po.id) as places_with_overrides,
  COUNT(DISTINCT lk.id) as places_with_local_knowledge,
  MAX(gd.synced_at) as last_google_sync,
  COUNT(DISTINCT g.id) as active_groups,
  COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = true) as active_checkins
FROM resorts r
LEFT JOIN places p ON r.id = p.resort_id
LEFT JOIN place_overrides po ON p.id = po.place_id
LEFT JOIN place_local_knowledge lk ON p.id = lk.place_id
LEFT JOIN place_google_data gd ON p.id = gd.place_id
LEFT JOIN groups g ON r.id = g.resort_id
LEFT JOIN checkins c ON g.id = c.group_id
GROUP BY r.id, r.slug, r.name, r.status;

COMMENT ON VIEW resort_stats IS 'Statistics dashboard for each resort';
