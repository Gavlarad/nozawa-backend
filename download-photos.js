const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Create photos directory
const PHOTOS_DIR = './downloaded_photos';
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// Load your JSON file
const data = JSON.parse(fs.readFileSync('./nozawa_places_unified.json', 'utf8'));
const places = data.places;

// Track progress
let totalPhotos = 0;
let downloadedPhotos = 0;
let failedDownloads = [];

// Function to sanitize filename
function sanitizeName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
}

// Function to download with redirect support
function downloadPhoto(urlString, filepath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject('Too many redirects');
      return;
    }
    
    const urlObj = new URL(urlString);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const file = fs.createWriteStream(filepath);
    
    protocol.get(urlString, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        file.close();
        fs.unlinkSync(filepath); // Remove empty file
        const redirectUrl = response.headers.location;
        console.log(`  → Redirect ${redirectCount + 1}`);
        downloadPhoto(redirectUrl, filepath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`  ✓ Downloaded: ${path.basename(filepath)}`);
          resolve();
        });
      } else {
        file.close();
        fs.unlinkSync(filepath);
        reject(`HTTP ${response.statusCode}: ${response.statusMessage}`);
      }
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      reject(err);
    });
  });
}

// Main download function
async function downloadAllPhotos() {
  console.log('Starting photo downloads...\n');
  console.log(`Processing ${places.length} places from nozawa_places_unified.json\n`);
  
  // Count total photos
  places.forEach(place => {
    if (place.google_data?.photos?.length > 0) {
      totalPhotos += place.google_data.photos.length;
    }
  });
  
  console.log(`Found ${totalPhotos} total photos to download\n`);
  
  // Download each place's photos
  for (const place of places) {
    if (!place.google_data?.photos?.length) {
      continue;
    }
    
    const placeName = sanitizeName(place.name);
    const placeDir = path.join(PHOTOS_DIR, placeName);
    
    // Create directory
    if (!fs.existsSync(placeDir)) {
      fs.mkdirSync(placeDir, { recursive: true });
    }
    
    console.log(`\n📍 ${place.name} (${place.category}) - ${place.google_data.photos.length} photos`);
    
    // Download each photo
    for (let i = 0; i < place.google_data.photos.length; i++) {
      const photo = place.google_data.photos[i];
      const filename = `${placeName}_${i + 1}.jpg`;
      const filepath = path.join(placeDir, filename);
      
      // Skip if exists
      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        if (stats.size > 1000) { // Only skip if file is not empty
          console.log(`  ⚡ Already exists: ${filename} (${(stats.size/1024).toFixed(1)}KB)`);
          downloadedPhotos++;
          continue;
        }
      }
      
      try {
        await downloadPhoto(photo.url, filepath);
        downloadedPhotos++;
        console.log(`  Progress: ${downloadedPhotos}/${totalPhotos} (${Math.round(downloadedPhotos/totalPhotos*100)}%)`);
        
        // Delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`  ✗ Failed ${filename}: ${error}`);
        failedDownloads.push({
          place: place.name,
          photo: i + 1,
          url: photo.url,
          error: error.toString()
        });
      }
    }
  }
  
  // Final report
  console.log('\n' + '='.repeat(50));
  console.log('DOWNLOAD COMPLETE');
  console.log('='.repeat(50));
  console.log(`✓ Successfully downloaded: ${downloadedPhotos}/${totalPhotos}`);
  
  if (failedDownloads.length > 0) {
    console.log(`✗ Failed: ${failedDownloads.length}`);
    fs.writeFileSync('./failed_downloads.json', JSON.stringify(failedDownloads, null, 2));
  }
  
  // Calculate size
  const getDirSize = (dirPath) => {
    let size = 0;
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirSize(filePath);
      } else {
        size += stats.size;
      }
    });
    return size;
  };
  
  const totalSize = getDirSize(PHOTOS_DIR);
  console.log(`\nTotal size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

// Run it
downloadAllPhotos().catch(console.error);