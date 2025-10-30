# Annual Update Guide - Nozawa Onsen App

Complete workflow for refreshing restaurant data from Google Places API while preserving all manual edits made through the admin panel.

## When to Run

Run this process annually (typically September before ski season) to:
- Refresh restaurant hours, ratings, and reviews
- Update restaurant photos
- Check for permanently closed restaurants
- Add any new restaurants to Nozawa

## Prerequisites

- Google Places API key active
- Access to admin panel (admin.html)
- Node.js and scripts installed in `nozawa-backend/scripts/`

---

## Step-by-Step Workflow

### Step 1: Backup Current Data

**Always backup before making changes!**

1. Open `admin.html` in your browser
2. Click "📡 Load from Server" to get latest data
3. Click "📥 Download Backup"
4. Save as: `backups/nozawa_places_unified_YYYY-MM-DD.json`
```bash
cd nozawa-backend
git add backups/
git commit -m "Backup before 2026 annual update"
git push
```

---

### Step 2: Fetch Fresh Restaurant Data

Fetch latest data from Google Places API:
```bash
cd nozawa-backend/scripts
node fetchAllRestaurantData.js
```

**What happens:**
- Queries Google Places API for restaurants in Nozawa
- Downloads ratings, hours, photos, reviews
- Saves to `nozawa_restaurants_complete.json`

**Time:** ~10-15 minutes

---

### Step 3: Merge with Manual Edits

Combine fresh Google data with your manual edits:
```bash
node mergeWithManualEdits.js
```

**What gets preserved:**
- ✅ `visible_in_app` settings (hidden restaurants stay hidden)
- ✅ `manual_photos` for onsens
- ✅ `local_knowledge` (warnings, tips, navigation)
- ✅ `enhanced_data` manual edits
- ✅ `subcategory` classifications
- ✅ All onsens and lifts (100% unchanged)

**What gets updated:**
- ✅ Ratings and review counts from Google
- ✅ Hours and contact info
- ✅ Google photos (except manual_photos)
- ✅ Restaurant status (open/closed)

**Output:** `nozawa_places_unified_updated.json`

**Review the console output carefully!** It shows what was preserved.

---

### Step 4: Review Merged Data

**Before deploying, review the merged file:**
```bash
# Copy to main location
cp scripts/nozawa_places_unified_updated.json nozawa_places_unified.json

# Open admin panel
open admin.html
```

In the admin panel:
1. Click "📤 Upload JSON"
2. Select `nozawa_places_unified.json`
3. Check several restaurants:
   - Verify previously hidden items are still hidden
   - Check local knowledge preserved
   - Verify onsens show "📸 Manual" badge
4. Filter by "Hidden from App" to see all hidden items

**Look for issues:**
- Restaurants that should be hidden but aren't
- Lost warnings/tips
- Missing manual edits

---

### Step 5: Update Photos (Optional)

If you want to download fresh photos from Google:
```bash
cd scripts
node updatePhotos.js
```

**What happens:**
- Downloads new restaurant photos from Google
- **Skips onsens with `manual_photos: true`**
- Saves to `../downloaded_photos/`

**Time:** ~30-60 minutes (depending on how many changed)

**Note:** Photos marked with `manual_photos: true` are NEVER overwritten.

---

### Step 6: Deploy to Railway

Upload your reviewed and tested data to production:

1. Open `admin.html` in browser
2. Ensure you have the reviewed `nozawa_places_unified.json` loaded
3. Click "💾 Save to Server"
4. Confirm the backup creation
5. Verify "Live Server Data" badge appears

**Railway now has your updated data!**

The server automatically:
- Creates timestamped backup in `backups/` folder
- Overwrites live `nozawa_places_unified.json`
- Reloads data in memory

---

### Step 7: Commit to Git

Save your changes to version control:
```bash
cd nozawa-backend

# Add updated data file
git add nozawa_places_unified.json

# Add photos if they changed
git add downloaded_photos/

# Commit with descriptive message
git commit -m "Annual update 2026 - Refreshed restaurant data from Google API"
git push origin main
```

---

### Step 8: Update Mobile App (If Photos Changed)

Only needed if photos were updated in Step 5:
```bash
cd nozawa-test

# Copy photos to app assets
cp -r ../nozawa-backend/downloaded_photos/* assets/photos/

# Regenerate photo mapping
node scripts/generatePhotoMap.js

# Commit changes
git add assets/photos/ utils/photoMap.js
git commit -m "Update photos - annual 2026"
git push

# Build for TestFlight
eas build --platform ios
eas submit --platform ios
```

**Time:** 
- Build: ~20 minutes
- TestFlight processing: ~30-60 minutes

---

## Quick Reference

### Full Update (All Steps)
```bash
# 1. Backup first via admin panel!

# 2. Fetch and merge
cd nozawa-backend/scripts
node fetchAllRestaurantData.js        # ~10-15 min
node mergeWithManualEdits.js          # ~1 min

# 3. Optional: Update photos
node updatePhotos.js                  # ~30-60 min

# 4. Review in admin panel (manual step)

# 5. Upload via admin "Save to Server" (manual step)

# 6. Commit to Git
cd nozawa-backend
git add .
git commit -m "Annual update $(date +%Y)"
git push
```

---

## Protected Data (Never Overwritten)

The following fields are **NEVER** overwritten during annual updates:

### Admin-Controlled Settings
- `visible_in_app` - Hide/show toggle
- `manual_photos` - Photo protection flag
- `manual_overrides` - Tracks all manual edits

### Manual Content
- `local_knowledge.warnings` - Custom warnings
- `local_knowledge.notes` - Local tips
- `local_knowledge.navigation_tips` - Directions
- `local_knowledge.verified_features` - Checkboxes

### Manual Classifications
- `subcategory` - If manually changed from "Restaurant"
- `enhanced_data` - If cuisine/budget manually added

### Complete Categories
- **All onsens** - 100% preserved (no Google data)
- **All lifts** - 100% preserved (no Google data)

---

## Troubleshooting

### Lost Manual Edits

**Problem:** After annual update, some manual edits disappeared

**Solution:**
1. Check `nozawa-backend/backups/` for pre-update backup
2. Load backup in admin panel: "📤 Upload JSON"
3. Find the lost edits
4. Re-apply them
5. "💾 Save to Server"

### Photos Overwritten for Onsens

**Problem:** Onsen photos were replaced during update

**Solution:**
1. Open admin panel
2. Find affected onsens
3. Check "📸 Protect Photos from Annual Updates"
4. Re-add correct photo URLs
5. "💾 Save Changes" → "💾 Save to Server"

### Restaurant Not Showing

**Problem:** New restaurant isn't visible in app

**Check:**
1. `visible_in_app` is `true` (not `false`)
2. `category` is `"restaurant"` (not typo)
3. `status` is `"active"` (not `"closed_permanently"`)

### Version Conflicts Between Git and Railway

**Problem:** Git repo and Railway server have different data

**Solution - Railway is source of truth:**
1. Open admin panel
2. "📡 Load from Server"
3. "📥 Download Backup"
4. Replace local file
5. Commit to Git
```bash
cd nozawa-backend
cp ~/Downloads/nozawa_places_unified_*.json nozawa_places_unified.json
git add nozawa_places_unified.json
git commit -m "Sync Git with Railway server - $(date +%Y-%m-%d)"
git push
```

---

## Data Flow Diagram
```
Annual Update Flow:
┌─────────────────────────────────────────────────────────────┐
│  1. Google Places API (Fresh Data)                          │
│     ↓                                                        │
│  2. fetchAllRestaurantData.js                               │
│     → nozawa_restaurants_complete.json                      │
│     ↓                                                        │
│  3. mergeWithManualEdits.js                                 │
│     + nozawa_places_unified.json (Current with edits)       │
│     → nozawa_places_unified_updated.json                    │
│     ↓                                                        │
│  4. Review in Admin Panel                                   │
│     ↓                                                        │
│  5. Upload to Railway (Save to Server)                      │
│     → Creates backup automatically                          │
│     → Updates live data                                     │
│     ↓                                                        │
│  6. Download & Commit to Git                                │
└─────────────────────────────────────────────────────────────┘
```

---

## File Locations
```
nozawa-backend/
├── nozawa_places_unified.json          # LIVE DATA (main file)
├── admin.html                          # Admin interface
├── backups/                            # Auto-created by server
│   └── nozawa_places_unified_backup_*.json
├── downloaded_photos/                  # Restaurant photos
│   ├── restaurant_id_1/
│   ├── restaurant_id_2/
│   └── ...
└── scripts/
    ├── fetchAllRestaurantData.js       # Step 2: Fetch from Google
    ├── mergeWithManualEdits.js         # Step 3: Merge data
    ├── updatePhotos.js                 # Step 5: Download photos
    ├── nozawa_restaurants_complete.json  # Temp: Fresh Google data
    └── nozawa_places_unified_updated.json # Temp: Merged result
```

---

## Best Practices

### Before Annual Update
- ✅ Download backup via admin panel
- ✅ Commit current state to Git
- ✅ Note any recent manual edits

### During Annual Update
- ✅ Review merge script output carefully
- ✅ Test in admin panel before deploying
- ✅ Check hidden restaurants stayed hidden
- ✅ Verify onsen photos weren't replaced

### After Annual Update
- ✅ Download from Railway and commit to Git
- ✅ Test app on TestFlight
- ✅ Verify a few restaurants in the live app
- ✅ Keep backup for at least one season

### Weekly Maintenance
```bash
# Sync Git with any admin panel changes
# Download from admin → Commit to Git
git add nozawa_places_unified.json
git commit -m "Weekly sync - $(date +%Y-%m-%d)"
git push
```

---

## Support & Resources

**Admin Panel:** `nozawa-backend/admin.html`
**Server API:** `https://nozawa-backend-production.up.railway.app`
**Admin Key:** `nozawa2024`

**Key Concepts:**
- **visible_in_app:** Controls if place shows in mobile app
- **manual_photos:** Protects onsen photos from annual overwrites
- **manual_overrides:** Tracks which fields were manually edited
- **google_place_id:** Links restaurant to Google Places (never edit)

---

Last Updated: January 2025