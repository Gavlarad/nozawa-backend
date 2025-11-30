# Frontend Migration Handoff - V2 API Integration

**Date**: December 1, 2025
**Backend Status**: ✅ Phase 3 Complete - PostgreSQL V2 API Ready
**Production URL**: `https://nozawa-backend-production.up.railway.app`

---

## Quick Summary

The backend has migrated from JSON files to PostgreSQL. A new V2 API is available and ready for frontend integration. All 97 places (79 restaurants, 14 onsens, 4 lifts) are syncing successfully with 0 errors.

**Your Task**: Update frontend to consume V2 PostgreSQL endpoints instead of V1 JSON endpoints.

---

## Current V1 Endpoints (JSON - Deprecated)

These still work but should be replaced:

```javascript
// OLD - JSON endpoints
GET /api/restaurants          // All restaurants from JSON
GET /api/places              // All places from JSON
GET /api/lifts/status        // Lift status
GET /api/weather/current     // Weather data
```

---

## New V2 Endpoints (PostgreSQL - Use These)

### 1. Get All Places (Paginated)

```javascript
GET /api/v2/places?limit=100&offset=0&category=restaurant&visible=true

// Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "external_id": "nozawa_fujiya",
      "google_place_id": "ChIJ...",
      "name": "Fujiya",
      "category": "restaurant",
      "subcategory": "Japanese",
      "visible_in_app": true,
      "location": {
        "lat": 36.923433,
        "lng": 138.4476483,
        "address": "123 Main St, Nozawa"
      },
      "rating": 4.5,
      "price_range": "¥¥",
      "phone": "+81-123-456-7890",
      "website": "https://example.com",
      "opening_hours": {
        "monday": "11:00-22:00",
        "tuesday": "11:00-22:00",
        // ...
      },
      "photos": ["url1.jpg", "url2.jpg"],
      "cuisine": "Japanese",
      "budget_range": "2000-4000",
      "english_menu": true,
      "accepts_cards": true,
      "custom_fields": {
        "reservations_required": false
      }
    }
    // ... more places
  ],
  "pagination": {
    "total": 79,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

**Query Parameters:**
- `limit` (default: 50, max: 100) - Number of results
- `offset` (default: 0) - Pagination offset
- `category` (optional) - Filter by: `restaurant`, `onsen`, `lift`
- `visible` (optional) - Filter by visibility: `true`/`false`

### 2. Get Single Place by ID

```javascript
GET /api/v2/places/1

// Response:
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Fujiya",
    // ... all place fields
  }
}
```

### 3. Get Places by Category

```javascript
GET /api/v2/places/category/restaurant?limit=100
GET /api/v2/places/category/onsen?limit=50
GET /api/v2/places/category/lift

// Same response format as /api/v2/places
```

### 4. Lift Status

```javascript
GET /api/v2/lifts

// Response:
{
  "success": true,
  "data": [
    {
      "id": 94,
      "name": "Nagasaka Gondola",
      "external_id": "nozawa_nagasaka_gondola",
      "category": "lift",
      "status": "operational",
      "last_scraped": "2025-12-01T10:30:00Z",
      "visible_in_app": true
    }
    // ... 3 more lifts
  ],
  "cached": true,
  "cache_time": "2025-12-01T10:30:00Z"
}
```

### 5. Weather Data

```javascript
GET /api/v2/weather

// Response:
{
  "success": true,
  "data": {
    "current": {
      "temperature": -2,
      "conditions": "Snowing",
      "wind_speed": 15,
      "snow_depth": 180
    },
    "forecast": [
      {
        "date": "2025-12-02",
        "high": 0,
        "low": -5,
        "conditions": "Cloudy",
        "snow_chance": 60
      }
      // ... more days
    ]
  },
  "cached": true,
  "cache_time": "2025-12-01T10:00:00Z"
}
```

### 6. Database Stats

```javascript
GET /api/v2/stats

// Response:
{
  "success": true,
  "stats": {
    "total_places": 97,
    "restaurants": 79,
    "onsens": 14,
    "lifts": 4,
    "visible_places": 95,
    "hidden_places": 2,
    "with_photos": 85,
    "with_hours": 72
  }
}
```

### 7. Health Check

```javascript
GET /api/v2/health

// Response:
{
  "status": "healthy",
  "database": "connected",
  "postgres_read_enabled": true,
  "dual_write_enabled": true,
  "timestamp": "2025-12-01T10:00:00Z"
}
```

---

## Migration Strategy

### Step 1: Create API Service Layer

Create a new API service that supports both V1 and V2 with feature flag:

```typescript
// services/api.service.ts
const USE_V2_API = true; // Feature flag

export class PlacesService {
  private baseUrl = 'https://nozawa-backend-production.up.railway.app';

  async getRestaurants(): Promise<Place[]> {
    if (USE_V2_API) {
      // New PostgreSQL endpoint
      const response = await fetch(
        `${this.baseUrl}/api/v2/places/category/restaurant?limit=100&visible=true`
      );
      const json = await response.json();
      return json.data; // V2 returns { success, data, pagination }
    } else {
      // Old JSON endpoint
      const response = await fetch(`${this.baseUrl}/api/restaurants`);
      return await response.json(); // V1 returns array directly
    }
  }

  async getOnsens(): Promise<Place[]> {
    if (USE_V2_API) {
      const response = await fetch(
        `${this.baseUrl}/api/v2/places/category/onsen?limit=50&visible=true`
      );
      const json = await response.json();
      return json.data;
    } else {
      // Old endpoint - filter from all places
      const response = await fetch(`${this.baseUrl}/api/places`);
      const places = await response.json();
      return places.filter(p => p.category === 'onsen');
    }
  }

  async getLifts(): Promise<Place[]> {
    if (USE_V2_API) {
      const response = await fetch(`${this.baseUrl}/api/v2/lifts`);
      const json = await response.json();
      return json.data;
    } else {
      const response = await fetch(`${this.baseUrl}/api/lifts/status`);
      return await response.json();
    }
  }

  async getPlaceById(id: number): Promise<Place> {
    // Only available in V2
    const response = await fetch(`${this.baseUrl}/api/v2/places/${id}`);
    const json = await response.json();
    return json.data;
  }
}
```

### Step 2: Update Data Models

V2 API uses consistent field names:

```typescript
// models/place.model.ts
export interface Place {
  id: number;                    // Database ID (NEW in V2)
  external_id?: string;          // Custom ID like "nozawa_fujiya"
  google_place_id?: string;      // Google Places ID
  name: string;
  category: 'restaurant' | 'onsen' | 'lift';
  subcategory?: string;
  visible_in_app: boolean;       // NEW: visibility toggle

  location: {
    lat: number;
    lng: number;
    address?: string;
  };

  // Restaurant-specific
  rating?: number;
  price_range?: string;          // "¥", "¥¥", "¥¥¥"
  phone?: string;
  website?: string;
  opening_hours?: Record<string, string>;
  photos?: string[];

  cuisine?: string;              // "Japanese", "Italian", etc.
  budget_range?: string;         // "2000-4000"
  english_menu?: boolean;
  accepts_cards?: boolean;

  custom_fields?: Record<string, any>;

  // Timestamps
  created_at?: string;
  updated_at?: string;
  last_verified?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  cached?: boolean;
  cache_time?: string;
}
```

### Step 3: Handle Pagination

V2 API supports pagination for large datasets:

```typescript
async getAllRestaurants(): Promise<Place[]> {
  const allPlaces: Place[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(
      `${this.baseUrl}/api/v2/places/category/restaurant?limit=${limit}&offset=${offset}&visible=true`
    );
    const json: ApiResponse<Place[]> = await response.json();

    allPlaces.push(...json.data);

    if (!json.pagination?.hasMore) {
      break;
    }

    offset += limit;
  }

  return allPlaces;
}
```

### Step 4: Error Handling

V2 API uses consistent error format:

```typescript
try {
  const response = await fetch(`${this.baseUrl}/api/v2/places/999999`);
  const json = await response.json();

  if (!json.success) {
    throw new Error(json.message || 'Failed to fetch place');
  }

  return json.data;
} catch (error) {
  console.error('API Error:', error);
  // Fallback or show error to user
}
```

---

## Key Differences: V1 vs V2

| Feature | V1 (JSON) | V2 (PostgreSQL) |
|---------|-----------|-----------------|
| Response format | Array directly | `{ success, data, pagination }` |
| Place ID | String (google_place_id) | Number (database id) |
| Pagination | No | Yes (`limit`, `offset`) |
| Visibility filter | No | Yes (`visible=true`) |
| Category filter | Manual filtering | Built-in (`category=restaurant`) |
| Single place lookup | No endpoint | `GET /api/v2/places/:id` |
| Caching info | No | `cached` and `cache_time` fields |
| visible_in_app | Not present | Boolean field (admin toggle) |

---

## Testing Checklist

Before deploying to production:

- [ ] Test restaurant list loads (`/api/v2/places/category/restaurant`)
- [ ] Test onsen list loads (`/api/v2/places/category/onsen`)
- [ ] Test lift status loads (`/api/v2/lifts`)
- [ ] Test single place detail view (`/api/v2/places/:id`)
- [ ] Test pagination with large datasets
- [ ] Test error handling (invalid IDs, network errors)
- [ ] Test with `visible=true` filter (should exclude hidden places)
- [ ] Verify all fields display correctly (photos, hours, etc.)
- [ ] Check performance (should be faster than JSON)

---

## Rollback Plan

If V2 API has issues, you can instantly rollback:

```typescript
// Set feature flag to false
const USE_V2_API = false;

// Frontend immediately uses V1 JSON endpoints
// No code changes needed, just flip the flag
```

V1 endpoints will remain available during transition period.

---

## Example: React Component Migration

**Before (V1):**
```typescript
// RestaurantList.tsx
useEffect(() => {
  fetch('https://nozawa-backend-production.up.railway.app/api/restaurants')
    .then(res => res.json())
    .then(restaurants => setRestaurants(restaurants));
}, []);
```

**After (V2):**
```typescript
// RestaurantList.tsx
useEffect(() => {
  fetch('https://nozawa-backend-production.up.railway.app/api/v2/places/category/restaurant?limit=100&visible=true')
    .then(res => res.json())
    .then(json => {
      if (json.success) {
        setRestaurants(json.data);
      }
    });
}, []);
```

---

## Production URLs

**Backend API**: `https://nozawa-backend-production.up.railway.app`

**Test Endpoints**:
```bash
# Health check
curl https://nozawa-backend-production.up.railway.app/api/v2/health

# Get restaurants
curl https://nozawa-backend-production.up.railway.app/api/v2/places/category/restaurant?limit=10

# Get stats
curl https://nozawa-backend-production.up.railway.app/api/v2/stats
```

---

## Current Data Snapshot

- **Total Places**: 97
  - Restaurants: 79
  - Onsens: 14
  - Lifts: 4
- **Visible Places**: 95 (2 currently hidden via admin panel)
- **All places have**: Database ID, name, category, location
- **Most places have**: Photos (85), opening hours (72), ratings

---

## Support & Documentation

Full backend docs available in repository:
- `docs/POSTGRESQL_API.md` - Complete V2 API reference
- `docs/FRONTEND_HANDOFF.md` - Detailed integration guide
- `PHASE3_README.md` - Current backend status

**Backend Status**: ✅ Production ready, monitoring daily

---

## Questions?

Common questions answered:

**Q: Is V2 API stable?**
A: Yes, all 97 places syncing with 0 errors. Running in production.

**Q: Do I need authentication?**
A: No, public endpoints are open. Only admin endpoints require JWT.

**Q: What about CORS?**
A: CORS is configured to allow all origins for public endpoints.

**Q: Performance?**
A: PostgreSQL is faster than JSON. Lifts/weather are cached (5min).

**Q: Can I filter by visibility?**
A: Yes, use `?visible=true` to only show places enabled in admin panel.

**Q: What if a place doesn't have certain fields?**
A: Optional fields may be `null`. Always check before displaying.

---

**Ready to start?** Begin with `/api/v2/health` to confirm backend connectivity, then migrate one component at a time (restaurants → onsens → lifts).

Good luck! 🚀
