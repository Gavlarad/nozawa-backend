# Admin Editable Fields - Architecture & Implementation

## Problem Statement

When admin edits a place through the admin interface:
- ✅ Changes save to JSON file (`nozawa_places_unified.json`)
- ❌ Changes DON'T sync to PostgreSQL for many fields
- ❌ Frontend reading from V2 API sees stale data

**Example:** Updating "Dori Dori" subcategory from "Restaurant" to "Ramen" saves to JSON but not PostgreSQL.

---

## Root Cause

The dual-write service (`services/dual-write.js`) only syncs:
- ✅ `visible_in_app` (one core field)
- ✅ All `place_overrides` fields (cuisine, budget, photos, etc.)

But it's **missing many editable core fields** like:
- ❌ `subcategory`
- ❌ `status`
- ❌ `category`
- ❌ `name_local`

---

## JSON File Structure (Source of Truth During Migration)

```json
{
  "places": [
    {
      "id": "ChIJ...",
      "name": "Dori Dori",
      "category": "restaurant",
      "subcategory": "Restaurant",  // ← Editable, but not syncing!
      "status": "active",            // ← Editable, but not syncing!
      "visible_in_app": true,        // ← Syncing ✓

      "manual_overrides": {
        "status": "active",
        "subcategory": "Restaurant",
        "enhanced_data": {...},
        "local_knowledge": {...}
      },

      "enhanced_data": {
        "cuisine": "Thai",           // ← Syncing ✓
        "budget": "$$",              // ← Syncing ✓
        "english_menu": true,        // ← Syncing ✓
        "credit_cards": true         // ← Syncing ✓
      },

      "local_knowledge": {
        "navigation_tips": "...",
        "warnings": [],
        "verified_features": {...}
      }
    }
  ]
}
```

---

## PostgreSQL Architecture (Multi-Table Design)

### Table 1: `places` (Core Place Data)
**Purpose:** Non-changing identity and classification
**Editable Fields:**
- ✅ `category` (restaurant, onsen, lift)
- ✅ `subcategory` (Thai, Japanese, Italian, public bath, gondola, etc.)
- ✅ `status` (active, closed_temporarily, closed_permanently, off-season)
- ✅ `visible_in_app` (show/hide toggle)
- ✅ `name_local` (Japanese name)

**Auto-managed Fields:**
- `id`, `resort_id`, `external_id`, `google_place_id`
- `latitude`, `longitude`, `address`
- `data_source`, `last_google_sync`, `last_verified`
- `created_at`, `updated_at`, `created_by`, `updated_by`

---

### Table 2: `place_google_data` (Auto-Refreshed from Google)
**Purpose:** Data that comes from Google Places API, refreshed periodically
**Fields:**
- `google_rating`, `google_review_count`
- `google_phone`, `google_website`, `google_maps_url`
- `google_price_range`
- `opening_hours`, `photos`
- `google_types`, `features`, `editorial_summary`
- `synced_at`

**NOT editable** - auto-refreshed from Google

---

### Table 3: `place_overrides` (Manual Admin Edits)
**Purpose:** Admin edits that OVERRIDE Google data
**Editable Fields:**
- ✅ `name_override` (custom name instead of Google's)
- ✅ `address_override`
- ✅ `phone_override`
- ✅ `website_override`
- ✅ `rating_override`
- ✅ `price_range_override`
- ✅ `hours_override`
- ✅ `cuisine` (Thai, Japanese, Italian, etc.)
- ✅ `budget_range` (¥, ¥¥, ¥¥¥)
- ✅ `english_menu` (boolean)
- ✅ `accepts_cards` (boolean)
- ✅ `photo_urls` (manual photo URLs)
- ✅ `manual_photos` (boolean - protect from Google updates)
- ✅ `custom_fields` (JSONB for future extensions)

---

### Table 4: `place_local_knowledge` (Local Insights)
**Purpose:** Editorial content added by admins
**Editable Fields:**
- ✅ `tips` (array of helpful tips)
- ✅ `warnings` (array of warnings)
- ✅ `navigation_tips` (array of directions)
- ✅ `description_override` (custom description)
- ✅ `insider_notes` (staff recommendations)
- ✅ `features_verified` (JSONB - wifi, parking, etc.)

---

## The View: `places_with_merged_data`

**Purpose:** Combines all 4 tables with override precedence
**Logic:**
```sql
SELECT
  -- Core from places
  p.category,
  p.subcategory,
  p.status,
  p.visible_in_app,

  -- Merged with override precedence
  COALESCE(po.name_override, p.name) as name,
  COALESCE(po.phone_override, gd.google_phone) as phone,
  COALESCE(po.rating_override, gd.google_rating) as rating,

  -- From overrides
  po.cuisine,
  po.budget_range,
  po.english_menu,

  -- From local knowledge
  lk.tips,
  lk.warnings

FROM places p
LEFT JOIN place_google_data gd ON p.id = gd.place_id
LEFT JOIN place_overrides po ON p.id = po.place_id
LEFT JOIN place_local_knowledge lk ON p.id = lk.place_id
```

---

## What Dual-Write Currently Syncs

### ✅ Currently Working

**From places table:**
- `visible_in_app` ← Line 194-200

**From place_overrides table:**
- `name_override`, `address_override`, `phone_override`, `website_override`
- `rating_override`, `price_range_override`, `hours_override`
- `cuisine`, `budget_range`, `english_menu`, `accepts_cards`
- `photo_urls`, `manual_photos`, `custom_fields`
← Lines 203-258

### ❌ NOT Syncing (THE GAP)

**From places table:**
- `category` ← Missing!
- `subcategory` ← Missing! (Your current issue)
- `status` ← Missing!
- `name_local` ← Missing!

**From place_local_knowledge table:**
- `tips` ← Missing!
- `warnings` ← Missing!
- `navigation_tips` ← Missing!
- `description_override` ← Missing!
- `insider_notes` ← Missing!
- `features_verified` ← Missing!

---

## Complete List of Admin-Editable Fields

### Category: Core Classification
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| category | places | `.category` | ❌ No |
| subcategory | places | `.subcategory` or `.manual_overrides.subcategory` | ❌ No |
| status | places | `.status` or `.manual_overrides.status` | ❌ No |
| visible_in_app | places | `.visible_in_app` | ✅ Yes |

### Category: Identity
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| name_local | places | `.name_local` | ❌ No |
| name_override | place_overrides | `.name` (if different from Google) | ✅ Yes |
| address_override | place_overrides | `.address` | ✅ Yes |

### Category: Contact & Hours
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| phone_override | place_overrides | `.phone` | ✅ Yes |
| website_override | place_overrides | `.website` | ✅ Yes |
| hours_override | place_overrides | `.opening_hours` | ✅ Yes |

### Category: Rating & Pricing
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| rating_override | place_overrides | `.rating` | ✅ Yes |
| price_range_override | place_overrides | `.price_range` | ✅ Yes |
| budget_range | place_overrides | `.enhanced_data.budget` | ✅ Yes |

### Category: Restaurant Details
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| cuisine | place_overrides | `.enhanced_data.cuisine` | ✅ Yes |
| english_menu | place_overrides | `.enhanced_data.english_menu` | ✅ Yes |
| accepts_cards | place_overrides | `.enhanced_data.credit_cards` | ✅ Yes |

### Category: Photos
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| photo_urls | place_overrides | `.photos` | ✅ Yes |
| manual_photos | place_overrides | `.manual_photos` | ✅ Yes |

### Category: Local Knowledge
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| tips | place_local_knowledge | `.local_knowledge.tips` | ❌ No |
| warnings | place_local_knowledge | `.local_knowledge.warnings` | ❌ No |
| navigation_tips | place_local_knowledge | `.local_knowledge.navigation_tips` | ❌ No |
| description_override | place_local_knowledge | `.local_knowledge.description` | ❌ No |
| insider_notes | place_local_knowledge | `.local_knowledge.notes` | ❌ No |
| features_verified | place_local_knowledge | `.local_knowledge.verified_features` | ❌ No |

### Category: Custom Extensions
| Field | Table | JSON Path | Currently Syncing? |
|-------|-------|-----------|-------------------|
| custom_fields | place_overrides | (various) | ✅ Yes (as JSONB) |

---

## Recommended Architecture: Complete Dual-Write

### Phase 1: Fix Core Fields (Immediate)

Update `services/dual-write.js` to sync **all editable `places` fields**:

```javascript
// Update places table with editable core fields
await client.query(`
  UPDATE places
  SET
    category = $1,
    subcategory = $2,
    status = $3,
    name_local = $4,
    visible_in_app = $5,
    updated_at = NOW(),
    updated_by = $6
  WHERE id = $7
`, [
  place.category || 'restaurant',
  place.subcategory || place.manual_overrides?.subcategory || null,
  place.status || place.manual_overrides?.status || 'active',
  place.name_local || null,
  place.visible_in_app !== undefined ? place.visible_in_app : true,
  adminId,
  placeId
]);
```

### Phase 2: Add Local Knowledge Sync

Create upsert for `place_local_knowledge`:

```javascript
// Extract local knowledge from JSON
const localKnowledge = place.local_knowledge || {};
const tips = localKnowledge.tips || [];
const warnings = localKnowledge.warnings || [];
const navigationTips = localKnowledge.navigation_tips || null;
const description = localKnowledge.description || null;
const insiderNotes = localKnowledge.notes || null;
const featuresVerified = localKnowledge.verified_features || {};

// Upsert place_local_knowledge
await client.query(`
  INSERT INTO place_local_knowledge (
    place_id,
    language_code,
    tips,
    warnings,
    navigation_tips,
    description_override,
    insider_notes,
    features_verified,
    updated_by,
    updated_at
  ) VALUES ($1, 'en', $2, $3, $4, $5, $6, $7, $8, NOW())
  ON CONFLICT (place_id, language_code)
  DO UPDATE SET
    tips = EXCLUDED.tips,
    warnings = EXCLUDED.warnings,
    navigation_tips = EXCLUDED.navigation_tips,
    description_override = EXCLUDED.description_override,
    insider_notes = EXCLUDED.insider_notes,
    features_verified = EXCLUDED.features_verified,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
`, [
  placeId,
  tips.length > 0 ? tips : null,
  warnings.length > 0 ? warnings : null,
  navigationTips,
  description,
  insiderNotes,
  JSON.stringify(featuresVerified)
  adminId
]);
```

### Phase 3: Validation & Consistency Check

Add comprehensive validation:

```javascript
async function validateFieldSync(placeId, jsonPlace, pgPlace) {
  const issues = [];

  // Check core fields
  if (jsonPlace.subcategory !== pgPlace.subcategory) {
    issues.push({
      field: 'subcategory',
      json: jsonPlace.subcategory,
      postgres: pgPlace.subcategory
    });
  }

  if (jsonPlace.status !== pgPlace.status) {
    issues.push({
      field: 'status',
      json: jsonPlace.status,
      postgres: pgPlace.status
    });
  }

  // Check override fields
  if (jsonPlace.enhanced_data?.cuisine !== pgPlace.cuisine) {
    issues.push({
      field: 'cuisine',
      json: jsonPlace.enhanced_data.cuisine,
      postgres: pgPlace.cuisine
    });
  }

  return issues;
}
```

---

## Implementation Plan

### Step 1: Immediate Fix (Your Current Issue)
- Add `subcategory` and `status` to `places` table update in dual-write
- Test with Dori Dori subcategory change
- Verify both JSON and PostgreSQL update

### Step 2: Complete Core Fields
- Add `category`, `name_local` to sync
- Test with multiple places
- Verify consistency

### Step 3: Add Local Knowledge Sync
- Create `place_local_knowledge` upsert
- Sync tips, warnings, navigation tips
- Test with places that have local knowledge

### Step 4: Add Validation Endpoint
- Create `/api/admin/validate-sync` endpoint
- Compare JSON vs PostgreSQL for all fields
- Report discrepancies

### Step 5: Bulk Consistency Fix
- Create migration script to sync all existing data
- Run one-time to fix current inconsistencies
- Schedule periodic validation checks

---

## Future-Proofing: Adding New Editable Fields

**Process for adding a new editable field:**

1. **Add to database** (if not exists):
   ```sql
   ALTER TABLE places ADD COLUMN new_field VARCHAR(100);
   ```

2. **Add to dual-write service**:
   ```javascript
   // In writeToPostgreSQL function
   new_field = $X,
   ```

3. **Add to view** (if needed):
   ```sql
   DROP VIEW places_with_merged_data;
   CREATE VIEW places_with_merged_data AS
   SELECT ..., p.new_field, ...
   ```

4. **Update admin interface** to edit the field

5. **Test the sync** with validation endpoint

---

## Testing Checklist

- [ ] Change subcategory in admin → Verify in PostgreSQL
- [ ] Change status in admin → Verify in PostgreSQL
- [ ] Change category in admin → Verify in PostgreSQL
- [ ] Add local knowledge tips → Verify in PostgreSQL
- [ ] Toggle visible_in_app → Verify in PostgreSQL (already working)
- [ ] Update cuisine → Verify in PostgreSQL (already working)
- [ ] Check V2 API returns updated values
- [ ] Verify backup is created in JSON
- [ ] Test error handling (DB connection failure)
- [ ] Test transaction rollback on partial failure

---

## Summary: The Gap

**Currently syncing:** 12 of 26 editable fields (46%)
**Missing:** 14 critical fields (54%)

**Impact:**
- Admin makes changes in UI
- JSON saves correctly (source of truth)
- PostgreSQL doesn't update
- V2 API serves stale data
- Frontend shows old values
- Users see incorrect information

**Solution:**
Comprehensive dual-write that syncs ALL editable fields across ALL tables (`places`, `place_overrides`, `place_local_knowledge`).

---

**Priority:** HIGH
**Complexity:** Medium
**Estimated Effort:** 4-6 hours
**Risk:** Low (additive changes, no breaking changes)
