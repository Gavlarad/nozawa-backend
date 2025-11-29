# Weather Architecture: Future State with PostgreSQL

**Date:** November 29, 2025
**Topic:** Weather Data Update Frequency & Architecture

---

## Current vs. Future State Comparison

### Current State (No PostgreSQL)

```
┌─────────────────────────────────────────────────────────────┐
│                    EVERY CLIENT REQUEST                      │
│               GET /api/weather/current                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   Express Server      │
                │   (server.js)         │
                │                       │
                │   No cache check      │
                │   No rate limit       │
                └───────────┬───────────┘
                            │
                            ▼
        ┌───────────────────┴───────────────────┐
        │          Fetch from Open-Meteo        │
        │          (3 parallel API calls)       │
        │          ~500ms per request           │
        └───────────────────┬───────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  Return JSON  │
                    └───────────────┘

Issues:
❌ Every request = 3 external API calls
❌ No caching = slow responses
❌ No persistence = data lost on restart
❌ No rate limiting = vulnerable to abuse
```

---

## Future State: Two Possible Approaches

### Approach A: On-Demand with PostgreSQL Cache (RECOMMENDED)

This is the **smart hybrid** approach - similar to how modern CDNs work.

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT REQUEST                            │
│               GET /api/weather/current                       │
│               (Rate Limited: 100/min)                        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Weather Service      │
                │  (weatherService.js)  │
                └───────────┬───────────┘
                            │
                    ┌───────┴────────┐
                    │ Check Cache    │
                    │ Age < 10min?   │
                    └───┬────────┬───┘
                        │        │
                    YES │        │ NO (expired or missing)
                        │        │
                        ▼        ▼
            ┌──────────────┐   ┌──────────────────────┐
            │ PostgreSQL   │   │  Fetch Open-Meteo    │
            │ (weather_    │   │  (3 parallel calls)  │
            │  cache)      │   │  ~500ms              │
            │              │   └──────────┬───────────┘
            │ Return       │              │
            │ cached data  │              ▼
            │ ~10ms        │   ┌──────────────────────┐
            └──────────────┘   │ Save to PostgreSQL   │
                   │           │ expires_at = NOW()   │
                   │           │   + 10 minutes       │
                   │           └──────────┬───────────┘
                   │                      │
                   └──────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Return to      │
                    │  Client         │
                    │  with metadata  │
                    └─────────────────┘
```

**Data Update Frequency:**
- ⏱️ **Cache Lifetime:** 10 minutes
- 🔄 **Update Trigger:** First request after cache expiry
- 📊 **Typical Pattern:**
  - 09:00:00 - User requests weather → Cache miss → Fetch Open-Meteo → Store in PostgreSQL
  - 09:00:30 - User requests weather → Cache HIT (9.5 min remaining)
  - 09:05:00 - User requests weather → Cache HIT (5 min remaining)
  - 09:10:01 - User requests weather → Cache MISS (expired) → Fetch Open-Meteo → Update PostgreSQL
  - And so on...

**Actual API Call Frequency:**
- Depends on traffic
- High traffic (100 users/hour): ~6 API calls/hour (every 10 min)
- Low traffic (10 users/day): ~2-3 API calls/day (only when someone requests)
- **Zero traffic:** Zero API calls (efficient!)

**Benefits:**
- ✅ Efficient (only fetches when needed)
- ✅ Fast (most requests served from cache in ~10ms)
- ✅ Resilient (PostgreSQL persists across restarts)
- ✅ Multi-instance safe (all Railway instances share PostgreSQL)
- ✅ Works during off-season (no unnecessary fetches)

**Drawbacks:**
- ⚠️ First request after expiry is slower (~500ms)
- ⚠️ Requires client to trigger updates

---

### Approach B: Scheduled Background Updates (Like Lift Scraping)

This mirrors the current lift scraping architecture.

```
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND SCHEDULER (Cron Job)                 │
│                    Every 10 Minutes                          │
│          */10 * * * * (JST timezone)                         │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Weather Scheduler    │
                │  (scheduler.js)       │
                │                       │
                │  performWeatherFetch()│
                └───────────┬───────────┘
                            │
                            ▼
        ┌───────────────────┴───────────────────┐
        │          Fetch from Open-Meteo        │
        │          (3 parallel API calls)       │
        │          ~500ms                       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Save to PostgreSQL   │
                │  (weather_cache)      │
                │                       │
                │  Also store in-memory │
                │  for fast access      │
                └───────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    CLIENT REQUEST                            │
│               GET /api/weather/current                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Weather Service      │
                │                       │
                │  1. Check in-memory   │
                │  2. If empty, check   │
                │     PostgreSQL        │
                │  3. Return cached     │
                │     (always fast!)    │
                └───────────┬───────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  Return data  │
                    │  ~5-10ms      │
                    └───────────────┘
```

**Data Update Frequency:**
- ⏱️ **Scheduled Updates:** Every 10 minutes (24/7)
- 🔄 **Update Trigger:** Cron job (independent of client requests)
- 📊 **Typical Pattern:**
  - 09:00:00 - Cron job fetches weather → Saves to PostgreSQL
  - 09:10:00 - Cron job fetches weather → Saves to PostgreSQL
  - 09:20:00 - Cron job fetches weather → Saves to PostgreSQL
  - Continuous updates regardless of traffic

**Actual API Call Frequency:**
- Fixed: **144 API calls per day** (every 10 minutes × 24 hours)
- Same frequency regardless of user traffic
- Runs even during off-season or at 3 AM with zero users

**Benefits:**
- ✅ All client requests are fast (~5ms)
- ✅ Data always fresh (max 10 min old)
- ✅ Consistent with lift scraping architecture
- ✅ Predictable behavior

**Drawbacks:**
- ⚠️ Wasteful (fetches even when no one is using the app)
- ⚠️ Uses 144 of 10,000 daily API quota (1.44%) regardless of need
- ⚠️ More complex (requires scheduler, cron jobs)
- ⚠️ During off-season: Fetches data that's never used

---

## Detailed Comparison

| Aspect | Approach A: On-Demand | Approach B: Scheduled | Winner |
|--------|----------------------|----------------------|--------|
| **API Calls (High Traffic)** | ~144/day | 144/day | 🟰 Tie |
| **API Calls (Low Traffic)** | ~10/day | 144/day | ✅ Approach A (90% savings) |
| **API Calls (Zero Traffic)** | 0/day | 144/day | ✅ Approach A (100% savings) |
| **Response Time (Cache Hit)** | 10ms | 5ms | 🟰 Tie (both fast) |
| **Response Time (Cache Miss)** | 500ms | N/A (no misses) | ✅ Approach B (always fast) |
| **Max Data Staleness** | 10 min | 10 min | 🟰 Tie |
| **Complexity** | Low | Medium | ✅ Approach A (simpler) |
| **Efficiency** | High | Medium | ✅ Approach A (adaptive) |
| **Consistency with Lifts** | Different | Same | ✅ Approach B (consistent) |
| **Off-Season Waste** | None | High | ✅ Approach A (no waste) |
| **Requires Cron Jobs** | ❌ No | ✅ Yes | ✅ Approach A (simpler) |
| **Multi-Instance Safe** | ✅ Yes | ✅ Yes | 🟰 Tie |
| **Server Restart Resilience** | ✅ Yes | ✅ Yes | 🟰 Tie |

---

## Why Weather is Different from Lifts

It's important to understand **why weather and lift scraping should use different update strategies**:

### Lift Scraping Characteristics
```
Data Source:     Nozawa website (requires web scraping)
Availability:    Only reliable during operating hours (6am-9pm JST)
Update Pattern:  Changes frequently during ski season
Seasonality:     Dec 10 - Apr 30 only
Access Method:   HTML parsing (fragile, can break)
Update Cost:     Medium (scraping overhead)
Criticality:     High (users need real-time lift status)
Best Strategy:   ✅ Scheduled background scraping
                 - Proactive updates during operating hours
                 - Handles scraping errors gracefully
                 - Data always ready for users
```

### Weather API Characteristics
```
Data Source:     Open-Meteo API (stable REST endpoint)
Availability:    24/7/365 reliable access
Update Pattern:  Updates every 15 minutes on their end
Seasonality:     Year-round relevance
Access Method:   Simple HTTP GET (reliable)
Update Cost:     Low (just an API call)
Criticality:     Medium (weather changes slowly)
Best Strategy:   ✅ On-demand with caching
                 - Only fetch when users need it
                 - Simple and efficient
                 - No unnecessary API calls
```

**Key Difference:** Lifts require **proactive scraping** because the data source is fragile and time-sensitive. Weather can use **reactive fetching** because the API is reliable and always available.

---

## Recommended Architecture: Hybrid Approach

**Best of both worlds:**

```javascript
// services/weatherService.js

class WeatherService {
  constructor() {
    this.memoryCache = { data: null, timestamp: null };
    this.CACHE_LIFETIME = 10 * 60 * 1000; // 10 minutes
  }

  async getCurrentWeather() {
    // 1. Check in-memory cache first (fastest)
    if (this.isMemoryCacheFresh()) {
      return {
        ...this.memoryCache.data,
        source: 'memory',
        cached: true,
        age: Math.round((Date.now() - this.memoryCache.timestamp) / 1000)
      };
    }

    // 2. Check PostgreSQL cache (fast, persistent)
    const pgCache = await this.loadFromPostgreSQL();
    if (pgCache && !this.isCacheExpired(pgCache.expires_at)) {
      // Store in memory for next request
      this.memoryCache = {
        data: pgCache.weather_data,
        timestamp: new Date(pgCache.fetched_at).getTime()
      };

      return {
        ...pgCache.weather_data,
        source: 'postgresql',
        cached: true,
        age: Math.round((Date.now() - new Date(pgCache.fetched_at)) / 1000)
      };
    }

    // 3. Cache expired/missing - fetch fresh data
    try {
      const weatherData = await this.fetchFromOpenMeteo();
      const snowLine = this.calculateSnowLine(weatherData);

      // Save to PostgreSQL with 10-minute expiry
      await this.saveToPostgreSQL(weatherData, snowLine);

      // Also save to memory
      this.memoryCache = {
        data: { ...weatherData, snow_line: snowLine },
        timestamp: Date.now()
      };

      return {
        ...weatherData,
        snow_line: snowLine,
        source: 'open-meteo',
        cached: false
      };

    } catch (error) {
      // 4. Fallback to stale cache if Open-Meteo fails
      if (pgCache) {
        console.warn('⚠️ Open-Meteo API failed, returning stale cache');
        return {
          ...pgCache.weather_data,
          source: 'postgresql-stale',
          cached: true,
          stale: true,
          warning: 'Weather data may be outdated due to API failure'
        };
      }
      throw error; // No fallback available
    }
  }

  isMemoryCacheFresh() {
    if (!this.memoryCache.timestamp) return false;
    return (Date.now() - this.memoryCache.timestamp) < this.CACHE_LIFETIME;
  }

  isCacheExpired(expiresAt) {
    return new Date() > new Date(expiresAt);
  }

  async loadFromPostgreSQL() {
    const result = await pool.query(`
      SELECT weather_data, snow_line, fetched_at, expires_at
      FROM weather_cache
      WHERE resort_id = $1
      ORDER BY fetched_at DESC
      LIMIT 1
    `, [1]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async saveToPostgreSQL(weatherData, snowLine) {
    const expiresAt = new Date(Date.now() + this.CACHE_LIFETIME);

    await pool.query(`
      INSERT INTO weather_cache (
        resort_id, weather_data, snow_line,
        village_temp_c, summit_temp_c,
        fetched_at, expires_at, source_url
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
      ON CONFLICT (resort_id)
      DO UPDATE SET
        weather_data = EXCLUDED.weather_data,
        snow_line = EXCLUDED.snow_line,
        village_temp_c = EXCLUDED.village_temp_c,
        summit_temp_c = EXCLUDED.summit_temp_c,
        fetched_at = NOW(),
        expires_at = EXCLUDED.expires_at,
        source_url = EXCLUDED.source_url
    `, [
      1, // resort_id
      JSON.stringify(weatherData),
      snowLine,
      weatherData.levels[0].current.temperature_2m,
      weatherData.levels[2].current.temperature_2m,
      expiresAt,
      'https://api.open-meteo.com'
    ]);

    console.log('✅ Weather data saved to PostgreSQL');
  }

  async fetchFromOpenMeteo() {
    // Existing 3-parallel-API-call logic
    // ...
  }

  calculateSnowLine(weatherData) {
    // Existing snow line calculation
    // ...
  }
}

module.exports = new WeatherService();
```

---

## Update Frequency Scenarios

### Scenario 1: Peak Season, Heavy Traffic (100 users/hour)

```
Time      Event                      Action                    API Calls
───────────────────────────────────────────────────────────────────────
09:00:00  User 1 requests weather   Cache MISS → Fetch         3 calls
09:00:15  User 2 requests weather   Cache HIT (memory)         0 calls
09:00:30  User 3 requests weather   Cache HIT (memory)         0 calls
...
09:09:45  User 40 requests weather  Cache HIT (memory)         0 calls
09:10:05  User 41 requests weather  Cache EXPIRED → Fetch      3 calls
09:10:20  User 42 requests weather  Cache HIT (memory)         0 calls
...
09:19:55  User 80 requests weather  Cache HIT (memory)         0 calls
09:20:10  User 81 requests weather  Cache EXPIRED → Fetch      3 calls
...

Total in 1 hour: 6 fetches × 3 calls = 18 API calls
                 (vs 94 cache hits = 0 API calls)

Cache Hit Rate: 94/100 = 94%
API Call Savings: 82 avoided API calls
```

### Scenario 2: Off-Season, Low Traffic (5 users/day)

```
Time      Event                      Action                    API Calls
───────────────────────────────────────────────────────────────────────
10:00:00  User 1 requests weather   Cache MISS → Fetch         3 calls
14:30:00  User 2 requests weather   Cache EXPIRED → Fetch      3 calls
18:45:00  User 3 requests weather   Cache EXPIRED → Fetch      3 calls
20:15:00  User 4 requests weather   Cache EXPIRED → Fetch      3 calls
21:00:00  User 5 requests weather   Cache HIT (15 min old)     0 calls

Total in 24 hours: 4 fetches × 3 calls = 12 API calls
                   (vs scheduled approach: 144 API calls)

Efficiency: 92% reduction in API calls vs. scheduled approach
```

### Scenario 3: Server Restart During Peak Season

```
Time      Event                      Action                    Recovery
───────────────────────────────────────────────────────────────────────
09:00:00  Weather cached            PostgreSQL has fresh data  -
09:05:00  ⚠️ Server restart         Memory cache lost!         -
09:05:10  Server starts up          Memory empty               -
09:05:15  User requests weather     Check PostgreSQL → HIT!    Instant recovery
09:05:16  Data loaded to memory     Subsequent requests fast   -

Result: Zero downtime, seamless recovery from PostgreSQL
```

### Scenario 4: Open-Meteo API Outage

```
Time      Event                      Action                    Fallback
───────────────────────────────────────────────────────────────────────
10:00:00  Cache expires             Try to fetch → FAILS       -
10:00:01  Check PostgreSQL          Data exists (stale)        ✅ Return stale
10:00:02  Return to user            With warning message       "Data may be outdated"
10:05:00  Cache still expired       Try to fetch → FAILS       -
10:05:01  Return stale again        PostgreSQL fallback        ✅ Graceful degradation
10:15:00  Open-Meteo recovers       Fetch succeeds             ✅ Fresh data again

Result: Service continues during API outage using stale cache
```

---

## Configuration Options

You can make the update frequency configurable via environment variables:

```bash
# .env
WEATHER_CACHE_MINUTES=10           # Cache lifetime (default: 10 min)
WEATHER_ENABLE_SCHEDULED=false     # Use scheduled updates? (default: false)
WEATHER_SCHEDULE_CRON='*/10 * * * *'  # If scheduled, how often?
```

This allows you to:
- Start with on-demand (efficient)
- Switch to scheduled later if needed (consistent with lifts)
- Adjust cache lifetime based on usage patterns

---

## Recommended Approach: On-Demand with PostgreSQL

**Final Recommendation: Approach A (On-Demand with PostgreSQL Cache)**

**Rationale:**
1. ✅ **Efficient:** Only fetches when needed (90%+ API call savings during low traffic)
2. ✅ **Fast:** Most requests served from cache in ~10ms
3. ✅ **Resilient:** PostgreSQL provides persistence and fallback
4. ✅ **Simple:** No cron jobs needed
5. ✅ **Flexible:** Works great during both peak season and off-season
6. ✅ **Reliable:** Open-Meteo API is stable (unlike web scraping)

**When Weather is Fetched:**
- First request after server start
- First request after cache expires (every 10 minutes, if traffic exists)
- Manually via admin endpoint (optional: `/api/admin/refresh-weather`)

**Typical Update Pattern (Peak Season):**
- 6 AM: First user checks weather → Fetch from Open-Meteo
- 6:10 AM: Cache expires, next user → Fetch from Open-Meteo
- 6:20 AM: Cache expires, next user → Fetch from Open-Meteo
- Continues every ~10 minutes as long as users are active

**Typical Update Pattern (Off-Season):**
- 2 PM: Tourist checks weather → Fetch from Open-Meteo
- 8 PM: Another tourist checks weather → Fetch from Open-Meteo (previous cache expired)
- Total: 2-5 fetches per day instead of 144

**Data Freshness Guarantee:**
- Maximum staleness: 10 minutes
- Average staleness: 5 minutes
- 99% of requests: < 1 second old (served from memory cache)

---

## Summary

**Update Frequency with PostgreSQL Integration:**

```
┌─────────────────────────────────────────────────────────────┐
│                    UPDATE FREQUENCY                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Cache Lifetime:        10 minutes                          │
│  Update Trigger:        First request after cache expiry    │
│  Fallback Strategy:     Return stale cache if API fails     │
│  Persistence:           PostgreSQL (survives restarts)       │
│  Fast Path:             In-memory cache (~5ms)              │
│  Medium Path:           PostgreSQL cache (~10ms)            │
│  Slow Path:             Open-Meteo API (~500ms)             │
│                                                              │
│  Typical API Calls:                                          │
│  - Peak season:         ~144/day (same as scheduled)        │
│  - Off-season:          ~10/day (90% reduction!)            │
│  - Zero traffic:        0/day (100% reduction!)             │
│                                                              │
│  Response Times:                                             │
│  - 98% of requests:     < 10ms (cache hit)                  │
│  - 2% of requests:      ~500ms (cache miss)                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**The PostgreSQL integration gives you:**
- ✅ Persistence across server restarts
- ✅ Shared cache across Railway instances
- ✅ Historical data for analysis
- ✅ Graceful degradation during API failures
- ✅ Consistency with the rest of your modernized backend

**But keeps it efficient by:**
- ⚡ Only fetching when users actually need the data
- 🎯 Adaptive behavior (busy during peak season, quiet during off-season)
- 💾 Multi-tier caching (memory → PostgreSQL → API)

This is the sweet spot: **PostgreSQL for reliability, on-demand for efficiency.**
