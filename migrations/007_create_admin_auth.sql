-- ============================================
-- ADMIN_USERS TABLE (Admin authentication)
-- ============================================
-- Simple admin authentication for managing places.
-- Replaces hardcoded 'nozawa2024' password with proper JWT auth.

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,  -- bcrypt hash
  name VARCHAR(255),

  -- Access control
  role VARCHAR(20) DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  resort_access INTEGER[],              -- Array of resort IDs they can manage

  -- Security
  api_key VARCHAR(64) UNIQUE,           -- For API access (optional)
  last_login TIMESTAMP,
  login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,               -- Account lockout after failed logins
  active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_admin_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_api_key ON admin_users(api_key);
CREATE INDEX IF NOT EXISTS idx_admin_active ON admin_users(active);

-- Comments
COMMENT ON TABLE admin_users IS 'Admin users with JWT authentication';
COMMENT ON COLUMN admin_users.password_hash IS 'bcrypt hash - never store plaintext passwords';
COMMENT ON COLUMN admin_users.role IS 'admin = single resort, super_admin = all resorts';
COMMENT ON COLUMN admin_users.resort_access IS 'Array of resort IDs this admin can manage';
COMMENT ON COLUMN admin_users.api_key IS 'Optional API key for programmatic access';


-- ============================================
-- AUDIT_LOG TABLE (Track all admin changes)
-- ============================================
-- Complete audit trail of all admin actions.
-- Critical for debugging and accountability.

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,

  -- What changed
  table_name VARCHAR(100) NOT NULL,
  record_id INTEGER,
  action VARCHAR(20) NOT NULL CHECK (action IN (
    'insert',
    'update',
    'delete',
    'google_sync',
    'bulk_update'
  )),

  -- Change details (JSONB for flexibility)
  old_values JSONB,
  new_values JSONB,

  -- Context
  ip_address INET,
  user_agent TEXT,
  request_path VARCHAR(500),

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- Comments
COMMENT ON TABLE audit_log IS 'Complete audit trail of all admin actions';
COMMENT ON COLUMN audit_log.old_values IS 'JSON of field values before change';
COMMENT ON COLUMN audit_log.new_values IS 'JSON of field values after change';
