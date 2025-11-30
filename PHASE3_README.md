# Phase 3: Dual-Write Enabled ✅

## What Changed

I've enabled **dual-write mode** which means:
- ✅ Admin panel edits now save to **both** JSON files AND PostgreSQL
- ✅ V2 API endpoints remain available (`/api/v2/*`)
- ✅ V1 JSON endpoints still work (backwards compatible)
- ✅ Data consistency is maintained automatically

## Quick Start

### 1. Test Locally (5 minutes)

```bash
# Start the server
npm start

# In another terminal, run the test script
./test-dual-write.sh
```

Expected output:
```
✅ Server is running
✅ Login successful
✅ PostgreSQL read is enabled
✅ Data is consistent
✅ V2 API is working
```

### 2. Deploy to Railway (10 minutes)

**Update environment variable in Railway:**

```bash
# Option 1: Via CLI
railway variables set ENABLE_DUAL_WRITE=true

# Option 2: Via Dashboard
# Go to your Railway project → Variables → Add ENABLE_DUAL_WRITE=true
```

Railway will automatically restart your server.

**Monitor the deployment:**
```bash
railway logs --tail 100
```

Look for these messages:
- ✅ `Dual-write enabled: true`
- ✅ `PostgreSQL sync: 97 places updated`
- ✅ `Server running on port 3000`

### 3. Verify Production (5 minutes)

```bash
# Replace with your Railway domain
./monitor-sync.sh https://your-app.railway.app
```

Expected output:
```
✅ Authenticated
✅ CONSISTENT
✅ PostgreSQL Read: Enabled
✅ Dual Write: Enabled
```

## Files Created

### Test Scripts
- **`test-dual-write.sh`** - Comprehensive test of dual-write functionality
- **`monitor-sync.sh`** - Daily monitoring script for production

### Documentation
- **`docs/NEXT_PHASE_ROLLOUT.md`** - Complete rollout plan with timeline
- **`PHASE3_README.md`** - This file (quick reference)

## Current Configuration

```env
# .env file
ENABLE_POSTGRES_READ=true   # V2 API active
ENABLE_DUAL_WRITE=true      # Syncs to both JSON + PostgreSQL
```

## Testing Dual-Write

### Via Admin Panel
1. Open your admin panel (admin.html)
2. Edit any place (e.g., update a description)
3. Save changes
4. **Check the response JSON** for:
   ```json
   {
     "success": true,
     "dual_write": {
       "enabled": true,
       "json": { "success": true },
       "postgresql": { "success": true, "updated": 97 }
     }
   }
   ```

### Via API
```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}' \
  | jq -r '.token')

# Check consistency
curl http://localhost:3000/api/admin/validate-data-consistency \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## What's Next?

### This Week
1. ✅ Dual-write enabled locally
2. ⏳ Deploy to Railway
3. ⏳ Monitor for errors daily
4. ⏳ Verify consistency daily

### Week 2-3 (Frontend Migration)
- Update frontend to use V2 API endpoints
- Test thoroughly in staging
- Gradual production rollout

### Month 2 (PostgreSQL-Only)
- Disable dual-write
- PostgreSQL becomes single source of truth
- Archive JSON files

See **`docs/NEXT_PHASE_ROLLOUT.md`** for complete timeline.

## Monitoring

### Daily Check (5 minutes)
```bash
./monitor-sync.sh https://your-app.railway.app
```

### View Logs
```bash
# Local
tail -f server.log | grep "dual-write"

# Production (Railway)
railway logs --tail 100 | grep -E "(dual-write|PostgreSQL)"
```

### Consistency Log
The monitoring script creates `sync-monitor.log`:
```bash
tail -f sync-monitor.log
```

Example log entry:
```
[Sun Dec 1 10:30:00 JST 2025] CONSISTENT: JSON=97 PG=97
```

## Troubleshooting

### Issue: "PostgreSQL transaction failed"
**Cause:** Database connection issue
**Fix:**
```bash
# Check database status
railway status

# Restart service
railway restart
```

### Issue: Data inconsistency detected
**Cause:** Migration not run or partial sync failure
**Fix:**
```bash
# Re-run migrations
node migrations/run-migrations.js

# Verify
./monitor-sync.sh
```

### Issue: Dual-write not working
**Cause:** Environment variable not set
**Fix:**
```bash
# Check current config
railway variables

# Set if missing
railway variables set ENABLE_DUAL_WRITE=true
```

## Rollback Plan

If you encounter critical issues:

### Option 1: Disable Dual-Write
```bash
# In Railway
railway variables set ENABLE_DUAL_WRITE=false

# Effect: Admin edits only go to JSON (safe mode)
```

### Option 2: Disable V2 API
```bash
railway variables set ENABLE_POSTGRES_READ=false

# Effect: V2 endpoints return 503, V1 keeps working
```

### Option 3: Full Rollback
```bash
# Restore both flags to previous state
railway variables set ENABLE_DUAL_WRITE=false
railway variables set ENABLE_POSTGRES_READ=false

# Effect: Back to JSON-only mode
```

## API Endpoints Reference

### V1 Endpoints (JSON - Still Working)
- `GET /api/restaurants` - Get all restaurants
- `GET /api/places` - Get all places
- `GET /api/lifts/status` - Lift status
- `GET /api/weather/current` - Weather

### V2 Endpoints (PostgreSQL - Now Available)
- `GET /api/v2/places` - All places (paginated)
- `GET /api/v2/places/:id` - Single place
- `GET /api/v2/places/category/restaurant` - By category
- `GET /api/v2/stats` - Database statistics
- `GET /api/v2/lifts` - Lift status (cached)
- `GET /api/v2/weather` - Weather (cached)
- `GET /api/v2/health` - Health check

### Admin Endpoints (Protected)
- `POST /api/admin/login` - Get JWT token
- `GET /api/admin/places-data` - Get places for editing
- `POST /api/admin/save-places` - Save with dual-write
- `GET /api/admin/validate-data-consistency` - Check sync

## Environment Variables Summary

| Variable | Current | Production | Purpose |
|----------|---------|------------|---------|
| `ENABLE_POSTGRES_READ` | `true` | `true` | Enable V2 API |
| `ENABLE_DUAL_WRITE` | `true` | **Set this** | Sync to PostgreSQL |
| `DATABASE_URL` | Set | Set | PostgreSQL connection |
| `JWT_SECRET` | Set | Set | Admin authentication |

## Success Checklist

Before moving to frontend migration:

- [ ] Dual-write enabled in production
- [ ] Daily monitoring script running
- [ ] 7 consecutive days of consistent data
- [ ] Zero PostgreSQL sync errors in logs
- [ ] Admin panel edits working correctly
- [ ] Both JSON and PostgreSQL updating

## Questions?

Check these resources:
1. **Full rollout plan:** `docs/NEXT_PHASE_ROLLOUT.md`
2. **Deployment guide:** `docs/DEPLOYMENT_GUIDE.md`
3. **Dual-write docs:** `docs/DUAL_WRITE.md`
4. **Frontend handoff:** `docs/FRONTEND_HANDOFF.md`

Or run the test scripts:
```bash
./test-dual-write.sh      # Full test suite
./monitor-sync.sh         # Consistency check
```

---

**Status:** ✅ Ready to deploy
**Next Action:** Run `./test-dual-write.sh` then deploy to Railway
**Estimated Time:** 30 minutes total
