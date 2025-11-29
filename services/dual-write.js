/**
 * Dual-Write Service
 *
 * Writes place data to both JSON files and PostgreSQL database simultaneously.
 * Ensures data consistency during migration from JSON to PostgreSQL.
 *
 * Feature flag: ENABLE_DUAL_WRITE
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Save places data to both JSON and PostgreSQL
 *
 * @param {Object} data - Places data object with { places: [], total_count: number }
 * @param {number} adminId - ID of admin user making the change
 * @returns {Promise<Object>} - Result object with success status and details
 */
async function dualWritePlaces(data, adminId) {
  const dualWriteEnabled = process.env.ENABLE_DUAL_WRITE === 'true';
  const timestamp = new Date().toISOString();
  const results = {
    success: false,
    json: { success: false, path: null, backup: null },
    postgresql: { success: false, updated: 0, errors: [] },
    dualWriteEnabled,
    timestamp
  };

  try {
    // STEP 1: Write to JSON (always happens)
    const jsonResult = await writeToJSON(data);
    results.json = jsonResult;

    if (!jsonResult.success) {
      throw new Error(`JSON write failed: ${jsonResult.error}`);
    }

    // STEP 2: Write to PostgreSQL (if dual-write enabled)
    if (dualWriteEnabled) {
      console.log('🔄 Dual-write enabled - syncing to PostgreSQL...');
      const pgResult = await writeToPostgreSQL(data.places, adminId);
      results.postgresql = pgResult;

      if (!pgResult.success) {
        // PostgreSQL write failed - JSON already succeeded
        // Log error but don't roll back JSON (JSON is source of truth during migration)
        console.error('❌ PostgreSQL write failed:', pgResult.errors);
        console.warn('⚠️  JSON updated successfully but PostgreSQL sync failed');
        results.success = false;
        results.warning = 'Data saved to JSON but PostgreSQL sync failed. Manual sync may be required.';
        return results;
      }

      console.log(`✅ Dual-write successful: JSON + PostgreSQL (${pgResult.updated} places)`);
    } else {
      console.log('📝 Dual-write disabled - only JSON updated');
      results.postgresql.skipped = true;
    }

    results.success = true;
    return results;

  } catch (error) {
    console.error('Dual-write error:', error);
    results.error = error.message;
    return results;
  }
}

/**
 * Write data to JSON file with backup
 *
 * @param {Object} data - Places data
 * @returns {Promise<Object>} - Result with success, path, and backup info
 */
async function writeToJSON(data) {
  const result = {
    success: false,
    path: null,
    backup: null,
    error: null
  };

  try {
    const dataPath = path.join(__dirname, '..', 'nozawa_places_unified.json');
    const backupDir = path.join(__dirname, '..', 'backups');

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
      result.backup = `nozawa_places_unified_backup_${timestamp}.json`;
      console.log(`📦 Backup created: ${result.backup}`);
    }

    // Prepare new data with metadata
    const newData = {
      ...data,
      total_count: data.places.length,
      generated_at: new Date().toISOString(),
      last_updated_by: 'dual-write-service'
    };

    // Write new data to JSON
    fs.writeFileSync(dataPath, JSON.stringify(newData, null, 2), 'utf8');

    result.success = true;
    result.path = dataPath;

    console.log(`✅ JSON write successful: ${data.places.length} places`);
    return result;

  } catch (error) {
    result.error = error.message;
    console.error('❌ JSON write error:', error);
    return result;
  }
}

/**
 * Write data to PostgreSQL database
 *
 * Updates place_overrides table with data from JSON
 * Does NOT modify core places table (that's managed by migrations)
 *
 * @param {Array} places - Array of place objects
 * @param {number} adminId - Admin user ID
 * @returns {Promise<Object>} - Result with success, updated count, and errors
 */
async function writeToPostgreSQL(places, adminId) {
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

        if (place.external_id) {
          const placeQuery = await client.query(
            'SELECT id FROM places WHERE external_id = $1',
            [place.external_id]
          );
          if (placeQuery.rows.length > 0) {
            placeId = placeQuery.rows[0].id;
          }
        } else if (place.google_place_id) {
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

        // Upsert place_overrides (update if exists, insert if not)
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
          place.cuisine || null,
          place.budget_range || null,
          place.english_menu || null,
          place.accepts_cards || null,
          place.photos ? JSON.stringify(place.photos) : null,
          place.manual_photos || false,
          place.custom_fields ? JSON.stringify(place.custom_fields) : null,
          adminId
        ]);

        result.updated++;
        result.details.push({
          place_id: placeId,
          name: place.name,
          action: 'upserted'
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
      console.log(`✅ PostgreSQL sync: ${result.updated} places updated`);
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
 * Validate data consistency between JSON and PostgreSQL
 *
 * @returns {Promise<Object>} - Validation result with discrepancies
 */
async function validateDataConsistency() {
  const result = {
    consistent: true,
    jsonCount: 0,
    postgresCount: 0,
    discrepancies: []
  };

  try {
    // Read JSON data
    const dataPath = path.join(__dirname, '..', 'nozawa_places_unified.json');
    const jsonData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    result.jsonCount = jsonData.places.length;

    // Query PostgreSQL count
    const pgResult = await pool.query('SELECT COUNT(*) FROM places');
    result.postgresCount = parseInt(pgResult.rows[0].count);

    // Check counts match
    if (result.jsonCount !== result.postgresCount) {
      result.consistent = false;
      result.discrepancies.push({
        type: 'count_mismatch',
        json: result.jsonCount,
        postgresql: result.postgresCount,
        difference: result.jsonCount - result.postgresCount
      });
    }

    // Sample check: verify first 5 places exist in both
    const samplePlaces = jsonData.places.slice(0, 5);
    for (const place of samplePlaces) {
      if (place.external_id) {
        const checkQuery = await pool.query(
          'SELECT id, name FROM places WHERE external_id = $1',
          [place.external_id]
        );

        if (checkQuery.rows.length === 0) {
          result.consistent = false;
          result.discrepancies.push({
            type: 'missing_in_postgres',
            place: place.name,
            external_id: place.external_id
          });
        }
      }
    }

    return result;

  } catch (error) {
    return {
      consistent: false,
      error: error.message
    };
  }
}

module.exports = {
  dualWritePlaces,
  writeToJSON,
  writeToPostgreSQL,
  validateDataConsistency
};
