#!/usr/bin/env node
/**
 * Generate Local Tips from Google Reviews using Claude API
 *
 * This script analyzes Google review data for restaurants and generates
 * concise, helpful local tips (max 200 characters) for tourists.
 *
 * Usage:
 *   node scripts/generateLocalTips.js [--dry-run] [--only-empty] [--limit N] [--place-id ID]
 *
 * Options:
 *   --dry-run     Preview what would be generated without saving
 *   --only-empty  Only generate tips for places without existing tips
 *   --limit N     Process only N restaurants
 *   --place-id ID Process only a specific place ID
 */

require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_EMPTY = args.includes('--only-empty');
const limitIndex = args.indexOf('--limit');
const LIMIT = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : null;
const placeIdIndex = args.indexOf('--place-id');
const PLACE_ID = placeIdIndex !== -1 ? parseInt(args[placeIdIndex + 1], 10) : null;

async function getRestaurantsWithReviews() {
  let query = `
    SELECT
      p.id,
      p.name,
      p.subcategory,
      p.review_analysis,
      plk.tips as existing_tips
    FROM places p
    LEFT JOIN place_local_knowledge plk ON p.id = plk.place_id
    WHERE p.category = 'restaurant'
      AND p.visible_in_app = true
      AND p.review_analysis IS NOT NULL
      AND p.review_analysis->'insights'->'recent_reviews' IS NOT NULL
      AND jsonb_array_length(p.review_analysis->'insights'->'recent_reviews') > 0
  `;

  const conditions = [];
  const params = [];

  if (ONLY_EMPTY) {
    conditions.push(`(plk.tips IS NULL OR array_length(plk.tips, 1) IS NULL OR array_length(plk.tips, 1) = 0)`);
  }

  if (PLACE_ID) {
    params.push(PLACE_ID);
    conditions.push(`p.id = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' AND ' + conditions.join(' AND ');
  }

  query += ' ORDER BY p.id';

  if (LIMIT) {
    params.push(LIMIT);
    query += ` LIMIT $${params.length}`;
  }

  const result = await pool.query(query, params);
  return result.rows;
}

async function generateTip(restaurant) {
  const reviews = restaurant.review_analysis?.insights?.recent_reviews || [];

  if (reviews.length === 0) {
    return null;
  }

  // Compile review snippets
  const reviewTexts = reviews
    .map(r => r.text_snippet)
    .filter(Boolean)
    .join('\n---\n');

  if (!reviewTexts.trim()) {
    return null;
  }

  // Build context about the restaurant
  const context = [
    `Restaurant: ${restaurant.name}`,
    restaurant.subcategory ? `Type: ${restaurant.subcategory}` : null,
  ].filter(Boolean).join('\n');

  const prompt = `You are helping create a local tip for tourists visiting Nozawa Onsen, a ski village in Japan.

${context}

Here are recent Google review snippets for this restaurant:
${reviewTexts}

Based on these reviews, write ONE helpful local tip for tourists. The tip should be:
- Maximum 200 characters (strict limit)
- Actionable or informative (e.g., "Try the gyudon" or "Cash only, no cards")
- Written as a single sentence or two short sentences
- Focused on: what to order, practical info, or insider knowledge
- Skip generic praise like "great food" - focus on specific, useful info

If there's nothing specific or useful to extract from the reviews, respond with just: SKIP

Respond with ONLY the tip text (or SKIP), no quotes or explanation.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    const tip = message.content[0]?.text?.trim();

    if (!tip || tip === 'SKIP' || tip.length > 250) {
      return null;
    }

    // Ensure under 200 chars
    if (tip.length > 200) {
      // Try to truncate at sentence or word boundary
      let truncated = tip.substring(0, 197);
      const lastPeriod = truncated.lastIndexOf('.');
      const lastSpace = truncated.lastIndexOf(' ');

      if (lastPeriod > 150) {
        truncated = truncated.substring(0, lastPeriod + 1);
      } else if (lastSpace > 150) {
        truncated = truncated.substring(0, lastSpace) + '...';
      } else {
        truncated += '...';
      }
      return truncated;
    }

    return tip;
  } catch (error) {
    console.error(`  Error generating tip for ${restaurant.name}:`, error.message);
    return null;
  }
}

async function saveTip(placeId, tip) {
  // Upsert into place_local_knowledge
  // tips is a text[] array column
  await pool.query(`
    INSERT INTO place_local_knowledge (place_id, tips, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (place_id)
    DO UPDATE SET tips = $2, updated_at = NOW()
  `, [placeId, [tip]]);
}

async function main() {
  console.log('=== Generate Local Tips from Google Reviews ===\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not found in environment variables');
    console.error('Add it to your .env file: ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  console.log('Options:');
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log(`  Only empty: ${ONLY_EMPTY}`);
  console.log(`  Limit: ${LIMIT || 'none'}`);
  console.log(`  Place ID: ${PLACE_ID || 'all'}`);
  console.log('');

  const restaurants = await getRestaurantsWithReviews();
  console.log(`Found ${restaurants.length} restaurants with reviews to process\n`);

  if (restaurants.length === 0) {
    console.log('No restaurants to process.');
    await pool.end();
    return;
  }

  let processed = 0;
  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const restaurant of restaurants) {
    processed++;
    const hasExistingTip = restaurant.existing_tips &&
      Array.isArray(restaurant.existing_tips) &&
      restaurant.existing_tips.length > 0 &&
      restaurant.existing_tips[0];

    console.log(`[${processed}/${restaurants.length}] ${restaurant.name} (ID: ${restaurant.id})`);

    if (hasExistingTip && !PLACE_ID) {
      console.log(`  Existing tip: "${restaurant.existing_tips[0]}"`);
    }

    const tip = await generateTip(restaurant);

    if (tip) {
      console.log(`  Generated: "${tip}" (${tip.length} chars)`);

      if (!DRY_RUN) {
        try {
          await saveTip(restaurant.id, tip);
          console.log('  Saved to database');
        } catch (err) {
          console.error('  Error saving:', err.message);
          errors++;
          continue;
        }
      }
      generated++;
    } else {
      console.log('  Skipped (no useful content)');
      skipped++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Generated: ${generated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

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
