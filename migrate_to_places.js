// Script to migrate restaurants.json to places.json structure
const fs = require('fs');

console.log('Starting migration from restaurants to places...');

try {
  // Read current restaurant data
  const rawData = fs.readFileSync('nozawa_restaurants_enhanced.json', 'utf8');
  const restaurantData = JSON.parse(rawData);
  
  // Check structure
  if (!restaurantData.restaurants || !Array.isArray(restaurantData.restaurants)) {
    throw new Error('Expected restaurants array not found');
  }

  // Transform to new places structure
  const placesData = {
    places: [],
    metadata: {
      version: "2.0",
      last_updated: new Date().toISOString(),
      total_places: 0,
      categories: {
        restaurant: 0,
        onsen: 0,
        service: 0,
        transport: 0,
        activity: 0,
        ski: 0
      }
    }
  };

  // Migrate each restaurant
  restaurantData.restaurants.forEach((restaurant, index) => {
    const place = {
      ...restaurant,
      // Add new required fields
      category: 'restaurant',
      subcategory: restaurant.cuisine || restaurant.type || 'general',
      // Ensure we have an ID
      id: restaurant.id || restaurant.google_place_id || `rest_${String(index + 1).padStart(3, '0')}`,
      // Add placeholder fields for future use
      navigation_tips: restaurant.navigation_tips || null,
      warnings: restaurant.warnings || [],
      features: restaurant.features || {}
    };
    
    placesData.places.push(place);
    placesData.metadata.categories.restaurant++;
  });

  // Update total count
  placesData.metadata.total_places = placesData.places.length;

  // Save the new structure
  fs.writeFileSync(
    'nozawa_places.json',
    JSON.stringify(placesData, null, 2)
  );

  console.log('\n✅ Migration complete!');
  console.log('='.repeat(40));
  console.log(`📊 Migrated ${placesData.places.length} restaurants`);
  console.log(`📁 New file created: nozawa_places.json`);
  console.log(`✅ Original preserved: nozawa_restaurants_enhanced.json`);
  console.log('='.repeat(40));
  
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
