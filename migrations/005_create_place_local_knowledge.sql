-- ============================================
-- PLACE_LOCAL_KNOWLEDGE (Local tips & warnings)
-- ============================================
-- 100% manual content, NEVER touched by Google sync.
-- Local insider information, warnings, navigation tips.

CREATE TABLE IF NOT EXISTS place_local_knowledge (
  id SERIAL PRIMARY KEY,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,

  -- Local tips & warnings (arrays for multiple entries)
  tips TEXT[],
  warnings TEXT[],
  navigation_tips TEXT[],

  -- Verified features (admin-checked boxes)
  -- Structure: { "wifi": true, "card_payment": true, ... }
  features_verified JSONB DEFAULT '{}'::jsonb,

  -- Rich content
  description_override TEXT,          -- Override Google description
  insider_notes TEXT,                 -- Admin's personal notes

  -- Language support (for future multi-language)
  language_code CHAR(2) DEFAULT 'en',

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(100),

  -- Constraints
  UNIQUE(place_id, language_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_local_knowledge_place ON place_local_knowledge(place_id);
CREATE INDEX IF NOT EXISTS idx_local_knowledge_lang ON place_local_knowledge(language_code);

-- Comments
COMMENT ON TABLE place_local_knowledge IS 'Local tips, warnings, navigation - 100% manual, never overwritten';
COMMENT ON COLUMN place_local_knowledge.tips IS 'Helpful tips array, e.g., ["Try early morning", "Bring cash"]';
COMMENT ON COLUMN place_local_knowledge.warnings IS 'Important warnings, e.g., ["Very hot water", "Cash only"]';
COMMENT ON COLUMN place_local_knowledge.navigation_tips IS 'How to find the place';
