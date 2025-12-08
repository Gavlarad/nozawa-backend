# Annual Update Guide - Nozawa Onsen App

Complete workflow for refreshing restaurant data from Google Places API while preserving all manual edits.

**Updated December 2025** - Now uses PostgreSQL-native workflow (no JSON files required)

---

## Claude Code Prompt

Copy and paste this to have Claude run the annual update:

```
Run the annual Google Places refresh for Nozawa restaurants.
Reference: ANNUAL_UPDATE_GUIDE.md in nozawa-backend

1. First do a dry run with --include-new to preview
2. Show me the results and ask before running live
3. Add any new places I approve
4. Skip closed places unless I say otherwise
```

---

## When to Run

Run this process annually (typically September before ski season) to:
- Refresh restaurant hours, ratings, and reviews
- Update restaurant photos from Google
- Update review snippets and insights (English menu, cash only, wait times, vegetarian)
- Check for permanently closed restaurants
- Discover new restaurants in Nozawa

## Prerequisites

- Google Places API key active (set in `.env` as `GOOGLE_PLACES_API_KEY`)
- PostgreSQL database access (Railway)
- Node.js installed locally
- Access to admin panel (admin.html)

---

## Quick Reference (TL;DR)

```bash
# 1. Refresh Google data (database)
cd nozawa-backend/scripts
node refreshGoogleDataPostgres.js --dry-run --include-new  # Preview
node refreshGoogleDataPostgres.js                           # Run live

# 2. Download photos for offline bundle
node downloadPhotosForBundle.js --dry-run                   # Preview
node downloadPhotosForBundle.js                             # Download

# 3. Regenerate photo map (in app directory)
cd ../../nozawa-test/scripts
node generatePhotoMap.js                                    # Rebuild map

# 4. Commit and push app update
```

---

## Step-by-Step Workflow

### Step 1: Preview Changes (Dry Run)

Always preview what will happen before making changes:

```bash
cd nozawa-backend/scripts
node refreshGoogleDataPostgres.js --dry-run --include-new
```

**What this shows:**
- Which restaurants will be updated
- New places found in Google (not yet in database)
- Places that may have closed (in DB but not found in Google)
- Estimated API cost

**Review the output carefully!**

---

### Step 2: Run the Google Refresh

Once satisfied with the dry run, execute the actual update:

```bash
node refreshGoogleDataPostgres.js
```

**What happens:**
- Fetches fresh data from Google Places API
- Updates `place_google_data` table ONLY
- **NEVER touches** `place_overrides` or `place_local_knowledge`
- Creates a JSON report in `scripts/google_refresh_report_YYYY-MM-DD.json`

**Time:** ~10-15 minutes (depending on restaurant count)

---

### Step 3: Review New Places (Optional)

If the refresh found new restaurants:

```bash
# Check the report
cat scripts/google_refresh_report_*.json | grep -A5 "newPlaces"

# Add a new place by its Google Place ID
node addNewPlaceFromGoogle.js ChIJ2T5hZ9DXGGAR0tKRWL8JqeI
```

After adding, use the admin panel to:
1. Set visibility (show/hide)
2. Add local knowledge (tips, warnings)
3. Set subcategory (Izakaya, Ramen, etc.)

---

### Step 4: Review Potentially Closed Places

The refresh report lists places in the database but not found in Google:

```bash
cat scripts/google_refresh_report_*.json | grep -A10 "potentiallyClosed"
```

**For each place, decide:**
- Mark as `closed_permanently` in admin panel, OR
- Keep if it's a known local spot not on Google

---

### Step 5: Download Photos for Offline Bundle

Download Google photos (and any manual photos) into the app's assets folder:

```bash
cd nozawa-backend/scripts

# Preview what will be downloaded
node downloadPhotosForBundle.js --dry-run

# Download photos (first 4 per restaurant)
node downloadPhotosForBundle.js
```

**What happens:**
- Checks each restaurant for photo sources
- If `manual_photos = true`: downloads only manual photo URLs
- If has `photo_urls` in overrides: downloads manual first, fills with Google
- Otherwise: downloads first 4 Google photos
- Skips places that already have bundled photos
- Saves to `nozawa-test/assets/photos/<place_name>/`

**Options:**
```bash
--dry-run                    # Preview only, no downloads
--output /path/to/photos     # Custom output directory
--place-id ChIJxxxxx         # Download for single place only
--clean                      # Remove folders for deleted places
```

---

### Step 6: Regenerate Photo Map

After downloading photos, regenerate the mapping file:

```bash
cd nozawa-test/scripts
node generatePhotoMap.js
```

**What happens:**
- Scans `assets/photos/` directory
- Matches folders to place IDs from PostgreSQL
- Generates `utils/photoMap.js` with `require()` statements
- Reports any unmapped folders (need manual cleanup)

---

### Step 7: Verify and Push App Update

1. Open admin.html and spot check restaurants
2. Test the app locally to verify photos load
3. Commit changes:
   ```bash
   cd nozawa-test
   git add assets/photos utils/photoMap.js
   git commit -m "Annual photo refresh"
   git push
   ```
4. Build and submit app update

---

## Photo Management

### Adding Manual Photos (Staging for Bundle)

To add your own photos that will be bundled for offline use:

**1. Upload photo to a hosting service:**
- [Imgur](https://imgur.com) - free, no account needed
- [Cloudinary](https://cloudinary.com) - free tier, good for images
- Any URL that returns a direct image

**2. Add URL to admin panel:**
1. Open admin.html
2. Find the restaurant
3. In the Photos section, add the image URL to `photo_urls`
4. Save changes

**3. Photos are staged until next bundle:**
- The URL is stored in `place_overrides.photo_urls`
- Your manual photos will appear FIRST in the app (before Google photos)
- On next annual refresh, `downloadPhotosForBundle.js` will download these URLs
- They get bundled into the app for offline use

**Note:** Until the next app update, manual photos display via URL (requires internet). After bundling, they work offline.

---

### How Photos Work

The system supports three photo modes:

| Mode | `manual_photos` | `photo_urls` | Result |
|------|-----------------|--------------|--------|
| **Google Only** | `false` | empty | Only Google photos shown |
| **Manual + Google** | `false` | has URLs | Manual photos FIRST, then Google |
| **Manual Only** | `true` | has URLs | ONLY manual photos (protected) |

### Adding Manual Photos

To add curated/manual photos that appear FIRST (before Google photos):

1. Open place in admin panel
2. Add photo URLs to the photo list
3. Leave "Protect Photos from Annual Updates" **unchecked**
4. Save changes

Your manual photos will appear first, followed by Google photos.

### Protecting Photos (Onsens)

For onsens and places where you want ONLY manual photos (no Google):

1. Open place in admin panel
2. Check "Protect Photos from Annual Updates"
3. Add your photo URLs
4. Save changes

Google refresh will **never** touch these photos.

---

## What Gets Updated vs Protected

### Updated by Google Refresh (place_google_data)

| Field | Description |
|-------|-------------|
| `google_rating` | Star rating from Google |
| `google_review_count` | Number of reviews |
| `google_price_range` | Price level (¥, ¥¥, etc.) |
| `google_phone` | Phone number |
| `google_website` | Website URL |
| `opening_hours` | Business hours |
| `photos` | Photo URLs from Google |
| `google_types` | Categories from Google |
| `editorial_summary` | Google's description |
| `features` | Takeout, delivery, etc. |

### Updated by Google Refresh (places.review_analysis)

| Field | Description |
|-------|-------------|
| `review_count` | Number of reviews analyzed |
| `insights.mentions_english` | Reviews mention English menu/speakers |
| `insights.mentions_cash_only` | Reviews mention cash-only policy |
| `insights.mentions_wait` | Reviews mention queues/busy times |
| `insights.mentions_vegetarian` | Reviews mention vegetarian options |
| `insights.recent_reviews` | Up to 5 review snippets with rating, time, text |

### NEVER Touched (place_overrides)

| Field | Description |
|-------|-------------|
| `name_override` | Custom name |
| `rating_override` | Manual rating |
| `phone_override` | Custom phone |
| `hours_override` | Custom hours |
| `cuisine` | Cuisine type |
| `budget_range` | Price range text |
| `english_menu` | English menu available |
| `accepts_cards` | Credit cards accepted |
| `photo_urls` | Manual photo URLs |
| `manual_photos` | Photo protection flag |

### NEVER Touched (place_local_knowledge)

| Field | Description |
|-------|-------------|
| `tips` | Local tips array |
| `warnings` | Warnings array |
| `navigation_tips` | How to find it |
| `description_override` | Custom description |
| `insider_notes` | Staff notes |
| `features_verified` | Verified features |

### NEVER Touched (places core)

| Field | Description |
|-------|-------------|
| `visible_in_app` | Show/hide in app |
| `category` | restaurant/onsen/lift |
| `subcategory` | Cuisine type |
| `status` | active/closed |
| `latitude/longitude` | Coordinates |

---

## Data Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GOOGLE REFRESH                          │
│  (runs annually via refreshGoogleDataPostgres.js)          │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────┐              │
│  │           place_google_data              │ ← SAFE TO    │
│  │  rating, hours, photos, google_types     │   OVERWRITE  │
│  └──────────────────────────────────────────┘              │
│                                                             │
│  ┌──────────────────────────────────────────┐              │
│  │      place_overrides + place_local_      │ ← NEVER      │
│  │  knowledge (tips, warnings, cuisine...)  │   TOUCHED    │
│  └──────────────────────────────────────────┘              │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────┐              │
│  │        places_with_merged_data           │ ← VIEW       │
│  │    (override > google > base)            │   AUTO-MERGE │
│  └──────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘

Photo Merge Logic (in view):
┌─────────────────────────────────────────────────────────────┐
│  manual_photos = true?                                      │
│    → Only show place_overrides.photo_urls                  │
│                                                             │
│  Has manual photo_urls but not protected?                   │
│    → Show manual photos FIRST, then Google photos          │
│                                                             │
│  No manual photos?                                          │
│    → Only show Google photos                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Scripts Reference

### refreshGoogleDataPostgres.js

Main refresh script - updates `place_google_data` table.

```bash
# Dry run (preview only)
node refreshGoogleDataPostgres.js --dry-run

# Dry run with new place discovery
node refreshGoogleDataPostgres.js --dry-run --include-new

# Live update
node refreshGoogleDataPostgres.js

# Live update with discovery report
node refreshGoogleDataPostgres.js --include-new
```

### addNewPlaceFromGoogle.js

Add a new restaurant from Google Place ID.

```bash
node addNewPlaceFromGoogle.js ChIJ2T5hZ9DXGGAR0tKRWL8JqeI
```

Creates entries in:
- `places` (core info)
- `place_google_data` (Google data)

You then add local knowledge via admin panel.

### downloadPhotosForBundle.js

Download photos from Google (and manual URLs) into app's assets folder for offline use.

```bash
# Preview what will be downloaded
node downloadPhotosForBundle.js --dry-run

# Download all photos
node downloadPhotosForBundle.js

# Download for a single place
node downloadPhotosForBundle.js --place-id ChIJxxxxx

# Clean up orphaned folders
node downloadPhotosForBundle.js --clean
```

Respects `manual_photos` flag:
- `true`: Only downloads from `photo_urls` (protected)
- `false` + has `photo_urls`: Manual first, then fill with Google
- No manual photos: Downloads first 4 Google photos

### generatePhotoMap.js (in nozawa-test/scripts)

Regenerate the photo mapping file after downloading new photos.

```bash
cd nozawa-test/scripts
node generatePhotoMap.js
```

- Scans `assets/photos/` directory
- Queries PostgreSQL for place IDs
- Generates `utils/photoMap.js`

---

## Troubleshooting

### "Place not found" during refresh

The restaurant may have a different Google Place ID than what's in the database.

**Solution:**
1. Search for the restaurant on Google Maps
2. Get the new Place ID from the URL
3. Update the `google_place_id` in the database

### Photos not updating

Check if `manual_photos = true` for that place.

**Solution:**
1. Open in admin panel
2. Uncheck "Protect Photos from Annual Updates"
3. Save and refresh

### New restaurant not appearing in app

Check:
1. `visible_in_app = true`
2. `status = 'active'`
3. `category = 'restaurant'`

### API costs higher than expected

The script shows estimated cost at the end. If too high:
- Run less frequently
- Use `--dry-run` to preview without API calls
- Consider reducing `MAX_PHOTOS` in config

---

## File Locations

```
nozawa-backend/
├── scripts/
│   ├── refreshGoogleDataPostgres.js    # Refresh Google data in DB
│   ├── downloadPhotosForBundle.js      # Download photos for offline
│   ├── addNewPlaceFromGoogle.js        # Add new places
│   └── google_refresh_report_*.json    # Generated reports
├── migrations/
│   └── 018_update_photo_merge_logic.sql  # Photo merge view
├── admin.html                           # Admin interface
└── .env                                 # API keys (GOOGLE_PLACES_API_KEY)

nozawa-test/
├── scripts/
│   └── generatePhotoMap.js             # Regenerate photo mapping
├── assets/photos/                       # Bundled photos (offline)
│   ├── <restaurant_name>/              # Folder per place
│   └── nozawa_<onsen>/                 # Onsen folders
└── utils/
    └── photoMap.js                      # Auto-generated photo mapping
```

---

## Migration from JSON Workflow

If you were using the old JSON-based workflow (`fetchAllRestaurantData.js` + `mergeWithManualEdits.js`), here's how to migrate:

1. **Stop using JSON files** - PostgreSQL is now the source of truth
2. **Use new script** - `refreshGoogleDataPostgres.js` instead
3. **Admin panel still works** - It reads from/writes to PostgreSQL

The old scripts still exist for reference but are deprecated.

---

## Best Practices

### Before Annual Update
- Run `--dry-run` first
- Note current restaurant count for comparison
- Check Google API quota/billing

### During Annual Update
- Monitor the script output for errors
- Review the generated report
- Add any new restaurants you want to include

### After Annual Update
- Spot check a few restaurants in admin panel
- Test the app to verify data displays correctly
- Keep the report JSON for reference

---

Last Updated: December 2025
