# Accommodation Toggle Bug Fix - Summary

## ✅ Implementation Complete

**Date:** December 1, 2025
**Deployed to:** Railway Production
**Commit:** `5839bae`

---

## What Was Broken

When a user toggled "Display my accommodation to group" to **OFF**, their accommodation marker **reverted to a PREVIOUS accommodation** instead of simply hiding their CURRENT accommodation.

### Example Bug Scenario:

1. Dave 2 at **Nozawa House** with display ON
   - ✅ Shows correctly at Nozawa House

2. Dave 2 changes to **Pension Schnee** with display ON
   - ✅ Shows correctly at Pension Schnee
   - ✅ Removed from Nozawa House

3. Dave 2 toggles display to **OFF**
   - ❌ BUG: Reappears at **Nozawa House** (old accommodation)
   - ✅ Correctly hidden from Pension Schnee

**Root Cause:**
The backend was setting accommodation fields to `null` when `share === false`, which caused the query to fall back to old check-in records with non-null accommodation data.

---

## The Fix

### Before (Buggy Code):
```javascript
// Lines 640-664 (old)
const shouldShare = share === true;
const accommodationCoordsStr = (shouldShare && accommodationCoords)
  ? JSON.stringify(accommodationCoords)
  : null; // ❌ Sets to null when share=false

const result = await pool.query(
  `UPDATE checkin_new SET ...`,
  [
    shouldShare ? accommodationPlaceId : null,  // ❌ Sets to null when share=false
    accommodationCoordsStr,
    shouldShare ? accommodationName : null,      // ❌ Sets to null when share=false
    shouldShare,
    code,
    deviceId
  ]
);
```

### After (Fixed Code):
```javascript
// Lines 640-691 (new)
// Get the user's MOST RECENT active check-in
const currentCheckIn = await pool.query(
  `SELECT id FROM checkin_new
   WHERE group_code = $1 AND device_id = $2 AND is_active = true
   ORDER BY checked_in_at DESC LIMIT 1`,
  [code, deviceId]
);

// ALWAYS update accommodation data regardless of share value
const shouldShare = share === true;
const accommodationCoordsStr = accommodationCoords
  ? JSON.stringify(accommodationCoords)
  : null; // ✅ Only null if coords not provided

// Update ONLY the most recent active check-in
const result = await pool.query(
  `UPDATE checkin_new SET ... WHERE id = $5`,
  [
    accommodationPlaceId,        // ✅ Always update
    accommodationCoordsStr,      // ✅ Always update
    accommodationName,           // ✅ Always update
    shouldShare,                 // Only this controls visibility
    currentCheckIn.rows[0].id    // ✅ Target specific check-in by ID
  ]
);

// Deactivate any other active check-ins (prevents stale data)
await pool.query(
  `UPDATE checkin_new SET is_active = false
   WHERE group_code = $1 AND device_id = $2
     AND id != $3 AND is_active = true`,
  [code, deviceId, currentCheckIn.rows[0].id]
);
```

---

## Key Changes

1. **✅ Find MOST RECENT active check-in first**
   - Uses `ORDER BY checked_in_at DESC LIMIT 1`
   - Updates by specific `id`, not by subquery

2. **✅ ALWAYS update accommodation data**
   - Accommodation fields updated regardless of `share` value
   - `share` flag **only controls VISIBILITY**, not data

3. **✅ Deactivate stale check-ins**
   - Any other active check-ins for same user/group are deactivated
   - Prevents old data from being displayed

4. **✅ Better logging**
   - Shows accommodation name and sharing status in logs

---

## Testing

### Test Scenario (Dave 2 Example):

```bash
# Step 1: Set accommodation to Pension Schnee with display ON
curl -X PUT https://nozawa-backend-production.up.railway.app/api/groups/723831/members/device-dave2/accommodation \
  -H "Content-Type: application/json" \
  -d '{
    "share": true,
    "accommodationPlaceId": "ChIJ_PensionSchnee",
    "accommodationCoords": [138.xxx, 36.xxx],
    "accommodationName": "Pension Schnee"
  }'
# ✅ Expected: Dave 2 appears at Pension Schnee

# Step 2: Toggle display OFF
curl -X PUT https://nozawa-backend-production.up.railway.app/api/groups/723831/members/device-dave2/accommodation \
  -H "Content-Type: application/json" \
  -d '{
    "share": false,
    "accommodationPlaceId": "ChIJ_PensionSchnee",
    "accommodationCoords": [138.xxx, 36.xxx],
    "accommodationName": "Pension Schnee"
  }'
# ✅ Expected: Dave 2 disappears from ALL accommodations
# ✅ Database still has Pension Schnee data (not reverted to Nozawa House)

# Step 3: Toggle display back ON
curl -X PUT https://nozawa-backend-production.up.railway.app/api/groups/723831/members/device-dave2/accommodation \
  -H "Content-Type: application/json" \
  -d '{
    "share": true,
    "accommodationPlaceId": "ChIJ_PensionSchnee",
    "accommodationCoords": [138.xxx, 36.xxx],
    "accommodationName": "Pension Schnee"
  }'
# ✅ Expected: Dave 2 reappears at Pension Schnee (NOT at old Nozawa House)
```

### Verification Query:
```sql
-- Check Dave 2's accommodation data in database
SELECT id, group_code, device_id, accommodation_name,
       display_accommodation_to_group, is_active, checked_in_at
FROM checkin_new
WHERE group_code = '723831'
  AND device_id = 'device-1764410167732-r8ewpsx'
  AND is_active = true
ORDER BY checked_in_at DESC;

-- Expected: 1 row with accommodation_name='Pension Schnee' regardless of display value
```

---

## Response Changes

### New Response Format:
```json
{
  "success": true,
  "updated": { /* check-in record */ },
  "checkInId": 12345  // ID of the updated check-in
}
```

---

## What This Fixes

- ✅ Accommodation data no longer reverts to old values when toggling OFF
- ✅ Only ONE active check-in per user per group (stale check-ins deactivated)
- ✅ Accommodation counts now accurate when users toggle visibility
- ✅ Users appear at CURRENT accommodation when toggling back ON
- ✅ No more "ghost" markers at old accommodations

---

## Database Impact

**Table:** `checkin_new`

**Updated Fields (always updated now):**
- `accommodation_place_id` - Current accommodation Google Place ID
- `accommodation_coords` - Current accommodation coordinates
- `accommodation_name` - Current accommodation name
- `display_accommodation_to_group` - Visibility flag (true/false)

**Additional Cleanup:**
- Old active check-ins for same user/group set to `is_active = false`

---

## Next Steps

1. **Test in your app:**
   - Set accommodation with display ON
   - Change to different accommodation
   - Toggle display OFF → should disappear completely
   - Toggle display ON → should reappear at CURRENT accommodation

2. **Verify counts:**
   - Check accommodation marker counts on map
   - Should not include users with `display = false`

3. **Monitor logs:**
   - Look for: `Accommodation updated: {deviceId} in group {code} - {name} (sharing: true/false)`

---

## Files Modified

- `server.js` (lines 623-697) - Complete rewrite of accommodation update endpoint

---

**Status:** ✅ **DEPLOYED AND READY FOR TESTING**

Test the toggle in your app - it should now work correctly!
