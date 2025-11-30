# Next Phase Rollout Plan

**Date:** December 1, 2025
**Current Phase:** 2.5 (V2 API enabled, Dual-write NOW enabled)
**Next Phase:** 3.0 (Full dual-write validation + Frontend migration)

---

## What Just Happened

✅ **Dual-write has been enabled** in your `.env` file
✅ **PostgreSQL read remains enabled** (V2 API available)
✅ **Test scripts created** for validation and monitoring

**Current Configuration:**
```bash
ENABLE_POSTGRES_READ=true   # V2 API endpoints active
ENABLE_DUAL_WRITE=true      # Admin edits sync to both JSON + PostgreSQL
```

---

## Phase 3: Validation & Stabilization (This Week)

### Step 1: Test Dual-Write Locally (30 minutes)

**A. Start the server:**
```bash
npm start
```

**B. Run the test script:**
```bash
./test-dual-write.sh
```

This will check:
- Server health
- Admin authentication
- Data consistency
- V2 API functionality

**C. Manual test via admin panel:**
1. Open your admin panel (admin.html)
2. Make a small edit to any place (e.g., change a description)
3. Save changes
4. **Check the response** for:
   ```json
   {
     "dual_write": {
       "enabled": true,
       "json": { "success": true },
       "postgresql": { "success": true, "updated": 97 }
     }
   }
   ```
5. Verify both JSON file and database were updated

**Expected outcome:** Both JSON and PostgreSQL update successfully ✅

---

### Step 2: Deploy to Railway (1 hour)

**A. Update Railway environment variable:**

Option 1 - Via Railway Dashboard:
1. Go to your Railway project
2. Navigate to Variables tab
3. Add/update: `ENABLE_DUAL_WRITE=true`
4. Railway will auto-redeploy

Option 2 - Via Railway CLI:
```bash
railway variables set ENABLE_DUAL_WRITE=true
```

**B. Monitor deployment:**
```bash
railway logs --tail 100
```

Look for:
- ✅ "Server running on port 3000"
- ✅ "Database connected successfully"
- ✅ "Dual-write enabled: true"
- ❌ Any PostgreSQL errors

**C. Verify production:**
```bash
# Replace with your Railway domain
./monitor-sync.sh https://your-app.railway.app
```

---

### Step 3: Monitor for 1 Week (Ongoing)

**Daily monitoring (5 minutes/day):**

```bash
# Run consistency check
./monitor-sync.sh https://your-app.railway.app

# Check logs
railway logs --tail 50 | grep -E "(dual-write|PostgreSQL)"
```

**What to watch for:**
- ✅ `dual_write.postgresql.success: true` in save responses
- ✅ Consistency validation passes daily
- ❌ "PostgreSQL transaction failed" errors
- ❌ Increasing discrepancy in counts

**If you see errors:**
1. Check Railway database is running
2. Verify DATABASE_URL is correct
3. Review PostgreSQL logs
4. Check connection pool limits

---

## Phase 4: Frontend Migration (Week 2-3)

### Prerequisites
- [ ] Dual-write running smoothly for 1 week
- [ ] Zero consistency errors in logs
- [ ] Daily validation checks passing

### Frontend Changes Required

**Update API endpoints:**

| Old (V1) | New (V2) | Change |
|----------|----------|--------|
| `/api/restaurants` | `/api/v2/places?category=restaurant` | Add `?category=restaurant` |
| `/api/restaurants/:id` | `/api/v2/places/:id` | Same path, different base |
| `/api/onsens` | `/api/v2/places?category=onsen` | Unified endpoint |
| `/api/lifts/status` | `/api/v2/lifts` | Change path |

**Response format changes:**

V2 adds pagination:
```json
{
  "success": true,
  "data": [ /* places array */ ],
  "pagination": {
    "total": 97,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  },
  "source": "postgresql"
}
```

V1 format:
```json
{
  "places": [ /* places array */ ],
  "total_count": 97
}
```

**Migration strategy:**

1. **Gradual rollout:**
   - Week 1: Test V2 in dev environment
   - Week 2: Deploy to staging, test thoroughly
   - Week 3: Production rollout (20% → 50% → 100%)

2. **Feature flag approach (recommended):**
   ```javascript
   const USE_V2_API = process.env.REACT_APP_USE_V2 === 'true';
   const API_BASE = USE_V2_API ? '/api/v2' : '/api';
   ```

3. **Parallel testing:**
   - Call both V1 and V2
   - Compare results
   - Log discrepancies
   - Use V1 for display, V2 for validation

---

## Phase 5: PostgreSQL-Only (Month 2)

**After frontend is fully migrated:**

### Step 1: Verify frontend is 100% on V2
```bash
# Check frontend code for V1 endpoints
grep -r "/api/restaurants" frontend/src/
grep -r "/api/onsens" frontend/src/

# Should return no results
```

### Step 2: Disable dual-write
```bash
# In .env (both local and Railway)
ENABLE_POSTGRES_READ=true
ENABLE_DUAL_WRITE=false
```

**Effect:**
- Admin edits only go to PostgreSQL
- JSON files stop being updated
- JSON becomes read-only backup

### Step 3: Archive JSON files
```bash
mkdir -p archive/
mv nozawa_places_unified.json archive/nozawa_places_unified_$(date +%Y%m%d).json
```

### Step 4: Clean up code
- Remove JSON write logic from admin endpoints
- Remove dual-write service
- Update documentation

---

## Rollback Plan (If Things Go Wrong)

### Scenario 1: Dual-write fails after Railway deployment

**Immediate action:**
```bash
# Disable dual-write in Railway
railway variables set ENABLE_DUAL_WRITE=false

# Server will restart, admin edits go to JSON only
```

**Recovery:**
1. Check Railway database connection
2. Review error logs
3. Fix issue
4. Re-enable dual-write

---

### Scenario 2: Data inconsistency detected

**Symptoms:**
```bash
./monitor-sync.sh
# Shows: JSON=97, PostgreSQL=95
```

**Fix:**
```bash
# Re-sync from JSON to PostgreSQL
node migrations/run-migrations.js

# Verify
./monitor-sync.sh
# Should show: CONSISTENT
```

---

### Scenario 3: Frontend V2 migration has bugs

**Rollback:**
```javascript
// In frontend .env
REACT_APP_USE_V2=false

// Redeploy frontend
npm run build && npm run deploy
```

**Effect:** Frontend goes back to V1 JSON endpoints (still works!)

---

## Success Metrics

### Week 1 (Dual-Write Validation)
- [ ] Dual-write enabled in production
- [ ] Daily consistency checks passing (7/7 days)
- [ ] Zero PostgreSQL sync errors
- [ ] Admin panel edits updating both systems

### Week 2-3 (Frontend Migration)
- [ ] V2 API endpoints tested in staging
- [ ] Frontend code updated to use V2
- [ ] Production rollout complete
- [ ] Performance improved (response times < 30ms)

### Month 2 (PostgreSQL-Only)
- [ ] All V1 endpoints deprecated
- [ ] Dual-write disabled
- [ ] JSON files archived
- [ ] Database is single source of truth

---

## Monitoring Dashboard (Optional)

Create a simple monitoring page:

```html
<!-- admin-monitoring.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Migration Monitoring</title>
  <style>
    .status-ok { color: green; }
    .status-error { color: red; }
  </style>
</head>
<body>
  <h1>Migration Monitoring</h1>
  <div id="status"></div>

  <script>
    async function checkStatus() {
      const token = localStorage.getItem('adminToken');

      // Check consistency
      const validation = await fetch('/api/admin/validate-data-consistency', {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(r => r.json());

      // Check health
      const health = await fetch('/api/v2/health').then(r => r.json());

      document.getElementById('status').innerHTML = `
        <p class="${validation.consistent ? 'status-ok' : 'status-error'}">
          Data Consistency: ${validation.consistent ? '✅ OK' : '❌ INCONSISTENT'}
        </p>
        <p>JSON: ${validation.jsonCount} | PostgreSQL: ${validation.postgresCount}</p>
        <p class="${health.featureFlags.dualWrite ? 'status-ok' : 'status-error'}">
          Dual Write: ${health.featureFlags.dualWrite ? '✅ Enabled' : '❌ Disabled'}
        </p>
        <p>Last checked: ${new Date().toLocaleString()}</p>
      `;
    }

    // Check every 5 minutes
    checkStatus();
    setInterval(checkStatus, 5 * 60 * 1000);
  </script>
</body>
</html>
```

---

## Timeline Summary

| Phase | Duration | Status | Next Action |
|-------|----------|--------|-------------|
| 1. PostgreSQL Setup | ✅ Done | Complete | - |
| 2. V2 API Available | ✅ Done | Complete | - |
| **3. Dual-Write Active** | **This Week** | **In Progress** | **Test locally & deploy** |
| 4. Frontend Migration | Week 2-3 | Pending | Update frontend code |
| 5. PostgreSQL-Only | Month 2 | Pending | Deprecate JSON |

---

## Quick Reference

### Test Locally
```bash
npm start
./test-dual-write.sh
```

### Deploy to Railway
```bash
railway variables set ENABLE_DUAL_WRITE=true
railway logs --tail 100
```

### Monitor Production
```bash
./monitor-sync.sh https://your-app.railway.app
```

### Check Consistency
```bash
curl https://your-app.railway.app/api/admin/validate-data-consistency \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Questions or Issues?

**Check these first:**
1. Server logs: `railway logs --tail 100`
2. Test script: `./test-dual-write.sh`
3. Monitoring script: `./monitor-sync.sh`
4. Deployment guide: `docs/DEPLOYMENT_GUIDE.md`

**Common issues:**
- Database connection: Check Railway database status
- Consistency errors: Re-run migrations
- Dual-write errors: Check server logs for PostgreSQL errors

---

**Last Updated:** December 1, 2025
**Created By:** Claude Code
**Status:** Ready for Phase 3 deployment
