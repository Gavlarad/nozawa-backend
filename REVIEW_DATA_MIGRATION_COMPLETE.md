# Review Data Migration - Status Complete

## What Was Done

The frontend team reported that review analysis data (review snippets, insights) was missing from V2 PostgreSQL API despite existing in V1 JSON API.

### ✅ Completed Locally

1. **Added Database Schema** (`migrations/015_add_review_analysis.sql`)
   - Added `review_analysis` JSONB column to `places` table
   - Added GIN index for efficient queries

2. **Migrated Review Data** (`migrate-review-data.js`)
   - Extracted review data from JSON: `enhanced_data.review_analysis`
   - Populated PostgreSQL with 79 restaurants' review analysis
   - Result: 79 places updated, 18 skipped (onsens/lifts don't have reviews)

3. **Updated Database View** (`migrations/016_update_view_with_reviews.sql`)
   - Updated `places_with_merged_data` view to include `review_analysis` field
   - V2 API now returns review data in all endpoints

### 📦 Review Data Structure

```json
{
  "review_analysis": {
    "review_count": 5,
    "insights": {
      "mentions_english": false,
      "mentions_cash_only": false,
      "mentions_wait": false,
      "mentions_vegetarian": false,
      "recent_reviews": [
        {
          "rating": 5,
          "time": "5 months ago",
          "text_snippet": "We walked past this place and thought..."
        }
      ]
    }
  }
}
```

## ⚠️ Production Migration Required

The migrations have been pushed to GitHub and Railway has auto-deployed. **However**, the data migration needs to be run in production.

### Option 1: Run Migration Script Locally (Recommended)

```bash
# Make sure you have production DATABASE_URL in .env
NODE_ENV=production node run-review-migration-production.js
```

This will:
1. Add `review_analysis` column
2. Migrate 79 restaurants from JSON
3. Update the database view
4. Output results

### Option 2: Add Admin Endpoint (If Preferred)

If you want to run it via HTTP (like we did for external_ids), add this to `server.js` after line 1112:

```javascript
// Migrate review analysis data (JWT protected - one-time)
app.post('/api/admin/migrate-reviews', adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { runReviewMigration } = require('./run-review-migration-production');
    const results = await runReviewMigration(pool);

    res.json({
      ...results,
      admin: req.admin.email
    });

  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message
    });
  }
});
```

Then call it:
```bash
TOKEN=$(curl -s -X POST https://nozawa-backend-production.up.railway.app/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}' | jq -r '.token')

curl -X POST https://nozawa-backend-production.up.railway.app/api/admin/migrate-reviews \
  -H "Authorization: Bearer $TOKEN"
```

## 🧪 Testing After Migration

Once migration runs in production:

```bash
# Test review data is returned
curl 'https://nozawa-backend-production.up.railway.app/api/v2/places/96' | \
  jq '.data.review_analysis.insights.recent_reviews[0].text_snippet'

# Should return something like:
# "I have no idea why this location doesn't have a review yet..."
```

## 📊 Expected Results

- ✅ 79 restaurants with review_analysis
- ⏭️ 18 places skipped (onsens and lifts don't have review data)
- ✅ All V2 API endpoints now include review_analysis field
- ✅ Frontend can display review snippets to users

## Files Created

- `migrations/015_add_review_analysis.sql` - Add column and index
- `migrations/016_update_view_with_reviews.sql` - Update view
- `migrate-review-data.js` - Local migration script
- `run-review-migration-production.js` - Production migration helper
- `REVIEW_DATA_MIGRATION_COMPLETE.md` - This file

## Frontend Impact

After migration completes, frontend can access review data via:

```typescript
// V2 API now includes review_analysis
const place = await fetch('/api/v2/places/96').then(r => r.json());

if (place.data.review_analysis) {
  const reviews = place.data.review_analysis.insights.recent_reviews;
  // Display review snippets to users
}
```

---

**Status**: ✅ Code ready, ⏳ Awaiting production migration run
**Next Action**: Run migration in production (Option 1 or 2 above)
**Estimated Time**: 2 minutes
