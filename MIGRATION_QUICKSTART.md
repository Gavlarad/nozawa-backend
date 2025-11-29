# PostgreSQL Migration - Quick Start Guide

## What We've Built So Far

### ✅ Completed (Nov 29, 2024)

1. **Git Safety**: Created feature branch `feature/postgres-security-migration`
   - Main branch protected
   - All work isolated on feature branch

2. **PostgreSQL Schema**: Complete multi-resort database architecture
   - 9 migration files (817 lines of SQL)
   - Multi-tenancy support (ready for Hakuba, etc.)
   - Data preservation system (Google vs Manual edits separated)
   - Admin authentication tables
   - Audit logging
   - Groups & check-ins (enhanced from current)

### 📁 New Files Created

```
migrations/
├── README.md
├── run-migrations.js               ← Run this to create database
├── 001_create_resorts.sql
├── 002_create_places_core.sql
├── 003_create_place_google_data.sql
├── 004_create_place_overrides.sql
├── 005_create_place_local_knowledge.sql
├── 006_create_groups_checkins.sql
├── 007_create_admin_auth.sql
├── 008_create_lift_status_cache.sql
└── 009_create_views.sql
```

---

## Next Steps (To Do This Week)

### Step 1: Run Database Migrations

Execute the migrations against your Railway PostgreSQL:

```bash
# Make sure your .env has DATABASE_URL
node migrations/run-migrations.js
```

**What this does:**
- Creates all tables in your Railway PostgreSQL
- Seeds Nozawa Onsen resort
- Creates convenience views
- Safe to run multiple times (won't duplicate)

**Expected output:**
```
✅ Database connection successful
✅ 001_create_resorts.sql completed
✅ 002_create_places_core.sql completed
... (all 9 migrations)
✅ Nozawa Onsen resort seeded successfully
```

### Step 2: Verify in Railway Dashboard

1. Open https://railway.app
2. Go to your PostgreSQL service
3. Click "Query" tab
4. Run: `SELECT * FROM resorts;`
5. Should see Nozawa Onsen resort

### Step 3: What's Next?

We still need to build (in order):

1. **Data Migration Script** - Move JSON data → PostgreSQL
2. **Security Middleware** - JWT, rate limiting, CORS
3. **New API Endpoints** - PostgreSQL-backed routes
4. **Admin Panel Auth** - Replace hardcoded password
5. **Dual-Write System** - Write to both JSON & PostgreSQL
6. **Testing** - Verify everything works
7. **Deploy** - Push to Railway

---

## Key Architecture Decisions

### Data Separation (This is Critical!)

Your places data is now split across 3 tables:

```
places (core data)
  ├── place_google_data     ← Refreshed annually, safe to overwrite
  ├── place_overrides       ← NEVER touched by Google updates
  └── place_local_knowledge ← NEVER touched by Google updates
```

**Why this matters:**
- Annual Google update touches ONLY `place_google_data` table
- Your manual edits in `place_overrides` are NEVER lost
- Local tips in `place_local_knowledge` are sacred

**How it merges:**
- Application layer combines them
- Precedence: `override > google > base`

### Multi-Resort Ready

The `resorts` table makes it easy to add Hakuba later:

```sql
-- Nozawa already seeded
INSERT INTO resorts (slug, name, ...) VALUES ('hakuba', 'Hakuba Valley', ...);
```

Every place, group, check-in links to a `resort_id`.

---

## How to Run This (Your Role)

### Option A: I run the migration now
Just say "go ahead and run it" and I'll execute:
```bash
node migrations/run-migrations.js
```

### Option B: You run it yourself
1. Make sure `.env` has `DATABASE_URL` from Railway
2. Run: `node migrations/run-migrations.js`
3. Share the output with me

### Option C: Manual via Railway Dashboard
If the script doesn't work, you can copy-paste each SQL file's content into Railway's Query tab.

---

## Safety Notes

- ✅ Your current system still works (no changes to production code yet)
- ✅ Main branch unchanged
- ✅ JSON file still the source of truth
- ✅ Can rollback by deleting tables
- ✅ Railway has automatic backups

---

## Timeline Estimate

**This Week:**
- Run migrations (10 min)
- Write data migration script (2-3 days)
- Test data import (1 day)

**Next Week:**
- Security implementation
- New API endpoints

**Weeks 3-4:**
- Admin panel updates
- Testing

**Target:** Fully migrated by end of January 2025 (well before ski season 2025)

---

## Questions?

- **What if migration fails?** Share error with me, usually a .env issue
- **Will this break my app?** No, not touching production code yet
- **Can I still use JSON file?** Yes! It's still the current source of truth
- **When does PostgreSQL become active?** After we build the dual-write system (week 3-4)

---

Ready to run the migrations?
