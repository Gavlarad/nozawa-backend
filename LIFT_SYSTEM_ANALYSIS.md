# Lift System Analysis - December 2025

## Executive Summary

**Problem:** Frontend is not displaying lift data
**Root Cause:** Two disconnected lift systems + possible frontend endpoint mismatch
**Status:** Backend is working correctly, but frontend may be using wrong endpoint

---

## Current State ✅

### Lift Scraping System (Working)
- ✅ Scheduler runs during ski season (Dec 10 - Apr 30)
- ✅ Scrapes every 15-30 minutes during operating hours
- ✅ **PostgreSQL persistence IS implemented** (writes to `lift_status_cache`)
- ✅ Loads from PostgreSQL on server startup
- ✅ V1 endpoint `/api/lifts/status` returns data
- ✅ V2 endpoint `/api/v2/lifts` returns data
- ✅ Currently showing 17 lifts (all `off-season` - correct for Dec 1)

### Verified Working Endpoints

```bash
# V1 Endpoint (In-memory + PostgreSQL fallback)
GET https://nozawa-backend-production.up.railway.app/api/lifts/status
Response: 17 lifts, source: "scheduler", status: "off-season"

# V2 Endpoint (PostgreSQL-only)
GET https://nozawa-backend-production.up.railway.app/api/v2/lifts
Response: 17 lifts, source: "postgresql", ageMinutes: 2572 (43 hours old)
```

---

## The Problem: Two Disconnected Systems

### System 1: Lift Status (Real-time Operations)

**Purpose:** Real-time lift status (open/closed/off-season)
**Storage:** `lift_status_cache` table
**Coverage:** 17 lifts
**Data Structure:**
```json
{
  "lifts": [
    {
      "id": 1,
      "name": "Nagasaka Gondola",
      "status": "off-season",
      "hours": "Season ended",
      "priority": 1
    }
    // ... 16 more lifts
  ],
  "scrapedAt": "2025-11-30T...",
  "isOffSeason": true
}
```

**Endpoints:**
- `/api/lifts/status` (V1)
- `/api/v2/lifts` (V2)

**Update Frequency:** Every 15-30 min during ski season

---

### System 2: Lift Places (Map/POI Data)

**Purpose:** Lift locations for map display
**Storage:** `places` table with `category='lift'`
**Coverage:** Only 4 lifts (!!!)
**Data Structure:**
```json
{
  "id": 187,
  "name": "Hikage Gondola",
  "external_id": null,
  "category": "lift",
  "latitude": "36.9257670",
  "longitude": "138.4522826",
  "status": null,           // ❌ No status!
  "visible_in_app": null    // ❌ No visibility flag!
}
```

**The 4 Lift POIs:**
1. Nagasaka Gondola (lift_nagasaka_gondola)
2. Hikage Gondola (lift_hikage_gondola)
3. Karasawa Area (lift_karasawa_area)
4. Yu Road Moving Walkway (yu_road_walkway)

**Endpoints:**
- `/api/v2/places/category/lift`

**Problems:**
- ❌ Only 4 lifts (vs 17 in status system)
- ❌ No `status` field (can't show open/closed)
- ❌ No `external_id` to link to scraper lifts
- ❌ `visible_in_app` is null (should these even show?)
- ❌ No connection to real-time status data

---

## Why Frontend Shows No Lifts

### Hypothesis 1: Frontend Using Wrong Endpoint

**If frontend queries:**
```javascript
GET /api/v2/places/category/lift
```

**It gets:** 4 lift POIs without status → Can't display operational info

**Should query instead:**
```javascript
GET /api/v2/lifts
```

**Would get:** 17 lifts with real-time status → Can display everything

---

### Hypothesis 2: Missing Data in Places System

The 4 lift "places" are incomplete:
- No status information
- No link to real-time data
- No clear purpose (just map markers?)
- May not be meant for display

---

## Detailed System Comparison

| Feature | Lift Status System | Lift Places System |
|---------|-------------------|-------------------|
| **Lifts Count** | 17 lifts | 4 lifts |
| **Has Status** | ✅ Yes (open/closed/off-season) | ❌ No |
| **Has Location** | ❌ No lat/lng | ✅ Yes |
| **Has Hours** | ✅ Yes (scraped) | ❌ No |
| **Real-time** | ✅ Updates every 15-30 min | ❌ Static |
| **PostgreSQL** | ✅ lift_status_cache | ✅ places table |
| **Endpoint** | /api/lifts/status, /api/v2/lifts | /api/v2/places/category/lift |
| **Data Source** | Nozawa website scraper | Manual JSON entry |
| **Purpose** | Operational status | Map POIs |

---

## The 17 Lifts in Status System

Complete list from scraper mappings (liftScraper.js:8-26):

1. **Nagasaka Gondola** (id: 1, priority: 1)
2. **Hikage Gondola** (id: 2, priority: 1)
3. **Yamabiko Quad** (id: 3, priority: 2)
4. **Yamabiko No 2 Quad** (id: 4, priority: 2)
5. **Skyline Double** (id: 5, priority: 2)
6. **Uenotaira Quad** (id: 6, priority: 2)
7. **Paradise Quad** (id: 7, priority: 2)
8. **Challenge Double** (id: 10, priority: 3)
9. **Utopia Double** (id: 11, priority: 3)
10. **Kandahar Double** (id: 12, priority: 3)
11. **Hikage Triple** (id: 14, priority: 3)
12. **Yu road** (id: 15, priority: 4)
13. **Hikage Quad** (id: 16, priority: 3)
14. **Nagasaka Triple** (id: 17, priority: 3)
15. **Nagasaka Quad** (id: 18, priority: 2)
16. **Nagasaka gondola-link Double** (id: 19, priority: 3)
17. **Karasawa Double** (id: 20, priority: 3)

---

## PostgreSQL Integration Status

### ✅ ALREADY IMPLEMENTED (contrary to LIFT_SCRAPING_REVIEW.md)

The `LIFT_SCRAPING_REVIEW.md` doc is **outdated**. PostgreSQL integration is DONE:

**1. Write to PostgreSQL** ✅
```javascript
// services/scheduler.js lines 24-53
async function setLatestScrapeResults(results) {
  scrapeResults = results;  // Memory cache

  await pool.query(`
    INSERT INTO lift_status_cache (...)
    VALUES ($1, $2, $3, NOW(), $4, $5)
    ON CONFLICT (resort_id)
    DO UPDATE SET ...
  `, [...]);
}
```

**2. Load from PostgreSQL on Startup** ✅
```javascript
// services/scheduler.js lines 57-80
async function loadCachedLiftStatus() {
  const result = await pool.query(`
    SELECT lift_data, scraped_at
    FROM lift_status_cache
    WHERE resort_id = 1
    ORDER BY scraped_at DESC
    LIMIT 1
  `);

  if (result.rows.length > 0) {
    scrapeResults = result.rows[0].lift_data;
    console.log('✅ Loaded cached lift data from PostgreSQL');
  }
}
```

**3. V2 API Endpoint** ✅
```javascript
// routes/places.js lines 476-530
router.get('/lifts', async (req, res) => {
  // Reads from lift_status_cache table
  // Returns 17 lifts with status
});
```

### ✅ Confirmed in Production

```bash
$ curl 'https://nozawa-backend-production.up.railway.app/api/v2/lifts'

{
  "success": true,
  "lifts": [17 lifts...],
  "scrapedAt": "2025-11-29T23:05:45.123Z",
  "ageMinutes": 2572,
  "isOffSeason": true,
  "source": "postgresql"
}
```

Data is 2572 minutes old (43 hours) because we're outside ski season, so no new scrapes are happening.

---

## Solutions & Recommendations

### Option 1: Frontend Uses Correct Endpoint (Recommended)

**Change frontend to query:**
```javascript
GET /api/v2/lifts
```

**Benefits:**
- ✅ Gets all 17 lifts
- ✅ Has real-time status
- ✅ Has operating hours
- ✅ Works NOW - no backend changes needed

**Drawback:**
- ❌ No lat/lng coordinates (can't show on map)

---

### Option 2: Merge the Two Systems

**Create unified lift system that combines:**
- Real-time status from scraper (17 lifts)
- Location data from map (4 lifts)
- External IDs to link them

**Implementation Steps:**

1. **Add lift POIs to database** (all 17 lifts)
   - Create migration to add 13 missing lifts to `places` table
   - Include lat/lng coordinates (need to source these)
   - Set `category='lift'` and `visible_in_app=true`

2. **Link systems via external_id**
   ```sql
   UPDATE places
   SET external_id = 'nagasaka_gondola'
   WHERE name = 'Nagasaka Gondola' AND category = 'lift';
   ```

3. **Create enhanced endpoint** `/api/v2/lifts/with-locations`
   ```javascript
   // Join lift_status_cache with places table
   SELECT
     lsc.lift_data,
     p.id, p.latitude, p.longitude, p.external_id
   FROM lift_status_cache lsc
   LEFT JOIN places p ON p.external_id = lsc.lift_data->'lifts'->>'external_id'
   WHERE lsc.resort_id = 1
   ```

4. **Return merged data**
   ```json
   {
     "lifts": [
       {
         "id": 1,
         "name": "Nagasaka Gondola",
         "status": "open",
         "hours": "8:30-16:30",
         "latitude": 36.9200588,
         "longitude": 138.4497970,
         "place_id": 186
       }
     ]
   }
   ```

**Benefits:**
- ✅ All 17 lifts with status + location
- ✅ Can show on map with real-time colors
- ✅ Unified data source

**Work Required:**
- Need to source lat/lng for 13 missing lifts
- Database migration
- New API endpoint
- Frontend update to use new endpoint

---

### Option 3: Status Overlay (Hybrid)

**Frontend queries BOTH endpoints:**

1. Get lift locations: `GET /api/v2/places/category/lift` (4 lifts with lat/lng)
2. Get lift status: `GET /api/v2/lifts` (17 lifts with status)
3. Match by name and overlay status onto map markers

**Benefits:**
- ✅ Works with existing data
- ✅ No backend changes needed

**Drawbacks:**
- ❌ Only 4 of 17 lifts will show on map
- ❌ Name matching is fragile
- ❌ Inefficient (two API calls)

---

## Immediate Actions

### 1. Check Frontend Code

**Determine which endpoint frontend is using:**
```javascript
// Look for:
fetch('/api/v2/places/category/lift')  // ❌ Wrong - only 4 lifts, no status
fetch('/api/v2/lifts')                 // ✅ Correct - 17 lifts with status
fetch('/api/lifts/status')             // ✅ Also works (V1)
```

### 2. Test Current Endpoints

```bash
# Test V2 lifts endpoint
curl 'https://nozawa-backend-production.up.railway.app/api/v2/lifts' | jq '.'

# Test V2 places/lift endpoint (problematic)
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/category/lift' | jq '.'

# Compare the two responses
```

### 3. Quick Fix (If Frontend Uses Wrong Endpoint)

**Option A:** Update frontend to use `/api/v2/lifts`

**Option B:** If frontend needs locations, use Option 3 (hybrid approach) temporarily

---

## Longer-Term Improvements

### 1. Add Missing Lift Locations

**Need to source lat/lng coordinates for 13 lifts:**
- Yamabiko Quad
- Yamabiko No 2 Quad
- Skyline Double
- Uenotaira Quad
- Paradise Quad
- Challenge Double
- Utopia Double
- Kandahar Double
- Hikage Triple
- Hikage Quad
- Nagasaka Triple
- Nagasaka Quad
- Nagasaka gondola-link Double
- Karasawa Double (note: Karasawa Area exists but different)

**Sources:**
1. Google Maps search
2. Nozawa ski map PDF
3. Manual GPS measurement from trail map

### 2. Create Unified Lift Table

**New migration:**
```sql
CREATE TABLE lifts (
  id SERIAL PRIMARY KEY,
  resort_id INTEGER REFERENCES resorts(id),
  external_id VARCHAR(100) UNIQUE,
  name VARCHAR(255),
  name_local VARCHAR(255),
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  priority INTEGER,
  type VARCHAR(50), -- gondola, quad, triple, double, walkway

  -- Link to real-time status
  scraper_key VARCHAR(100), -- e.g. 'new_nagasaka_g'

  visible_in_app BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Enhanced V2 Endpoint

**Combine static data + real-time status:**
```javascript
GET /api/v2/lifts/enhanced

Response:
{
  "lifts": [
    {
      // Static data from lifts table
      "id": 1,
      "name": "Nagasaka Gondola",
      "latitude": 36.9200588,
      "longitude": 138.4497970,
      "type": "gondola",
      "priority": 1,

      // Real-time data from lift_status_cache
      "status": "open",
      "hours": "8:30-16:30",
      "lastUpdated": "2025-12-15T08:15:00Z"
    }
  ],
  "scrapedAt": "2025-12-15T08:15:00Z",
  "source": "postgresql"
}
```

### 4. Admin Endpoint for Lift Management

```javascript
POST /api/admin/lifts/:id
PUT /api/admin/lifts/:id
DELETE /api/admin/lifts/:id

// Update lift metadata (location, name, visibility)
```

---

## Off-Season Behavior (Current State)

**We're currently OUTSIDE ski season** (Dec 1, season starts Dec 10)

**Scraper behavior:**
- ❌ No scheduled scrapes running
- ✅ Last scrape from ~43 hours ago shows all lifts as `off-season`
- ✅ Data persisted in PostgreSQL, served to API

**Expected behavior Dec 10:**
- ✅ Scraper will resume scheduled runs
- ✅ Will detect actual lift status (open/closed)
- ✅ Will update every 15-30 minutes

**To test NOW (force a scrape):**
```javascript
// Temporarily override season check
// services/liftScraper.js line 29
checkIfSkiSeason() {
  return true;  // Force in-season
}
```

---

## Summary

### What's Working ✅
- Lift scraper system (17 lifts)
- PostgreSQL persistence
- V1 and V2 API endpoints
- Scheduled updates (when in season)
- Off-season detection

### What's Not Working ❌
- Lift places system (only 4 lifts, no status)
- Disconnected from real-time status
- Missing location data for 13 lifts
- Frontend may be using wrong endpoint

### Root Cause
Two separate lift systems that don't talk to each other:
1. **Operational system** (status) - works great
2. **POI system** (map markers) - incomplete

### Recommended Fix
**Short-term:** Frontend should use `/api/v2/lifts` for status
**Long-term:** Merge the two systems with complete location + status data

---

**Last Updated:** 2025-12-01
**Status:** Awaiting frontend investigation
**Priority:** High (ski season starts Dec 10)
