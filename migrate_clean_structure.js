const fs = require('fs');

console.log('Migrating to clean structure with status tracking...');

try {
  const rawData = fs.readFileSync('nozawa_restaurants_enhanced.json', 'utf8');
  const restaurantData = JSON.parse(rawData);
  
  const placesData = {
    places: [],
    metadata: {
      version: "2.1",
      last_updated: new Date().toISOString(),
      last_google_sync: null,
      total_places: 0,
      categories: {
        restaurant: 0,
        onsen: 0,
        service: 0
      }
    }
  };

  restaurantData.restaurants.forEach((restaurant, index) => {
    const place = {
      // Core identity
      id: restaurant.google_place_id || `rest_${String(index + 1).padStart(3, '0')}`,
      category: 'restaurant',
      subcategory: restaurant.cuisine || restaurant.type || 'general',
      status: 'active',
      last_verified: new Date().toISOString(),
      
      // Google data (refreshable)
      google_data: {
        place_id: restaurant.google_place_id,
        name: restaurant.name,
        rating: restaurant.rating,
        review_count: restaurant.review_count,
        price_range: restaurant.price_range,
        hours: restaurant.opening_hours,
        photos: restaurant.photos || [],
        coordinates: restaurant.coordinates,
        address: restaurant.address,
        phone: restaurant.phone,
        website: restaurant.website,
        maps_url: restaurant.google_maps_url
      },
      
      // Enhanced data (preserved)
      enhanced_data: {
        review_analysis: restaurant.review_analysis,
        cuisine: restaurant.cuisine,
        budget: restaurant.budget,
        english_menu: restaurant.english_menu,
        credit_cards: restaurant.credit_cards,
        vegetarian_friendly: restaurant.vegetarian_friendly
      },
      
      // Local knowledge (manual)
      local_knowledge: {
        navigation_tips: null,
        warnings: [],
        notes: null,
        verified_features: {}
      }
    };
    
    placesData.places.push(place);
    placesData.metadata.categories.restaurant++;
  });

  placesData.metadata.total_places = placesData.places.length;
  
  fs.writeFileSync(
    'nozawa_places_clean.json',
    JSON.stringify(placesData, null, 2)
  );

  console.log(`✅ Migrated ${placesData.places.length} restaurants to clean structure`);
  
} catch (error) {
  console.error('❌ Migration failed:', error.message);
}
