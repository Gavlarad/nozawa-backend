# Lift Scraping System Review

## Executive Summary

**Status:** ⚠️ **Partially Integrated** - Works but has gaps
**Security:** ✅ **Good** - Has protection mechanisms
**PostgreSQL Integration:** ❌ **Missing** - Table exists but not used

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Server Startup                     │
└─────────────────────────────────────────────────────┘
                        ↓
            initializeScheduler()
                        ↓
        ┌───────────────────────────────┐
        │   Cron Jobs (node-cron)       │
        │   - Every 15 min (6-9:30 JST) │
        │   - Every 30 min (10-14:30)   │
        │   - Every 15 min (15-16:30)   │
        │   - Once at 17:00             │
        └───────────────────────────────┘
                        ↓
            Only if Dec 10 - Apr 30
                        ↓
        ┌───────────────────────────────┐
        │  performScheduledScrape()     │
        └───────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │   NozawaLiftScraper.scrape()  │
        │   1. Fetch HTML from Nozawa   │
        │   2. Parse with Cheerio       │
        │   3. Extract lift status      │
        └───────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │   Store in Memory Variable    │
        │   (scrapeResults)             │
        └───────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │   API Returns Cached Data     │
        │   GET /api/lifts/status       │
        └───────────────────────────────┘
```

### Data Flow

**1. Scheduled Scraping (Automatic)**
- Runs during ski season (Dec 10 - Apr 30)
- Multiple times per day based on priority
- Stores in memory only (not database)

**2. API Request**
```javascript
GET /api/lifts/status

Response priority:
1. Scheduler cache (in-memory)
2. Route cache (in-memory, 10 min)
3. Test data (fallback if no cache)
```

**3. Scraping Logic**
```javascript
// Target URL
https://en.nozawaski.com/the-mountain/moutain-info/slopes-lifts/

// Parsing strategies:
1. Table parsing (primary) - More reliable
2. Image parsing (fallback) - Looks for _on.gif/_off.gif
3. Off-season detection - Shows all as "off-season"
```

---

## Security Analysis

### ✅ Good Security Practices

**1. Rate Limiting Protection**
```javascript
// Minimum 5 minutes between scrapes
const MIN_SCRAPE_INTERVAL = 5 * 60 * 1000;

if (Date.now() - lastScrapeAttempt < MIN_SCRAPE_INTERVAL) {
  console.log('Skipping scrape - too soon');
  return;
}
```

**2. Timeout Protection**
```javascript
await axios.get(this.url, {
  timeout: 10000  // 10 second timeout
});
```

**3. User-Agent Header**
```javascript
headers: {
  'User-Agent': 'NozawaGuideApp/1.0'
}
```
✅ Good - Identifies the scraper properly

**4. Off-Season Detection**
```javascript
// Prevents excessive scraping when ski season is closed
if (!scraper.checkIfSkiSeason()) {
  console.log('Outside ski season, skipping scrape');
  return;
}
```

**5. No On-Demand Scraping**
```javascript
// routes/lifts.js line 38-46
// NO SCRAPE ALLOWED - Only returns cached/test data
// Prevents abuse
```

### ⚠️ Security Concerns

**1. No Authentication on Scraping Endpoint**
- Currently there is NO manual scrape endpoint
- This is actually GOOD - prevents abuse
- But routes mention it: `'POST /api/lifts/scrape (POST with apiKey)'`
- **Issue:** Documentation suggests endpoint exists but it doesn't

**2. External URL Dependency**
```javascript
this.url = 'https://en.nozawaski.com/the-mountain/moutain-info/slopes-lifts/';
```
- Single point of failure
- No fallback URL
- If Nozawa changes site structure, scraper breaks

**3. No PostgreSQL Persistence**
```javascript
// Migration 008 creates lift_status_cache table
// BUT it's never used!
// Data only stored in memory variable
```
- Server restart = lost data
- No historical tracking
- No cross-instance sharing (Railway multi-instance deployment)

**4. No Error Alerting**
```javascript
catch (error) {
  console.error('Scrape failed:', error.message);
  // Just logs - no alert/notification
}
```

---

## PostgreSQL Integration Status

### ❌ Database Table Exists But Not Used

**Schema Created:**
```sql
-- migrations/008_create_lift_status_cache.sql
CREATE TABLE lift_status_cache (
  id SERIAL PRIMARY KEY,
  resort_id INTEGER NOT NULL,
  lift_data JSONB NOT NULL,
  is_off_season BOOLEAN DEFAULT false,
  scraped_at TIMESTAMP DEFAULT NOW(),
  scraper_version VARCHAR(20),
  source_url VARCHAR(500),
  UNIQUE(resort_id)
);
```

**Current Code:**
```javascript
// services/scheduler.js
let scrapeResults = null;  // In-memory only!

function setLatestScrapeResults(results) {
  scrapeResults = results;  // NOT writing to database
}
```

### Problems with Current Approach

1. **Data Loss on Restart**
   - Server restart = all cached data gone
   - Users see test data until next scrape

2. **No Multi-Instance Support**
   - Railway can run multiple instances
   - Each instance has separate cache
   - Inconsistent data across instances

3. **No Historical Data**
   - Can't track lift status over time
   - Can't generate analytics
   - Can't detect patterns

4. **No Persistence During Deployment**
   - Deploy = restart = lost cache
   - Gaps in data availability

---

## Integration with New Backend

### ✅ Currently Working

1. **Mounted in server.js:**
   ```javascript
   const liftRoutes = require('./routes/lifts');
   app.use('/api/lifts', liftRoutes);
   ```

2. **Scheduler Initialized:**
   ```javascript
   scheduler.initializeScheduler();
   ```

3. **No Security Middleware Applied:**
   - Lift endpoints don't use rate limiters
   - Public access (appropriate for read-only data)

### ❌ Missing Integration

1. **PostgreSQL Write:**
   - Scraper doesn't save to `lift_status_cache` table
   - Database table is unused

2. **V2 API:**
   - No `/api/v2/lifts` endpoint
   - No integration with PostgreSQL-backed API

3. **Dual-Write:**
   - Not part of dual-write system
   - Should write to both memory + PostgreSQL

4. **Admin Management:**
   - No admin endpoint to view scrape history
   - No manual trigger (actually good for security)
   - No scrape health monitoring

---

## Recommendations

### Priority 1: Add PostgreSQL Persistence

**Update scheduler.js:**
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setLatestScrapeResults(results) {
  // Store in memory (for fast access)
  scrapeResults = results;

  // ALSO store in PostgreSQL
  try {
    await pool.query(`
      INSERT INTO lift_status_cache (
        resort_id,
        lift_data,
        is_off_season,
        scraped_at,
        scraper_version,
        source_url
      ) VALUES ($1, $2, $3, NOW(), $4, $5)
      ON CONFLICT (resort_id)
      DO UPDATE SET
        lift_data = EXCLUDED.lift_data,
        is_off_season = EXCLUDED.is_off_season,
        scraped_at = NOW(),
        scraper_version = EXCLUDED.scraper_version
    `, [
      1,  // Nozawa resort_id
      JSON.stringify(results),
      results.isOffSeason || false,
      '1.0',
      'https://en.nozawaski.com/the-mountain/moutain-info/slopes-lifts/'
    ]);

    console.log('✅ Lift status saved to PostgreSQL');
  } catch (error) {
    console.error('❌ Failed to save to PostgreSQL:', error.message);
    // Don't throw - memory cache still works
  }
}
```

### Priority 2: Load from PostgreSQL on Startup

**Update scheduler.js initialization:**
```javascript
async function initializeScheduler() {
  console.log('Initializing lift status scheduler...');

  // Try to load last known status from PostgreSQL
  try {
    const result = await pool.query(`
      SELECT lift_data, scraped_at
      FROM lift_status_cache
      WHERE resort_id = 1
      ORDER BY scraped_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      scrapeResults = result.rows[0].lift_data;
      console.log(`✅ Loaded cached lift data from PostgreSQL (${result.rows[0].scraped_at})`);
    }
  } catch (error) {
    console.error('Failed to load cached lift data:', error.message);
  }

  // Setup cron jobs...
  cron.schedule('*/15 6-9 * * *', performScheduledScrape, { timezone: "Asia/Tokyo" });
  // ... rest of schedule
}
```

### Priority 3: Add V2 API Endpoint

**Create GET /api/v2/lifts endpoint:**
```javascript
// routes/places.js or new routes/lifts-v2.js

router.get('/lifts', async (req, res) => {
  try {
    // Feature flag check
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'Use /api/lifts/status instead'
      });
    }

    // Query PostgreSQL
    const result = await pool.query(`
      SELECT
        lift_data,
        is_off_season,
        scraped_at,
        scraper_version
      FROM lift_status_cache
      WHERE resort_id = $1
      ORDER BY scraped_at DESC
      LIMIT 1
    `, [1]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No lift data available',
        message: 'Lift status not yet scraped'
      });
    }

    const data = result.rows[0];
    res.json({
      success: true,
      ...data.lift_data,
      scrapedAt: data.scraped_at,
      source: 'postgresql',
      version: data.scraper_version
    });

  } catch (error) {
    console.error('Error fetching lifts from PostgreSQL:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});
```

### Priority 4: Add Rate Limiting

**Apply security middleware to lift endpoints:**
```javascript
// routes/lifts.js
const { apiLimiter } = require('../middleware/security');

// Apply rate limiting to prevent abuse
router.get('/status', apiLimiter, async (req, res) => {
  // existing code...
});
```

### Priority 5: Add Admin Monitoring

**Add admin endpoint to view scrape history:**
```javascript
// server.js
app.get('/api/admin/lift-scrapes', adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        scraped_at,
        is_off_season,
        scraper_version,
        (lift_data->'lifts')::jsonb as lifts_summary
      FROM lift_status_cache
      WHERE resort_id = 1
      ORDER BY scraped_at DESC
      LIMIT 100
    `);

    res.json({
      success: true,
      scrapes: result.rows,
      count: result.rows.length,
      admin: req.admin.email
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch scrape history',
      message: error.message
    });
  }
});
```

### Priority 6: Add Fallback URL

**Handle site structure changes:**
```javascript
class NozawaLiftScraper {
  constructor() {
    this.urls = [
      'https://en.nozawaski.com/the-mountain/moutain-info/slopes-lifts/',
      'https://www.nozawaski.com/en/lift-status',  // Fallback
    ];
  }

  async scrape(options = {}) {
    for (const url of this.urls) {
      try {
        const { data } = await axios.get(url, { timeout: 10000 });
        // Parse and return
        return this.parseHTML(data);
      } catch (error) {
        console.error(`Failed to scrape ${url}:`, error.message);
        // Try next URL
      }
    }

    throw new Error('All scrape URLs failed');
  }
}
```

---

## Risk Assessment

### Current Risks

| Risk | Severity | Likelihood | Impact |
|------|----------|------------|--------|
| Data loss on restart | Medium | High | Users see test data |
| Multi-instance inconsistency | Medium | Medium | Different data per instance |
| Scraper breaking (site change) | High | Medium | No lift status |
| Excessive scraping | Low | Low | Good protection |
| No historical data | Low | Low | Missing analytics |

### Mitigated Risks

| Risk | Mitigation |
|------|------------|
| Scraping too often | 5-min minimum interval |
| DDoS of Nozawa site | Scheduled only, no on-demand |
| Off-season scraping | Season check before every scrape |
| Timeout issues | 10-second timeout |

---

## Testing Recommendations

### 1. Test PostgreSQL Integration

```bash
# After implementing PostgreSQL writes
# Check data is being saved
psql "$DATABASE_URL" -c "SELECT * FROM lift_status_cache ORDER BY scraped_at DESC LIMIT 1;"
```

### 2. Test Server Restart

```bash
# 1. Restart server
npm start

# 2. Immediately check lift status
curl http://localhost:3000/api/lifts/status | jq '.'

# Expected: Should load from PostgreSQL, not test data
```

### 3. Test Off-Season Behavior

```javascript
// Temporarily change season check to always return false
// services/liftScraper.js line 29
checkIfSkiSeason() {
  return false;  // Force off-season
}

// Expected: All lifts show 'off-season', no scraping happens
```

### 4. Test Multi-Instance (Railway)

```bash
# Deploy to Railway with multiple instances
# Check if all instances show same data
# With PostgreSQL: ✅ Should be consistent
# Without PostgreSQL: ❌ May differ
```

---

## Summary

### What's Working ✅
- Scheduled scraping during ski season
- Rate limiting protection (5-min minimum)
- Off-season detection
- Timeout protection
- No on-demand scraping (prevents abuse)
- Clean error handling
- Test data fallback

### What's Missing ❌
- PostgreSQL persistence
- V2 API endpoint
- Load from database on startup
- Scrape history tracking
- Admin monitoring
- Multi-instance support
- Fallback URLs

### Recommended Actions

**Immediate (Before Ski Season):**
1. ✅ Add PostgreSQL write to scheduler
2. ✅ Load from PostgreSQL on startup
3. ✅ Test with server restarts

**Short Term (During Season):**
4. Add V2 API endpoint
5. Add admin monitoring endpoint
6. Apply rate limiting to endpoints

**Long Term (Future Seasons):**
7. Add fallback URLs
8. Track scrape history
9. Generate analytics from historical data
10. Add alerting for scrape failures

---

**Last Updated:** 2025-11-29
**Status:** Needs PostgreSQL Integration
**Priority:** Medium (before ski season starts Dec 10)
