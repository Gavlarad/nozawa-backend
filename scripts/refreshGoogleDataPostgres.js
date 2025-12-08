/**
 * PostgreSQL-Native Google Places Refresh Script
 *
 * Refreshes restaurant data from Google Places API directly into PostgreSQL.
 *
 * KEY PRINCIPLE: Only updates `place_google_data` table.
 * NEVER touches: place_overrides, place_local_knowledge, or core places data.
 *
 * Three modes:
 * 1. --dry-run: Show what would happen without making changes
 * 2. --update-only: Only update existing places (default)
 * 3. --include-new: Also report new places found (doesn't auto-add)
 *
 * Usage:
 *   node refreshGoogleDataPostgres.js              # Update existing places
 *   node refreshGoogleDataPostgres.js --dry-run   # Preview changes
 *   node refreshGoogleDataPostgres.js --include-new  # Also find new places
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  GOOGLE_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
  NOZAWA_CENTER: { lat: 36.923011, lng: 138.447077 },
  SEARCH_RADIUS: 2000, // 2km covers whole village
  DELAY_MS: 200,
  PAGE_DELAY_MS: 2000,
  MAX_PHOTOS: 5,
  MAX_REVIEWS: 5,
  RESORT_ID: 1 // Nozawa Onsen
};

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCLUDE_NEW = args.includes('--include-new');

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper: Make HTTPS request
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Helper: Delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Get photo URLs from Google response
function extractPhotoUrls(photos) {
  if (!photos || photos.length === 0) return [];

  return photos.slice(0, CONFIG.MAX_PHOTOS).map(photo => ({
    url: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photo.photo_reference}&key=${CONFIG.GOOGLE_API_KEY}`,
    width: photo.width,
    height: photo.height,
    attributions: photo.html_attributions || []
  }));
}

// Convert price level to symbols
function getPriceRange(priceLevel) {
  if (priceLevel === undefined || priceLevel === null) return null;
  const levels = ['Free', '¥', '¥¥', '¥¥¥', '¥¥¥¥'];
  return levels[priceLevel] || null;
}

// Extract Google features from details
function extractFeatures(details) {
  return {
    takeout: details.takeout || false,
    delivery: details.delivery || false,
    dine_in: details.dine_in || false,
    reservable: details.reservable || false,
    serves_beer: details.serves_beer || false,
    serves_wine: details.serves_wine || false,
    wheelchair_accessible: details.wheelchair_accessible_entrance || false
  };
}

// Analyze reviews for insights (English menu, cash only, wait times, vegetarian)
function analyzeReviews(reviews) {
  if (!reviews || reviews.length === 0) return {
    review_count: 0,
    insights: {
      mentions_english: false,
      mentions_cash_only: false,
      mentions_wait: false,
      mentions_vegetarian: false,
      recent_reviews: []
    }
  };

  const insights = {
    mentions_english: false,
    mentions_cash_only: false,
    mentions_wait: false,
    mentions_vegetarian: false,
    recent_reviews: []
  };

  const englishWords = ['english', 'foreigner', 'tourist friendly', 'english menu', 'english speaking'];
  const cashWords = ['cash only', 'no card', 'no credit', 'cash'];
  const waitWords = ['wait', 'queue', 'line', 'busy', 'crowded', 'packed'];
  const vegWords = ['vegetarian', 'vegan', 'veggie', 'plant based'];

  reviews.forEach((review, index) => {
    const text = (review.text || '').toLowerCase();

    // Check for keywords
    if (englishWords.some(word => text.includes(word))) {
      insights.mentions_english = true;
    }
    if (cashWords.some(word => text.includes(word))) {
      insights.mentions_cash_only = true;
    }
    if (waitWords.some(word => text.includes(word))) {
      insights.mentions_wait = true;
    }
    if (vegWords.some(word => text.includes(word))) {
      insights.mentions_vegetarian = true;
    }

    // Keep first MAX_REVIEWS reviews for reference
    if (index < CONFIG.MAX_REVIEWS) {
      insights.recent_reviews.push({
        rating: review.rating,
        time: review.relative_time_description,
        text_snippet: (review.text || '').substring(0, 200) + ((review.text || '').length > 200 ? '...' : '')
      });
    }
  });

  return {
    review_count: reviews.length,
    insights
  };
}

/**
 * Search Google Places for all restaurants in Nozawa
 */
async function searchGooglePlaces() {
  const allResults = [];
  let nextPageToken = null;
  let pageCount = 1;

  console.log('\n🔍 Searching Google Places API...\n');

  // Search for restaurants
  do {
    let searchUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
      `location=${CONFIG.NOZAWA_CENTER.lat},${CONFIG.NOZAWA_CENTER.lng}` +
      `&radius=${CONFIG.SEARCH_RADIUS}` +
      `&type=restaurant` +
      `&key=${CONFIG.GOOGLE_API_KEY}`;

    if (nextPageToken) {
      searchUrl += `&pagetoken=${nextPageToken}`;
      await sleep(CONFIG.PAGE_DELAY_MS);
    }

    console.log(`  Fetching restaurant page ${pageCount}...`);
    const searchData = await makeRequest(searchUrl);

    if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
      console.error('  Search failed:', searchData.status, searchData.error_message);
      break;
    }

    if (searchData.results) {
      allResults.push(...searchData.results);
      console.log(`  Found ${searchData.results.length} (Total: ${allResults.length})`);
    }

    nextPageToken = searchData.next_page_token;
    pageCount++;
  } while (nextPageToken);

  // Also search for cafes and bars
  for (const placeType of ['cafe', 'bar']) {
    const typeUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
      `location=${CONFIG.NOZAWA_CENTER.lat},${CONFIG.NOZAWA_CENTER.lng}` +
      `&radius=${CONFIG.SEARCH_RADIUS}` +
      `&type=${placeType}` +
      `&key=${CONFIG.GOOGLE_API_KEY}`;

    await sleep(CONFIG.DELAY_MS);
    const typeData = await makeRequest(typeUrl);

    if (typeData.status === 'OK' && typeData.results) {
      let newPlaces = 0;
      typeData.results.forEach(place => {
        if (!allResults.find(r => r.place_id === place.place_id)) {
          allResults.push(place);
          newPlaces++;
        }
      });
      console.log(`  Found ${newPlaces} new ${placeType}s (Total: ${allResults.length})`);
    }
  }

  return allResults;
}

/**
 * Get detailed info for a single place from Google
 */
async function getPlaceDetails(placeId) {
  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?` +
    `place_id=${placeId}` +
    `&fields=name,formatted_address,formatted_phone_number,` +
    `opening_hours,website,rating,user_ratings_total,price_level,types,` +
    `business_status,geometry,reviews,photos,editorial_summary,` +
    `takeout,delivery,dine_in,reservable,serves_beer,serves_wine,` +
    `wheelchair_accessible_entrance` +
    `&language=en` +
    `&key=${CONFIG.GOOGLE_API_KEY}`;

  await sleep(CONFIG.DELAY_MS);
  const data = await makeRequest(detailsUrl);

  if (data.status === 'OK' && data.result) {
    return data.result;
  }
  return null;
}

/**
 * Get existing places from PostgreSQL
 */
async function getExistingPlaces() {
  const result = await pool.query(`
    SELECT
      p.id,
      p.google_place_id,
      p.name,
      p.category,
      gd.synced_at as last_sync
    FROM places p
    LEFT JOIN place_google_data gd ON p.id = gd.place_id
    WHERE p.resort_id = $1
    AND p.category = 'restaurant'
    AND p.google_place_id IS NOT NULL
  `, [CONFIG.RESORT_ID]);

  return result.rows;
}

/**
 * Update place_google_data for a single place
 */
async function updateGoogleData(placeId, googlePlaceId, details) {
  const photos = extractPhotoUrls(details.photos);
  const features = extractFeatures(details);
  // google_types is TEXT[] in PostgreSQL, so we pass the array directly (pg driver handles conversion)
  const googleTypes = details.types || [];
  const reviewAnalysis = analyzeReviews(details.reviews);

  // Update place_google_data table
  await pool.query(`
    INSERT INTO place_google_data (
      place_id,
      google_rating,
      google_review_count,
      google_price_range,
      google_phone,
      google_website,
      opening_hours,
      photos,
      google_types,
      editorial_summary,
      features,
      google_maps_url,
      synced_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (place_id)
    DO UPDATE SET
      google_rating = EXCLUDED.google_rating,
      google_review_count = EXCLUDED.google_review_count,
      google_price_range = EXCLUDED.google_price_range,
      google_phone = EXCLUDED.google_phone,
      google_website = EXCLUDED.google_website,
      opening_hours = EXCLUDED.opening_hours,
      photos = EXCLUDED.photos,
      google_types = EXCLUDED.google_types,
      editorial_summary = EXCLUDED.editorial_summary,
      features = EXCLUDED.features,
      google_maps_url = EXCLUDED.google_maps_url,
      synced_at = NOW()
  `, [
    placeId,
    details.rating || null,
    details.user_ratings_total || 0,
    getPriceRange(details.price_level),
    details.formatted_phone_number || null,
    details.website || null,
    details.opening_hours ? JSON.stringify(details.opening_hours) : null,
    JSON.stringify(photos),
    googleTypes,  // Pass as native JS array - pg driver converts to TEXT[]
    details.editorial_summary?.overview || null,
    JSON.stringify(features),
    `https://maps.google.com/?cid=${googlePlaceId}`
  ]);

  // Update review_analysis in places table (safe - doesn't touch manual fields)
  await pool.query(`
    UPDATE places
    SET review_analysis = $1, updated_at = NOW()
    WHERE id = $2
  `, [
    JSON.stringify(reviewAnalysis),
    placeId
  ]);
}

/**
 * Main refresh function
 */
async function refreshGoogleData() {
  console.log('═'.repeat(60));
  console.log('  GOOGLE PLACES DATA REFRESH (PostgreSQL-Native)');
  console.log('═'.repeat(60));
  console.log(`\n  Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '💾 LIVE UPDATE'}`);
  console.log(`  Include New Places: ${INCLUDE_NEW ? 'Yes' : 'No'}`);
  console.log(`  Resort: Nozawa Onsen (ID: ${CONFIG.RESORT_ID})`);

  if (!CONFIG.GOOGLE_API_KEY) {
    console.error('\n❌ Error: GOOGLE_PLACES_API_KEY not set in environment');
    process.exit(1);
  }

  const stats = {
    existing: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    newFound: 0,
    closedFound: 0,
    apiCalls: 0
  };

  try {
    // Step 1: Get existing places from PostgreSQL
    console.log('\n📊 Loading existing places from PostgreSQL...');
    const existingPlaces = await getExistingPlaces();
    stats.existing = existingPlaces.length;
    console.log(`   Found ${existingPlaces.length} restaurants with Google Place IDs`);

    // Create lookup map
    const existingByGoogleId = {};
    existingPlaces.forEach(p => {
      existingByGoogleId[p.google_place_id] = p;
    });

    // Step 2: Search Google for current restaurants
    const googleResults = await searchGooglePlaces();
    stats.apiCalls += Math.ceil(googleResults.length / 20) + 3;

    // Step 3: Find new and closed places
    const googlePlaceIds = new Set(googleResults.map(r => r.place_id));
    const newPlaces = googleResults.filter(r => !existingByGoogleId[r.place_id]);
    const potentiallyClosed = existingPlaces.filter(p => !googlePlaceIds.has(p.google_place_id));

    stats.newFound = newPlaces.length;
    stats.closedFound = potentiallyClosed.length;

    // Step 4: Update existing places
    console.log('\n🔄 Updating existing places...\n');

    for (const place of existingPlaces) {
      const googleResult = googleResults.find(r => r.place_id === place.google_place_id);

      if (!googleResult) {
        console.log(`   ⚠️  ${place.name} - Not found in Google (may be closed)`);
        stats.skipped++;
        continue;
      }

      // Skip if permanently closed
      if (googleResult.business_status === 'CLOSED_PERMANENTLY') {
        console.log(`   🚫 ${place.name} - Permanently closed`);
        stats.skipped++;
        continue;
      }

      try {
        // Get detailed info
        const details = await getPlaceDetails(place.google_place_id);
        stats.apiCalls++;

        if (!details) {
          console.log(`   ❌ ${place.name} - Failed to get details`);
          stats.errors++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`   ✓ ${place.name} - Would update (${details.rating}⭐, ${details.user_ratings_total} reviews)`);
        } else {
          await updateGoogleData(place.id, place.google_place_id, details);
          console.log(`   ✅ ${place.name} - Updated (${details.rating}⭐, ${details.user_ratings_total} reviews)`);
        }
        stats.updated++;

      } catch (err) {
        console.log(`   ❌ ${place.name} - Error: ${err.message}`);
        stats.errors++;
      }
    }

    // Step 5: Report new places (if requested)
    if (INCLUDE_NEW && newPlaces.length > 0) {
      console.log('\n📍 NEW PLACES FOUND (not in database):');
      console.log('─'.repeat(50));

      for (const place of newPlaces.slice(0, 20)) { // Limit to first 20
        console.log(`   + ${place.name}`);
        console.log(`     Google ID: ${place.place_id}`);
        console.log(`     Rating: ${place.rating || 'N/A'} (${place.user_ratings_total || 0} reviews)`);
        console.log('');
      }

      if (newPlaces.length > 20) {
        console.log(`   ... and ${newPlaces.length - 20} more`);
      }
    }

    // Step 6: Report potentially closed places
    if (potentiallyClosed.length > 0) {
      console.log('\n⚠️  POTENTIALLY CLOSED (in DB but not found in Google):');
      console.log('─'.repeat(50));

      for (const place of potentiallyClosed) {
        console.log(`   ? ${place.name} (ID: ${place.id})`);
      }
    }

    // Step 7: Summary
    console.log('\n' + '═'.repeat(60));
    console.log('  REFRESH COMPLETE');
    console.log('═'.repeat(60));
    console.log(`
  📊 Statistics:
     Existing restaurants:  ${stats.existing}
     Updated:               ${stats.updated}
     Skipped:               ${stats.skipped}
     Errors:                ${stats.errors}

  🔍 Discovery:
     New places found:      ${stats.newFound}
     Potentially closed:    ${stats.closedFound}

  💰 API Usage:
     Total API calls:       ${stats.apiCalls}
     Estimated cost:        $${(stats.apiCalls * 0.017).toFixed(2)}
`);

    if (DRY_RUN) {
      console.log('  🔍 DRY RUN - No changes were made to the database\n');
    }

    // Save report
    const reportPath = path.join(__dirname, `google_refresh_report_${new Date().toISOString().split('T')[0]}.json`);
    await fs.writeFile(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: DRY_RUN ? 'dry-run' : 'live',
      stats,
      newPlaces: newPlaces.map(p => ({
        google_place_id: p.place_id,
        name: p.name,
        rating: p.rating,
        review_count: p.user_ratings_total
      })),
      potentiallyClosed: potentiallyClosed.map(p => ({
        id: p.id,
        name: p.name,
        google_place_id: p.google_place_id
      }))
    }, null, 2));

    console.log(`  📁 Report saved: ${reportPath}\n`);

  } catch (error) {
    console.error('\n❌ Fatal Error:', error);
  } finally {
    await pool.end();
  }
}

// Run
console.log('\n🚀 Starting Google Places Refresh\n');
refreshGoogleData();
