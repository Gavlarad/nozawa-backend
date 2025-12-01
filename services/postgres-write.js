/**
 * Direct PostgreSQL Write Service
 *
 * Writes place data directly to PostgreSQL (single source of truth).
 * Replaces dual-write system with direct database updates.
 *
 * Handles ALL editable fields across all tables:
 * - places (core fields: category, subcategory, status, name_local, visible_in_app)
 * - place_overrides (overrides: name, address, phone, rating, cuisine, etc.)
 * - place_local_knowledge (tips, warnings, navigation, etc.)
 */

const { Pool } = require('pg');

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Save places data directly to PostgreSQL
 *
 * @param {Array} places - Array of place objects
 * @param {number} adminId - ID of admin user making the change
 * @returns {Promise<Object>} - Result object with success status and details
 */
async function savePlacesToPostgreSQL(places, adminId) {
  const result = {
    success: false,
    updated: 0,
    errors: [],
    details: []
  };

  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    for (const place of places) {
      try {
        // Find the place ID by external_id or google_place_id
        let placeId = null;

        if (place.id && !place.id.startsWith('ChIJ')) {
          // It's an external_id
          const placeQuery = await client.query(
            'SELECT id FROM places WHERE external_id = $1',
            [place.id]
          );
          if (placeQuery.rows.length > 0) {
            placeId = placeQuery.rows[0].id;
          }
        } else if (place.google_place_id) {
          // It's a Google place ID
          const placeQuery = await client.query(
            'SELECT id FROM places WHERE google_place_id = $1',
            [place.google_place_id]
          );
          if (placeQuery.rows.length > 0) {
            placeId = placeQuery.rows[0].id;
          }
        }

        if (!placeId) {
          result.errors.push({
            place: place.name || place.id,
            error: 'Place not found in database (no matching external_id or google_place_id)'
          });
          continue;
        }

        // ========================================
        // 1. UPDATE PLACES TABLE (Core Fields)
        // ========================================
        const subcategory = place.subcategory || place.manual_overrides?.subcategory || null;
        const status = place.status || place.manual_overrides?.status || 'active';

        await client.query(`
          UPDATE places
          SET
            category = $1,
            subcategory = $2,
            status = $3,
            name_local = $4,
            visible_in_app = $5,
            updated_at = NOW(),
            updated_by = $6
          WHERE id = $7
        `, [
          place.category || 'restaurant',
          subcategory,
          status,
          place.name_local || null,
          place.visible_in_app !== undefined ? place.visible_in_app : true,
          adminId,
          placeId
        ]);

        // ========================================
        // 2. UPSERT PLACE_OVERRIDES TABLE
        // ========================================
        await client.query(`
          INSERT INTO place_overrides (
            place_id,
            name_override,
            address_override,
            phone_override,
            website_override,
            rating_override,
            price_range_override,
            hours_override,
            cuisine,
            budget_range,
            english_menu,
            accepts_cards,
            photo_urls,
            manual_photos,
            custom_fields,
            updated_by,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (place_id)
          DO UPDATE SET
            name_override = EXCLUDED.name_override,
            address_override = EXCLUDED.address_override,
            phone_override = EXCLUDED.phone_override,
            website_override = EXCLUDED.website_override,
            rating_override = EXCLUDED.rating_override,
            price_range_override = EXCLUDED.price_range_override,
            hours_override = EXCLUDED.hours_override,
            cuisine = EXCLUDED.cuisine,
            budget_range = EXCLUDED.budget_range,
            english_menu = EXCLUDED.english_menu,
            accepts_cards = EXCLUDED.accepts_cards,
            photo_urls = EXCLUDED.photo_urls,
            manual_photos = EXCLUDED.manual_photos,
            custom_fields = EXCLUDED.custom_fields,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        `, [
          placeId,
          place.name || null,
          place.address || null,
          place.phone || null,
          place.website || null,
          place.rating ? parseFloat(place.rating) : null,
          place.price_range || null,
          place.opening_hours ? JSON.stringify(place.opening_hours) : null,
          place.enhanced_data?.cuisine || null,
          place.enhanced_data?.budget || null,
          place.enhanced_data?.english_menu || null,
          place.enhanced_data?.credit_cards || null,
          place.photos ? JSON.stringify(place.photos) : null,
          place.manual_photos || false,
          place.custom_fields ? JSON.stringify(place.custom_fields) : null,
          adminId
        ]);

        // ========================================
        // 3. UPSERT PLACE_LOCAL_KNOWLEDGE TABLE
        // ========================================
        const localKnowledge = place.local_knowledge || {};
        const tips = localKnowledge.tips || [];
        const warnings = localKnowledge.warnings || [];

        // navigation_tips can be a string (old format) or array (new format)
        // Normalize to array for PostgreSQL TEXT[] type
        let navigationTips = null;
        if (localKnowledge.navigation_tips) {
          if (Array.isArray(localKnowledge.navigation_tips)) {
            navigationTips = localKnowledge.navigation_tips;
          } else if (typeof localKnowledge.navigation_tips === 'string') {
            navigationTips = [localKnowledge.navigation_tips];
          }
        }

        const description = localKnowledge.description || null;
        const insiderNotes = localKnowledge.notes || null;
        const featuresVerified = localKnowledge.verified_features || {};

        // Only upsert if there's actually local knowledge to save
        if (tips.length > 0 || warnings.length > 0 || navigationTips || description || insiderNotes || Object.keys(featuresVerified).length > 0) {
          await client.query(`
            INSERT INTO place_local_knowledge (
              place_id,
              language_code,
              tips,
              warnings,
              navigation_tips,
              description_override,
              insider_notes,
              features_verified,
              updated_by,
              updated_at
            ) VALUES ($1, 'en', $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (place_id, language_code)
            DO UPDATE SET
              tips = EXCLUDED.tips,
              warnings = EXCLUDED.warnings,
              navigation_tips = EXCLUDED.navigation_tips,
              description_override = EXCLUDED.description_override,
              insider_notes = EXCLUDED.insider_notes,
              features_verified = EXCLUDED.features_verified,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()
          `, [
            placeId,
            tips.length > 0 ? tips : null,
            warnings.length > 0 ? warnings : null,
            navigationTips && navigationTips.length > 0 ? navigationTips : null,
            description,
            insiderNotes,
            JSON.stringify(featuresVerified),
            adminId
          ]);
        }

        result.updated++;
        result.details.push({
          place_id: placeId,
          name: place.name,
          action: 'updated'
        });

      } catch (placeError) {
        result.errors.push({
          place: place.name || place.id,
          error: placeError.message
        });
        console.error(`Error syncing place ${place.name}:`, placeError.message);
      }
    }

    // Commit transaction
    await client.query('COMMIT');
    result.success = result.errors.length === 0 || result.updated > 0;

    if (result.success) {
      console.log(`✅ PostgreSQL direct write: ${result.updated} places updated`);
    }

    if (result.errors.length > 0) {
      console.warn(`⚠️  PostgreSQL sync completed with ${result.errors.length} errors`);
    }

  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    result.error = error.message;
    console.error('❌ PostgreSQL transaction failed:', error);
  } finally {
    client.release();
  }

  return result;
}

/**
 * Export places data from PostgreSQL to JSON format
 *
 * @returns {Promise<Object>} - Places data in JSON format
 */
async function exportPlacesToJSON() {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.external_id,
        p.google_place_id,
        p.category,
        p.subcategory,
        p.status,
        p.visible_in_app,
        p.name,
        p.name_local,
        p.latitude,
        p.longitude,
        p.address,
        po.rating_override as rating,
        gd.google_review_count as review_count,
        po.phone_override as phone,
        po.website_override as website,
        po.price_range_override as price_range,
        po.hours_override as opening_hours,
        CASE
          WHEN po.manual_photos = true THEN po.photo_urls
          ELSE gd.photos
        END as photos,
        po.manual_photos,
        po.cuisine,
        po.budget_range,
        po.english_menu,
        po.accepts_cards as credit_cards,
        p.review_analysis,
        lk.tips,
        lk.warnings,
        lk.navigation_tips,
        lk.description_override as description,
        lk.insider_notes as notes,
        lk.features_verified,
        p.last_verified,
        p.created_at,
        p.updated_at
      FROM places p
      LEFT JOIN place_google_data gd ON p.id = gd.place_id
      LEFT JOIN place_overrides po ON p.id = po.place_id
      LEFT JOIN place_local_knowledge lk ON p.id = lk.place_id
      WHERE p.resort_id = 1
      ORDER BY p.category, p.name
    `);

    // Transform to JSON structure
    const places = result.rows.map(row => {
      const place = {
        id: row.external_id || row.google_place_id,
        google_place_id: row.google_place_id,
        name: row.name,
        name_local: row.name_local,
        category: row.category,
        subcategory: row.subcategory,
        status: row.status,
        visible_in_app: row.visible_in_app,
        coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)],
        address: row.address,
        rating: row.rating,
        review_count: row.review_count,
        phone: row.phone,
        website: row.website,
        price_range: row.price_range,
        opening_hours: row.opening_hours,
        photos: row.photos,
        manual_photos: row.manual_photos,
        last_verified: row.last_verified
      };

      // Enhanced data
      if (row.cuisine || row.budget_range || row.english_menu || row.credit_cards || row.review_analysis) {
        place.enhanced_data = {};
        if (row.cuisine) place.enhanced_data.cuisine = row.cuisine;
        if (row.budget_range) place.enhanced_data.budget = row.budget_range;
        if (row.english_menu !== null) place.enhanced_data.english_menu = row.english_menu;
        if (row.credit_cards !== null) place.enhanced_data.credit_cards = row.credit_cards;
        if (row.review_analysis) place.enhanced_data.review_analysis = row.review_analysis;
      }

      // Local knowledge
      if (row.tips || row.warnings || row.navigation_tips || row.description || row.notes || row.features_verified) {
        place.local_knowledge = {};
        if (row.tips) place.local_knowledge.tips = row.tips;
        if (row.warnings) place.local_knowledge.warnings = row.warnings;
        if (row.navigation_tips) place.local_knowledge.navigation_tips = row.navigation_tips;
        if (row.description) place.local_knowledge.description = row.description;
        if (row.notes) place.local_knowledge.notes = row.notes;
        if (row.features_verified) place.local_knowledge.verified_features = row.features_verified;
      }

      return place;
    });

    return {
      places,
      total_count: places.length,
      generated_at: new Date().toISOString(),
      source: 'postgresql',
      version: '2.0.0'
    };

  } catch (error) {
    console.error('Error exporting places to JSON:', error);
    throw error;
  }
}

module.exports = {
  savePlacesToPostgreSQL,
  exportPlacesToJSON,
  pool
};
