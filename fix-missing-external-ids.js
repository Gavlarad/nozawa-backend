/**
 * Fix Missing External IDs for Onsens and Lifts
 *
 * Adds external_id to onsens and lifts so dual-write can sync them to PostgreSQL
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Read JSON data
const jsonPath = path.join(__dirname, 'nozawa_places_unified.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// Helper function to create slug from name
function createSlug(name) {
  return 'nozawa_' + name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '_')          // Spaces to underscores
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .substring(0, 50);             // Limit length
}

async function fixExternalIds() {
  console.log('🔧 Fixing missing external_ids for onsens and lifts...\n');

  let updatedCount = 0;
  const updates = [];

  // Process each place
  data.places.forEach((place, index) => {
    // Only update if missing external_id AND missing google_place_id
    if (!place.external_id && !place.google_place_id) {
      const external_id = createSlug(place.name);

      console.log(`Adding external_id to: ${place.name}`);
      console.log(`  → ${external_id}`);

      data.places[index].external_id = external_id;
      updatedCount++;

      updates.push({
        name: place.name,
        external_id: external_id,
        category: place.category
      });
    }
  });

  if (updatedCount === 0) {
    console.log('\n✅ No places need updating - all have IDs');
    return { updates: [], jsonUpdated: false };
  }

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupPath = path.join(__dirname, 'backups', `nozawa_places_before_id_fix_${timestamp}.json`);

  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  fs.writeFileSync(backupPath, fs.readFileSync(jsonPath, 'utf8'));
  console.log(`\n📦 Backup created: ${path.basename(backupPath)}`);

  // Write updated JSON
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`\n✅ Updated ${updatedCount} places in JSON file`);

  return { updates, jsonUpdated: true };
}

async function updatePostgreSQL(updates) {
  if (updates.length === 0) {
    console.log('\nNo PostgreSQL updates needed');
    return;
  }

  console.log('\n🔄 Updating PostgreSQL with new external_ids...');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    for (const update of updates) {
      try {
        // Find place by name and category
        const result = await pool.query(
          'UPDATE places SET external_id = $1, updated_at = NOW() WHERE name = $2 AND category = $3 AND external_id IS NULL RETURNING id, name',
          [update.external_id, update.name, update.category]
        );

        if (result.rows.length > 0) {
          console.log(`  ✅ ${update.name} → ${update.external_id}`);
        } else {
          console.log(`  ⚠️  ${update.name} - not found in PostgreSQL or already has external_id`);
        }
      } catch (err) {
        console.error(`  ❌ Error updating ${update.name}:`, err.message);
      }
    }

    await pool.end();
    console.log('\n✅ PostgreSQL updates complete');

  } catch (error) {
    console.error('\n❌ PostgreSQL update failed:', error.message);
    await pool.end();
  }
}

async function verify() {
  console.log('\n🔍 Verifying...');

  // Check JSON
  const updatedData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const missingIds = updatedData.places.filter(p => !p.external_id && !p.google_place_id);

  console.log(`\nJSON file: ${updatedData.places.length} total places`);
  console.log(`Missing IDs: ${missingIds.length}`);

  if (missingIds.length > 0) {
    console.log('\n⚠️  Still missing IDs:');
    missingIds.forEach(p => console.log(`  - ${p.name} (${p.category})`));
  } else {
    console.log('✅ All places now have external_id or google_place_id');
  }

  // Check PostgreSQL
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  const result = await pool.query('SELECT COUNT(*) as total, COUNT(external_id) as with_id FROM places');
  console.log(`\nPostgreSQL: ${result.rows[0].total} total places`);
  console.log(`With external_id: ${result.rows[0].with_id}`);

  await pool.end();
}

// Run it
(async () => {
  try {
    const { updates, jsonUpdated } = await fixExternalIds();

    if (jsonUpdated) {
      await updatePostgreSQL(updates);
      await verify();

      console.log('\n' + '='.repeat(50));
      console.log('NEXT STEPS:');
      console.log('='.repeat(50));
      console.log('1. Review the changes in nozawa_places_unified.json');
      console.log('2. Commit and push to git');
      console.log('3. Test dual-write in admin panel');
      console.log('4. Verify all 97 places sync successfully');
      console.log('='.repeat(50));
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
})();
