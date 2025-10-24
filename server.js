const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const scheduler = require('./services/scheduler');
const { Pool } = require('pg');

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

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// NEW: UNIFIED PLACES ENDPOINT
app.get('/api/places', (req, res) => {
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

// MAIN RESTAURANTS/PLACES ENDPOINT
app.get('/api/restaurants', (req, res) => {
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

// Create a new group
app.post('/api/groups/create', async (req, res) => {
  const { deviceId, userName } = req.body;
  
  if (!deviceId || !userName) {
    return res.status(400).json({ error: 'Device ID and user name required' });
  }
  
  let code;
  let attempts = 0;
  
  do {
    code = generateGroupCode();
    try {
      await pool.query(
        'INSERT INTO groups (code) VALUES ($1)',
        [code]
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

// Check-in to a place
app.post('/api/groups/:code/checkin', async (req, res) => {
  const { code } = req.params;
  const { deviceId, userName, placeId, placeName } = req.body;
  
  if (!deviceId || !userName || !placeId || !placeName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    // Verify group exists
    const groupCheck = await pool.query('SELECT * FROM groups WHERE code = $1', [code]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    // Auto-checkout any existing active check-ins for this user
    await pool.query(
      'UPDATE checkin_new SET is_active = false, checked_out_at = $1 WHERE group_code = $2 AND device_id = $3 AND is_active = true',
      [Date.now(), code, deviceId]
    );
    
    // Create new check-in (use provided timestamp or current time)
    const checkedInAt = req.body.timestamp || Date.now();
    const result = await pool.query(
      'INSERT INTO checkin_new (group_code, user_name, device_id, place_id, place_name, checked_in_at, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [code, userName, deviceId, placeId, placeName, checkedInAt, true]
    );
    
    console.log(`Check-in: ${userName} at ${placeName} in group ${code}`);
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
  
  if (!deviceId || !placeId) {
    return res.status(400).json({ error: 'Device ID and place ID required' });
  }
  
  try {
    // Use provided timestamp or current time
    const checkedOutAt = req.body.timestamp || Date.now();
    const result = await pool.query(
      'UPDATE checkin_new SET is_active = false, checked_out_at = $1 WHERE group_code = $2 AND device_id = $3 AND place_id = $4 AND is_active = true RETURNING *',
      [checkedOutAt, code, deviceId, placeId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active check-in found' });
    }
    
    console.log(`Check-out: Device ${deviceId} from ${placeId} in group ${code}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to check out' });
  }
});

// Get group check-ins (with auto-expire)
app.get('/api/groups/:code/checkins', async (req, res) => {
  const { code } = req.params;
  
  try {
    // Auto-expire check-ins older than 1 hour that haven't been manually checked out
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await pool.query(
      'UPDATE checkin_new SET is_active = false WHERE group_code = $1 AND checked_in_at < $2 AND is_active = true AND checked_out_at IS NULL',
      [code, oneHourAgo]
    );
    
    // Get all check-ins for this group (last 7 days for history)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      'SELECT * FROM checkin_new WHERE group_code = $1 AND checked_in_at > $2 ORDER BY checked_in_at DESC',
      [code, sevenDaysAgo]
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
    // Get unique members who have checked in within last 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      `SELECT DISTINCT ON (device_id) 
       device_id, user_name, MAX(checked_in_at) as last_checkin
       FROM checkin_new 
       WHERE group_code = $1 AND checked_in_at > $2
       GROUP BY device_id, user_name
       ORDER BY device_id`,
      [code, sevenDaysAgo]
    );
    
    // Get currently active check-ins for each member
    const activeResult = await pool.query(
      'SELECT device_id, place_name FROM checkin_new WHERE group_code = $1 AND is_active = true',
      [code]
    );
    
    const activeMap = {};
    activeResult.rows.forEach(row => {
      activeMap[row.device_id] = row.place_name;
    });
    
    // Combine member info with active status
    const membersWithStatus = result.rows.map(member => ({
      ...member,
      last_checkin: parseInt(member.last_checkin),
      currently_at: activeMap[member.device_id] || null,
      is_checked_in: !!activeMap[member.device_id]
    }));
    
    res.json({
      group_code: code,
      members: membersWithStatus,
      count: membersWithStatus.length
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ============= END GROUP MANAGEMENT =============

// WEATHER ENDPOINTS
async function fetchWeatherData() {
  const fetch = (await import('node-fetch')).default;
  
  const elevations = [
    { name: 'Village', elevation: 570, lat: 36.9205, lon: 138.4331 },
    { name: 'Mid-Mountain', elevation: 1200, lat: 36.9305, lon: 138.4331 },
    { name: 'Summit', elevation: 1650, lat: 36.9405, lon: 138.4331 }
  ];
  
  try {
    const weatherData = await Promise.all(
      elevations.map(async (level) => {
        const url = `https://api.open-meteo.com/v1/forecast?` +
          `latitude=${level.lat}&longitude=${level.lon}&elevation=${level.elevation}` +
          `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,weather_code,wind_speed_10m,wind_direction_10m` +
          `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max` +
          `&timezone=Asia/Tokyo`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        return {
          location: level.name,
          elevation: level.elevation,
          current: data.current,
          daily: data.daily,
          units: data.current_units
        };
      })
    );
    
    return weatherData;
  } catch (error) {
    console.error('Weather fetch error:', error);
    throw error;
  }
}

app.get('/api/weather/current', async (req, res) => {
  try {
    const weatherData = await fetchWeatherData();
    
    let snowLine = 'Unknown';
    const village = weatherData[0].current.temperature_2m;
    const summit = weatherData[2].current.temperature_2m;
    
    if (village > 2 && summit <= 0) {
      snowLine = 'Snow above ~1000m';
    } else if (village <= 0) {
      snowLine = 'Snow to village level';
    } else if (summit > 2) {
      snowLine = 'No snow (too warm)';
    } else {
      snowLine = 'Mixed conditions';
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      snow_line: snowLine,
      levels: weatherData
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch weather data',
      message: error.message 
    });
  }
});

app.get('/api/weather/forecast', async (req, res) => {
  try {
    const weatherData = await fetchWeatherData();
    
    const forecast = weatherData.map(level => ({
      location: level.location,
      elevation: level.elevation,
      daily_forecast: level.daily.time.map((date, index) => ({
        date,
        temp_max: level.daily.temperature_2m_max[index],
        temp_min: level.daily.temperature_2m_min[index],
        precipitation: level.daily.precipitation_sum[index],
        snowfall: level.daily.snowfall_sum[index],
        precipitation_probability: level.daily.precipitation_probability_max[index]
      }))
    }));
    
    res.json({
      timestamp: new Date().toISOString(),
      forecast
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch weather forecast',
      message: error.message 
    });
  }
});

// ADMIN ENDPOINTS
app.post('/api/admin/reload-data', async (req, res) => {
  const { admin_key } = req.body;
  
  if (admin_key !== 'nozawa2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  await loadRestaurantData();
  
  res.json({
    success: true,
    restaurants_loaded: restaurantsData.length,
    timestamp: lastDataLoad
  });
});

// Get current places data for admin editing
app.get('/api/admin/places-data', (req, res) => {
  const { admin_key } = req.query;
  
  if (admin_key !== 'nozawa2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const dataPath = path.join(__dirname, 'nozawa_places_unified.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(rawData);
    
    res.json({
      success: true,
      data: data,
      loaded_from: 'server',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error loading places data:', error);
    res.status(500).json({ 
      error: 'Failed to load places data',
      message: error.message 
    });
  }
});

// Save updated places data (with backup)
app.post('/api/admin/save-places', (req, res) => {
  const { admin_key, data } = req.body;
  
  if (admin_key !== 'nozawa2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!data || !data.places) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
  
  try {
    const dataPath = path.join(__dirname, 'nozawa_places_unified.json');
    const backupDir = path.join(__dirname, 'backups');
    
    // Create backups directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Create timestamped backup of current file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = path.join(backupDir, `nozawa_places_unified_backup_${timestamp}.json`);
    
    // Read current file and create backup
    if (fs.existsSync(dataPath)) {
      const currentData = fs.readFileSync(dataPath, 'utf8');
      fs.writeFileSync(backupPath, currentData, 'utf8');
      console.log(`✅ Backup created: ${backupPath}`);
    }
    
    // Save new data
    const newData = {
      ...data,
      total_count: data.places.length,
      generated_at: new Date().toISOString()
    };
    
    fs.writeFileSync(dataPath, JSON.stringify(newData, null, 2), 'utf8');
    console.log(`✅ Places data updated: ${data.places.length} places`);
    
    // Reload data in memory
    loadRestaurantData();
    
    res.json({
      success: true,
      places_saved: data.places.length,
      backup_created: `nozawa_places_unified_backup_${timestamp}.json`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error saving places data:', error);
    res.status(500).json({ 
      error: 'Failed to save places data',
      message: error.message 
    });
  }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    restaurants_loaded: restaurantsData.length,
    data_loaded_at: lastDataLoad,
    server_time: new Date().toISOString(),
    timezone: 'Asia/Tokyo'
  });
});

// LIFT STATUS
const liftRoutes = require('./routes/lifts');
app.use('/api/lifts', liftRoutes);

// ROOT ENDPOINT
app.get('/', (req, res) => {
  res.json({
    name: 'Nozawa Onsen API',
    version: '1.0.0',
    endpoints: {
      restaurants: {
        'GET /api/restaurants': 'Get all restaurants',
        'GET /api/restaurants?category=restaurant': 'Filter by category',
        'GET /api/restaurants/:id': 'Get single restaurant',
        'GET /api/restaurants/status/open': 'Get currently open',
        'GET /api/restaurants/stats': 'Get statistics'
      },
      weather: {
        'GET /api/weather/current': 'Current conditions',
        'GET /api/weather/forecast': '7-day forecast'
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
  scheduler.initializeScheduler();
  
  app.listen(PORT, () => {
    console.log('\n🚀 Nozawa Onsen Backend Server');
    console.log('='.repeat(40));
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🍴 Loaded ${restaurantsData.length} restaurants`);
    console.log(`🌡️  Weather API connected`);
    console.log(`🎿 Lift status monitoring active`);
    console.log(`👥 Group management ready`);
    console.log('='.repeat(40));
  });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});

startServer();