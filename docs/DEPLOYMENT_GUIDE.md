# Nozawa Backend Deployment Guide

**Version:** 1.0
**Branch:** `feature/postgres-security-migration`
**Last Updated:** 2025-01-29

## Overview

This guide covers deploying the modernized Nozawa backend to Railway with full rollback capability. The deployment includes PostgreSQL integration, JWT authentication, rate limiting, and caching improvements.

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Variables](#environment-variables)
3. [Deployment Steps](#deployment-steps)
4. [Migration Verification](#migration-verification)
5. [Rollback Procedures](#rollback-procedures)
6. [Post-Deployment Health Checks](#post-deployment-health-checks)
7. [Monitoring](#monitoring)
8. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### 1. Code Review

- [ ] All commits reviewed and tested locally
- [ ] Frontend handoff document (`FRONTEND_HANDOFF.md`) reviewed
- [ ] All migrations tested on local PostgreSQL
- [ ] Test scripts run successfully (`test-lift-integration.js`)
- [ ] No uncommitted changes or debug code

### 2. Database Backup

**CRITICAL:** Always backup production database before deployment.

```bash
# Using Railway CLI (recommended)
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# Or using Heroku-style DATABASE_URL
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```

**Store backup securely:**
- Upload to S3/cloud storage
- Keep local copy
- Document backup timestamp and git commit SHA

### 3. Git Preparation

- [ ] Create deployment tag for rollback point
- [ ] Push all changes to remote
- [ ] Verify branch is up to date with origin

### 4. Railway Configuration

- [ ] Verify Railway project is connected to correct GitHub repo
- [ ] Check that PostgreSQL addon is provisioned
- [ ] Review current environment variables

---

## Environment Variables

### Required Variables

Verify these exist in Railway environment settings:

| Variable | Value | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | `postgresql://...` | Auto-provisioned by Railway |
| `NODE_ENV` | `production` | Enable production optimizations |
| `JWT_SECRET` | Random 32+ char string | JWT token signing (CHANGE FROM DEFAULT) |
| `PORT` | `3000` | Railway auto-provisions |

### Feature Flags (New)

Configure these to control PostgreSQL integration:

| Variable | Default | Recommended | Purpose |
|----------|---------|-------------|---------|
| `ENABLE_POSTGRES_READ` | `false` | `true` | Enable V2 PostgreSQL endpoints |
| `ENABLE_DUAL_WRITE` | `false` | `true` | Write to both JSON + PostgreSQL |
| `WEATHER_CACHE_MINUTES` | `10` | `10` | Weather cache lifetime |
| `LIFT_SCRAPE_INTERVAL_MINUTES` | `30` | `30` | Lift scraping frequency |

### Security Variables (New)

| Variable | Value | Purpose |
|----------|-------|---------|
| `JWT_EXPIRES_IN` | `24h` | JWT token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing strength |

### Recommended Initial Deployment Settings

For a gradual rollout, start with conservative settings:

```env
# Conservative deployment (Phase 1)
ENABLE_POSTGRES_READ=false
ENABLE_DUAL_WRITE=true
```

This writes to PostgreSQL but frontend still uses V1 JSON endpoints. Allows testing PostgreSQL integration without user impact.

**Phase 2 (after verification):**

```env
ENABLE_POSTGRES_READ=true
ENABLE_DUAL_WRITE=true
```

Enables V2 endpoints while maintaining backward compatibility.

**Phase 3 (final state):**

```env
ENABLE_POSTGRES_READ=true
ENABLE_DUAL_WRITE=false
```

PostgreSQL becomes single source of truth (JSON files deprecated).

---

## Deployment Steps

### Step 1: Create Rollback Point

**Tag current production state BEFORE deploying:**

```bash
# Get current commit SHA from production
railway logs --tail 50 | grep "Starting Nozawa Backend"

# Create rollback tag
git tag -a v1.0.0-pre-postgres-migration \
  -m "Rollback point before PostgreSQL migration - $(date)"

# Push tag to remote
git push origin v1.0.0-pre-postgres-migration
```

**Document this tag SHA** - you'll need it for rollback.

### Step 2: Verify Local Tests

```bash
# Run server locally with production-like settings
export DATABASE_URL="your-local-postgres-url"
export NODE_ENV=development
export ENABLE_POSTGRES_READ=true
export ENABLE_DUAL_WRITE=true

node server.js

# Test endpoints
curl http://localhost:3000/api/v2/health
curl http://localhost:3000/api/weather/current
curl http://localhost:3000/api/lifts/status
```

All should return `200 OK`.

### Step 3: Deploy to Railway

**Option A: Automatic Deploy (via GitHub push)**

```bash
# Push to branch connected to Railway
git checkout feature/postgres-security-migration
git push origin feature/postgres-security-migration
```

Railway will auto-deploy if GitHub integration is configured.

**Option B: Manual Deploy (Railway CLI)**

```bash
# Install Railway CLI if not already installed
npm i -g @railway/cli

# Login and link project
railway login
railway link

# Deploy current branch
railway up
```

### Step 4: Monitor Deployment

Watch deployment logs in Railway dashboard:

```bash
# Or via CLI
railway logs --tail 100
```

**Look for:**
- ✅ "PostgreSQL connection pool initialized"
- ✅ "Weather cache loaded from PostgreSQL"
- ✅ "Lift status loaded from PostgreSQL"
- ✅ "Server running on port 3000"
- ✅ "Scheduler initialized for Nozawa Onsen (JST)"

**Red flags:**
- ❌ Database connection errors
- ❌ Migration errors
- ❌ "ECONNREFUSED" PostgreSQL errors
- ❌ Server crash loops

---

## Migration Verification

### Step 1: Database Schema Check

Verify all migrations ran successfully:

```bash
# Via Railway CLI
railway run psql $DATABASE_URL -c "\dt"

# Should show these tables:
# resorts
# places
# google_place_data
# local_knowledge
# lift_status_cache
# weather_cache
# admin_users
```

**Check latest migration:**

```sql
-- Run in Railway console
SELECT tablename, schemaname
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected tables (12 total):
1. `resorts`
2. `places`
3. `google_place_data`
4. `local_knowledge`
5. `lift_status_cache`
6. `weather_cache`
7. `admin_users`
8. Views: `places_with_merged_data`

### Step 2: Test V2 Endpoints

```bash
# Replace with your Railway domain
BASE_URL="https://your-app.railway.app"

# Health check
curl $BASE_URL/api/v2/health | jq .

# Expected response:
# {
#   "success": true,
#   "database": "connected",
#   "featureFlags": {
#     "postgresRead": true,
#     "dualWrite": true
#   }
# }

# Weather endpoint
curl $BASE_URL/api/weather/current | jq .

# Lift status
curl $BASE_URL/api/lifts/status | jq .

# Places list (V2)
curl "$BASE_URL/api/v2/places?limit=5" | jq .
```

**All should return `200 OK` with valid JSON.**

### Step 3: Verify Caching

```bash
# First request (should fetch from API)
curl $BASE_URL/api/weather/current | jq '.cached'
# Expected: false or null (fresh fetch)

# Second request within 10 minutes (should use cache)
curl $BASE_URL/api/weather/current | jq '.cached'
# Expected: true
```

### Step 4: Admin Panel Test

```bash
# Login
curl -X POST $BASE_URL/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}' \
  | jq .

# Expected: { "token": "eyJ...", "admin": {...} }

# Use token for authenticated request
TOKEN="<token from login>"
curl $BASE_URL/api/admin/places-data \
  -H "Authorization: Bearer $TOKEN" \
  | jq .

# Expected: { "places": [...], "stats": {...} }
```

---

## Rollback Procedures

### Option 1: Git Revert (Fastest)

**Use this if deployment fails during startup.**

```bash
# Revert to tagged commit
git checkout v1.0.0-pre-postgres-migration

# Force deploy old version
git push origin v1.0.0-pre-postgres-migration:feature/postgres-security-migration --force

# Railway will auto-deploy the old version
```

**Database Note:** PostgreSQL data remains unchanged. New tables (weather_cache, lift_status_cache) are ignored by old code.

### Option 2: Feature Flag Rollback (Safest)

**Use this if deployment succeeds but issues occur in production.**

No code changes needed - just update environment variables in Railway:

```env
ENABLE_POSTGRES_READ=false
ENABLE_DUAL_WRITE=false
```

**Effect:**
- V2 endpoints return `503 Service Unavailable`
- All traffic routes to V1 JSON endpoints
- PostgreSQL tables remain but unused
- No data loss

**Redeploy not required** - Railway auto-restarts on env var changes.

### Option 3: Database Rollback (Nuclear)

**Only use if database corruption occurs.**

```bash
# Restore from backup created in pre-deployment step
railway run psql $DATABASE_URL < backup-20250129-143022.sql

# Verify restore
railway run psql $DATABASE_URL -c "SELECT COUNT(*) FROM places;"
```

**WARNING:** This will lose any data created after backup timestamp.

### Option 4: Migration Rollback

**Use if specific migration causes issues.**

Create a down migration (manual):

```sql
-- Example: Rollback weather_cache table
DROP TABLE IF EXISTS weather_cache CASCADE;
```

**Not recommended** - better to use Feature Flag Rollback.

---

## Post-Deployment Health Checks

### 1. Endpoint Availability

Test all critical endpoints:

```bash
BASE_URL="https://your-app.railway.app"

# Root endpoint
curl $BASE_URL/ | jq .

# V1 endpoints (backward compatibility)
curl $BASE_URL/api/restaurants | jq '.length'
curl $BASE_URL/api/onsens | jq '.length'
curl $BASE_URL/api/lifts/status | jq .
curl $BASE_URL/api/weather/current | jq .

# V2 endpoints (new)
curl $BASE_URL/api/v2/places | jq '.pagination'
curl $BASE_URL/api/v2/lifts | jq '.source'
curl $BASE_URL/api/v2/weather | jq '.source'

# Admin endpoints
curl $BASE_URL/api/admin/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}' \
  | jq .
```

### 2. Performance Check

Monitor response times:

```bash
# Use httpie or curl with timing
time curl -s $BASE_URL/api/v2/places > /dev/null

# Expected: < 100ms for cached data
# Expected: < 500ms for fresh PostgreSQL queries
```

### 3. Cache Verification

```bash
# Check weather cache status
curl $BASE_URL/api/weather/cache-status | jq .

# Expected response:
# {
#   "cache": {
#     "memory": { "fresh": true, "ageSeconds": 45 },
#     "configured": { "lifetimeMinutes": 10 }
#   }
# }
```

### 4. Database Connection Pool

Check Railway logs for pool stats:

```bash
railway logs --tail 100 | grep "pool"
```

Expected: No pool exhaustion warnings.

### 5. Rate Limiting

Test rate limits are working:

```bash
# Spam endpoint (should get rate limited)
for i in {1..150}; do
  curl -s $BASE_URL/api/weather/current > /dev/null
  echo "Request $i"
done

# After ~100 requests, should see:
# "Too many requests, please try again later."
```

---

## Monitoring

### Key Metrics to Watch

1. **Response Times**
   - V1 endpoints: Should remain unchanged
   - V2 endpoints: < 100ms (cached), < 500ms (PostgreSQL)

2. **Error Rates**
   - Watch for 500 errors in logs
   - Monitor PostgreSQL connection errors

3. **Cache Hit Rates**
   - Check `/api/weather/cache-status` regularly
   - Should see `cached: true` for most weather requests

4. **Database Connections**
   - Railway metrics: Active connections should be < 10
   - Watch for "too many connections" errors

5. **Memory Usage**
   - Railway metrics: Memory should be stable
   - Watch for memory leaks (gradual increase)

### Railway Dashboard

**Metrics to check:**
- Deployment status: "Active"
- Health check: Passing
- Memory: Stable around 150-250 MB
- CPU: < 30% average
- Network: Healthy response times

### Log Monitoring

**Watch for these patterns:**

```bash
# Good signs:
✅ Weather cache loaded from PostgreSQL
✅ Lift status loaded from PostgreSQL
✅ Cache hit (source: memory)

# Warning signs:
⚠️  Open-Meteo API failed, returning stale cache
⚠️  PostgreSQL query slow (>1000ms)

# Critical errors:
❌ Database connection failed
❌ Migration failed
❌ Server crash
```

### Alerts to Configure

Set up Railway alerts for:
- Deployment failures
- Memory > 80% for 5 minutes
- Response time > 2 seconds
- Error rate > 5% for 5 minutes

---

## Troubleshooting

### Issue 1: "PostgreSQL read not enabled"

**Symptoms:**
```json
{
  "error": "PostgreSQL read not enabled",
  "message": "This endpoint requires ENABLE_POSTGRES_READ=true"
}
```

**Fix:**
```bash
# Set environment variable in Railway
ENABLE_POSTGRES_READ=true

# Railway will auto-restart server
```

**Verify:**
```bash
curl $BASE_URL/api/v2/health | jq '.featureFlags.postgresRead'
# Expected: true
```

---

### Issue 2: Migration Not Applied

**Symptoms:**
```
ERROR: relation "weather_cache" does not exist
```

**Fix:**

```bash
# Check which migrations have run
railway run psql $DATABASE_URL -c "\dt"

# If table missing, run migration manually
railway run psql $DATABASE_URL -f migrations/012_create_weather_cache.sql

# Or use Node.js script
railway run node run-weather-migration.js
```

---

### Issue 3: Admin Login Fails

**Symptoms:**
```json
{
  "error": "Invalid credentials"
}
```

**Possible Causes:**

1. **JWT_SECRET changed** (invalidates existing tokens)
   - Solution: Login again to get new token

2. **Admin user not seeded**
   - Check: `railway run psql $DATABASE_URL -c "SELECT * FROM admin_users;"`
   - Fix: Run `migrations/004_create_admin_users.sql`

3. **Password incorrect**
   - Default: `admin@nozawa.com` / `NozawaAdmin2024!`
   - Change via admin panel after first login

---

### Issue 4: Stale Cache Returned

**Symptoms:**
```json
{
  "cached": true,
  "stale": true,
  "warning": "Weather data may be outdated due to API failure"
}
```

**Cause:** Open-Meteo API is down or rate limited.

**Fix:**
- This is expected behavior (graceful degradation)
- Cache will refresh when API becomes available
- Monitor logs for API recovery

**If persistent:**
```bash
# Clear PostgreSQL cache to force refresh
railway run psql $DATABASE_URL -c "TRUNCATE weather_cache;"

# Next request will fetch fresh data
```

---

### Issue 5: Rate Limiting Too Aggressive

**Symptoms:** Users getting `429 Too Many Requests` frequently.

**Fix:** Adjust rate limits in `middleware/security.js`:

```javascript
// Current: 100 requests per minute
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100  // Increase to 200 if needed
});
```

Redeploy after changes.

---

### Issue 6: Database Connection Pool Exhausted

**Symptoms:**
```
Error: sorry, too many clients already
```

**Fix:**

```javascript
// In all route files (places.js, weather.js, etc.)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,  // Add this
  idleTimeoutMillis: 30000,  // Add this
  connectionTimeoutMillis: 2000  // Add this
});
```

**Or** increase Railway PostgreSQL plan limits.

---

### Issue 7: Scheduler Not Running

**Symptoms:** Lift data not updating every 30 minutes.

**Check logs:**
```bash
railway logs | grep "Scheduler initialized"
railway logs | grep "Scheduled scrape"
```

**Expected:**
```
Scheduler initialized for Nozawa Onsen (JST)
Scheduled scrape: Every 30 minutes (JST)
Running scheduled scrape...
```

**If missing:**

1. Check `services/scheduler.js` is being loaded in `server.js`
2. Verify `NODE_ENV` is set (scheduler doesn't run in test mode)
3. Check for errors during scheduler initialization

---

## Deployment Checklist Summary

### Pre-Deployment

- [ ] Database backup created and stored
- [ ] Git tag created (`v1.0.0-pre-postgres-migration`)
- [ ] Local tests passing
- [ ] Frontend team has handoff document
- [ ] Environment variables reviewed

### Deployment

- [ ] Code deployed to Railway
- [ ] Deployment logs show no errors
- [ ] All migrations applied successfully
- [ ] Server started without crashes

### Post-Deployment

- [ ] `/api/v2/health` returns `200 OK`
- [ ] V1 endpoints still working (backward compatibility)
- [ ] V2 endpoints working (if `ENABLE_POSTGRES_READ=true`)
- [ ] Admin login successful
- [ ] Weather caching working
- [ ] Lift scraping working
- [ ] Rate limiting working
- [ ] Response times acceptable
- [ ] No error spikes in logs

### Rollback Readiness

- [ ] Rollback tag documented
- [ ] Backup location documented
- [ ] Feature flag rollback tested
- [ ] Team knows rollback procedures

---

## Support and Next Steps

### After Successful Deployment

1. **Monitor for 24-48 hours**
   - Watch Railway metrics
   - Check logs regularly
   - Monitor user reports

2. **Gradual Feature Flag Rollout**
   - Start: `ENABLE_POSTGRES_READ=false`
   - Phase 2: `ENABLE_POSTGRES_READ=true` (after 1 week)
   - Phase 3: `ENABLE_DUAL_WRITE=false` (after 2 weeks)

3. **Frontend Migration**
   - Share `FRONTEND_HANDOFF.md` with frontend team
   - Support frontend during V2 migration
   - Coordinate testing

4. **Deprecate JSON Files**
   - After frontend fully migrated to V2
   - Archive `nozawa_*.json` files
   - Remove JSON write code

### Documentation

- **Frontend:** `docs/FRONTEND_HANDOFF.md`
- **Lift Integration:** `docs/LIFT_SCRAPING_REVIEW.md`
- **Weather Integration:** `docs/WEATHER_INTEGRATION_REVIEW.md`
- **Architecture:** `docs/WEATHER_ARCHITECTURE_FUTURE_STATE.md`
- **This Guide:** `docs/DEPLOYMENT_GUIDE.md`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-29 | Initial deployment guide |

---

**Questions or Issues?**

1. Check Railway logs first
2. Review troubleshooting section
3. Try feature flag rollback if needed
4. Restore from backup as last resort
