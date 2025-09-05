// Nozawa Onsen Backend Server - Fixed Version
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// GLOBAL data storage - making sure these are accessible everywhere
global.placesData = [];
global.restaurantsData = [];
let lastDataLoad = null;

async function loadPlacesData() {
  try {
    const dataPath = path.join(__dirname, 'nozawa_places_clean.json');
    const rawData = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(rawData);
    
    // Store in global
    global.placesData = parsed.places || [];
    
    // Transform restaurants for backward compatibility
    global.restaurantsData = global.placesData
      .filter(p => p.category === 'restaurant' && p.status === 'active')
      .map(p => ({
        id: p.id,
        google_place_id: p.google_data?.place_id,
        name: p.google_data?.name,
        rating: p.google_data?.rating,
        review_count: p.google_data?.review_count,
        price_range: p.google_data?.price_range,
        opening_hours: p.google_data?.hours,
        photos: p.google_data?.photos,
        coordinates: p.google_data?.coordinates,
        address: p.google_data?.address,
        phone: p.google_data?.phone,
        website: p.google_data?.website,
        google_maps_url: p.google_data?.maps_url,
        review_analysis: p.enhanced_data?.review_analysis,
        cuisine: p.enhanced_data?.cuisine,
        type: p.enhanced_data?.cuisine,
        budget: p.enhanced_data?.budget,
        english_menu: p.enhanced_data?.english_menu,
        credit_cards: p.enhanced_data?.credit_cards,
        vegetarian_friendly: p.enhanced_data?.vegetarian_friendly
      }));
    
    lastDataLoad = new Date();
    console.log(`✅ Loaded ${global.placesData.length} places (${global.restaurantsData.length} active restaurants)`);
  } catch (error) {
    console.error('❌ Error loading places data:', error);
    // Fallback to restaurants file
    try {
      const dataPath = path.join(__dirname, 'nozawa_restaurants_enhanced.json');
      const rawData = await fs.readFile(dataPath, 'utf8');
      const parsed = JSON.parse(rawData);
      global.restaurantsData = parsed.restaurants || [];
      
      // Create places from restaurants
      global.placesData = global.restaurantsData.map(r => ({
        id: r.google_place_id || r.id,
        category: 'restaurant',
        status: 'active',
        google_data: r,
        enhanced_data: {
          review_analysis: r.review_analysis,
          cuisine: r.cuisine,
          budget: r.budget,
          english_menu: r.english_menu,
          credit_cards: r.credit_cards,
          vegetarian_friendly: r.vegetarian_friendly
        },
        local_knowledge: {}
      }));
      
      console.log(`✅ Loaded ${global.restaurantsData.length} restaurants (fallback)`);
    } catch (fallbackError) {
      console.error('❌ Failed to load any data:', fallbackError);
    }
  }
}

function isRestaurantOpen(restaurant) {
  if (!restaurant.opening_hours?.periods) return null;
  
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentTime = now.getHours() * 100 + now.getMinutes();
  
  const periods = restaurant.opening_hours.periods;
  
  for (const period of periods) {
    if (period.open?.day === dayOfWeek) {
      const openTime = parseInt(period.open.time);
      const closeTime = period.close ? parseInt(period.close.time) : 2359;
      
      if (currentTime >= openTime && currentTime <= closeTime) {
        return true;
      }
    }
  }
  
  return false;
}

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

// PLACES ENDPOINT - FIXED
app.get('/api/places', (req, res) => {
  const { category } = req.query;
  
  let filtered = global.placesData || [];
  
  if (category) {
    const categories = category.split(',');
    filtered = filtered.filter(p => categories.includes(p.category));
  }
  
  res.json({
    count: filtered.length,
    places: filtered
  });
});

// RESTAURANTS ENDPOINT
app.get('/api/restaurants', (req, res) => {
  const { 
    open_now, 
    cuisine, 
    price_range,
    english_menu,
    lat,
    lng,
    limit = 100
  } = req.query;
  
  let filtered = [...global.restaurantsData];
  
  if (open_now === 'true') {
    filtered = filtered.filter(r => isRestaurantOpen(r) === true);
  }
  
  if (cuisine) {
    filtered = filtered.filter(r => 
      r.cuisine?.toLowerCase().includes(cuisine.toLowerCase()) ||
      r.type?.toLowerCase().includes(cuisine.toLowerCase())
    );
  }
  
  if (price_range) {
    filtered = filtered.filter(r => r.price_range === price_range);
  }
  
  if (english_menu === 'true') {
    filtered = filtered.filter(r => 
      r.review_analysis?.insights?.mentions_english === true
    );
  }
  
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
  
  filtered = filtered.slice(0, parseInt(limit));
  
  res.json({
    count: filtered.length,
    restaurants: filtered
  });
});

app.get('/api/restaurants/stats', (req, res) => {
  const stats = {
    total_count: global.restaurantsData.length,
    by_cuisine: {},
    by_price: {},
    with_photos: 0,
    with_english_mentions: 0,
    average_rating: 0,
    data_updated: lastDataLoad
  };
  
  let totalRating = 0;
  let ratedCount = 0;
  
  global.restaurantsData.forEach(r => {
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

app.get('/api/restaurants/status/open', (req, res) => {
  const openRestaurants = global.restaurantsData.filter(r => isRestaurantOpen(r) === true);
  
  res.json({
    count: openRestaurants.length,
    current_time: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Tokyo' }),
    restaurants: openRestaurants
  });
});

app.get('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  
  const restaurant = global.restaurantsData.find(r => 
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
  
  await loadPlacesData();
  
  res.json({
    success: true,
    places_loaded: global.placesData.length,
    restaurants_loaded: global.restaurantsData.length,
    timestamp: lastDataLoad
  });
});

// HEALTH & DEBUG
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    places_loaded: global.placesData.length,
    restaurants_loaded: global.restaurantsData.length,
    data_loaded_at: lastDataLoad,
    server_time: new Date().toISOString(),
    timezone: 'Asia/Tokyo'
  });
});

app.get('/api/debug', (req, res) => {
  res.json({
    placesDataLength: global.placesData.length,
    restaurantsDataLength: global.restaurantsData.length,
    firstPlace: global.placesData[0] || 'No places loaded'
  });
});

// LIFT ROUTES
const liftRoutes = require('./routes/lifts');
app.use('/api/lifts', liftRoutes);

// ROOT
app.get('/', (req, res) => {
  res.json({
    name: 'Nozawa Onsen API',
    version: '2.0.0',
    endpoints: {
      places: {
        'GET /api/places': 'Get all places',
        'GET /api/places?category=restaurant': 'Get places by category'
      },
      restaurants: {
        'GET /api/restaurants': 'Get all restaurants'
      },
      weather: {
        'GET /api/weather/current': 'Current conditions',
        'GET /api/weather/forecast': '7-day forecast'
      }
    }
  });
});

// START SERVER
async function startServer() {
  await loadPlacesData();
  scheduler.initializeScheduler();
  
  app.listen(PORT, () => {
    console.log('\n🚀 Nozawa Onsen Backend Server');
    console.log('='.repeat(40));
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`📊 Loaded ${global.placesData.length} total places`);
    console.log(`🍴 ${global.restaurantsData.length} active restaurants`);
    console.log('='.repeat(40));
  });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});

startServer();