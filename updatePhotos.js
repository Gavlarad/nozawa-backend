// updatePhotos.js - Smart photo updater for annual updates
const fs = require('fs');
const path = require('path');
const https = require('https');

// Function to sanitize filename
function sanitizeName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
}

// Function to download a single photo
function downloadPhoto(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`  ✓ Downloaded: ${path.basename(filepath)}`);
          resolve();
        });
      } else {
        reject(`Failed: ${response.statusCode}`);
      }
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function updatePhotos() {
  console.log('Starting smart photo update...\n');
  
  // Load old and new data
  const oldData = JSON.parse(fs.readFileSync('./nozawa_places_unified.json', 'utf8'));
  const newData = JSON.parse(fs.readFileSync('./nozawa_places_unified_updated.json', 'utf8'));
  
  // Create photos directory if it doesn't exist
  const PHOTOS_DIR = './downloaded_photos';
  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  }
  
  // Track what to download
  const toDownload = [];
  let preservedCount = 0;
  let unchangedCount = 0;
  
  // Check each place
  for (const place of newData.places) {
    const oldPlace = oldData.places.find(p => p.id === place.id);
    
    // Skip if marked as manual (onsens)
    if (place.manual_photos) {
      console.log(`✓ Preserving manual photos for: ${place.name}`);
      preservedCount++;
      continue;
    }
    
    // Get photo arrays
    const oldPhotos = oldPlace?.google_data?.photos || [];
    const newPhotos = place.google_data?.photos || [];
    
    // Check if photos changed (compare URLs)
    const oldUrls = oldPhotos.map(p => p.url).sort().join('|');
    const newUrls = newPhotos.map(p => p.url).sort().join('|');
    
    if (oldUrls !== newUrls && newPhotos.length > 0) {
      console.log(`⟳ Photos changed for: ${place.name}`);
      toDownload.push({
        place: place.name,
        id: place.id,
        photos: newPhotos
      });
    } else if (newPhotos.length > 0) {
      unchangedCount++;
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`  - ${preservedCount} places with manual photos (preserved)`);
  console.log(`  - ${unchangedCount} places with unchanged photos`);
  console.log(`  - ${toDownload.length} places need photo updates`);
  
  if (toDownload.length === 0) {
    console.log('\n✅ No photo updates needed!');
    return;
  }
  
  console.log(`\n📥 Downloading updated photos...\n`);
  
  // Download only changed photos
  for (const item of toDownload) {
    const folderName = sanitizeName(item.place);
    const folderPath = path.join(PHOTOS_DIR, folderName);
    
    console.log(`\nUpdating ${item.place}:`);
    
    // Clear old photos for this place
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true });
      console.log(`  ✓ Cleared old photos`);
    }
    fs.mkdirSync(folderPath, { recursive: true });
    
    // Download new photos
    for (let i = 0; i < item.photos.length; i++) {
      const filename = `${folderName}_${i + 1}.jpg`;
      const filepath = path.join(folderPath, filename);
      
      try {
        await downloadPhoto(item.photos[i].url, filepath);
        
        // Add small delay to be nice to Google's servers
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`  ✗ Failed to download ${filename}: ${error}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ PHOTO UPDATE COMPLETE!');
  console.log('='.repeat(50));
  console.log('\nNext steps:');
  console.log('1. Copy updated photos to app: cp -r downloaded_photos/* ../nozawa-test/assets/photos/');
  console.log('2. Regenerate photo map: cd ../nozawa-test && node scripts/generatePhotoMap.js');
  console.log('3. Build and deploy app');
}

// Run the update
updatePhotos().catch(console.error);