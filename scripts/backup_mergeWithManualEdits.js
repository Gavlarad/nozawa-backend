const fs = require('fs').promises;
const path = require('path');

async function mergeRestaurantData() {
  console.log('🔀 Merging Fresh Data with Manual Edits\n');
  
  try {
    // Load fresh Google data (created by fetchAllRestaurantData.js)
    const freshData = JSON.parse(
      await fs.readFile('nozawa_restaurants_complete.json', 'utf8')
    );
    
    // Fix the path - go up TWO directories from scripts folder
    const unifiedPath = path.join(__dirname, '../../nozawa-backend/nozawa_places_unified.json');
    
    console.log('Looking for unified file at:', unifiedPath);
    
    const currentUnified = JSON.parse(
      await fs.readFile(unifiedPath, 'utf8')
    );
    
    // Extract manual edits
    const manualEdits = {};
    let preservedCount = 0;
    
    currentUnified.places
      .filter(p => p.category === 'restaurant')
      .forEach(r => {
        if (r.subcategory && r.subcategory !== 'Restaurant') {
          manualEdits[r.id] = {
            subcategory: r.subcategory,
            local_knowledge: r.local_knowledge
          };
          preservedCount++;
          console.log(`  Preserving: ${r.name} → ${r.subcategory}`);
        }
      });
    
    console.log(`\nFound ${preservedCount} manual edits to preserve\n`);
    
    // Merge fresh data with manual edits
    const mergedRestaurants = freshData.restaurants.map(r => ({
      ...r,
      subcategory: manualEdits[r.id]?.subcategory || r.subcategory,
      local_knowledge: manualEdits[r.id]?.local_knowledge || r.local_knowledge
    }));
    
    // Get onsens and lifts from current unified
    const onsens = currentUnified.places.filter(p => p.category === 'onsen');
    const lifts = currentUnified.places.filter(p => p.category === 'lift');
    
    console.log('Current data breakdown:');
    console.log(`  - Existing restaurants in unified: ${currentUnified.places.filter(p => p.category === 'restaurant').length}`);
    console.log(`  - Fresh restaurants from Google: ${freshData.restaurants.length}`);
    console.log(`  - Onsens: ${onsens.length}`);
    console.log(`  - Lifts: ${lifts.length}`);
    
    // Create new unified file
    const newUnified = {
      places: [...mergedRestaurants, ...onsens, ...lifts],
      total_count: mergedRestaurants.length + onsens.length + lifts.length,
      generated_at: new Date().toISOString()
    };
    
    // Save to scripts folder for review
    await fs.writeFile(
      'nozawa_places_unified_updated.json',
      JSON.stringify(newUnified, null, 2)
    );
    
    console.log('\n✅ Merge complete!');
    console.log(`📊 Total places: ${newUnified.total_count}`);
    console.log(`  - Restaurants: ${mergedRestaurants.length}`);
    console.log(`  - Onsens: ${onsens.length}`);
    console.log(`  - Lifts: ${lifts.length}`);
    console.log('\n📁 Output saved to: nozawa_places_unified_updated.json');
    console.log('\n⚠️  Review the file, then copy to backend if everything looks good:');
    console.log('cp nozawa_places_unified_updated.json ../../nozawa-backend/nozawa_places_unified.json');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full path attempted:', error.path);
    if (error.code === 'ENOENT') {
      console.error('\n❌ File not found. Check your directory structure.');
      console.error('Current directory:', __dirname);
      console.error('Make sure nozawa-backend folder is at the same level as nozawa-test');
    }
  }
}

mergeRestaurantData();