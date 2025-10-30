const fs = require('fs').promises;
const path = require('path');

async function mergeRestaurantData() {
  console.log('🔀 Merging Fresh Google Data with Manual Edits\n');
  
  try {
    // Load fresh Google data (created by fetchAllRestaurantData.js)
    const freshDataPath = path.join(__dirname, 'nozawa_restaurants_complete.json');
    const freshData = JSON.parse(await fs.readFile(freshDataPath, 'utf8'));
    
    // Load current unified data from backend
    const unifiedPath = path.join(__dirname, '../nozawa_places_unified.json');
    console.log('📂 Loading current data from:', unifiedPath);
    
    const currentUnified = JSON.parse(await fs.readFile(unifiedPath, 'utf8'));
    
    // Create lookup map of existing restaurants by Google Place ID
    const existingRestaurants = {};
    currentUnified.places
      .filter(p => p.category === 'restaurant' && p.google_place_id)
      .forEach(r => {
        existingRestaurants[r.google_place_id] = r;
      });
    
    console.log(`\n📊 Current Data:`);
    console.log(`  - Restaurants in unified: ${Object.keys(existingRestaurants).length}`);
    console.log(`  - Fresh from Google API: ${freshData.restaurants.length}`);
    
    // Track what we're preserving
    let preservedVisibility = 0;
    let preservedLocalKnowledge = 0;
    let preservedEnhancedData = 0;
    let preservedManualPhotos = 0;
    
    // Merge fresh data with manual edits
    const mergedRestaurants = freshData.restaurants.map(freshRestaurant => {
      const existing = existingRestaurants[freshRestaurant.google_place_id];
      
      if (!existing) {
        // New restaurant - use fresh data with defaults
        return {
          ...freshRestaurant,
          visible_in_app: true,
          manual_overrides: {}
        };
      }
      
      // Restaurant exists - smart merge
      const merged = {
        ...freshRestaurant, // Start with fresh Google data
        
        // ALWAYS preserve these admin-controlled fields
        visible_in_app: existing.visible_in_app !== undefined ? existing.visible_in_app : true,
        status: existing.status || freshRestaurant.status,
        manual_overrides: existing.manual_overrides || {},
        last_verified: existing.last_verified
      };
      
      // Preserve visibility setting
      if (existing.visible_in_app === false) {
        preservedVisibility++;
        console.log(`  🙈 Hidden: ${freshRestaurant.google_data?.name || freshRestaurant.name}`);
      }
      
      // Preserve subcategory if manually edited
      if (existing.manual_overrides?.subcategory || 
          (existing.subcategory && existing.subcategory !== 'Restaurant')) {
        merged.subcategory = existing.subcategory;
        merged.manual_overrides.subcategory = true;
      }
      
      // Preserve local_knowledge if manually edited
      if (existing.manual_overrides?.local_knowledge || 
          existing.local_knowledge?.warnings?.length > 0 ||
          existing.local_knowledge?.notes ||
          existing.local_knowledge?.navigation_tips) {
        merged.local_knowledge = existing.local_knowledge;
        merged.manual_overrides.local_knowledge = true;
        preservedLocalKnowledge++;
      }
      
      // Preserve enhanced_data if manually edited
      if (existing.manual_overrides?.enhanced_data ||
          existing.enhanced_data?.cuisine ||
          existing.enhanced_data?.budget ||
          existing.enhanced_data?.english_menu !== undefined) {
        merged.enhanced_data = {
          ...freshRestaurant.enhanced_data,
          ...existing.enhanced_data // Prefer existing manual data
        };
        merged.manual_overrides.enhanced_data = true;
        preservedEnhancedData++;
      }
      
      return merged;
    });
    
    console.log(`\n✅ Preserved Manual Edits:`);
    console.log(`  - Hidden from app: ${preservedVisibility}`);
    console.log(`  - Local knowledge: ${preservedLocalKnowledge}`);
    console.log(`  - Enhanced data: ${preservedEnhancedData}`);
    
    // Get onsens and lifts from current unified (100% unchanged)
    const onsens = currentUnified.places.filter(p => p.category === 'onsen');
    const lifts = currentUnified.places.filter(p => p.category === 'lift');
    
    // Count manual photo protection
    onsens.forEach(onsen => {
      if (onsen.manual_photos === true) {
        preservedManualPhotos++;
      }
    });
    
    console.log(`\n📦 Other Categories (Unchanged):`);
    console.log(`  - Onsens: ${onsens.length}`);
    console.log(`  - Lifts: ${lifts.length}`);
    console.log(`  - Manual photo protection: ${preservedManualPhotos} onsens`);
    
    // Create new unified file
    const newUnified = {
      places: [...mergedRestaurants, ...onsens, ...lifts],
      total_count: mergedRestaurants.length + onsens.length + lifts.length,
      generated_at: new Date().toISOString()
    };
    
    // Save to scripts folder for review
    const outputPath = path.join(__dirname, 'nozawa_places_unified_updated.json');
    await fs.writeFile(outputPath, JSON.stringify(newUnified, null, 2));
    
    console.log('\n✅ Merge Complete!');
    console.log(`📊 Total places: ${newUnified.total_count}`);
    console.log(`  - Restaurants: ${mergedRestaurants.length}`);
    console.log(`  - Onsens: ${onsens.length}`);
    console.log(`  - Lifts: ${lifts.length}`);
    console.log(`\n📁 Output: ${outputPath}`);
    console.log('\n⚠️  Next Steps:');
    console.log('1. Review: nozawa_places_unified_updated.json');
    console.log('2. Copy to backend: cp scripts/nozawa_places_unified_updated.json nozawa_places_unified.json');
    console.log('3. Test in admin panel');
    console.log('4. Upload to Railway via admin: "Save to Server"');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'ENOENT') {
      console.error('File not found:', error.path);
      console.error('Current directory:', __dirname);
    }
    throw error;
  }
}

mergeRestaurantData();