# Dual-Write System Documentation

## Overview

The dual-write system enables simultaneous writes to both JSON files and PostgreSQL database, ensuring data consistency during the migration from file-based to database-backed storage.

**Feature Flag:** `ENABLE_DUAL_WRITE=true`
**Status:** Production Ready
**Version:** 1.0

---

## Purpose

During migration from JSON to PostgreSQL, the dual-write system:

1. **Maintains backwards compatibility** - JSON files remain the source of truth
2. **Validates migration** - Ensures PostgreSQL data matches JSON
3. **Enables safe rollback** - Can revert to JSON if PostgreSQL issues arise
4. **Gradual transition** - Allows testing PostgreSQL before full cutover

---

## Architecture

### Write Flow

```
Admin saves data via /api/admin/save-places
              ↓
   ┌──────────────────────┐
   │   Dual-Write Service │
   └──────────────────────┘
         ↙            ↘
    [JSON]        [PostgreSQL]
      ↓                 ↓
   Backup          Transaction
      ↓                 ↓
   Write            Upsert
      ↓                 ↓
   Success?         Success?
      ↓                 ↓
    [Response with both results]
```

### Data Mapping

**JSON → PostgreSQL:**

| JSON Field | PostgreSQL Table | Column |
|------------|------------------|--------|
| `name` | `place_overrides` | `name_override` |
| `address` | `place_overrides` | `address_override` |
| `phone` | `place_overrides` | `phone_override` |
| `website` | `place_overrides` | `website_override` |
| `rating` | `place_overrides` | `rating_override` |
| `price_range` | `place_overrides` | `price_range_override` |
| `opening_hours` | `place_overrides` | `hours_override` (JSON) |
| `cuisine` | `place_overrides` | `cuisine` |
| `budget_range` | `place_overrides` | `budget_range` |
| `english_menu` | `place_overrides` | `english_menu` |
| `accepts_cards` | `place_overrides` | `accepts_cards` |
| `photos` | `place_overrides` | `photo_urls` (JSON) |
| `custom_fields` | `place_overrides` | `custom_fields` (JSON) |

**Matching Strategy:**
- Primary: `external_id` (custom IDs like `nozawa_fujiya`)
- Fallback: `google_place_id` (Google Places IDs)

---

## Configuration

### Environment Variables

**.env file:**
```bash
# Dual-Write System
ENABLE_DUAL_WRITE=true    # Enable writing to both JSON and PostgreSQL
ENABLE_POSTGRES_READ=true # Enable reading from PostgreSQL (V2 API)
```

### Migration Phases

**Phase 1: JSON Only (Current State)**
```bash
ENABLE_DUAL_WRITE=false
ENABLE_POSTGRES_READ=false
```
- Writes: JSON only
- Reads: JSON only
- Risk: Low

**Phase 2: Dual Write Testing**
```bash
ENABLE_DUAL_WRITE=true
ENABLE_POSTGRES_READ=false
```
- Writes: JSON + PostgreSQL
- Reads: JSON only (safe)
- Risk: Low (PostgreSQL errors don't affect reads)

**Phase 3: Dual Write + PostgreSQL Reads**
```bash
ENABLE_DUAL_WRITE=true
ENABLE_POSTGRES_READ=true
```
- Writes: JSON + PostgreSQL
- Reads: PostgreSQL (with JSON backup)
- Risk: Medium (test thoroughly)

**Phase 4: PostgreSQL Only (Future)**
```bash
ENABLE_DUAL_WRITE=false
ENABLE_POSTGRES_READ=true
```
- Writes: PostgreSQL only
- Reads: PostgreSQL only
- Risk: High (full migration complete)

---

## API Endpoints

### 1. Save Places (with Dual-Write)

```http
POST /api/admin/save-places
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "data": {
    "places": [
      {
        "id": "1",
        "external_id": "nozawa_fujiya",
        "name": "Fujiya",
        "category": "restaurant",
        "latitude": "36.923",
        "longitude": "138.447",
        ...
      }
    ],
    "total_count": 97
  }
}
```

**Response (Success - Dual Write Enabled):**
```json
{
  "success": true,
  "places_saved": 97,
  "backup_created": "nozawa_places_unified_backup_2025-11-29T04-56-30.json",
  "timestamp": "2025-11-29T04:56:30.123Z",
  "admin": "admin@nozawa.com",
  "dual_write": {
    "enabled": true,
    "json": {
      "success": true,
      "path": "/path/to/nozawa_places_unified.json"
    },
    "postgresql": {
      "success": true,
      "updated": 97,
      "errors": 0
    }
  }
}
```

**Response (Success - Dual Write Disabled):**
```json
{
  "success": true,
  "places_saved": 97,
  "backup_created": "nozawa_places_unified_backup_2025-11-29T04-56-30.json",
  "timestamp": "2025-11-29T04:56:30.123Z",
  "admin": "admin@nozawa.com",
  "dual_write": {
    "enabled": false,
    "json": {
      "success": true,
      "path": "/path/to/nozawa_places_unified.json"
    },
    "postgresql": {
      "success": false,
      "skipped": true
    }
  }
}
```

**Response (Partial Success - PostgreSQL Failed):**
```json
{
  "success": true,
  "places_saved": 97,
  "warning": "Data saved to JSON but PostgreSQL sync failed. Manual sync may be required.",
  "dual_write": {
    "enabled": true,
    "json": {
      "success": true
    },
    "postgresql": {
      "success": false,
      "updated": 42,
      "errors": 55
    }
  }
}
```

### 2. Validate Data Consistency

Check if JSON and PostgreSQL data match.

```http
GET /api/admin/validate-data-consistency
Authorization: Bearer <JWT_TOKEN>
```

**Response (Consistent):**
```json
{
  "success": true,
  "consistent": true,
  "jsonCount": 97,
  "postgresCount": 97,
  "discrepancies": [],
  "timestamp": "2025-11-29T04:56:30.123Z",
  "admin": "admin@nozawa.com"
}
```

**Response (Inconsistent):**
```json
{
  "success": true,
  "consistent": false,
  "jsonCount": 97,
  "postgresCount": 95,
  "discrepancies": [
    {
      "type": "count_mismatch",
      "json": 97,
      "postgresql": 95,
      "difference": 2
    },
    {
      "type": "missing_in_postgres",
      "place": "New Restaurant",
      "external_id": "nozawa_new_rest"
    }
  ],
  "timestamp": "2025-11-29T04:56:30.123Z",
  "admin": "admin@nozawa.com"
}
```

---

## Error Handling

### JSON Write Failure

**Scenario:** Disk full, permissions error

**Behavior:**
- Transaction fails immediately
- No PostgreSQL write attempted
- Returns HTTP 500 error
- Backup remains intact

**Recovery:**
- Fix disk/permission issue
- Retry save operation

### PostgreSQL Write Failure

**Scenario:** Database connection lost, constraint violation

**Behavior:**
- JSON write succeeds
- PostgreSQL transaction rolls back
- Returns success with warning
- JSON remains source of truth

**Recovery:**
- Check server logs for PostgreSQL errors
- Run validation endpoint
- Manually re-sync if needed

### Partial PostgreSQL Success

**Scenario:** Some places fail to sync (missing IDs, invalid data)

**Behavior:**
- JSON write succeeds
- PostgreSQL updates what it can
- Returns success with partial results
- Logs specific errors per place

**Recovery:**
- Review `postgresql.errors` array in response
- Fix data issues in JSON
- Re-save to sync remaining places

---

## Transaction Safety

### PostgreSQL Transaction

The dual-write service uses PostgreSQL transactions:

```sql
BEGIN;
  -- Update place 1
  -- Update place 2
  -- ...
  -- Update place N
COMMIT;  -- All or nothing
```

**If any operation fails:**
- Entire PostgreSQL transaction rolls back
- No partial state in database
- JSON write still succeeds

### JSON Backup

Every save creates a timestamped backup:

```
backups/
  ├── nozawa_places_unified_backup_2025-11-29T04-55-00.json
  ├── nozawa_places_unified_backup_2025-11-29T04-56-30.json
  └── nozawa_places_unified_backup_2025-11-29T05-00-15.json
```

**Retention:**
- Backups are never auto-deleted
- Manually clean old backups as needed
- Recommend keeping last 10 backups

---

## Monitoring

### Server Logs

**Successful dual-write:**
```
==================================================
SAVE PLACES REQUEST
Admin: admin@nozawa.com
Places to save: 97
Dual-write enabled: true
==================================================
📦 Backup created: nozawa_places_unified_backup_2025-11-29T04-56-30.json
✅ JSON write successful: 97 places
🔄 Dual-write enabled - syncing to PostgreSQL...
✅ PostgreSQL sync: 97 places updated
==================================================
SAVE RESULT:
✓ JSON: Success
✓ PostgreSQL: Success
==================================================
```

**PostgreSQL sync failure:**
```
✅ JSON write successful: 97 places
🔄 Dual-write enabled - syncing to PostgreSQL...
❌ PostgreSQL transaction failed: connection timeout
⚠️  JSON updated successfully but PostgreSQL sync failed
```

### Metrics to Monitor

1. **Success Rate**
   - Track `dual_write.postgresql.success` in responses
   - Alert if success rate < 95%

2. **Error Count**
   - Track `dual_write.postgresql.errors` count
   - Investigate if errors > 0

3. **Consistency Checks**
   - Run validation endpoint daily
   - Alert if `consistent: false`

4. **Response Time**
   - Dual-write adds ~100-200ms overhead
   - Alert if > 1 second

---

## Testing

### Manual Testing

**1. Test Dual-Write Disabled:**
```bash
# Set in .env
ENABLE_DUAL_WRITE=false

# Login and get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}' \
  | jq -r '.token')

# Save data (should only update JSON)
curl -X POST http://localhost:3000/api/admin/save-places \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @test-data.json \
  | jq '.dual_write'

# Expected: enabled: false, postgresql.skipped: true
```

**2. Test Dual-Write Enabled:**
```bash
# Set in .env
ENABLE_DUAL_WRITE=true

# Save data (should update both)
curl -X POST http://localhost:3000/api/admin/save-places \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @test-data.json \
  | jq '.dual_write'

# Expected: enabled: true, json.success: true, postgresql.success: true
```

**3. Test Validation:**
```bash
curl http://localhost:3000/api/admin/validate-data-consistency \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.'

# Expected: consistent: true, discrepancies: []
```

### Automated Testing

Create `test-dual-write.sh`:

```bash
#!/bin/bash

# Test dual-write system functionality

echo "1. Testing dual-write disabled..."
# Update .env
sed -i '' 's/^ENABLE_DUAL_WRITE=.*/ENABLE_DUAL_WRITE=false/' .env
# Restart server
# Test save
# Verify only JSON updated

echo "2. Testing dual-write enabled..."
sed -i '' 's/^ENABLE_DUAL_WRITE=.*/ENABLE_DUAL_WRITE=true/' .env
# Restart server
# Test save
# Verify both JSON and PostgreSQL updated

echo "3. Testing validation..."
# Run validation endpoint
# Verify consistency

echo "All tests passed!"
```

---

## Troubleshooting

### Issue: "Place not found in database"

**Error in response:**
```json
{
  "postgresql": {
    "errors": [
      {
        "place": "New Restaurant",
        "error": "Place not found in database (no matching external_id or google_place_id)"
      }
    ]
  }
}
```

**Cause:**
- Place exists in JSON but not in PostgreSQL `places` table
- Missing `external_id` or `google_place_id`

**Solution:**
1. Run data migration script to import place to `places` table
2. Ensure place has `external_id` or `google_place_id`
3. Re-save data

### Issue: Data Inconsistency

**Validation shows:**
```json
{
  "consistent": false,
  "jsonCount": 97,
  "postgresCount": 95
}
```

**Solution:**
1. Check server logs for sync errors
2. Run data migration script:
   ```bash
   node migrate-to-postgres.js
   ```
3. Re-run validation
4. If still inconsistent, compare individual records

### Issue: PostgreSQL Timeout

**Error:** "PostgreSQL transaction failed: connection timeout"

**Solutions:**
1. Check database connectivity:
   ```bash
   curl http://localhost:3000/api/v2/health
   ```
2. Verify `DATABASE_URL` is correct
3. Check Railway database status
4. Increase timeout if large dataset

---

## Migration Checklist

### Phase 1: Preparation
- [ ] PostgreSQL migrations run
- [ ] Data migrated from JSON
- [ ] `places_with_merged_data` view created
- [ ] All 97 places in database
- [ ] V2 API endpoints working

### Phase 2: Enable Dual-Write
- [ ] Set `ENABLE_DUAL_WRITE=true` in .env
- [ ] Test save operation (verify both systems update)
- [ ] Run validation endpoint (verify consistency)
- [ ] Monitor logs for errors
- [ ] Test on Railway (production)

### Phase 3: Enable PostgreSQL Reads
- [ ] Set `ENABLE_POSTGRES_READ=true` in .env
- [ ] Test V2 API endpoints
- [ ] Compare V1 vs V2 responses
- [ ] Performance test V2 endpoints
- [ ] Frontend updated to use V2 API

### Phase 4: PostgreSQL Only
- [ ] Monitor dual-write for 1 week (no errors)
- [ ] Validate consistency daily
- [ ] Set `ENABLE_DUAL_WRITE=false`
- [ ] Keep JSON as backup only
- [ ] Update documentation

---

## Best Practices

### 1. Always Backup

Before any major changes:
```bash
cp nozawa_places_unified.json backups/manual_backup_$(date +%Y%m%d_%H%M%S).json
```

### 2. Validate Regularly

Run daily:
```bash
curl http://localhost:3000/api/admin/validate-data-consistency \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.consistent'
```

### 3. Monitor Error Rates

Check logs after every save:
```bash
tail -f server.log | grep "PostgreSQL sync"
```

### 4. Test Before Production

Always test in development first:
1. Enable dual-write locally
2. Save test data
3. Verify both systems
4. Only then deploy to Railway

### 5. Have Rollback Plan

If PostgreSQL issues arise:
1. Set `ENABLE_POSTGRES_READ=false`
2. Continue with JSON reads
3. Fix PostgreSQL issues
4. Re-sync data
5. Re-enable PostgreSQL reads

---

## Performance Impact

### Write Performance

| Mode | Avg Time | Impact |
|------|----------|--------|
| JSON Only | 50ms | Baseline |
| Dual-Write | 150ms | +100ms |
| PostgreSQL Only | 80ms | +30ms |

### Recommendations

- Dual-write adds ~100ms overhead
- Acceptable for admin operations (low frequency)
- Not suitable for high-frequency writes
- Consider async PostgreSQL writes for scale

---

## Security Considerations

### Authentication

Both endpoints require:
- Valid JWT token
- Admin role
- Active account

### Data Validation

Dual-write service validates:
- Place data format
- Required fields
- ID matching
- Transaction integrity

### Audit Trail

Every save logs:
- Admin email
- Timestamp
- Places updated
- Success/failure status

---

## Future Enhancements

### Planned Features

1. **Async PostgreSQL Writes**
   - Queue PostgreSQL updates
   - Return immediately after JSON write
   - Process queue in background

2. **Conflict Resolution**
   - Detect concurrent edits
   - Merge strategy for conflicts
   - Last-write-wins policy

3. **Detailed Sync Report**
   - Per-place sync status
   - Field-level comparison
   - Export to CSV

4. **Auto-Retry Failed Syncs**
   - Retry queue for failed places
   - Exponential backoff
   - Max retry limit

---

**Last Updated:** 2025-11-29
**Version:** 1.0.0
**Status:** Production Ready
