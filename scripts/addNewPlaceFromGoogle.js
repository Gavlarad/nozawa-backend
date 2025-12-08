/**
 * Add New Place from Google Places API
 *
 * Adds a new restaurant to the database from a Google Place ID.
 * Creates entries in both `places` and `place_google_data` tables.
 *
 * Usage:
 *   node addNewPlaceFromGoogle.js <google_place_id>
 *   node addNewPlaceFromGoogle.js ChIJxxxxxxxxxxxxxxx
 *
 * The place will be added as:
 * - Category: restaurant
 * - Visible: true (you can hide via admin later)
 * - Status: active
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const https = require('https');

const CONFIG = {
  GOOGLE_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
  RESORT_ID: 1,
  MAX_PHOTOS: 5,
  MAX_REVIEWS: 5
};

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

// Extract features
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

// Get cuisine type from Google types
function getCuisineType(types) {
  const typeMap = {
    'ramen_restaurant': 'Ramen',
    'sushi_restaurant': 'Sushi',
    'japanese_restaurant': 'Japanese',
    'italian_restaurant': 'Italian',
    'french_restaurant': 'French',
    'chinese_restaurant': 'Chinese',
    'korean_restaurant': 'Korean',
    'cafe': 'Cafe',
    'bar': 'Bar',
    'bakery': 'Bakery'
  };

  for (const type of types || []) {
    if (typeMap[type]) return typeMap[type];
  }
  return 'Restaurant';
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

// Generate external_id from name and google place id
function generateExternalId(name, googlePlaceId) {
  // Try to create from name first
  const fromName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);

  // If name doesn't produce valid slug (e.g., all Japanese), use last 8 chars of Google ID
  if (fromName.length < 3) {
    return 'google_' + googlePlaceId.slice(-12);
  }
  return 'google_' + fromName;
}

async function addPlace(googlePlaceId) {
  console.log('═'.repeat(50));
  console.log('  ADD NEW PLACE FROM GOOGLE');
  console.log('═'.repeat(50));
  console.log(`\n  Google Place ID: ${googlePlaceId}\n`);

  if (!CONFIG.GOOGLE_API_KEY) {
    console.error('❌ Error: GOOGLE_PLACES_API_KEY not set');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    // Check if place already exists
    const existing = await client.query(
      'SELECT id, name FROM places WHERE google_place_id = $1',
      [googlePlaceId]
    );

    if (existing.rows.length > 0) {
      console.log(`❌ Place already exists: ${existing.rows[0].name} (ID: ${existing.rows[0].id})`);
      return;
    }

    // Fetch from Google
    console.log('📡 Fetching from Google Places API...');

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?` +
      `place_id=${googlePlaceId}` +
      `&fields=name,formatted_address,formatted_phone_number,` +
      `opening_hours,website,rating,user_ratings_total,price_level,types,` +
      `business_status,geometry,photos,reviews,editorial_summary,` +
      `takeout,delivery,dine_in,reservable,serves_beer,serves_wine,` +
      `wheelchair_accessible_entrance` +
      `&language=en` +
      `&key=${CONFIG.GOOGLE_API_KEY}`;

    const data = await makeRequest(detailsUrl);

    if (data.status !== 'OK' || !data.result) {
      console.error(`❌ Google API error: ${data.status}`);
      console.error(data.error_message || '');
      return;
    }

    const details = data.result;
    console.log(`\n✅ Found: ${details.name}`);
    console.log(`   Address: ${details.formatted_address}`);
    console.log(`   Rating: ${details.rating || 'N/A'} (${details.user_ratings_total || 0} reviews)`);

    // Begin transaction
    await client.query('BEGIN');

    // Generate external_id
    const externalId = generateExternalId(details.name, googlePlaceId);

    // Analyze reviews
    const reviewAnalysis = analyzeReviews(details.reviews);

    // Insert into places table
    const placeResult = await client.query(`
      INSERT INTO places (
        resort_id,
        external_id,
        google_place_id,
        category,
        subcategory,
        status,
        visible_in_app,
        data_source,
        name,
        latitude,
        longitude,
        address,
        review_analysis,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING id
    `, [
      CONFIG.RESORT_ID,
      externalId,
      googlePlaceId,
      'restaurant',
      getCuisineType(details.types),
      'active',
      true,
      'google',
      details.name,
      details.geometry.location.lat,
      details.geometry.location.lng,
      details.formatted_address,
      JSON.stringify(reviewAnalysis)
    ]);

    const placeId = placeResult.rows[0].id;
    console.log(`\n💾 Created place record (ID: ${placeId})`);

    // Insert into place_google_data
    const photos = extractPhotoUrls(details.photos);
    const features = extractFeatures(details);

    await client.query(`
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
    `, [
      placeId,
      details.rating || null,
      details.user_ratings_total || 0,
      getPriceRange(details.price_level),
      details.formatted_phone_number || null,
      details.website || null,
      details.opening_hours ? JSON.stringify(details.opening_hours) : null,
      JSON.stringify(photos),
      details.types || [],  // Pass as native JS array - pg driver converts to TEXT[]
      details.editorial_summary?.overview || null,
      JSON.stringify(features),
      `https://maps.google.com/?cid=${googlePlaceId}`
    ]);

    console.log('💾 Created Google data record');

    await client.query('COMMIT');

    console.log('\n' + '═'.repeat(50));
    console.log('  ✅ PLACE ADDED SUCCESSFULLY');
    console.log('═'.repeat(50));
    console.log(`
  Name:      ${details.name}
  ID:        ${placeId}
  Category:  restaurant
  Subcategory: ${getCuisineType(details.types)}
  Visible:   Yes

  Next steps:
  1. Open admin panel
  2. Find "${details.name}"
  3. Add local knowledge (tips, warnings)
  4. Adjust visibility if needed
`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

// Get Google Place ID from command line
const googlePlaceId = process.argv[2];

if (!googlePlaceId) {
  console.log(`
Usage: node addNewPlaceFromGoogle.js <google_place_id>

Example:
  node addNewPlaceFromGoogle.js ChIJ2T5hZ9DXGGAR0tKRWL8JqeI

Get the Google Place ID from:
1. Run refreshGoogleDataPostgres.js --include-new
2. Check the report for new places found
3. Use the google_place_id from the report
`);
  process.exit(1);
}

addPlace(googlePlaceId);
