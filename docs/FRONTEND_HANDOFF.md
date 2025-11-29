# Frontend Handoff: Backend Modernization
**Date:** November 29, 2025
**Backend Version:** 2.0.0
**Branch:** `feature/postgres-security-migration` → merging to `main`

---

## 🎯 Executive Summary

The backend has been modernized with PostgreSQL, enhanced security, and improved caching. **Most changes are backward compatible** - your existing frontend will continue to work. New V2 endpoints are available for gradual migration.

### What You Need to Know
- ✅ **All existing endpoints still work** (no breaking changes)
- ✅ **New V2 endpoints available** (optional upgrade path)
- ✅ **Weather API has new caching metadata** (minor change)
- ✅ **Admin panel requires JWT authentication** (breaking change for admin)
- ⚠️ **Rate limiting active** (100 req/min per IP - should be fine for normal use)

---

## 📋 Quick Checklist for Frontend Team

### Immediate (Required for Launch)
- [ ] Update admin panel to use JWT authentication
- [ ] Test all existing endpoints still work
- [ ] Handle new weather response format (added `cached`, `source`, `age` fields)
- [ ] Test rate limiting doesn't affect normal usage

### Soon (Within 2 Weeks)
- [ ] Migrate to V2 endpoints for places (better performance)
- [ ] Add cache status indicators for weather
- [ ] Test group accommodation sharing feature

### Later (Optional)
- [ ] Build admin monitoring dashboard for lifts
- [ ] Add weather cache age indicators
- [ ] Implement V2 endpoint error handling

---

## 🔄 Backward Compatibility Matrix

| Endpoint Category | Status | Action Required |
|------------------|--------|-----------------|
| **Restaurants** | ✅ Fully compatible | None - keep using as-is |
| **Weather** | ⚠️ Minor changes | Update to handle new fields (optional) |
| **Lifts** | ✅ Fully compatible | None - keep using as-is |
| **Groups** | ✅ Fully compatible | None - keep using as-is |
| **Places** | ✅ Fully compatible | None - keep using as-is |
| **Admin Panel** | 🔴 Breaking changes | JWT auth required (see below) |

---

## 📡 API Changes by Endpoint

### 1. Weather Endpoints (Minor Changes)

#### `/api/weather/current` - Response Format Changed

**Before:**
```json
{
  "timestamp": "2025-11-29T07:00:00.000Z",
  "snow_line": "No snow (too warm)",
  "levels": [
    {
      "location": "Village",
      "elevation": 570,
      "current": { "temperature_2m": 5.9, ... },
      "daily": { ... },
      "units": { ... }
    }
  ]
}
```

**After (adds caching metadata):**
```json
{
  "timestamp": "2025-11-29T07:00:00.000Z",
  "snow_line": "No snow (too warm)",
  "levels": [ ... ],
  "cached": true,          // NEW: Was this from cache?
  "source": "memory",      // NEW: memory | postgresql | open-meteo
  "age": 45,               // NEW: Cache age in seconds (optional)
  "stale": false,          // NEW: Is cache stale? (optional)
  "warning": null          // NEW: Warning message if API failed (optional)
}
```

**Migration Strategy:**
- **Option 1 (Easy):** Ignore new fields - everything still works
- **Option 2 (Recommended):** Display cache age to users
  ```typescript
  if (weather.cached && weather.age) {
    const minutes = Math.floor(weather.age / 60);
    showCacheIndicator(`Data ${minutes}min old`);
  }
  ```

#### `/api/weather/forecast` - Same changes as above

**New fields:** `cached`, `source`, `age`

#### `/api/weather/cache-status` - NEW Endpoint (Optional)

```bash
GET /api/weather/cache-status
```

**Response:**
```json
{
  "success": true,
  "cache": {
    "memory": {
      "hasData": true,
      "age": 120,
      "fresh": true
    },
    "cacheLifetime": 10
  },
  "timestamp": "2025-11-29T07:00:00.000Z"
}
```

**Use case:** Debugging weather issues

---

### 2. Lift Endpoints (No Changes)

✅ **No changes required** - everything works as before

**Endpoints:**
- `GET /api/lifts/status` - Still works exactly the same
- `GET /api/lifts/status-info` - Still works exactly the same

**New (Optional):**
- `GET /api/v2/lifts` - PostgreSQL-backed version (requires `ENABLE_POSTGRES_READ=true`)

---

### 3. Restaurant/Places Endpoints (No Changes)

✅ **No changes required** - everything works as before

**Existing endpoints still work:**
- `GET /api/restaurants`
- `GET /api/restaurants/:id`
- `GET /api/restaurants/stats`
- `GET /api/restaurants/status/open`
- `GET /api/places`

**New (Optional):**
- `GET /api/v2/places` - PostgreSQL-backed with pagination
- `GET /api/v2/places/:id` - Single place from PostgreSQL
- `GET /api/v2/places/category/:category` - Category-based query
- `GET /api/v2/stats` - Database statistics

---

### 4. Group Endpoints (No Changes)

✅ **No changes required** - everything works as before

**All group endpoints work the same:**
- `POST /api/groups/create`
- `GET /api/groups/:code`
- `POST /api/groups/:code/checkin`
- `POST /api/groups/:code/checkout`
- `GET /api/groups/:code/checkins`
- `GET /api/groups/:code/members`

**Enhanced (Already working):**
- Accommodation sharing now persists correctly
- Auto-expire after 1 hour still works

---

### 5. Admin Panel (BREAKING CHANGES)

🔴 **JWT Authentication Now Required**

#### Old Flow (No longer works):
```javascript
// ❌ This won't work anymore
fetch('/api/admin/places-data')
  .then(res => res.json())
```

#### New Flow (Required):

**Step 1: Login to get JWT token**
```javascript
const loginResponse = await fetch('/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@nozawa.com',
    password: 'your-password'
  })
});

const { token, admin } = await loginResponse.json();
// Store token in localStorage or sessionStorage
localStorage.setItem('adminToken', token);
```

**Step 2: Use token for all admin requests**
```javascript
const response = await fetch('/api/admin/places-data', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

#### Admin Endpoints Requiring JWT

All these now require `Authorization: Bearer <token>` header:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/login` | POST | Get JWT token (no auth needed) |
| `/api/admin/reload-data` | POST | Reload restaurant data |
| `/api/admin/places-data` | GET | Get places for editing |
| `/api/admin/save-places` | POST | Save places with dual-write |
| `/api/admin/validate-data-consistency` | GET | Check JSON ↔ PostgreSQL sync |
| `/api/admin/lift-scrapes` | GET | **NEW:** Lift monitoring |

#### Example: Complete Admin Auth Flow

```typescript
// auth.service.ts
class AdminAuthService {
  private token: string | null = null;

  async login(email: string, password: string) {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();
    this.token = data.token;
    localStorage.setItem('adminToken', data.token);
    return data.admin;
  }

  async getPlacesData() {
    const token = this.token || localStorage.getItem('adminToken');
    if (!token) throw new Error('Not authenticated');

    const response = await fetch('/api/admin/places-data', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      // Token expired
      this.logout();
      throw new Error('Session expired');
    }

    return response.json();
  }

  logout() {
    this.token = null;
    localStorage.removeItem('adminToken');
  }
}
```

#### JWT Token Details
- **Expiry:** 24 hours (configurable via `JWT_EXPIRY` env var)
- **Storage:** Store in localStorage or sessionStorage (your choice)
- **Refresh:** No auto-refresh - user must re-login after 24h
- **Security:** Tokens are signed with `JWT_SECRET` - cannot be forged

---

## 🆕 New V2 Endpoints (Optional Migration)

V2 endpoints are **PostgreSQL-backed** and offer better performance and features. Migration is optional and gradual.

### Why Migrate to V2?

| Feature | V1 (Current) | V2 (New) |
|---------|-------------|----------|
| Data Source | JSON file | PostgreSQL |
| Pagination | No | Yes |
| Filtering | Limited | Advanced |
| Performance | Good | Better (indexed) |
| Real-time | No | Eventually |

### V2 Endpoints Available

#### 1. Places
```bash
# List all places with pagination
GET /api/v2/places?limit=50&offset=0&category=restaurant&visible=true

# Get single place
GET /api/v2/places/:id

# Get places by category
GET /api/v2/places/category/restaurant
```

**Example Response:**
```json
{
  "success": true,
  "data": [ /* places array */ ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "page": 1,
    "totalPages": 3,
    "hasMore": true
  },
  "source": "postgresql"
}
```

#### 2. Stats
```bash
GET /api/v2/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "byCategory": {
      "restaurants": 79,
      "onsens": 45,
      "lifts": 26
    },
    "visibility": {
      "visible": 140,
      "hidden": 10
    },
    "dataQuality": {
      "withOverrides": 50,
      "withLocalKnowledge": 30,
      "withGoogleData": 120
    }
  }
}
```

#### 3. Lifts
```bash
GET /api/v2/lifts
```

**Returns lift data from PostgreSQL** (same format as V1 but from database)

#### 4. Weather
```bash
GET /api/v2/weather
```

**Returns cached weather from PostgreSQL** (same format as V1 but from database)

#### 5. Health Check
```bash
GET /api/v2/health
```

**Check PostgreSQL connection:**
```json
{
  "success": true,
  "database": "connected",
  "serverTime": "2025-11-29T07:00:00.000Z",
  "postgresVersion": "PostgreSQL 14.5",
  "featureFlags": {
    "postgresRead": true,
    "dualWrite": false
  }
}
```

### Migration Strategy for V2

**Phase 1: Test V2 alongside V1**
```typescript
// Keep using V1
const v1Data = await fetch('/api/restaurants').then(r => r.json());

// Test V2 in parallel
const v2Data = await fetch('/api/v2/places?category=restaurant').then(r => r.json());

// Compare results
console.log('V1:', v1Data.restaurants.length);
console.log('V2:', v2Data.data.length);
```

**Phase 2: Gradual cutover**
- Start with non-critical pages
- Monitor for issues
- Rollback if needed

**Phase 3: Full migration**
- Switch all pages to V2
- Remove V1 calls
- Enjoy better performance

---

## 🚨 Rate Limiting

All endpoints now have rate limiting to prevent abuse.

### Limits per IP Address

| Endpoint Type | Limit | Window | HTTP Status if Exceeded |
|--------------|-------|--------|------------------------|
| Authentication (`/api/admin/login`) | 5 requests | 15 minutes | 429 Too Many Requests |
| API (`/api/*`) | 100 requests | 1 minute | 429 Too Many Requests |
| Admin (`/api/admin/*`) | 50 requests | 5 minutes | 429 Too Many Requests |

### What This Means for Frontend

**Normal users:** Won't notice - 100 req/min is generous
**Admin users:** 50 req/5min should be fine
**Bots/scrapers:** Will be blocked

### Handling Rate Limit Errors

```typescript
async function fetchWithRetry(url: string, options?: RequestInit) {
  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '60';
    throw new Error(`Rate limited. Try again in ${retryAfter} seconds.`);
  }

  return response;
}
```

---

## 🧪 Testing Checklist

### 1. Weather Testing
```bash
# Test current weather
curl http://localhost:3000/api/weather/current

# Check for new fields
# ✓ timestamp (existing)
# ✓ snow_line (existing)
# ✓ levels (existing)
# ✓ cached (NEW)
# ✓ source (NEW)
# ✓ age (NEW - optional)
```

**Frontend Code:**
```typescript
interface WeatherResponse {
  timestamp: string;
  snow_line: string;
  levels: WeatherLevel[];
  cached?: boolean;      // NEW
  source?: string;       // NEW
  age?: number;          // NEW
  stale?: boolean;       // NEW
  warning?: string;      // NEW
}

// Handle gracefully
function displayWeather(data: WeatherResponse) {
  // Your existing code works
  showSnowLine(data.snow_line);
  showLevels(data.levels);

  // Optional: Show cache indicator
  if (data.cached && data.age) {
    const minutes = Math.floor(data.age / 60);
    showCacheAge(`${minutes}min ago`);
  }

  // Optional: Show warning if API failed
  if (data.warning) {
    showWarning(data.warning);
  }
}
```

### 2. Admin Panel Testing

**Test authentication flow:**
```bash
# 1. Login (should work)
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}'

# 2. Get places without token (should fail with 401)
curl http://localhost:3000/api/admin/places-data

# 3. Get places with token (should work)
curl http://localhost:3000/api/admin/places-data \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 3. Rate Limiting Testing

```bash
# Spam requests to trigger rate limit
for i in {1..150}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/weather/current
done

# Expected: First 100 return 200, next 50 return 429
```

### 4. V2 Endpoints Testing

```bash
# Test V2 places (requires ENABLE_POSTGRES_READ=true)
curl http://localhost:3000/api/v2/places?limit=10

# Should return pagination metadata
# {
#   "success": true,
#   "data": [...],
#   "pagination": { "total": 150, ... }
# }
```

---

## 🐛 Common Issues & Solutions

### Issue 1: "Feature flag not enabled"

**Error:**
```json
{
  "error": "PostgreSQL read not enabled",
  "message": "This endpoint requires ENABLE_POSTGRES_READ=true"
}
```

**Solution:** V2 endpoints require feature flag. Either:
1. Use V1 endpoints instead
2. Ask backend to enable `ENABLE_POSTGRES_READ=true`

### Issue 2: "Unauthorized" on admin endpoints

**Error:**
```json
{
  "error": "Unauthorized",
  "message": "No token provided"
}
```

**Solution:** Include JWT token in Authorization header:
```typescript
headers: {
  'Authorization': `Bearer ${token}`
}
```

### Issue 3: "Rate limited"

**Error:**
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded"
}
```

**Solution:**
- Check if you're making too many requests in loops
- Implement exponential backoff
- Cache responses on frontend

### Issue 4: Weather cache seems stale

**Symptom:** Weather data shows `age: 600` (10 minutes)

**This is normal!** Weather cache refreshes every 10 minutes. If you need fresher data:
1. Check `stale` field - if true, API failed and using old cache
2. Wait for cache to refresh automatically
3. Don't spam refresh - it won't help (cache is server-side)

---

## 🔐 Environment Variables (For Reference)

These are set on the backend - frontend doesn't need them, but good to know:

```bash
# Feature Flags
ENABLE_POSTGRES_READ=true   # Enables V2 endpoints
ENABLE_DUAL_WRITE=false     # JSON is still primary

# Authentication
JWT_SECRET=***              # Secret for JWT signing
JWT_EXPIRY=24h              # Token lifetime

# Rate Limits
API_RATE_LIMIT_MAX=100      # 100 requests per minute
ADMIN_RATE_LIMIT_MAX=50     # 50 admin requests per 5 minutes
AUTH_RATE_LIMIT_MAX=5       # 5 login attempts per 15 minutes
```

---

## 📊 Migration Timeline

### Immediate (Deploy Day)
- [ ] Update admin panel with JWT auth
- [ ] Test all existing endpoints
- [ ] Monitor error rates

### Week 1
- [ ] Test V2 endpoints in staging
- [ ] Add cache indicators for weather
- [ ] Monitor rate limit hits

### Week 2-4
- [ ] Gradual migration to V2 endpoints
- [ ] A/B test performance
- [ ] Gather user feedback

### Month 2+
- [ ] Full V2 migration
- [ ] Remove V1 fallbacks
- [ ] Optimize based on metrics

---

## 🆘 Support & Rollback

### If Something Breaks

**Backend can rollback to previous version:**
1. Railway supports instant rollback
2. Git tag exists for old version
3. Database migrations are non-destructive

**Frontend can fallback to V1:**
- All V1 endpoints still work
- V2 is optional
- Rate limits won't affect normal usage

### Getting Help

**Backend logs:**
- Check Railway logs for errors
- Admin endpoints have monitoring
- Cache status endpoints for debugging

**Questions?**
- Check `docs/` folder for detailed documentation
- All endpoints are documented with examples
- Test scripts available in repo

---

## 📚 Additional Resources

**Backend Documentation:**
- `docs/POSTGRESQL_API.md` - V2 API reference
- `docs/JWT_AUTHENTICATION.md` - Authentication guide
- `docs/SECURITY_MIDDLEWARE.md` - Rate limiting details
- `docs/WEATHER_INTEGRATION_REVIEW.md` - Weather caching explained
- `docs/LIFT_SCRAPING_REVIEW.md` - Lift status details

**Example Code:**
- See admin panel for JWT auth implementation
- Weather components for cache handling
- Group components for backward compatibility

---

## ✅ Frontend Developer Checklist

Before deploying frontend changes:

### Must Have
- [ ] Admin panel uses JWT authentication
- [ ] Admin panel handles 401 errors (token expired)
- [ ] Weather response handles new optional fields gracefully
- [ ] Error handling for rate limits (429 status)
- [ ] Test all existing features still work

### Nice to Have
- [ ] Display weather cache age to users
- [ ] Show warning if weather API failed
- [ ] Test V2 endpoints in parallel with V1
- [ ] Add loading states for admin operations

### Future
- [ ] Migrate to V2 endpoints
- [ ] Build admin monitoring dashboard
- [ ] Implement frontend caching layer
- [ ] Add analytics for V2 adoption

---

## 🎉 Summary

**Good news:** Most changes are backward compatible!
**Main change:** Admin panel needs JWT auth (breaking)
**New features:** V2 endpoints, better caching, monitoring
**Migration:** Gradual - no rush to switch everything

**Questions?** Check the docs or ask - happy to help! 🚀
