# Frontend Handoff: V2 API New Data Fields

## Summary

The V2 PostgreSQL API now returns **review analysis data** and **manual photos flags** that were previously missing. These fields are now available across all V2 endpoints and ready for frontend integration.

---

## What's New

### 1. Review Analysis Data ✅

**Field:** `review_analysis`
**Type:** `object | null`
**Available in:** All places endpoints
**Coverage:** 79 restaurants have review data

#### Structure

```json
{
  "review_analysis": {
    "review_count": 5,
    "insights": {
      "mentions_english": false,
      "mentions_cash_only": false,
      "mentions_wait": false,
      "mentions_vegetarian": false,
      "recent_reviews": [
        {
          "rating": 5,
          "time": "5 months ago",
          "text_snippet": "We walked past this place and thought the smell coming from inside was amazing. We went in for dinner and it was incredible..."
        },
        {
          "rating": 5,
          "time": "a year ago",
          "text_snippet": "I have no idea why this location doesn't have a review yet. I have been here 4 times..."
        }
      ]
    }
  }
}
```

#### Use Cases

- **Display review snippets** from real Google reviews
- **Show quick insights** (e.g., "English spoken", "Cash only", "Long wait times")
- **Provide social proof** with recent customer experiences
- **Help users make decisions** based on real feedback

---

### 2. Manual Photos Flag ✅

**Field:** `manual_photos`
**Type:** `boolean`
**Available in:** All places endpoints
**Coverage:** 14 places (mostly onsens) have this flag set to `true`

#### Purpose

Indicates whether a place uses manually curated photos instead of Google Photos. When `true`, these photos are protected from automatic updates.

```json
{
  "manual_photos": true,
  "photos": [
    {
      "url": "https://custom-photos.example.com/onsen1.jpg"
    }
  ]
}
```

#### Use Cases

- **Display attribution correctly** (manual photos vs. Google photos)
- **Admin UI**: Show which places have protected photos
- **Photo refresh logic**: Skip auto-updates for manual photos

---

## API Endpoints

All V2 endpoints now return these fields:

### List All Places
```bash
GET /api/v2/places
GET /api/v2/places?category=restaurant
GET /api/v2/places?search=ramen&limit=10
```

### Get Single Place
```bash
GET /api/v2/places/:id
```

### Get by Category
```bash
GET /api/v2/places/category/restaurant
GET /api/v2/places/category/onsen
GET /api/v2/places/category/lift
```

---

## Example Responses

### Restaurant with Review Analysis

```bash
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/93'
```

```json
{
  "success": true,
  "data": {
    "id": 93,
    "name": "とんかつ あげ太郎 野沢温泉 Tonkatsu Agetaro nozawa",
    "category": "restaurant",
    "rating": "5.0",
    "review_count": 47,
    "photos": [
      {
        "url": "https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=...",
        "width": 2028,
        "height": 1521,
        "attributions": ["<a href=\"...\">ファイヤーマン</a>"]
      }
    ],
    "manual_photos": false,
    "review_analysis": {
      "review_count": 5,
      "insights": {
        "mentions_english": false,
        "mentions_cash_only": false,
        "mentions_wait": false,
        "mentions_vegetarian": false,
        "recent_reviews": [
          {
            "rating": 5,
            "time": "5 months ago",
            "text_snippet": "We walked past this place and thought the smell coming from inside was amazing..."
          }
        ]
      }
    }
  },
  "source": "postgresql"
}
```

### Onsen with Manual Photos

```bash
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/172'
```

```json
{
  "success": true,
  "data": {
    "id": 172,
    "name": "Oyu",
    "category": "onsen",
    "external_id": "nozawa_oyu",
    "manual_photos": true,
    "photos": [...],
    "review_analysis": null
  },
  "source": "postgresql"
}
```

---

## Frontend Implementation Guide

### 1. Display Review Snippets

```typescript
// Check if place has review analysis
if (place.review_analysis?.insights?.recent_reviews) {
  const reviews = place.review_analysis.insights.recent_reviews;

  // Display first review as a testimonial
  const topReview = reviews[0];

  return (
    <div className="review-snippet">
      <div className="rating">{"⭐".repeat(topReview.rating)}</div>
      <p className="review-text">"{topReview.text_snippet}"</p>
      <span className="review-time">{topReview.time}</span>
    </div>
  );
}
```

### 2. Show Review Insights as Tags

```typescript
// Display insight badges
const insights = place.review_analysis?.insights;

if (insights) {
  return (
    <div className="place-tags">
      {insights.mentions_english && <Tag>English Spoken</Tag>}
      {insights.mentions_cash_only && <Tag>Cash Only</Tag>}
      {insights.mentions_vegetarian && <Tag>Vegetarian Options</Tag>}
      {insights.mentions_wait && <Tag icon="⏱️">Expect Wait Times</Tag>}
    </div>
  );
}
```

### 3. Handle Manual Photos Flag

```typescript
// Show photo attribution
function PhotoAttribution({ place }) {
  if (place.manual_photos) {
    return <span>📸 Curated photos</span>;
  }
  return <span>Photos from Google</span>;
}
```

### 4. Fallback for Missing Data

```typescript
// Always check for null/undefined
const hasReviews = place.review_analysis?.insights?.recent_reviews?.length > 0;

if (!hasReviews) {
  // Show alternative content (e.g., description, rating only)
  return <PlaceDescription description={place.description_override} />;
}
```

---

## Data Coverage

### Review Analysis
- ✅ **79 restaurants** have review data
- ❌ **18 places** (onsens + lifts) have `review_analysis: null`
- 📊 Average 5 reviews per place

### Manual Photos
- ✅ **14 places** (mostly onsens) have `manual_photos: true`
- ✅ **83 places** use Google Photos (`manual_photos: false`)

### Photos
- ✅ **Most places** have 3 photos from Google
- ✅ **Onsens** have manually curated photos
- ⚠️ **Some places** may have 0 photos (handle gracefully)

---

## Testing Endpoints

### Test Review Data
```bash
# Restaurant with great reviews
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/93' | jq '.data.review_analysis'

# List all restaurants (all should have review_analysis)
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/category/restaurant?limit=5' | jq '.data[].review_analysis'
```

### Test Manual Photos Flag
```bash
# Onsen with manual photos (should be true)
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/172' | jq '.data.manual_photos'

# All onsens (14 should have manual_photos: true)
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/category/onsen' | jq '.data[] | {name, manual_photos}'
```

---

## Breaking Changes

### None! ✅

These are **additive changes only**. Existing V2 API responses remain unchanged except for these new fields:

- Old code will continue to work (new fields default to `null`)
- No changes to existing field names or structures
- No changes to endpoint URLs or parameters

---

## Migration from V1 to V2

### V1 Structure (JSON)
```javascript
// Old V1 format
place.enhanced_data.review_analysis.insights.recent_reviews
```

### V2 Structure (PostgreSQL)
```javascript
// New V2 format
place.review_analysis.insights.recent_reviews
```

**Key difference:** Review data is now **at the top level** instead of nested under `enhanced_data`.

---

## Next Steps for Frontend

1. **Update TypeScript types** to include new fields:
   ```typescript
   interface Place {
     // ... existing fields
     review_analysis?: {
       review_count: number;
       insights: {
         mentions_english: boolean;
         mentions_cash_only: boolean;
         mentions_wait: boolean;
         mentions_vegetarian: boolean;
         recent_reviews: Array<{
           rating: number;
           time: string;
           text_snippet: string;
         }>;
       };
     } | null;
     manual_photos: boolean;
   }
   ```

2. **Add UI components** for review snippets
   - Review card component
   - Insight tags/badges
   - Expandable review section

3. **Update place detail pages** to show reviews
   - Display 1-2 review snippets
   - Show insight badges
   - Link to Google Maps for full reviews

4. **Update restaurant list views**
   - Add review snippet preview
   - Show insight icons/tags
   - Use reviews for social proof

5. **Handle null cases gracefully**
   - Onsens and lifts have `review_analysis: null`
   - Some restaurants may have empty reviews array
   - Always check before rendering

---

## Questions or Issues?

- **Backend API docs:** Check `/api/v2/health` for feature flags
- **Data migration:** All 79 restaurants migrated successfully
- **Production ready:** All changes deployed and verified
- **Performance:** No impact (indexed JSONB column)

---

## Example UI Mockups

### Restaurant Card (List View)
```
┌─────────────────────────────────────┐
│ 🍜 Tonkatsu Agetaro                │
│ ⭐⭐⭐⭐⭐ 5.0 (47 reviews)          │
│                                     │
│ 💭 "The smell coming from inside   │
│     was amazing..."                 │
│     - 5 months ago                  │
│                                     │
│ 📸 [Photo] [Photo] [Photo]         │
└─────────────────────────────────────┘
```

### Restaurant Detail Page
```
┌─────────────────────────────────────┐
│ とんかつ あげ太郎                    │
│ Tonkatsu Agetaro Nozawa             │
│                                     │
│ ⭐⭐⭐⭐⭐ 5.0 (47 reviews)          │
│                                     │
│ 📷 [Photo Gallery - Google Photos] │
│                                     │
│ 💬 Recent Reviews                   │
│ ────────────────────────────────   │
│ ⭐⭐⭐⭐⭐ "We walked past this       │
│ place and thought the smell was    │
│ amazing. We went in for dinner..." │
│ - 5 months ago                      │
│                                     │
│ ⭐⭐⭐⭐⭐ "I have no idea why this   │
│ location doesn't have a review..." │
│ - a year ago                        │
│                                     │
│ [See all reviews on Google Maps →] │
└─────────────────────────────────────┘
```

---

**Status:** ✅ Ready for frontend integration
**Deployed:** Production (https://nozawa-backend-production.up.railway.app)
**Feature Flag:** `ENABLE_POSTGRES_READ=true`
**Last Updated:** 2025-12-01
