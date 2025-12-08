#!/usr/bin/env node
/**
 * Import Onsen Descriptions and Local Tips from Markdown
 *
 * This script parses the nozawa-onsen-descriptions.md file and updates
 * the place_local_knowledge table with rich descriptions and local tips.
 *
 * Usage:
 *   node scripts/importOnsenDescriptions.js [--dry-run]
 *
 * Options:
 *   --dry-run     Preview what would be updated without saving
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const DRY_RUN = process.argv.includes('--dry-run');

// Mapping from markdown names to database names (handle variations)
const nameMapping = {
  'Oyu': 'Oyu',
  'Kawahara-yu': 'Kawahara-yu',
  'Akiha-no-yu': 'Akiha-no-yu',
  'Taki-no-yu': 'Taki-no-yu',
  'Kuma-no-tearai-yu': 'Kumanote-ara', // Different name in DB
  'Matsuba-no-yu': 'Matsuba-no-yu',
  'Nakao-no-yu': 'Nakao-no-yu',
  'Shin-yu': 'Shinyu', // Different name in DB
  'Asagama-no-yu': 'Asagama-no-yu',
  'Kamitera-yu': 'Kamitera-yu',
  'Yokochi-no-yu': 'Yokochi-no-yu',
  'Juoudou-no-yu': 'Juodo-no-yu', // Different name in DB
  'Shinden-no-yu': 'Shinden-no-yu',
};

function parseMarkdown(content) {
  const onsens = [];

  // Split by ## headers (each onsen section)
  const sections = content.split(/^## \d+\. /m).slice(1); // Skip content before first onsen

  for (const section of sections) {
    const lines = section.trim().split('\n');

    // First line has the name, e.g., "Oyu (大湯) - The Grand Bath"
    const headerLine = lines[0];
    const nameMatch = headerLine.match(/^([A-Za-z-]+)/);
    if (!nameMatch) continue;

    const markdownName = nameMatch[1];
    const dbName = nameMapping[markdownName];

    if (!dbName) {
      console.log(`Warning: No mapping for "${markdownName}"`);
      continue;
    }

    // Find the description paragraphs (between header and **Local Tip:**)
    const localTipIndex = section.indexOf('**Local Tip:**');
    let descriptionSection = localTipIndex > 0
      ? section.substring(0, localTipIndex)
      : section;

    // Remove header line and temperature line
    const descLines = descriptionSection.split('\n').slice(1);

    // Filter out the **Temperature:** line and empty lines at start
    const filteredLines = descLines.filter((line, i) => {
      if (line.startsWith('**Temperature:')) return false;
      return true;
    });

    // Join paragraphs, removing empty lines between them
    const description = filteredLines
      .join('\n')
      .trim()
      .replace(/\n\n+/g, '\n\n'); // Normalize paragraph breaks

    // Extract local tip
    let localTip = null;
    if (localTipIndex > 0) {
      const tipSection = section.substring(localTipIndex + '**Local Tip:**'.length);
      // Get text until next ## or end
      const nextSectionIndex = tipSection.indexOf('\n## ');
      localTip = (nextSectionIndex > 0
        ? tipSection.substring(0, nextSectionIndex)
        : tipSection
      ).trim();
    }

    onsens.push({
      markdownName,
      dbName,
      description,
      localTip,
    });
  }

  return onsens;
}

async function getOnsenPlaces() {
  const result = await pool.query(`
    SELECT id, name FROM places WHERE category = 'onsen' ORDER BY name
  `);
  return result.rows;
}

async function updateOnsenData(placeId, description, tip) {
  await pool.query(`
    INSERT INTO place_local_knowledge (place_id, description_override, tips, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (place_id)
    DO UPDATE SET
      description_override = $2,
      tips = $3,
      updated_at = NOW()
  `, [placeId, description, tip ? [tip] : null]);
}

async function main() {
  console.log('=== Import Onsen Descriptions ===\n');

  if (DRY_RUN) {
    console.log('DRY RUN MODE - No changes will be saved\n');
  }

  // Read and parse the markdown file
  const mdPath = path.join(__dirname, '..', 'nozawa-onsen-descriptions.md');
  const content = fs.readFileSync(mdPath, 'utf-8');

  const parsedOnsens = parseMarkdown(content);
  console.log(`Parsed ${parsedOnsens.length} onsens from markdown\n`);

  // Get existing onsens from database
  const dbOnsens = await getOnsenPlaces();
  console.log(`Found ${dbOnsens.length} onsens in database\n`);

  // Create lookup by name
  const dbLookup = {};
  for (const onsen of dbOnsens) {
    dbLookup[onsen.name] = onsen.id;
  }

  let updated = 0;
  let notFound = 0;

  for (const onsen of parsedOnsens) {
    const placeId = dbLookup[onsen.dbName];

    if (!placeId) {
      console.log(`NOT FOUND: "${onsen.dbName}" (from "${onsen.markdownName}")`);
      notFound++;
      continue;
    }

    console.log(`\n[${onsen.dbName}] (ID: ${placeId})`);
    console.log(`  Description: ${onsen.description.substring(0, 100)}...`);
    console.log(`  Local Tip: ${onsen.localTip ? onsen.localTip.substring(0, 80) + '...' : 'None'}`);

    if (!DRY_RUN) {
      await updateOnsenData(placeId, onsen.description, onsen.localTip);
      console.log('  ✓ Saved');
    }
    updated++;
  }

  console.log('\n=== Summary ===');
  console.log(`Updated: ${updated}`);
  console.log(`Not found: ${notFound}`);

  if (DRY_RUN) {
    console.log('\n(Dry run - no changes saved)');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
