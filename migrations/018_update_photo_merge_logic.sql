-- ============================================
-- UPDATE PHOTO MERGE LOGIC
-- ============================================
-- Changes photo handling to support three modes:
-- 1. manual_photos = true → Only manual photos (protects onsens)
-- 2. manual_photos = false + has photo_urls → Manual photos FIRST, then Google
-- 3. No manual photos → Just Google photos
--
-- This allows adding featured/curated photos to any place while
-- keeping Google photos as supplementary content.

-- Drop and recreate the view with updated photo logic
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

  -- Photos (three modes: manual-only, manual+google, google-only)
  -- Manual photos always appear FIRST in the array
  CASE
    -- Mode 1: manual_photos = true → Only manual photos (full protection)
    WHEN po.manual_photos = true THEN po.photo_urls
    -- Mode 2: Has manual photos but not protected → Manual FIRST, then Google
    WHEN po.photo_urls IS NOT NULL AND jsonb_array_length(po.photo_urls) > 0
      THEN po.photo_urls || COALESCE(gd.photos, '[]'::jsonb)
    -- Mode 3: No manual photos → Just Google
    ELSE gd.photos
  END as photos,
  po.manual_photos,

  -- Enhanced data (admin-added)
  po.cuisine,
  po.budget_range,
  po.english_menu,
  po.accepts_cards,
  po.custom_fields,

  -- Review analysis from places table
  p.review_analysis,

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

COMMENT ON VIEW places_with_merged_data IS 'Merged view with three-mode photo handling: manual-only, manual+google, google-only';

-- Verify the view was created
SELECT
  'View updated successfully' as status,
  COUNT(*) as total_places
FROM places_with_merged_data;
