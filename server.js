// Environment validation FIRST - before anything else
const { validateOrExit, getTypedConfig } = require('./config/env-validation');
const config = validateOrExit(); // Validates and exits if invalid

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const scheduler = require('./services/scheduler');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticateAdmin } = require('./middleware/auth');
const {
  authLimiter,
  apiLimiter,
  adminLimiter,
  getCorsOptions,
  validateLogin,
  validateGroupCreation,
  validateCheckin,
  checkValidation,
  getHelmetOptions,
  ipBlocker,
} = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection - proper configuration for Railway
let pool;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false
  });
} else {
  console.error('DATABASE_URL not found!');
  pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'test',
    user: 'test',
    password: 'test'
  });
}

// Test database connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
  } else {
    console.log('Database connected successfully');
    release();
  }
});

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Security headers
app.use(helmet(getHelmetOptions()));

// IP blocking (optional)
app.use(ipBlocker);

// CORS configuration
app.use(cors(getCorsOptions()));

// Body parsing with error handling
app.use(express.json({ limit: '50mb' }));

// JSON parsing error handler - catches malformed JSON from clients
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    // Log once without stack trace to reduce noise
    console.warn(`⚠️  Invalid JSON from ${req.ip} on ${req.method} ${req.path}`);
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains malformed JSON'
    });
  }
  next(err);
});

// Trust proxy (for Railway deployment)
app.set('trust proxy', 1);

// Load restaurant data
let restaurantsData = [];
let lastDataLoad = null;

function loadRestaurantData() {
  try {
    const dataPath = path.join(__dirname, 'nozawa_places_unified.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(rawData);
    // Filter to only get restaurants from the unified data
    restaurantsData = (data.places || []).filter(p => p.category === 'restaurant');
    lastDataLoad = new Date().toISOString();
    console.log(`Loaded ${restaurantsData.length} restaurants at ${lastDataLoad}`);
  } catch (error) {
    console.error('Error loading restaurant data:', error);
    restaurantsData = [];
  }
}

// NEW: UNIFIED PLACES ENDPOINT (rate limited)
app.get('/api/places', apiLimiter, (req, res) => {
  try {
    const placesData = JSON.parse(fs.readFileSync('./nozawa_places_unified.json', 'utf8'));
    let places = placesData.places || [];
    
    // Filter by category if requested
    const { category } = req.query;
    if (category) {
      places = places.filter(p => p.category === category);
    }
    
    res.json({
      places,
      total_count: places.length
    });
  } catch (error) {
    console.error('Error loading places:', error);
    res.status(500).json({ error: 'Failed to load places data' });
  }
});

// ============================================
// GOOGLE PLACES API ENDPOINTS (for accommodation search)
// ============================================

// Autocomplete search for accommodations
app.get('/api/places/autocomplete', async (req, res) => {
  const { input } = req.query;
  
  if (!input || input.trim().length < 2) {
    return res.status(400).json({ error: 'Search query too short' });
  }
  
  const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }
  
  // Nozawa Onsen center coordinates
  const NOZAWA_CENTER = { lat: 36.923005, lng: 138.446971 };
  const RADIUS = 5000; // 5km radius
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
      `input=${encodeURIComponent(input)}` +
      `&location=${NOZAWA_CENTER.lat},${NOZAWA_CENTER.lng}` +
      `&radius=${RADIUS}` +
      `&key=${GOOGLE_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'ZERO_RESULTS') {
      return res.json({ predictions: [], status: 'ZERO_RESULTS' });
    }
    
    if (data.status !== 'OK') {
      console.error('Google Places API error:', data.status, data.error_message);
      return res.status(500).json({ 
        error: 'Google Places API error', 
        status: data.status,
        message: data.error_message 
      });
    }
    
    // Return predictions
    res.json({
      predictions: data.predictions.map(p => ({
        place_id: p.place_id,
        description: p.description,
        main_text: p.structured_formatting?.main_text || p.description,
        secondary_text: p.structured_formatting?.secondary_text || ''
      })),
      status: 'OK'
    });
    
  } catch (error) {
    console.error('Autocomplete error:', error);
    res.status(500).json({ 
      error: 'Failed to search accommodations',
      message: error.message 
    });
  }
});

// Get place details (coordinates, address)
app.get('/api/places/details', async (req, res) => {
  const { place_id } = req.query;
  
  if (!place_id) {
    return res.status(400).json({ error: 'place_id required' });
  }
  
  const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    const url = `https://maps.googleapis.com/maps/api/place/details/json?` +
      `place_id=${place_id}` +
      `&fields=name,formatted_address,geometry` +
      `&key=${GOOGLE_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status !== 'OK') {
      console.error('Google Places Details API error:', data.status);
      return res.status(500).json({ 
        error: 'Google Places API error',
        status: data.status 
      });
    }
    
    const result = data.result;
    
    res.json({
      place_id: place_id,
      name: result.name,
      address: result.formatted_address,
      coordinates: [
        result.geometry.location.lng,
        result.geometry.location.lat
      ]
    });
    
  } catch (error) {
    console.error('Place details error:', error);
    res.status(500).json({ 
      error: 'Failed to get place details',
      message: error.message 
    });
  }
});

// ============= END GOOGLE PLACES API =============

// Helper function to check if restaurant is open
function isRestaurantOpen(restaurant) {
  if (!restaurant.opening_hours || !restaurant.opening_hours.periods) {
    return null;
  }
  
  // Implementation continues...
}

// Helper function to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c * 1000;
}

// Generate 6-digit numeric code for groups
function generateGroupCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// MAIN RESTAURANTS/PLACES ENDPOINT (rate limited)
app.get('/api/restaurants', apiLimiter, (req, res) => {
  const { 
    category,
    open_now, 
    cuisine, 
    price_range,
    english_menu,
    lat,
    lng,
    limit = 100
  } = req.query;
  
  let filtered = [...restaurantsData];
  
  // Category filter (for future use with onsens, services, etc)
  if (category && category !== 'restaurant') {
    return res.json({
      count: 0,
      restaurants: []
    });
  }
  
  // Open now filter
  if (open_now === 'true') {
    filtered = filtered.filter(r => isRestaurantOpen(r) === true);
  }
  
  // Cuisine filter
  if (cuisine) {
    filtered = filtered.filter(r => 
      r.cuisine?.toLowerCase().includes(cuisine.toLowerCase()) ||
      r.type?.toLowerCase().includes(cuisine.toLowerCase())
    );
  }
  
  // Price range filter
  if (price_range) {
    filtered = filtered.filter(r => r.price_range === price_range);
  }
  
  // English menu filter
  if (english_menu === 'true') {
    filtered = filtered.filter(r => 
      r.review_analysis?.insights?.mentions_english === true
    );
  }
  
  // Distance sorting
  if (lat && lng) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    
    filtered = filtered.map(r => ({
      ...r,
      distance: r.coordinates ? 
        calculateDistance(userLat, userLng, r.coordinates[1], r.coordinates[0]) : 
        99999
    })).sort((a, b) => a.distance - b.distance);
  }
  
  // Apply limit
  filtered = filtered.slice(0, parseInt(limit));
  
  res.json({
    count: filtered.length,
    restaurants: filtered,
    filters_applied: {
      category: category || 'restaurant',
      open_now: open_now === 'true',
      cuisine,
      price_range,
      english_menu: english_menu === 'true',
      proximity_sort: !!(lat && lng)
    }
  });
});

// Get restaurant statistics
app.get('/api/restaurants/stats', (req, res) => {
  const stats = {
    total_count: restaurantsData.length,
    by_cuisine: {},
    by_price: {},
    with_photos: 0,
    with_english_mentions: 0,
    average_rating: 0,
    data_updated: lastDataLoad
  };
  
  let totalRating = 0;
  let ratedCount = 0;
  
  restaurantsData.forEach(r => {
    const cuisine = r.cuisine || r.type || 'Other';
    stats.by_cuisine[cuisine] = (stats.by_cuisine[cuisine] || 0) + 1;
    
    const price = r.price_range || 'Unknown';
    stats.by_price[price] = (stats.by_price[price] || 0) + 1;
    
    if (r.photos && r.photos.length > 0) stats.with_photos++;
    if (r.review_analysis?.insights?.mentions_english) stats.with_english_mentions++;
    
    if (r.rating) {
      totalRating += r.rating;
      ratedCount++;
    }
  });
  
  stats.average_rating = ratedCount > 0 ? (totalRating / ratedCount).toFixed(2) : null;
  
  res.json(stats);
});

// Get currently open restaurants
app.get('/api/restaurants/status/open', (req, res) => {
  const openRestaurants = restaurantsData.filter(r => isRestaurantOpen(r) === true);
  
  res.json({
    count: openRestaurants.length,
    current_time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Tokyo' }),
    restaurants: openRestaurants
  });
});

// Get single restaurant by ID
app.get('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  
  const restaurant = restaurantsData.find(r => 
    r.id === id || r.google_place_id === id
  );
  
  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }
  
  res.json({
    ...restaurant,
    is_open_now: isRestaurantOpen(restaurant)
  });
});

// ============================================
// GROUP MANAGEMENT ENDPOINTS
// ============================================

// Helper function for time display
function getTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// Create a new group (rate limited + validated)
app.post('/api/groups/create', apiLimiter, validateGroupCreation, checkValidation, async (req, res) => {
  const { deviceId, userName } = req.body;
  
  let code;
  let attempts = 0;
  
  do {
    code = generateGroupCode();
    try {
      await pool.query(
        'INSERT INTO groups (resort_id, code) VALUES ($1, $2)',
        [1, code]  // resort_id = 1 (Nozawa Onsen)
      );
      break;
    } catch (e) {
      if (e.code === '23505') { // Duplicate key error
        attempts++;
        if (attempts >= 10) {
          return res.status(500).json({ error: 'Could not generate unique code' });
        }
      } else {
        console.error('Database error:', e.message);
        return res.status(500).json({ error: 'Database error' });
      }
    }
  } while (attempts < 10);
  
  console.log(`Group created: ${code} by ${userName}`);
  res.json({ code });
});

// Check if a group exists
app.get('/api/groups/:code', async (req, res) => {
  const { code } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM groups WHERE code = $1',
      [code]
    );
    
    if (result.rows.length > 0) {
      res.json({ exists: true, group: result.rows[0] });
    } else {
      res.status(404).json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking group:', error);
    res.status(500).json({ error: 'Failed to check group' });
  }
});

// Check-in to a place (rate limited + validated)
app.post('/api/groups/:code/checkin', apiLimiter, validateCheckin, checkValidation, async (req, res) => {
  const { code } = req.params;
  const {
    deviceId,
    userName,
    placeId,
    placeName,
    accommodationPlaceId,
    accommodationCoords,
    accommodationName,
    displayAccommodationToGroup,
    scheduledFor,  // NEW: Optional timestamp for future meetup
    meetupNote     // NEW: Optional note for meetup
  } = req.body;
  
  try {
    // Verify group exists
    const groupCheck = await pool.query('SELECT * FROM groups WHERE code = $1', [code]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if user is already checked in to the same place
    const existingCheckin = await pool.query(
      'SELECT * FROM checkin_new WHERE group_code = $1 AND device_id = $2 AND place_id = $3 AND is_active = true',
      [code, deviceId, placeId]
    );

    // If already checked in to the same place, just update the timestamp and return
    if (existingCheckin.rows.length > 0) {
      const updatedTimestamp = req.body.timestamp || Date.now();
      const result = await pool.query(
        'UPDATE checkin_new SET checked_in_at = $1 WHERE id = $2 RETURNING *',
        [updatedTimestamp, existingCheckin.rows[0].id]
      );

      console.log(`Check-in refreshed: ${userName} at ${placeName} in group ${code}`);
      return res.json({ success: true, checkin: result.rows[0], refreshed: true });
    }

    // Auto-checkout any existing active check-ins for this user (different place)
    await pool.query(
      'UPDATE checkin_new SET is_active = false, checked_out_at = $1 WHERE group_code = $2 AND device_id = $3 AND is_active = true',
      [Date.now(), code, deviceId]
    );

    // Create new check-in (use provided timestamp or current time)
    const checkedInAt = req.body.timestamp || Date.now();

    // Prepare accommodation data (store as null if not sharing or not provided)
    const shouldShareAccommodation = displayAccommodationToGroup === true;
    const accommodationCoordsStr = (shouldShareAccommodation && accommodationCoords)
      ? JSON.stringify(accommodationCoords)
      : null;

    // Prepare meetup data (NULL = check-in now, timestamp = future meetup)
    // IMPORTANT: Send ISO string directly to avoid timezone conversion by PostgreSQL
    const scheduledTime = scheduledFor || null;
    const truncatedNote = meetupNote ? meetupNote.substring(0, 200) : null;

    // DEBUG: Log what we received
    if (scheduledFor) {
      console.log(`[DEBUG] Received scheduledFor from frontend: "${scheduledFor}" (type: ${typeof scheduledFor})`);
      console.log(`[DEBUG] Will store in DB: "${scheduledTime}" (type: ${typeof scheduledTime})`);
    }

    const result = await pool.query(
      'INSERT INTO checkin_new (group_code, user_name, device_id, place_id, place_name, checked_in_at, is_active, accommodation_place_id, accommodation_coords, accommodation_name, display_accommodation_to_group, scheduled_for, meetup_note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
      [
        code,
        userName,
        deviceId,
        placeId,
        placeName,
        checkedInAt,
        true,
        shouldShareAccommodation ? accommodationPlaceId : null,
        accommodationCoordsStr,
        shouldShareAccommodation ? accommodationName : null,
        shouldShareAccommodation,
        scheduledTime,  // NEW: Future meetup time or NULL
        truncatedNote   // NEW: Meetup note (max 200 chars)
      ]
    );
    
    // Log different message for meetups vs regular check-ins
    if (scheduledTime) {
      const timeStr = new Date(scheduledTime).toLocaleString('en-US', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' });
      console.log(`Meetup created: ${userName} at ${placeName} scheduled for ${timeStr} in group ${code}`);
    } else {
      console.log(`Check-in: ${userName} at ${placeName} in group ${code}`);
    }

    res.json({ success: true, checkin: result.rows[0] });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Failed to save check-in' });
  }
});

// Check-out from a place
app.post('/api/groups/:code/checkout', async (req, res) => {
  const { code } = req.params;
  const { deviceId, placeId } = req.body;

  // Validate deviceId is provided
  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  try {
    // Use provided timestamp or current time
    const checkedOutAt = req.body.timestamp || Date.now();
    let result;

    if (placeId) {
      // Scenario 1: Specific check-out from a location
      result = await pool.query(
        'UPDATE checkin_new SET is_active = false, checked_out_at = $1 WHERE group_code = $2 AND device_id = $3 AND place_id = $4 AND is_active = true RETURNING *',
        [checkedOutAt, code, deviceId, placeId]
      );
      console.log(`Check-out: Device ${deviceId} from ${placeId} in group ${code}`);
    } else {
      // Scenario 2: Full group leave - deactivate ALL check-ins for this device in this group
      result = await pool.query(
        'UPDATE checkin_new SET is_active = false, checked_out_at = $1 WHERE group_code = $2 AND device_id = $3 AND is_active = true RETURNING *',
        [checkedOutAt, code, deviceId]
      );
      console.log(`Full group leave: Device ${deviceId} checked out from ALL locations in group ${code} (${result.rowCount} records updated)`);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active check-in found' });
    }

    res.json({
      success: true,
      message: placeId ? 'Checked out from location' : 'Checked out from group',
      rowsUpdated: result.rowCount
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to check out' });
  }
});

// Update user's accommodation sharing status
app.put('/api/groups/:code/members/:deviceId/accommodation', async (req, res) => {
  const { code, deviceId } = req.params;
  const {
    share,
    accommodationPlaceId,
    accommodationCoords,
    accommodationName
  } = req.body;

  try {
    // Verify group exists
    const groupCheck = await pool.query('SELECT * FROM groups WHERE code = $1', [code]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Get the user's MOST RECENT active check-in
    const currentCheckIn = await pool.query(
      `SELECT id FROM checkin_new
       WHERE group_code = $1
         AND device_id = $2
         AND is_active = true
       ORDER BY checked_in_at DESC
       LIMIT 1`,
      [code, deviceId]
    );

    if (currentCheckIn.rows.length === 0) {
      return res.status(404).json({ error: 'No active check-in found' });
    }

    // ALWAYS update accommodation data regardless of share value
    // The share flag only controls VISIBILITY, not the data itself
    const shouldShare = share === true;
    const accommodationCoordsStr = accommodationCoords ? JSON.stringify(accommodationCoords) : null;

    // Update ONLY the most recent active check-in
    const result = await pool.query(
      `UPDATE checkin_new
       SET accommodation_place_id = $1,
           accommodation_coords = $2,
           accommodation_name = $3,
           display_accommodation_to_group = $4
       WHERE id = $5
       RETURNING *`,
      [
        accommodationPlaceId,
        accommodationCoordsStr,
        accommodationName,
        shouldShare,
        currentCheckIn.rows[0].id
      ]
    );

    // Deactivate any other active check-ins for this device in this group
    // This prevents stale data from appearing
    await pool.query(
      `UPDATE checkin_new
       SET is_active = false
       WHERE group_code = $1
         AND device_id = $2
         AND id != $3
         AND is_active = true`,
      [code, deviceId, currentCheckIn.rows[0].id]
    );

    console.log(`Accommodation updated: ${deviceId} in group ${code} - ${accommodationName || 'none'} (sharing: ${shouldShare})`);
    res.json({ success: true, updated: result.rows[0], checkInId: currentCheckIn.rows[0].id });

  } catch (error) {
    console.error('Update accommodation error:', error);
    res.status(500).json({ error: 'Failed to update accommodation' });
  }
});

// Get group check-ins (with auto-expire)
app.get('/api/groups/:code/checkins', async (req, res) => {
  const { code } = req.params;

  try {
    // Auto-expire check-ins older than 1 hour that haven't been manually checked out
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await pool.query(
      'UPDATE checkin_new SET is_active = false WHERE group_code = $1 AND checked_in_at < $2 AND is_active = true AND checked_out_at IS NULL AND scheduled_for IS NULL',
      [code, oneHourAgo]
    );

    // Auto-expire meetups past their scheduled time + 2 hour grace period
    // Calculate expiry threshold (2 hours ago in milliseconds)
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const expiryThresholdDate = new Date(twoHoursAgo);

    const expireResult = await pool.query(
      `UPDATE checkin_new
       SET is_active = false
       WHERE group_code = $1
         AND is_active = true
         AND scheduled_for IS NOT NULL
         AND scheduled_for < $2
       RETURNING id, place_name, scheduled_for`,
      [code, expiryThresholdDate]
    );

    if (expireResult.rowCount > 0) {
      console.log(`[MEETUP EXPIRY] Expired ${expireResult.rowCount} meetup(s) in group ${code}:`);
      expireResult.rows.forEach(row => {
        console.log(`  - ID ${row.id}: ${row.place_name} (was scheduled for ${row.scheduled_for})`);
      });
    }

    // Get all check-ins for this group (last 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const result = await pool.query(
      'SELECT * FROM checkin_new WHERE group_code = $1 AND checked_in_at > $2 ORDER BY checked_in_at DESC',
      [code, oneDayAgo]
    );
    
    // Format the timestamps for frontend
    const formattedCheckins = result.rows.map(row => ({
      ...row,
      checked_in_at: parseInt(row.checked_in_at),
      checked_out_at: row.checked_out_at ? parseInt(row.checked_out_at) : null,
      time_ago: getTimeAgo(parseInt(row.checked_in_at)),
      // Add display status
      status: row.is_active ? 'active' : 
              (row.checked_out_at ? 'checked_out' : 'expired')
    }));
    
    res.json({
      group_code: code,
      checkins: formattedCheckins,
      count: formattedCheckins.length
    });
  } catch (error) {
    console.error('Error fetching check-ins:', error);
    res.status(500).json({ error: 'Failed to fetch check-ins' });
  }
});

// Get member list for a group
app.get('/api/groups/:code/members', async (req, res) => {
  const { code } = req.params;

  try {
    // Get unique members with their latest accommodation data (last 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const result = await pool.query(
      `SELECT DISTINCT ON (c1.device_id)
       c1.device_id,
       c1.user_name,
       c1.checked_in_at as last_checkin,
       COALESCE(c2.accommodation_place_id, c1.accommodation_place_id) as accommodation_place_id,
       COALESCE(c2.accommodation_coords, c1.accommodation_coords) as accommodation_coords,
       COALESCE(c2.accommodation_name, c1.accommodation_name) as accommodation_name,
       COALESCE(c2.display_accommodation_to_group, c1.display_accommodation_to_group) as display_accommodation_to_group
       FROM checkin_new c1
       LEFT JOIN LATERAL (
         SELECT accommodation_place_id, accommodation_coords, accommodation_name, display_accommodation_to_group
         FROM checkin_new
         WHERE group_code = $1
           AND device_id = c1.device_id
           AND accommodation_place_id IS NOT NULL
         ORDER BY checked_in_at DESC
         LIMIT 1
       ) c2 ON true
       WHERE c1.group_code = $1 AND c1.checked_in_at > $2
       ORDER BY c1.device_id, c1.checked_in_at DESC`,
      [code, oneDayAgo]
    );

    // Get currently active check-ins for each member (scheduled_for IS NULL = check-in now)
    const activeResult = await pool.query(
      'SELECT device_id, place_name FROM checkin_new WHERE group_code = $1 AND is_active = true AND scheduled_for IS NULL',
      [code]
    );

    const activeMap = {};
    activeResult.rows.forEach(row => {
      activeMap[row.device_id] = row.place_name;
    });

    // Get future meetups (scheduled_for IS NOT NULL and in future)
    const meetupsResult = await pool.query(
      `SELECT
        id,
        device_id,
        user_name,
        place_id,
        place_name,
        scheduled_for,
        meetup_note,
        checked_in_at as created_at
       FROM checkin_new
       WHERE group_code = $1
         AND is_active = true
         AND scheduled_for IS NOT NULL
         AND scheduled_for > NOW()
       ORDER BY scheduled_for ASC`,
      [code]
    );

    // Combine member info with active status and accommodation data
    const membersWithStatus = result.rows.map(member => {
      // Parse accommodation coords from JSON string to array
      let accommodationCoords = null;
      if (member.accommodation_coords) {
        try {
          accommodationCoords = JSON.parse(member.accommodation_coords);
        } catch (e) {
          console.error('Failed to parse accommodation coords:', e);
        }
      }

      return {
        device_id: member.device_id,
        user_name: member.user_name,
        last_checkin: parseInt(member.last_checkin),
        currently_at: activeMap[member.device_id] || null,
        is_checked_in: !!activeMap[member.device_id],
        // Accommodation fields (only include if sharing)
        accommodationPlaceId: member.display_accommodation_to_group ? member.accommodation_place_id : null,
        accommodationCoords: member.display_accommodation_to_group ? accommodationCoords : null,
        accommodationName: member.display_accommodation_to_group ? member.accommodation_name : null
      };
    });

    // Format meetups for frontend
    const meetups = meetupsResult.rows.map(meetup => ({
      id: meetup.id,
      deviceId: meetup.device_id,
      username: meetup.user_name,
      place: {
        id: meetup.place_id,
        name: meetup.place_name
      },
      scheduledFor: meetup.scheduled_for.toISOString(),
      note: meetup.meetup_note,
      createdAt: new Date(parseInt(meetup.created_at)).toISOString()
    }));

    res.json({
      group_code: code,
      members: membersWithStatus,
      meetups: meetups,
      count: membersWithStatus.length,
      meetup_count: meetups.length
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Leave a group (deletes all check-ins for this user)
app.delete('/api/groups/:code/leave', async (req, res) => {
  const { code } = req.params;
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  try {
    // Delete all check-ins for this device in this group
    const result = await pool.query(
      'DELETE FROM checkin_new WHERE group_code = $1 AND device_id = $2 RETURNING *',
      [code, deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No check-ins found',
        message: 'User has no check-ins in this group'
      });
    }

    console.log(`Leave group: Device ${deviceId} left group ${code} (${result.rows.length} check-ins deleted)`);
    res.json({
      success: true,
      message: 'Successfully left group',
      deleted_checkins: result.rows.length
    });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

// ============= END GROUP MANAGEMENT =============

// ============================================
// ADMIN AUTHENTICATION & ENDPOINTS
// ============================================

// Admin login endpoint - returns JWT token (rate limited + validated)
app.post('/api/admin/login', authLimiter, validateLogin, checkValidation, async (req, res) => {
  const { email, password } = req.body;

  try {
    // Query admin user from database
    const result = await pool.query(
      'SELECT id, email, password_hash, name, role, resort_access, active FROM admin_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    const admin = result.rows[0];

    // Check if admin is active
    if (!admin.active) {
      return res.status(403).json({
        error: 'Account disabled',
        message: 'This admin account has been deactivated'
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, admin.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Generate JWT token (configurable expiry from env)
    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        resortAccess: admin.resort_access
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    console.log(`Admin login: ${admin.email} (${admin.role})`);

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        resortAccess: admin.resort_access
      },
      expiresIn: '24h'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

// Reload restaurant data (JWT protected + rate limited)
app.post('/api/admin/reload-data', adminLimiter, authenticateAdmin, async (req, res) => {
  await loadRestaurantData();

  res.json({
    success: true,
    restaurants_loaded: restaurantsData.length,
    timestamp: lastDataLoad,
    admin: req.admin.email
  });
});

// Get current places data for admin editing (JWT protected + rate limited)
app.get('/api/admin/places-data', adminLimiter, authenticateAdmin, (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'nozawa_places_unified.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(rawData);

    res.json({
      success: true,
      data: data,
      loaded_from: 'server',
      timestamp: new Date().toISOString(),
      admin: req.admin.email
    });
  } catch (error) {
    console.error('Error loading places data:', error);
    res.status(500).json({
      error: 'Failed to load places data',
      message: error.message
    });
  }
});

// Save updated places data directly to PostgreSQL (JWT protected + rate limited)
app.post('/api/admin/save-places', adminLimiter, authenticateAdmin, async (req, res) => {
  const { data } = req.body;

  if (!data || !data.places) {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  try {
    const { savePlacesToPostgreSQL } = require('./services/postgres-write');

    console.log(`\n${'='.repeat(50)}`);
    console.log(`SAVE PLACES REQUEST (Direct PostgreSQL)`);
    console.log(`Admin: ${req.admin.email}`);
    console.log(`Places to save: ${data.places.length}`);
    console.log('='.repeat(50));

    // Save directly to PostgreSQL
    const result = await savePlacesToPostgreSQL(data.places, req.admin.id);

    console.log('='.repeat(50));
    console.log(`SAVE RESULT:`);
    console.log(`✓ PostgreSQL: ${result.success ? 'Success' : 'Failed'}`);
    console.log(`✓ Updated: ${result.updated} places`);
    console.log(`✓ Errors: ${result.errors.length}`);
    console.log('='.repeat(50) + '\n');

    // Build response
    const response = {
      success: result.success,
      places_saved: result.updated,
      total_requested: data.places.length,
      timestamp: new Date().toISOString(),
      admin: req.admin.email,
      postgresql: {
        success: result.success,
        updated: result.updated,
        errors: result.errors.length
      },
      details: result.errors.length > 0 ? result.errors : undefined
    };

    // Send response with appropriate status code
    if (result.success) {
      res.json(response);
    } else {
      res.status(500).json({
        ...response,
        error: 'Save completed with errors',
        message: result.error || 'Check details for more information'
      });
    }

  } catch (error) {
    console.error('Error saving places data:', error);
    res.status(500).json({
      error: 'Failed to save places data',
      message: error.message
    });
  }
});

// Export places data from PostgreSQL to JSON format (JWT protected)
app.get('/api/admin/export-json', adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { exportPlacesToJSON } = require('./services/postgres-write');

    console.log(`\nExporting places data to JSON format...`);
    console.log(`Requested by: ${req.admin.email}`);

    const jsonData = await exportPlacesToJSON();

    res.json({
      success: true,
      ...jsonData,
      exported_by: req.admin.email,
      exported_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
});

// Update external_ids for onsens and lifts (JWT protected - one-time migration)
app.post('/api/admin/update-external-ids', adminLimiter, authenticateAdmin, async (req, res) => {
  console.log(`\nUpdating external_ids for onsens and lifts...`);
  console.log(`Requested by: ${req.admin.email}`);

  const externalIds = [
    // Onsens
    { name: 'Oyu', external_id: 'nozawa_oyu', category: 'onsen' },
    { name: 'Kawahara-yu', external_id: 'nozawa_kawahara-yu', category: 'onsen' },
    { name: 'Kumanote-ara', external_id: 'nozawa_kumanote-ara', category: 'onsen' },
    { name: 'Akiha-no-yu', external_id: 'nozawa_akiha-no-yu', category: 'onsen' },
    { name: 'Juodo-no-yu', external_id: 'nozawa_juodo-no-yu', category: 'onsen' },
    { name: 'Matsuba-no-yu', external_id: 'nozawa_matsuba-no-yu', category: 'onsen' },
    { name: 'Nakao-no-yu', external_id: 'nozawa_nakao-no-yu', category: 'onsen' },
    { name: 'Shinyu', external_id: 'nozawa_shinyu', category: 'onsen' },
    { name: 'Kamitera-yu', external_id: 'nozawa_kamitera-yu', category: 'onsen' },
    { name: 'Asagama-no-yu', external_id: 'nozawa_asagama-no-yu', category: 'onsen' },
    { name: 'Yokochi-no-yu', external_id: 'nozawa_yokochi-no-yu', category: 'onsen' },
    { name: 'Taki-no-yu', external_id: 'nozawa_taki-no-yu', category: 'onsen' },
    { name: 'Ogama (Cooking Onsen)', external_id: 'nozawa_ogama_cooking_onsen', category: 'onsen' },
    { name: 'Shinden-no-yu', external_id: 'nozawa_shinden-no-yu', category: 'onsen' },

    // Lifts
    { name: 'Nagasaka Gondola', external_id: 'nozawa_nagasaka_gondola', category: 'lift' },
    { name: 'Hikage Gondola', external_id: 'nozawa_hikage_gondola', category: 'lift' },
    { name: 'Karasawa Area (Lower Access)', external_id: 'nozawa_karasawa_area_lower_access', category: 'lift' },
    { name: 'Yu Road (Moving Walkway)', external_id: 'nozawa_yu_road_moving_walkway', category: 'lift' }
  ];

  let updated = 0;
  let notFound = 0;
  const results = [];

  try {
    for (const place of externalIds) {
      const result = await pool.query(
        'UPDATE places SET external_id = $1, updated_at = NOW() WHERE name = $2 AND category = $3 RETURNING id, name',
        [place.external_id, place.name, place.category]
      );

      if (result.rows.length > 0) {
        console.log(`✅ ${place.name} → ${place.external_id}`);
        updated++;
        results.push({ name: place.name, external_id: place.external_id, status: 'updated' });
      } else {
        console.log(`⚠️  ${place.name} - not found in PostgreSQL`);
        notFound++;
        results.push({ name: place.name, external_id: place.external_id, status: 'not_found' });
      }
    }

    console.log(`\n✅ Updated ${updated} places`);
    if (notFound > 0) {
      console.log(`⚠️  ${notFound} places not found`);
    }

    res.json({
      success: true,
      updated,
      notFound,
      total: externalIds.length,
      results,
      admin: req.admin.email,
      message: `Successfully updated ${updated} places with external_ids`
    });

  } catch (error) {
    console.error('❌ Update error:', error);
    res.status(500).json({
      error: 'Failed to update external_ids',
      message: error.message
    });
  }
});

// Migrate review analysis data (JWT protected - one-time)
app.post('/api/admin/migrate-reviews', adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const { runReviewMigration } = require('./run-review-migration-production');
    const results = await runReviewMigration(pool);

    res.json({
      ...results,
      admin: req.admin.email
    });

  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message
    });
  }
});

// Get lift scrape history and monitoring (JWT protected)
app.get('/api/admin/lift-scrapes', adminLimiter, authenticateAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200); // Max 200

    // Get scrape history from PostgreSQL
    const result = await pool.query(`
      SELECT
        id,
        scraped_at,
        is_off_season,
        scraper_version,
        source_url,
        (lift_data->>'lifts')::jsonb as lifts_summary,
        jsonb_array_length((lift_data->>'lifts')::jsonb) as lift_count
      FROM lift_status_cache
      WHERE resort_id = $1
      ORDER BY scraped_at DESC
      LIMIT $2
    `, [1, limit]);

    // Calculate scrape statistics
    const stats = {
      totalScrapes: result.rows.length,
      latestScrape: result.rows[0]?.scraped_at || null,
      oldestScrape: result.rows[result.rows.length - 1]?.scraped_at || null,
      offSeasonScrapes: result.rows.filter(r => r.is_off_season).length,
      inSeasonScrapes: result.rows.filter(r => !r.is_off_season).length,
      averageLiftCount: result.rows.length > 0
        ? Math.round(result.rows.reduce((sum, r) => sum + parseInt(r.lift_count || 0), 0) / result.rows.length)
        : 0
    };

    // Get current scheduler status
    const scheduler = require('./services/scheduler');
    const currentData = scheduler.getLatestScrapeResults();
    const hasCurrentData = !!currentData;
    const dataAge = currentData && currentData.scrapedAt
      ? Math.round((Date.now() - new Date(currentData.scrapedAt)) / 60000)
      : null;

    res.json({
      success: true,
      stats,
      current: {
        hasData: hasCurrentData,
        ageMinutes: dataAge,
        liftCount: currentData?.lifts?.length || 0,
        isOffSeason: currentData?.isOffSeason || false,
        scrapedAt: currentData?.scrapedAt || null
      },
      history: result.rows.map(row => ({
        id: row.id,
        scrapedAt: row.scraped_at,
        isOffSeason: row.is_off_season,
        version: row.scraper_version,
        sourceUrl: row.source_url,
        liftCount: parseInt(row.lift_count || 0)
      })),
      pagination: {
        limit,
        returned: result.rows.length
      },
      admin: req.admin.email
    });

  } catch (error) {
    console.error('Error fetching lift scrape history:', error);
    res.status(500).json({
      error: 'Failed to fetch lift scrape history',
      message: error.message
    });
  }
});

// ADMIN INTERFACE (serve static HTML)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// HEALTH CHECK
app.get('/api/health', async (req, res) => {
  try {
    const tzResult = await pool.query('SHOW TIMEZONE');
    const typeResult = await pool.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'checkin_new'
      AND column_name = 'scheduled_for'
    `);

    res.json({
      status: 'healthy',
      restaurants_loaded: restaurantsData.length,
      data_loaded_at: lastDataLoad,
      server_time: new Date().toISOString(),
      timezone: 'Asia/Tokyo',
      database: {
        session_timezone: tzResult.rows[0].timezone,
        scheduled_for_column: typeResult.rows[0]
      }
    });
  } catch (error) {
    res.json({
      status: 'healthy',
      restaurants_loaded: restaurantsData.length,
      data_loaded_at: lastDataLoad,
      server_time: new Date().toISOString(),
      timezone: 'Asia/Tokyo',
      database_error: error.message
    });
  }
});

// LIFT STATUS
const liftRoutes = require('./routes/lifts');
app.use('/api/lifts', liftRoutes);

// WEATHER
const weatherRoutes = require('./routes/weather');
app.use('/api/weather', weatherRoutes);

// POSTGRESQL-BACKED API (V2)
const placesRoutes = require('./routes/places');
app.use('/api/v2', placesRoutes);

// ROOT ENDPOINT
app.get('/', (req, res) => {
  res.json({
    name: 'Nozawa Onsen API',
    version: '2.0.0',
    endpoints: {
      v2: {
        'GET /api/v2/places': 'List all places (PostgreSQL)',
        'GET /api/v2/places/:id': 'Get single place (PostgreSQL)',
        'GET /api/v2/places/category/:category': 'Get places by category (PostgreSQL)',
        'GET /api/v2/stats': 'Database statistics (PostgreSQL)',
        'GET /api/v2/lifts': 'Lift status (PostgreSQL)',
        'GET /api/v2/weather': 'Weather status (PostgreSQL)',
        'GET /api/v2/health': 'PostgreSQL health check',
        note: 'Requires ENABLE_POSTGRES_READ=true'
      },
      restaurants: {
        'GET /api/restaurants': 'Get all restaurants',
        'GET /api/restaurants?category=restaurant': 'Filter by category',
        'GET /api/restaurants/:id': 'Get single restaurant',
        'GET /api/restaurants/status/open': 'Get currently open',
        'GET /api/restaurants/stats': 'Get statistics'
      },
      weather: {
        'GET /api/weather/current': 'Current conditions (with caching)',
        'GET /api/weather/forecast': '7-day forecast (with caching)',
        'GET /api/weather/cache-status': 'Cache status for monitoring'
      },
      lifts: {
        'GET /api/lifts/status': 'Current lift status'
      },
      groups: {
        'POST /api/groups/create': 'Create new group',
        'GET /api/groups/:code': 'Check if group exists',
        'POST /api/groups/:code/checkin': 'Check-in to a place',
        'GET /api/groups/:code/checkins': 'Get group check-ins',
        'GET /api/groups/:code/members': 'Get group members'
      }
    }
  });
});

// START SERVER
async function startServer() {
  await loadRestaurantData();
  await scheduler.initializeScheduler();  // Now async - loads from PostgreSQL

  app.listen(PORT, () => {
    console.log('\n🚀 Nozawa Onsen Backend Server');
    console.log('='.repeat(40));
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🍴 Loaded ${restaurantsData.length} restaurants`);
    console.log(`🌡️  Weather service ready (cached)`);
    console.log(`🎿 Lift status monitoring active`);
    console.log(`👥 Group management ready`);
    console.log('='.repeat(40));
  });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});

startServer();