# PostgreSQL API Documentation (V2)

## Overview

The V2 API provides PostgreSQL-backed endpoints for querying places data. These endpoints use the `places_with_merged_data` view which intelligently combines data from Google Places API, admin overrides, and local knowledge.

**Version:** 2.0
**Base Path:** `/api/v2`
**Feature Flag:** `ENABLE_POSTGRES_READ=true` (required)

## Architecture

### Data Merging Strategy

The `places_with_merged_data` view merges data with the following precedence:

1. **Admin Overrides** (highest priority)
   - Manual edits from admin panel
   - Custom fields (cuisine, budget_range, english_menu)
   - Protected photo URLs

2. **Local Knowledge**
   - Tips and warnings
   - Navigation instructions
   - Insider notes

3. **Google Places Data** (lowest priority)
   - Ratings and reviews
   - Opening hours
   - Photos and features

### Database Statistics

Current data (as of migration):
- **97 total places** across Nozawa Onsen
- **79 restaurants** with diverse cuisines
- **14 onsens** (public hot springs)
- **4 lifts** (ski infrastructure)
- **97 places** with admin overrides
- **93 places** with local knowledge
- **79 places** with Google data

---

## Endpoints

### 1. Health Check

Check PostgreSQL connection and feature flags.

```http
GET /api/v2/health
```

**Response:**
```json
{
  "success": true,
  "database": "connected",
  "serverTime": "2025-11-29T04:56:19.084Z",
  "postgresVersion": "PostgreSQL 17.6 ...",
  "featureFlags": {
    "postgresRead": true,
    "dualWrite": false
  }
}
```

**Use Cases:**
- Monitoring database connectivity
- Checking feature flag status
- Health checks for deployment

---

### 2. Get Statistics

Get comprehensive statistics about the database.

```http
GET /api/v2/stats?resort_id=1
```

**Query Parameters:**
- `resort_id` (optional): Resort ID to filter by (default: 1)

**Response:**
```json
{
  "success": true,
  "resort_id": 1,
  "stats": {
    "total": 97,
    "byCategory": {
      "restaurants": 79,
      "onsens": 14,
      "lifts": 4
    },
    "visibility": {
      "visible": 97,
      "hidden": 0
    },
    "dataQuality": {
      "withOverrides": 97,
      "withLocalKnowledge": 93,
      "withGoogleData": 79
    },
    "metrics": {
      "averageRating": "4.34",
      "lastUpdated": "2025-11-28T15:06:22.366Z"
    }
  },
  "source": "postgresql"
}
```

**Use Cases:**
- Admin dashboard statistics
- Data quality monitoring
- Analytics and reporting

---

### 3. List All Places

Get a paginated list of places with filtering and sorting.

```http
GET /api/v2/places
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `resort_id` | integer | 1 | Filter by resort |
| `category` | string | - | Filter by category (restaurant, onsen, lift) |
| `visible` | boolean | - | Filter by visibility |
| `search` | string | - | Search by name (case-insensitive) |
| `limit` | integer | 100 | Max results (max: 500) |
| `offset` | integer | 0 | Pagination offset |
| `sort` | string | name | Sort field (name, rating, category, created_at, updated_at) |
| `order` | string | asc | Sort order (asc, desc) |

**Examples:**

```bash
# Get all restaurants
GET /api/v2/places?category=restaurant

# Search for places with "fuji" in the name
GET /api/v2/places?search=fuji

# Get top-rated places
GET /api/v2/places?sort=rating&order=desc&limit=10

# Paginated results (page 2, 20 per page)
GET /api/v2/places?limit=20&offset=20
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 96,
      "resort_id": 1,
      "external_id": "ChIJx7AFYQAF9l8Rl5-Jao7R78I",
      "category": "restaurant",
      "subcategory": "Bar",
      "status": "active",
      "visible_in_app": true,
      "data_source": "google",
      "google_place_id": "ChIJx7AFYQAF9l8Rl5-Jao7R78I",
      "name": "AM*NESIA",
      "name_local": null,
      "latitude": "36.9228238",
      "longitude": "138.4473255",
      "address": "9516-2 Toyosato, Nozawaonsen, ...",
      "rating": "5.0",
      "review_count": 1,
      "phone": null,
      "website": null,
      "price_range": "¥¥",
      "opening_hours": null,
      "photos": [],
      "cuisine": null,
      "budget_range": null,
      "english_menu": null,
      "accepts_cards": null,
      "tips": null,
      "warnings": [],
      "navigation_tips": null,
      "description_override": null,
      "google_types": ["bar", "establishment", "point_of_interest"],
      "editorial_summary": null,
      "google_features": {
        "dine_in": true,
        "takeout": false,
        "delivery": false,
        "serves_beer": true
      },
      "google_maps_url": "https://maps.google.com/?cid=...",
      "has_overrides": true,
      "has_local_knowledge": true,
      "has_google_data": true,
      "created_at": "2025-11-28T15:04:20.450Z",
      "updated_at": "2025-11-28T15:04:20.450Z"
    }
  ],
  "pagination": {
    "total": 97,
    "limit": 100,
    "offset": 0,
    "page": 1,
    "totalPages": 1,
    "hasMore": false
  },
  "filters": {
    "resort_id": 1,
    "category": "all",
    "visible": "all",
    "search": null
  },
  "source": "postgresql"
}
```

**Use Cases:**
- Main app listing page
- Filtered searches
- Map marker data
- Admin data management

---

### 4. Get Single Place

Get detailed information about a specific place.

```http
GET /api/v2/places/:id
```

**Path Parameters:**
- `id` (required): Place ID (integer)

**Query Parameters:**
- `resort_id` (optional): Resort ID for validation (default: 1)

**Examples:**
```bash
GET /api/v2/places/96
GET /api/v2/places/175?resort_id=1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 96,
    "resort_id": 1,
    "name": "AM*NESIA",
    "category": "restaurant",
    "rating": "5.0",
    "review_count": 1,
    "photos": [],
    "opening_hours": null,
    "tips": null,
    "warnings": [],
    "has_overrides": true,
    "has_local_knowledge": true,
    "has_google_data": true,
    "last_google_sync_date": "2025-11-28T15:04:20.450Z",
    "last_manual_edit": "2025-11-28T15:04:20.450Z",
    "last_edited_by": 1
  },
  "source": "postgresql"
}
```

**Error Responses:**

```json
// 400 Bad Request - Invalid ID
{
  "error": "Invalid place ID",
  "message": "Place ID must be a valid integer"
}

// 404 Not Found
{
  "error": "Place not found",
  "message": "No place found with ID 999 for resort 1"
}
```

**Use Cases:**
- Place detail page
- Deep linking from map
- Editing in admin panel

---

### 5. Get Places by Category

Get all places in a specific category.

```http
GET /api/v2/places/category/:category
```

**Path Parameters:**
- `category` (required): restaurant, onsen, or lift

**Query Parameters:**
- `resort_id` (optional): Filter by resort (default: 1)
- `visible` (optional): Filter by visibility (default: true)

**Examples:**
```bash
GET /api/v2/places/category/restaurant
GET /api/v2/places/category/onsen
GET /api/v2/places/category/lift
```

**Response:**
```json
{
  "success": true,
  "category": "restaurant",
  "count": 79,
  "data": [
    {
      "id": 96,
      "name": "AM*NESIA",
      "name_local": null,
      "category": "restaurant",
      "subcategory": "Bar",
      "latitude": "36.9228238",
      "longitude": "138.4473255",
      "rating": "5.0",
      "review_count": 1,
      "cuisine": null,
      "budget_range": null,
      "english_menu": null,
      "tips": null,
      "has_overrides": true,
      "has_local_knowledge": true
    }
  ],
  "source": "postgresql"
}
```

**Note:** Results are automatically sorted by rating (highest first), then by name.

**Error Response (400 Bad Request):**
```json
{
  "error": "Invalid category",
  "message": "Category must be one of: restaurant, onsen, lift"
}
```

**Use Cases:**
- Category filter pages
- Navigation menus
- Quick category access

---

## Feature Flag Control

All V2 endpoints require the `ENABLE_POSTGRES_READ` feature flag to be enabled.

### Checking Feature Flag Status

```bash
curl http://localhost:3000/api/v2/health
```

### When Feature Flag is Disabled

**Response (503 Service Unavailable):**
```json
{
  "error": "PostgreSQL read not enabled",
  "message": "This endpoint requires ENABLE_POSTGRES_READ=true",
  "hint": "Use the legacy JSON API endpoints instead"
}
```

### Enabling PostgreSQL Read

**.env file:**
```bash
ENABLE_POSTGRES_READ=true
```

**Railway environment variables:**
```
ENABLE_POSTGRES_READ=true
```

After changing, restart the server:
```bash
npm start
```

---

## Migration from V1 to V2

### Key Differences

| Feature | V1 (JSON) | V2 (PostgreSQL) |
|---------|-----------|-----------------|
| Data Source | nozawa_places_unified.json | PostgreSQL database |
| Response Time | ~50ms | ~20ms |
| Filtering | In-memory | Database query |
| Sorting | In-memory | Database index |
| Scalability | Limited by RAM | Scalable |
| Real-time Updates | Requires file reload | Immediate |
| Multi-user | Risk of conflicts | ACID compliant |

### Endpoint Mapping

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/restaurants` | `GET /api/v2/places?category=restaurant` | Same data, better performance |
| `GET /api/restaurants/:id` | `GET /api/v2/places/:id` | ID format unchanged |
| `GET /api/restaurants/stats` | `GET /api/v2/stats` | Enhanced statistics |
| - | `GET /api/v2/places/category/:category` | New endpoint |
| - | `GET /api/v2/health` | New endpoint |

### Gradual Migration Strategy

1. **Phase 1:** Enable `ENABLE_POSTGRES_READ=true`
2. **Phase 2:** Test V2 endpoints in parallel
3. **Phase 3:** Update frontend to use V2 endpoints
4. **Phase 4:** Deprecate V1 endpoints
5. **Phase 5:** Enable `ENABLE_DUAL_WRITE=false` (stop writing to JSON)

---

## Performance

### Query Performance

Typical response times (with 97 places):
- **Health check:** 10-15ms
- **List all places:** 15-25ms
- **Single place:** 10-15ms
- **Category filter:** 15-20ms
- **Stats:** 20-30ms

### Optimization

The `places_with_merged_data` view uses:
- LEFT JOINs for efficient merging
- Indexed columns (id, category, resort_id)
- COALESCE for precedence without IF statements

### Caching Recommendations

For production:
- Cache stats endpoint (5 minutes)
- Cache place list by category (2 minutes)
- Cache individual places (5 minutes)
- Invalidate on admin updates

---

## Error Handling

### Error Response Format

All errors follow this format:
```json
{
  "error": "Error type",
  "message": "Human-readable description",
  "hint": "Suggestion for fixing (optional)"
}
```

### Common Errors

| Status Code | Error | Cause |
|-------------|-------|-------|
| 400 | Invalid place ID | Non-numeric ID |
| 400 | Invalid category | Not restaurant/onsen/lift |
| 404 | Place not found | ID doesn't exist |
| 500 | Database query failed | Connection error |
| 503 | PostgreSQL read not enabled | Feature flag disabled |

---

## Testing

### Health Check

```bash
curl http://localhost:3000/api/v2/health | jq '.'
```

### Get All Restaurants

```bash
curl http://localhost:3000/api/v2/places?category=restaurant | jq '.count'
```

### Search for Place

```bash
curl 'http://localhost:3000/api/v2/places?search=fuji' | jq '.data[0].name'
```

### Top Rated Places

```bash
curl 'http://localhost:3000/api/v2/places?sort=rating&order=desc&limit=5' | jq '.data[].rating'
```

### Automated Test Script

```bash
chmod +x test-postgres-api.sh
./test-postgres-api.sh
```

---

## Security

### Authentication

Currently, V2 read endpoints are **public** (no authentication required).

For write operations (future):
- JWT authentication required
- Admin role verification
- Rate limiting enforced

### Rate Limiting

V2 endpoints use the same rate limits as V1:
- 100 requests per minute per IP
- Configurable via `API_RATE_LIMIT_MAX` env variable

### Input Validation

All inputs are validated:
- Place IDs must be integers
- Categories must be from whitelist
- Sort fields prevent SQL injection
- Search terms are parameterized

---

## Future Enhancements

### Planned Features

1. **Geolocation Search**
   - Find places near coordinates
   - Radius filtering
   - Distance sorting

2. **Advanced Filtering**
   - Multiple categories
   - Price range
   - Open now
   - English menu availability

3. **Write Endpoints**
   - Create new places
   - Update place data
   - Upload photos
   - Add local knowledge

4. **Real-time Updates**
   - WebSocket connections
   - Live check-in notifications
   - Live lift status

---

## Support

### Getting Help

- Check [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) for configuration
- Check [SECURITY_MIDDLEWARE.md](./SECURITY_MIDDLEWARE.md) for security
- Check database logs: `node check-db-schema.js`

### Common Issues

**Issue:** "places_with_merged_data does not exist"

**Solution:**
```bash
node create-places-view.js
```

**Issue:** "503 PostgreSQL read not enabled"

**Solution:**
```bash
# Update .env
ENABLE_POSTGRES_READ=true

# Restart server
npm start
```

---

**Last Updated:** 2025-11-29
**Version:** 2.0.0
**Status:** Production Ready
**Database:** PostgreSQL 17.6 on Railway
