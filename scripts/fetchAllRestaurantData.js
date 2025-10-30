const fs = require('fs').promises;
const https = require('https');

// Configuration
const CONFIG = {
  GOOGLE_API_KEY: 'AIzaSyDA4KHJIRJKGpHxaLPTumOSWlWYH5ypKFw',
  NOZAWA_LAT: 36.923011,
  NOZAWA_LNG: 138.447077,
  SEARCH_RADIUS: 2000, // 2km covers whole village
  OUTPUT_FILE: 'nozawa_restaurants_complete.json',
  DELAY_MS: 200, // Delay between API calls
  PAGE_DELAY_MS: 2000, // Required delay between pagination
  MAX_PHOTOS: 3, // Max photos per restaurant
  MAX_REVIEWS: 5 // Max reviews to analyze per restaurant
};

// Helper function to make API requests
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Helper to add delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    'american_restaurant': 'American',
    'pizza_restaurant': 'Pizza',
    'cafe': 'Cafe',
    'bar': 'Bar',
    'bakery': 'Bakery',
    'vegetarian_restaurant': 'Vegetarian'
  };
  
  for (const type of types || []) {
    if (typeMap[type]) return typeMap[type];
  }
  return 'Restaurant';
}

// Convert price level to yen symbols
function getPriceRange(priceLevel) {
  if (!priceLevel && priceLevel !== 0) return '¥¥';
  const levels = ['Free', '¥', '¥¥', '¥¥¥', '¥¥¥¥'];
  return levels[priceLevel] || '¥¥';
}

// Analyze reviews for insights
function analyzeReviews(reviews) {
  if (!reviews || reviews.length === 0) return {
    mentions_english: false,
    mentions_cash_only: false,
    mentions_wait: false,
    mentions_vegetarian: false,
    recent_reviews: []
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
    const text = review.text.toLowerCase();
    
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
    
    // Keep first 5 reviews for reference
    if (index < CONFIG.MAX_REVIEWS) {
      insights.recent_reviews.push({
        rating: review.rating,
        time: review.relative_time_description,
        text_snippet: review.text.substring(0, 200) + (review.text.length > 200 ? '...' : '')
      });
    }
  });
  
  return insights;
}

// Get photo URLs
function getPhotoUrls(photos) {
  if (!photos || photos.length === 0) return [];
  
  const photoUrls = [];
  const maxPhotos = Math.min(CONFIG.MAX_PHOTOS, photos.length);
  
  for (let i = 0; i < maxPhotos; i++) {
    const photo = photos[i];
    photoUrls.push({
      url: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photo.photo_reference}&key=${CONFIG.GOOGLE_API_KEY}`,
      width: photo.width,
      height: photo.height,
      attributions: photo.html_attributions || []
    });
  }
  
  return photoUrls;
}

// Search for all restaurants with pagination
async function searchAllRestaurants() {
  const allResults = [];
  let nextPageToken = null;
  let pageCount = 1;
  
  console.log('🔍 Searching for restaurants...\n');
  
  do {
    let searchUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
      `location=${CONFIG.NOZAWA_LAT},${CONFIG.NOZAWA_LNG}` +
      `&radius=${CONFIG.SEARCH_RADIUS}` +
      `&type=restaurant` +
      `&key=${CONFIG.GOOGLE_API_KEY}`;
    
    if (nextPageToken) {
      searchUrl += `&pagetoken=${nextPageToken}`;
      await sleep(CONFIG.PAGE_DELAY_MS);
    }
    
    console.log(`  Fetching page ${pageCount}...`);
    const searchData = await makeRequest(searchUrl);
    
    if (searchData.status !== 'OK' && searchData.status !== 'ZERO_RESULTS') {
      console.error('  ❌ Search failed:', searchData.status);
      if (searchData.error_message) {
        console.error('  Error:', searchData.error_message);
      }
      break;
    }
    
    if (searchData.results && searchData.results.length > 0) {
      allResults.push(...searchData.results);
      console.log(`  ✅ Found ${searchData.results.length} restaurants (Total: ${allResults.length})`);
    }
    
    nextPageToken = searchData.next_page_token;
    pageCount++;
    
  } while (nextPageToken);
  
  // Also search for cafes and bars
  console.log('\n🔍 Searching for cafes and bars...\n');
  
  for (const placeType of ['cafe', 'bar']) {
    const typeUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
      `location=${CONFIG.NOZAWA_LAT},${CONFIG.NOZAWA_LNG}` +
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
      console.log(`  ✅ Found ${newPlaces} new ${placeType}s (Total: ${allResults.length})`);
    }
  }
  
  return allResults;
}

// Main scraper function
async function scrapeNozawaRestaurants() {
  console.log('🍜 Nozawa Complete Restaurant Data Fetcher\n');
  console.log('📍 Location: Nozawa Onsen, Japan\n');
  console.log('=' .repeat(50));
  
  const restaurants = [];
  let totalApiCalls = 0;
  let skippedCount = 0;
  let failedCount = 0;
  
  try {
    // Step 1: Search for all restaurants
    const searchResults = await searchAllRestaurants();
    totalApiCalls += Math.ceil(searchResults.length / 20) + 2; // Pages + cafe/bar searches
    
    console.log(`\n✅ Found ${searchResults.length} total establishments\n`);
    console.log('=' .repeat(50));
    console.log('\n📊 Getting complete details for each restaurant...\n');
    
    // Step 2: Get complete details for each restaurant
    for (let i = 0; i < searchResults.length; i++) {
      const place = searchResults[i];
      
      // Skip if permanently closed
      if (place.business_status === 'CLOSED_PERMANENTLY') {
        console.log(`⏭️  [${i + 1}/${searchResults.length}] Skipping ${place.name} (permanently closed)`);
        skippedCount++;
        continue;
      }
      
      // Get ALL valid fields in one request
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?` +
        `place_id=${place.place_id}` +
        `&fields=name,formatted_address,formatted_phone_number,international_phone_number,` +
        `opening_hours,website,rating,user_ratings_total,price_level,types,` +
        `business_status,geometry,vicinity,reviews,photos,editorial_summary,` +
        `takeout,delivery,dine_in,reservable,serves_beer,serves_wine,` +
        `wheelchair_accessible_entrance,curbside_pickup` +
        `&language=en` +
        `&key=${CONFIG.GOOGLE_API_KEY}`;
      
      await sleep(CONFIG.DELAY_MS);
      
      const detailsData = await makeRequest(detailsUrl);
      totalApiCalls++;
      
      if (detailsData.status === 'OK' && detailsData.result) {
        const details = detailsData.result;
        
        // Analyze reviews
        const reviewAnalysis = analyzeReviews(details.reviews);
        
        // Get photo URLs
        const photos = getPhotoUrls(details.photos);
        
        // Check if it's vegetarian from types or reviews
        const isVegetarian = details.types?.includes('vegetarian_restaurant') || 
                            reviewAnalysis.mentions_vegetarian;
        
        // Create complete restaurant object
        const restaurant = {
          // Identifiers
          id: place.place_id,
          google_place_id: place.place_id,
          
          // Basic info
          name: details.name,
          category: 'restaurant',
          subcategory: getCuisineType(details.types), // Will be overridden by manual edits
          status: 'active',
          last_verified: new Date().toISOString(),
          
          // Location - both formats for compatibility
          coordinates: [
            details.geometry.location.lng,
            details.geometry.location.lat
          ],
          location: {
            lat: details.geometry.location.lat,
            lng: details.geometry.location.lng,
            address: details.formatted_address || details.vicinity
          },
          
          // Complete Google data
          google_data: {
            place_id: place.place_id,
            name: details.name,
            rating: details.rating || null,
            review_count: details.user_ratings_total || 0,
            price_range: getPriceRange(details.price_level),
            
            // Hours
            hours: details.opening_hours || null,
            
            // Photos
            photos: photos,
            
            // Location
            coordinates: [details.geometry.location.lng, details.geometry.location.lat],
            address: details.formatted_address || details.vicinity,
            
            // Contact
            phone: details.formatted_phone_number || details.international_phone_number || null,
            website: details.website || null,
            
            // Maps link
            maps_url: `https://maps.google.com/?cid=${place.place_id}`,
            
            // Editorial content
            editorial_summary: details.editorial_summary?.overview || null,
            
            // Types from Google
            types: details.types || [],
            
            // Valid service options from API
            takeout: details.takeout || false,
            delivery: details.delivery || false,
            dine_in: details.dine_in || false,
            reservable: details.reservable || false,
            serves_beer: details.serves_beer || false,
            serves_wine: details.serves_wine || false,
            curbside_pickup: details.curbside_pickup || false,
            wheelchair_accessible: details.wheelchair_accessible_entrance || false,
            
            // Inferred from reviews/types
            vegetarian_friendly: isVegetarian
          },
          
          // Enhanced data from review analysis
          enhanced_data: {
            review_analysis: {
              review_count: details.reviews?.length || 0,
              insights: reviewAnalysis
            }
          },
          
          // Placeholder for manual data
          local_knowledge: {
            navigation_tips: null,
            warnings: [],
            notes: null,
            verified_features: {}
          }
        };
        
        restaurants.push(restaurant);
        
        // Progress indicator with insights
        const insights = [];
        if (reviewAnalysis.mentions_english) insights.push('EN');
        if (reviewAnalysis.mentions_cash_only) insights.push('💵');
        if (reviewAnalysis.mentions_vegetarian) insights.push('🥗');
        if (photos.length > 0) insights.push(`📸${photos.length}`);
        
        console.log(`✅ [${i + 1}/${searchResults.length}] ${restaurant.name} (${restaurant.subcategory}, ${restaurant.google_data.price_range}, ${restaurant.google_data.rating || 'N/A'}⭐) ${insights.join(' ')}`);
        
      } else {
        console.log(`❌ [${i + 1}/${searchResults.length}] Failed to get details for ${place.name}`);
        failedCount++;
      }
    }
    
    // Step 3: Sort by rating
    restaurants.sort((a, b) => (b.google_data?.rating || 0) - (a.google_data?.rating || 0));
    
    // Step 4: Save complete data
    const output = {
      metadata: {
        location: 'Nozawa Onsen',
        generated_at: new Date().toISOString(),
        total_found: searchResults.length,
        total_processed: restaurants.length,
        skipped_closed: skippedCount,
        failed_details: failedCount,
        api_calls_made: totalApiCalls,
        estimated_cost: `$${(totalApiCalls * 0.017).toFixed(2)}`,
        data_completeness: 'full',
        includes: {
          basic_info: true,
          photos: true,
          reviews: true,
          service_options: true,
          accessibility: true,
          review_insights: true
        }
      },
      restaurants: restaurants
    };
    
    await fs.writeFile(CONFIG.OUTPUT_FILE, JSON.stringify(output, null, 2));
    
    // Step 5: Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 SCRAPING COMPLETE!');
    console.log('='.repeat(50));
    console.log(`✅ Successfully processed: ${restaurants.length} establishments`);
    console.log(`⏭️  Skipped (closed): ${skippedCount}`);
    console.log(`❌ Failed to fetch: ${failedCount}`);
    console.log(`📞 API calls made: ${totalApiCalls}`);
    console.log(`💰 Estimated cost: $${(totalApiCalls * 0.017).toFixed(2)}`);
    console.log(`📁 Data saved to: ${CONFIG.OUTPUT_FILE}`);
    
    // Category summary
    const categories = {};
    restaurants.forEach(r => {
      categories[r.subcategory] = (categories[r.subcategory] || 0) + 1;
    });
    
    console.log('\n📈 By category:');
    Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
    
    // Insights summary
    const cashOnly = restaurants.filter(r => r.enhanced_data?.review_analysis?.insights?.mentions_cash_only).length;
    const englishFriendly = restaurants.filter(r => r.enhanced_data?.review_analysis?.insights?.mentions_english).length;
    const vegetarian = restaurants.filter(r => r.google_data?.vegetarian_friendly).length;
    const hasPhotos = restaurants.filter(r => r.google_data?.photos?.length > 0).length;
    
    console.log('\n💡 Insights found:');
    console.log(`  💵 Cash only mentioned: ${cashOnly} places`);
    console.log(`  🇬🇧 English friendly: ${englishFriendly} places`);
    console.log(`  🥗 Vegetarian friendly: ${vegetarian} places`);
    console.log(`  📸 Have photos: ${hasPhotos} places`);
    
    // Service options summary
    const takeout = restaurants.filter(r => r.google_data?.takeout).length;
    const delivery = restaurants.filter(r => r.google_data?.delivery).length;
    const wheelchair = restaurants.filter(r => r.google_data?.wheelchair_accessible).length;
    
    console.log('\n🚀 Service options:');
    console.log(`  🥡 Takeout available: ${takeout} places`);
    console.log(`  🚚 Delivery available: ${delivery} places`);
    console.log(`  ♿ Wheelchair accessible: ${wheelchair} places`);
    
    // Top rated
    console.log('\n🏆 Top 5 rated:');
    restaurants
      .filter(r => r.google_data?.rating && r.google_data?.review_count > 10)
      .slice(0, 5)
      .forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.name} (${r.google_data.rating}⭐ from ${r.google_data.review_count} reviews)`);
      });
    
  } catch (error) {
    console.error('\n❌ Critical Error:', error);
    console.error('Stack:', error.stack);
  }
}

// Run the scraper
console.log('🚀 Starting Complete Nozawa Restaurant Data Fetch\n');
console.log('📝 This replaces both googlePlacesScraper.js and enhanceRestaurants.js\n');

if (CONFIG.GOOGLE_API_KEY === 'YOUR_API_KEY_HERE') {
  console.error('❌ Please add your Google API key to the CONFIG object');
  process.exit(1);
}

scrapeNozawaRestaurants();