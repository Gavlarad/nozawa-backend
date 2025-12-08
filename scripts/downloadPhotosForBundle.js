/**
 * Download Photos for App Bundle
 *
 * Downloads photos from Google Places API (and manual URLs) for bundling
 * into the React Native app for offline use.
 *
 * Respects the manual_photos flag:
 * - manual_photos = true: Only download from place_overrides.photo_urls
 * - manual_photos = false + has photo_urls: Download manual first, fill with Google
 * - No manual photos: Download from Google only
 *
 * Usage:
 *   node downloadPhotosForBundle.js --output ../nozawa-test/assets/photos
 *   node downloadPhotosForBundle.js --dry-run
 *   node downloadPhotosForBundle.js --place-id ChIJxxxxxx  # Single place
 *   node downloadPhotosForBundle.js --clean  # Remove folders for places no longer in DB
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  MAX_PHOTOS_PER_PLACE: 4,
  OUTPUT_DIR: path.join(__dirname, '../../nozawa-test/assets/photos'),
  TIMEOUT_MS: 60000, // 60 seconds - Google photo API can be slow
  CATEGORIES_TO_INCLUDE: ['restaurant', 'bar', 'cafe'], // Skip onsens - handled separately
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CLEAN_MODE = args.includes('--clean');
const SINGLE_PLACE_ID = args.find(a => a.startsWith('--place-id='))?.split('=')[1]
  || (args.includes('--place-id') ? args[args.indexOf('--place-id') + 1] : null);
const OUTPUT_DIR = args.find(a => a.startsWith('--output='))?.split('=')[1]
  || (args.includes('--output') ? args[args.indexOf('--output') + 1] : null)
  || CONFIG.OUTPUT_DIR;

/**
 * Generate folder name from place name (matches existing convention)
 */
function generateFolderName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

/**
 * Download a file from URL to local path
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { timeout: CONFIG.TIMEOUT_MS }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {}); // Clean up partial file
        reject(err);
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Get all places with their photo data from PostgreSQL
 */
async function getPlacesWithPhotos() {
  const query = `
    SELECT
      p.id,
      p.external_id,
      p.google_place_id,
      p.name,
      p.category,
      p.status,
      p.visible_in_app,
      po.photo_urls as manual_photo_urls,
      po.manual_photos as protect_photos,
      gd.photos as google_photos
    FROM places p
    LEFT JOIN place_overrides po ON p.id = po.place_id
    LEFT JOIN place_google_data gd ON p.id = gd.place_id
    WHERE p.resort_id = 1
      AND p.status = 'active'
      AND p.visible_in_app = true
      ${SINGLE_PLACE_ID ? `AND (p.google_place_id = $1 OR p.external_id = $1)` : ''}
    ORDER BY p.category, p.name
  `;

  const params = SINGLE_PLACE_ID ? [SINGLE_PLACE_ID] : [];
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Extract URL from photo object or string
 */
function extractUrl(photo) {
  if (typeof photo === 'string') return photo;
  if (photo && photo.url) return photo.url;
  return null;
}

/**
 * Determine which photos to download for a place
 */
function getPhotosToDownload(place) {
  const photos = [];
  const manualUrls = place.manual_photo_urls || [];
  const googlePhotos = place.google_photos || [];
  const protectPhotos = place.protect_photos || false;

  // If protected, only use manual photos
  if (protectPhotos) {
    manualUrls.slice(0, CONFIG.MAX_PHOTOS_PER_PLACE).forEach((photo, i) => {
      const url = extractUrl(photo);
      if (url) {
        photos.push({ url, source: 'manual', index: i + 1 });
      }
    });
    return photos;
  }

  // Add manual photos first
  manualUrls.slice(0, CONFIG.MAX_PHOTOS_PER_PLACE).forEach((photo, i) => {
    const url = extractUrl(photo);
    if (url) {
      photos.push({ url, source: 'manual', index: i + 1 });
    }
  });

  // Fill remaining slots with Google photos
  const remainingSlots = CONFIG.MAX_PHOTOS_PER_PLACE - photos.length;
  if (remainingSlots > 0 && googlePhotos.length > 0) {
    googlePhotos.slice(0, remainingSlots).forEach((photo, i) => {
      const url = extractUrl(photo);
      if (url) {
        photos.push({ url, source: 'google', index: photos.length + 1 });
      }
    });
  }

  return photos;
}

/**
 * Download photos for a single place
 */
async function downloadPlacePhotos(place, outputDir) {
  const folderName = generateFolderName(place.name);
  const placeId = place.google_place_id || place.external_id;
  const folderPath = path.join(outputDir, folderName);

  const photosToDownload = getPhotosToDownload(place);

  if (photosToDownload.length === 0) {
    return { place: place.name, status: 'skipped', reason: 'no photos' };
  }

  // Check if folder exists and has photos
  const existingPhotos = fs.existsSync(folderPath)
    ? fs.readdirSync(folderPath).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'))
    : [];

  // Skip if already has enough photos (unless single place mode for refresh)
  if (!SINGLE_PLACE_ID && existingPhotos.length >= photosToDownload.length) {
    return { place: place.name, status: 'skipped', reason: 'already has photos', count: existingPhotos.length };
  }

  if (DRY_RUN) {
    return {
      place: place.name,
      placeId,
      status: 'would download',
      photos: photosToDownload.map(p => ({ source: p.source, index: p.index })),
      folder: folderName
    };
  }

  // Create folder
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Download each photo
  const results = [];
  for (const photo of photosToDownload) {
    const fileName = `${folderName}_${photo.index}.jpg`;
    const filePath = path.join(folderPath, fileName);

    try {
      await downloadFile(photo.url, filePath);
      results.push({ index: photo.index, source: photo.source, status: 'downloaded' });
    } catch (err) {
      results.push({ index: photo.index, source: photo.source, status: 'failed', error: err.message });
    }
  }

  return {
    place: place.name,
    placeId,
    status: 'processed',
    folder: folderName,
    photos: results
  };
}

/**
 * Clean up folders for places no longer in database
 */
async function cleanOrphanedFolders(places, outputDir) {
  if (!fs.existsSync(outputDir)) {
    return { removed: 0, folders: [] };
  }

  // Get all valid folder names from database
  const validFolders = new Set(places.map(p => generateFolderName(p.name)));

  // Also keep onsen folders (they're managed separately)
  const allFolders = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const orphaned = allFolders.filter(folder => {
    // Keep onsen folders
    if (folder.startsWith('nozawa_')) return false;
    // Keep if matches a valid place
    return !validFolders.has(folder);
  });

  if (DRY_RUN) {
    return { removed: orphaned.length, folders: orphaned, dryRun: true };
  }

  // Remove orphaned folders
  for (const folder of orphaned) {
    const folderPath = path.join(outputDir, folder);
    fs.rmSync(folderPath, { recursive: true, force: true });
  }

  return { removed: orphaned.length, folders: orphaned };
}

/**
 * Main execution
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('  DOWNLOAD PHOTOS FOR APP BUNDLE');
  console.log('═'.repeat(60));
  console.log(`\n  Output: ${OUTPUT_DIR}`);
  console.log(`  Max photos per place: ${CONFIG.MAX_PHOTOS_PER_PLACE}`);
  if (DRY_RUN) console.log('  Mode: DRY RUN (no files will be downloaded)');
  if (SINGLE_PLACE_ID) console.log(`  Single place: ${SINGLE_PLACE_ID}`);
  if (CLEAN_MODE) console.log('  Clean mode: Will remove orphaned folders');
  console.log();

  try {
    // Get places from database
    console.log('📡 Fetching places from database...');
    const places = await getPlacesWithPhotos();
    console.log(`   Found ${places.length} active, visible places\n`);

    // Filter to restaurant-like categories
    const eligiblePlaces = places.filter(p =>
      CONFIG.CATEGORIES_TO_INCLUDE.includes(p.category)
    );
    console.log(`   ${eligiblePlaces.length} restaurants/bars/cafes to process\n`);

    // Clean orphaned folders if requested
    if (CLEAN_MODE) {
      console.log('🧹 Checking for orphaned folders...');
      const cleanResult = await cleanOrphanedFolders(eligiblePlaces, OUTPUT_DIR);
      if (cleanResult.removed > 0) {
        console.log(`   ${DRY_RUN ? 'Would remove' : 'Removed'} ${cleanResult.removed} orphaned folders:`);
        cleanResult.folders.forEach(f => console.log(`     - ${f}`));
      } else {
        console.log('   No orphaned folders found');
      }
      console.log();
    }

    // Process each place
    console.log('📥 Processing photos...\n');
    const results = {
      downloaded: [],
      skipped: [],
      failed: []
    };

    for (const place of eligiblePlaces) {
      const result = await downloadPlacePhotos(place, OUTPUT_DIR);

      if (result.status === 'processed' || result.status === 'would download') {
        results.downloaded.push(result);
        const icon = DRY_RUN ? '📋' : '✅';
        console.log(`${icon} ${result.place}`);
        if (result.photos) {
          result.photos.forEach(p => {
            const status = p.status || `${p.source}`;
            console.log(`   ${p.index}. ${status}`);
          });
        }
      } else if (result.status === 'skipped') {
        results.skipped.push(result);
      } else {
        results.failed.push(result);
        console.log(`❌ ${result.place}: ${result.reason || 'unknown error'}`);
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(`\n  ${DRY_RUN ? 'Would download' : 'Downloaded'}: ${results.downloaded.length} places`);
    console.log(`  Skipped (already have photos): ${results.skipped.length} places`);
    if (results.failed.length > 0) {
      console.log(`  Failed: ${results.failed.length} places`);
    }

    // Next steps
    console.log('\n  Next steps:');
    if (DRY_RUN) {
      console.log('  1. Run without --dry-run to download photos');
    } else {
      console.log('  1. cd to nozawa-test/scripts');
      console.log('  2. Run: node generatePhotoMap.js');
      console.log('  3. Commit and push app update');
    }
    console.log();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
