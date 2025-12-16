/**
 * PostgreSQL-backed Places API Routes
 *
 * V2 API endpoints that read from PostgreSQL instead of JSON files.
 * Uses the places_with_merged_data view for efficient querying.
 *
 * Feature flag: ENABLE_POSTGRES_READ
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const fs = require('fs');
const path = require('path');

// Load onsen local_info data from JSON (temporary until migrated to PostgreSQL)
let onsenLocalInfo = {};
try {
  const jsonPath = path.join(__dirname, '..', 'nozawa_places_unified.json');
  console.log(`[Onsen Enrichment] Attempting to load JSON from: ${jsonPath}`);

  if (!fs.existsSync(jsonPath)) {
    console.warn(`[Onsen Enrichment] JSON file not found at ${jsonPath}`);
  } else {
    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(rawData);

    // Build lookup map: external_id -> local_info
    data.places.forEach(place => {
      if (place.category === 'onsen' && place.local_info) {
        // Use external_id or name as key
        const key = place.external_id || place.name;
        onsenLocalInfo[key] = {
          description: place.description || null,
          local_tips: place.local_tips || null,
          local_info: place.local_info
        };
      }
    });
    console.log(`[Onsen Enrichment] ✅ Loaded local_info for ${Object.keys(onsenLocalInfo).length} onsens`);
  }
} catch (error) {
  console.error(`[Onsen Enrichment] ❌ Failed to load onsen local_info:`, error.message);
}

/**
 * Enrich place data with onsen-specific fields
 * Priority: PostgreSQL data > JSON fallback
 */
function enrichOnsenData(place) {
  if (place.category !== 'onsen') return place;

  // Try to find local_info by external_id or name (for temperature, hours, etc.)
  const key = place.external_id || place.name;
  const localData = onsenLocalInfo[key];

  // PostgreSQL data takes priority for description and tips
  const description = place.description_override || localData?.description || null;
  const local_tips = (Array.isArray(place.tips) && place.tips.length > 0)
    ? place.tips[0]  // Use first tip from PostgreSQL
    : localData?.local_tips || null;

  return {
    ...place,
    description,
    local_tips,
    // Keep local_info from JSON for temperature, hours, etc.
    local_info: localData?.local_info || null
  };
}

/**
 * GET /api/v2/places
 * List all places with optional filtering
 *
 * Query Parameters:
 * - resort_id: Filter by resort (default: 1 for Nozawa Onsen)
 * - category: Filter by category (restaurant, onsen, lift)
 * - visible: Filter by visibility (true/false)
 * - search: Search by name (case-insensitive)
 * - limit: Max results (default: 100)
 * - offset: Pagination offset (default: 0)
 * - sort: Sort field (name, rating, category) (default: name)
 * - order: Sort order (asc, desc) (default: asc)
 */
router.get('/places', async (req, res) => {
  try {
    // Check if PostgreSQL read is enabled
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'This endpoint requires ENABLE_POSTGRES_READ=true',
        hint: 'Use the legacy JSON API endpoints instead'
      });
    }

    // Parse query parameters with defaults
    const resort_id = parseInt(req.query.resort_id) || 1;
    const category = req.query.category;
    const visible = req.query.visible;
    const search = req.query.search;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500); // Max 500
    const offset = parseInt(req.query.offset) || 0;
    const sort = req.query.sort || 'name';
    const order = req.query.order === 'desc' ? 'DESC' : 'ASC';

    // Build WHERE clause dynamically
    const conditions = ['resort_id = $1'];
    const params = [resort_id];
    let paramIndex = 2;

    if (category) {
      conditions.push(`category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (visible !== undefined) {
      conditions.push(`visible_in_app = $${paramIndex}`);
      params.push(visible === 'true');
      paramIndex++;
    }

    if (search) {
      conditions.push(`(name ILIKE $${paramIndex} OR name_local ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Validate sort field (prevent SQL injection)
    const validSortFields = ['name', 'rating', 'category', 'created_at', 'updated_at'];
    const sortField = validSortFields.includes(sort) ? sort : 'name';

    // Build query
    const whereClause = conditions.join(' AND ');
    const query = `
      SELECT
        id,
        resort_id,
        external_id,
        category,
        subcategory,
        status,
        visible_in_app,
        data_source,
        google_place_id,
        name,
        name_local,
        latitude,
        longitude,
        address,
        rating,
        review_count,
        phone,
        website,
        price_range,
        opening_hours,
        photos,
        manual_photos,
        cuisine,
        budget_range,
        english_menu,
        accepts_cards,
        review_analysis,
        tips,
        warnings,
        navigation_tips,
        description_override,
        google_types,
        editorial_summary,
        google_features,
        google_maps_url,
        has_overrides,
        has_local_knowledge,
        has_google_data,
        created_at,
        updated_at
      FROM places_with_merged_data
      WHERE ${whereClause}
      ORDER BY ${sortField} ${order}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    // Execute query
    const result = await pool.query(query, params);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM places_with_merged_data
      WHERE ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params.slice(0, paramIndex - 1));
    const total = parseInt(countResult.rows[0].total);

    // Enrich onsen data with local_info from JSON
    const enrichedData = result.rows.map(enrichOnsenData);

    // Return results with pagination metadata
    res.json({
      success: true,
      data: enrichedData,
      pagination: {
        total,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + limit < total
      },
      filters: {
        resort_id,
        category: category || 'all',
        visible: visible !== undefined ? visible === 'true' : 'all',
        search: search || null
      },
      source: 'postgresql'
    });

  } catch (error) {
    console.error('Error fetching places from PostgreSQL:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message,
      hint: 'Check database connection and query syntax'
    });
  }
});

/**
 * GET /api/v2/places/:id
 * Get a single place by ID with all merged data
 *
 * Path Parameters:
 * - id: Place ID (integer)
 *
 * Query Parameters:
 * - resort_id: Resort ID for validation (default: 1)
 */
router.get('/places/:id', async (req, res) => {
  try {
    // Check if PostgreSQL read is enabled
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'This endpoint requires ENABLE_POSTGRES_READ=true'
      });
    }

    const placeId = parseInt(req.params.id);
    const resort_id = parseInt(req.query.resort_id) || 1;

    if (!placeId || isNaN(placeId)) {
      return res.status(400).json({
        error: 'Invalid place ID',
        message: 'Place ID must be a valid integer'
      });
    }

    // Query single place
    const query = `
      SELECT
        id,
        resort_id,
        external_id,
        category,
        subcategory,
        status,
        visible_in_app,
        data_source,
        google_place_id,
        name,
        name_local,
        latitude,
        longitude,
        address,
        rating,
        review_count,
        phone,
        website,
        price_range,
        opening_hours,
        photos,
        manual_photos,
        cuisine,
        budget_range,
        english_menu,
        accepts_cards,
        custom_fields,
        review_analysis,
        tips,
        warnings,
        navigation_tips,
        description_override,
        insider_notes,
        features_verified,
        google_types,
        editorial_summary,
        google_features,
        google_maps_url,
        has_overrides,
        has_local_knowledge,
        has_google_data,
        last_google_sync_date,
        last_manual_edit,
        last_edited_by,
        created_at,
        updated_at
      FROM places_with_merged_data
      WHERE id = $1 AND resort_id = $2
    `;

    const result = await pool.query(query, [placeId, resort_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Place not found',
        message: `No place found with ID ${placeId} for resort ${resort_id}`
      });
    }

    // Enrich onsen data with local_info
    const enrichedPlace = enrichOnsenData(result.rows[0]);

    res.json({
      success: true,
      data: enrichedPlace,
      source: 'postgresql'
    });

  } catch (error) {
    console.error('Error fetching place from PostgreSQL:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v2/places/category/:category
 * Get all places in a specific category
 *
 * Path Parameters:
 * - category: restaurant, onsen, or lift
 *
 * Query Parameters:
 * - resort_id: Filter by resort (default: 1)
 * - visible: Filter by visibility (default: true)
 */
router.get('/places/category/:category', async (req, res) => {
  try {
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'This endpoint requires ENABLE_POSTGRES_READ=true'
      });
    }

    const category = req.params.category.toLowerCase();
    const resort_id = parseInt(req.query.resort_id) || 1;
    const visible = req.query.visible !== 'false'; // Default to true

    // Validate category
    const validCategories = ['restaurant', 'onsen', 'lift'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        error: 'Invalid category',
        message: `Category must be one of: ${validCategories.join(', ')}`
      });
    }

    const query = `
      SELECT
        id,
        name,
        name_local,
        category,
        subcategory,
        latitude,
        longitude,
        address,
        rating,
        review_count,
        phone,
        website,
        price_range,
        opening_hours,
        photos,
        manual_photos,
        cuisine,
        budget_range,
        english_menu,
        accepts_cards,
        review_analysis,
        tips,
        google_maps_url,
        has_overrides,
        has_local_knowledge
      FROM places_with_merged_data
      WHERE resort_id = $1 AND category = $2 AND visible_in_app = $3
      ORDER BY rating DESC NULLS LAST, name ASC
    `;

    const result = await pool.query(query, [resort_id, category, visible]);

    // Enrich onsen data with local_info
    const enrichedData = result.rows.map(enrichOnsenData);

    res.json({
      success: true,
      category,
      count: enrichedData.length,
      data: enrichedData,
      source: 'postgresql'
    });

  } catch (error) {
    console.error('Error fetching places by category:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v2/stats
 * Get statistics about places in the database
 *
 * Query Parameters:
 * - resort_id: Filter by resort (default: 1)
 */
router.get('/stats', async (req, res) => {
  try {
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'This endpoint requires ENABLE_POSTGRES_READ=true'
      });
    }

    const resort_id = parseInt(req.query.resort_id) || 1;

    const query = `
      SELECT
        COUNT(*) as total_places,
        COUNT(*) FILTER (WHERE category = 'restaurant') as restaurants,
        COUNT(*) FILTER (WHERE category = 'onsen') as onsens,
        COUNT(*) FILTER (WHERE category = 'lift') as lifts,
        COUNT(*) FILTER (WHERE visible_in_app = true) as visible_places,
        COUNT(*) FILTER (WHERE has_overrides = true) as places_with_overrides,
        COUNT(*) FILTER (WHERE has_local_knowledge = true) as places_with_local_knowledge,
        COUNT(*) FILTER (WHERE has_google_data = true) as places_with_google_data,
        AVG(rating) FILTER (WHERE rating IS NOT NULL) as avg_rating,
        MAX(updated_at) as last_updated
      FROM places_with_merged_data
      WHERE resort_id = $1
    `;

    const result = await pool.query(query, [resort_id]);
    const stats = result.rows[0];

    res.json({
      success: true,
      resort_id,
      stats: {
        total: parseInt(stats.total_places),
        byCategory: {
          restaurants: parseInt(stats.restaurants),
          onsens: parseInt(stats.onsens),
          lifts: parseInt(stats.lifts)
        },
        visibility: {
          visible: parseInt(stats.visible_places),
          hidden: parseInt(stats.total_places) - parseInt(stats.visible_places)
        },
        dataQuality: {
          withOverrides: parseInt(stats.places_with_overrides),
          withLocalKnowledge: parseInt(stats.places_with_local_knowledge),
          withGoogleData: parseInt(stats.places_with_google_data)
        },
        metrics: {
          averageRating: stats.avg_rating ? parseFloat(stats.avg_rating).toFixed(2) : null,
          lastUpdated: stats.last_updated
        }
      },
      source: 'postgresql'
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v2/health
 * Health check endpoint for PostgreSQL connection
 */
router.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as server_time, version() as postgres_version');

    res.json({
      success: true,
      database: 'connected',
      serverTime: result.rows[0].server_time,
      postgresVersion: result.rows[0].postgres_version,
      featureFlags: {
        postgresRead: process.env.ENABLE_POSTGRES_READ === 'true'
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      database: 'disconnected',
      error: error.message
    });
  }
});

/**
 * GET /api/v2/lifts
 * Get lift status from PostgreSQL
 *
 * Returns the latest scraped lift status from the database.
 * Falls back to in-memory cache if PostgreSQL read is disabled.
 */
router.get('/lifts', async (req, res) => {
  try {
    // Feature flag check
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'Use /api/lifts/status instead',
        hint: 'Set ENABLE_POSTGRES_READ=true to use this endpoint'
      });
    }

    // Query PostgreSQL for latest lift status
    const result = await pool.query(`
      SELECT
        lift_data,
        is_off_season,
        scraped_at,
        scraper_version,
        source_url
      FROM lift_status_cache
      WHERE resort_id = $1
      ORDER BY scraped_at DESC
      LIMIT 1
    `, [1]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No lift data available',
        message: 'Lift status has not been scraped yet',
        hint: 'Wait for next scheduled scrape or check /api/lifts/status for cached data'
      });
    }

    const data = result.rows[0];
    const ageMinutes = Math.round((Date.now() - new Date(data.scraped_at)) / 60000);

    res.json({
      success: true,
      ...data.lift_data,
      scrapedAt: data.scraped_at,
      ageMinutes: ageMinutes,
      isOffSeason: data.is_off_season,
      source: 'postgresql',
      version: data.scraper_version,
      sourceUrl: data.source_url
    });

  } catch (error) {
    console.error('Error fetching lifts from PostgreSQL:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});

/**
 * GET /api/v2/weather
 * Get weather from PostgreSQL cache
 *
 * Returns the latest cached weather data from the database.
 * Falls back to in-memory cache if PostgreSQL read is disabled.
 */
router.get('/weather', async (req, res) => {
  try {
    // Feature flag check
    if (process.env.ENABLE_POSTGRES_READ !== 'true') {
      return res.status(503).json({
        error: 'PostgreSQL read not enabled',
        message: 'Use /api/weather/current instead',
        hint: 'Set ENABLE_POSTGRES_READ=true to use this endpoint'
      });
    }

    // Query PostgreSQL for latest weather data
    const result = await pool.query(`
      SELECT
        weather_data,
        snow_line,
        village_temp_c,
        summit_temp_c,
        fetched_at,
        expires_at,
        source_url
      FROM weather_cache
      WHERE resort_id = $1
      ORDER BY fetched_at DESC
      LIMIT 1
    `, [1]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No weather data available',
        message: 'Weather has not been fetched yet',
        hint: 'Check /api/weather/current to trigger a fetch'
      });
    }

    const data = result.rows[0];
    const ageMinutes = Math.round((Date.now() - new Date(data.fetched_at)) / 60000);
    const isExpired = new Date() > new Date(data.expires_at);

    res.json({
      success: true,
      ...data.weather_data,
      snow_line: data.snow_line,
      fetchedAt: data.fetched_at,
      expiresAt: data.expires_at,
      ageMinutes,
      expired: isExpired,
      source: 'postgresql',
      sourceUrl: data.source_url
    });

  } catch (error) {
    console.error('Error fetching weather from PostgreSQL:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});

module.exports = router;
