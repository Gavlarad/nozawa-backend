/**
 * Update PostgreSQL with External IDs for Onsens and Lifts
 * Run this in production AFTER deploying the updated JSON file
 */

const { Pool } = require('pg');

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

async function updateExternalIds() {
  console.log('🔄 Updating PostgreSQL external_ids for onsens and lifts...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  let updated = 0;
  let notFound = 0;

  try {
    for (const place of externalIds) {
      const result = await pool.query(
        'UPDATE places SET external_id = $1, updated_at = NOW() WHERE name = $2 AND category = $3 RETURNING id, name',
        [place.external_id, place.name, place.category]
      );

      if (result.rows.length > 0) {
        console.log(`✅ ${place.name} → ${place.external_id}`);
        updated++;
      } else {
        console.log(`⚠️  ${place.name} - not found in PostgreSQL`);
        notFound++;
      }
    }

    console.log(`\n✅ Updated ${updated} places`);
    if (notFound > 0) {
      console.log(`⚠️  ${notFound} places not found`);
    }

    await pool.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

updateExternalIds();
