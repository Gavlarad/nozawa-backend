-- Migration: Add review analysis data to places table
-- This adds review snippets and insights from Google Places reviews

-- Add review_analysis column to places table
ALTER TABLE places
ADD COLUMN IF NOT EXISTS review_analysis JSONB;

-- Add index for querying review data
CREATE INDEX IF NOT EXISTS idx_places_review_analysis
ON places USING GIN (review_analysis);

-- Add comment explaining the structure
COMMENT ON COLUMN places.review_analysis IS
'Review analysis data from Google Places including recent review snippets and insights.
Structure: { review_count, insights: { mentions_english, mentions_cash_only, mentions_wait, mentions_vegetarian, recent_reviews: [{rating, time, text_snippet}] } }';

-- Migration complete
