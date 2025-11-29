# Database Migrations

This directory contains SQL migration files for the Nozawa Backend PostgreSQL schema.

## Migration Files

Execute in order:

1. **001_create_resorts.sql** - Multi-resort support foundation
2. **002_create_places_core.sql** - Core place data (restaurants, onsens, lifts)
3. **003_create_place_google_data.sql** - Google Places API data (refreshable)
4. **004_create_place_overrides.sql** - Manual admin edits (NEVER overwritten)
5. **005_create_place_local_knowledge.sql** - Local tips & warnings (100% manual)
6. **006_create_groups_checkins.sql** - User groups & check-ins
7. **007_create_admin_auth.sql** - Admin authentication & audit logging
8. **008_create_lift_status_cache.sql** - Lift status cache
9. **009_create_views.sql** - Convenience views for merged data

## Running Migrations

### Option 1: Using Node.js script (Recommended)
```bash
npm install
node migrations/run-migrations.js
```

### Option 2: Manual via psql
```bash
psql $DATABASE_URL -f migrations/001_create_resorts.sql
psql $DATABASE_URL -f migrations/002_create_places_core.sql
# ... etc for all files
```

### Option 3: Railway Dashboard
1. Open Railway Dashboard
2. Go to your PostgreSQL service
3. Click "Query" tab
4. Copy-paste each SQL file content
5. Execute in order

## Data Preservation Philosophy

The schema is designed to **NEVER lose manual edits** during annual Google updates:

- `place_google_data` table = Refreshable annually
- `place_overrides` table = NEVER touched by automation
- `place_local_knowledge` table = NEVER touched by automation

Application layer merges data with precedence: **override > google > base**

## After Migration

Run the data migration script to move existing JSON data into PostgreSQL:
```bash
node scripts/migrateJsonToPostgres.js
```

## Rollback

If you need to rollback:
```bash
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```
Then restore from backup.
