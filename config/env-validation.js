/**
 * Environment Variable Validation
 *
 * Validates that all required environment variables are present
 * and properly formatted before the application starts.
 *
 * This prevents runtime errors from missing configuration.
 */

require('dotenv').config();

/**
 * Required environment variables
 * Application will not start if these are missing
 */
const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GOOGLE_PLACES_API_KEY',
];

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_VARS = {
  NODE_ENV: 'development',
  PORT: '3000',
  JWT_EXPIRY: '24h',
  LOG_LEVEL: 'info',
  ENABLE_REQUEST_LOGGING: 'true',
  ENABLE_DUAL_WRITE: 'false',
  ENABLE_POSTGRES_READ: 'false',
  AUTH_RATE_LIMIT_MAX: '5',
  AUTH_RATE_LIMIT_WINDOW_MS: '900000', // 15 minutes
  API_RATE_LIMIT_MAX: '100',
  API_RATE_LIMIT_WINDOW_MS: '60000', // 1 minute
  ADMIN_RATE_LIMIT_MAX: '50',
  ADMIN_RATE_LIMIT_WINDOW_MS: '300000', // 5 minutes
};

/**
 * Validation rules for specific variables
 */
const VALIDATION_RULES = {
  DATABASE_URL: (value) => {
    if (!value.startsWith('postgres://') && !value.startsWith('postgresql://')) {
      return 'DATABASE_URL must start with postgres:// or postgresql://';
    }
    return null;
  },

  JWT_SECRET: (value) => {
    if (value.length < 32) {
      return 'JWT_SECRET must be at least 32 characters for security';
    }
    if (value.includes('change') || value.includes('example') || value.includes('your_')) {
      return 'JWT_SECRET appears to be a placeholder - please use a real secret';
    }
    return null;
  },

  NODE_ENV: (value) => {
    const valid = ['development', 'production', 'test'];
    if (!valid.includes(value)) {
      return `NODE_ENV must be one of: ${valid.join(', ')}`;
    }
    return null;
  },

  PORT: (value) => {
    const port = parseInt(value);
    if (isNaN(port) || port < 1 || port > 65535) {
      return 'PORT must be a number between 1 and 65535';
    }
    return null;
  },
};

/**
 * Validate all environment variables
 * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
 */
function validateEnvironment() {
  const errors = [];
  const warnings = [];
  const config = {};

  // Check required variables
  for (const varName of REQUIRED_VARS) {
    const value = process.env[varName];

    if (!value) {
      errors.push(`Missing required environment variable: ${varName}`);
      continue;
    }

    // Apply specific validation rules
    if (VALIDATION_RULES[varName]) {
      const error = VALIDATION_RULES[varName](value);
      if (error) {
        errors.push(`${varName}: ${error}`);
      }
    }

    config[varName] = value;
  }

  // Apply defaults for optional variables
  for (const [varName, defaultValue] of Object.entries(OPTIONAL_VARS)) {
    const value = process.env[varName] || defaultValue;

    // Apply specific validation rules
    if (VALIDATION_RULES[varName]) {
      const error = VALIDATION_RULES[varName](value);
      if (error) {
        errors.push(`${varName}: ${error}`);
      }
    }

    config[varName] = value;

    // Warn if using default
    if (!process.env[varName]) {
      warnings.push(`Using default for ${varName}: ${defaultValue}`);
    }
  }

  // Security warnings
  if (config.NODE_ENV === 'production') {
    if (!config.DATABASE_URL.includes('ssl')) {
      warnings.push('Production database URL should use SSL');
    }

    if (config.JWT_SECRET.length < 64) {
      warnings.push('JWT_SECRET should be at least 64 characters in production');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config
  };
}

/**
 * Print validation results
 */
function printValidationResults(results) {
  console.log('\n' + '='.repeat(50));
  console.log('ENVIRONMENT VALIDATION');
  console.log('='.repeat(50));

  console.log(`\nEnvironment: ${process.env.NODE_ENV || 'development'}`);

  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    results.errors.forEach(error => {
      console.log(`   - ${error}`);
    });
  }

  if (results.warnings.length > 0 && process.env.LOG_LEVEL !== 'error') {
    console.log('\n⚠️  WARNINGS:');
    results.warnings.forEach(warning => {
      console.log(`   - ${warning}`);
    });
  }

  if (results.valid) {
    console.log('\n✅ All required environment variables are set');
  } else {
    console.log('\n❌ Environment validation failed - see errors above');
    console.log('\n💡 TIP: Copy .env.example to .env and fill in your values');
  }

  console.log('='.repeat(50) + '\n');
}

/**
 * Validate and exit if invalid
 * Call this at the start of your application
 */
function validateOrExit() {
  const results = validateEnvironment();
  printValidationResults(results);

  if (!results.valid) {
    console.error('Cannot start application with invalid environment configuration');
    process.exit(1);
  }

  return results.config;
}

/**
 * Get a config value with type conversion
 */
function getConfig(key, type = 'string') {
  const value = process.env[key];

  switch (type) {
    case 'number':
      return parseInt(value) || 0;
    case 'boolean':
      return value === 'true' || value === '1';
    case 'array':
      return value ? value.split(',').map(v => v.trim()) : [];
    default:
      return value;
  }
}

/**
 * Get all config as typed object
 */
function getTypedConfig() {
  return {
    // Application
    nodeEnv: getConfig('NODE_ENV'),
    port: getConfig('PORT', 'number'),

    // Database
    databaseUrl: getConfig('DATABASE_URL'),

    // Authentication
    jwtSecret: getConfig('JWT_SECRET'),
    jwtExpiry: getConfig('JWT_EXPIRY'),

    // External APIs
    googlePlacesApiKey: getConfig('GOOGLE_PLACES_API_KEY'),

    // CORS
    allowedOrigins: getConfig('ALLOWED_ORIGINS', 'array'),

    // Rate Limiting
    authRateLimit: {
      max: getConfig('AUTH_RATE_LIMIT_MAX', 'number'),
      windowMs: getConfig('AUTH_RATE_LIMIT_WINDOW_MS', 'number'),
    },
    apiRateLimit: {
      max: getConfig('API_RATE_LIMIT_MAX', 'number'),
      windowMs: getConfig('API_RATE_LIMIT_WINDOW_MS', 'number'),
    },
    adminRateLimit: {
      max: getConfig('ADMIN_RATE_LIMIT_MAX', 'number'),
      windowMs: getConfig('ADMIN_RATE_LIMIT_WINDOW_MS', 'number'),
    },

    // Logging
    logLevel: getConfig('LOG_LEVEL'),
    enableRequestLogging: getConfig('ENABLE_REQUEST_LOGGING', 'boolean'),

    // Feature Flags
    enableDualWrite: getConfig('ENABLE_DUAL_WRITE', 'boolean'),
    enablePostgresRead: getConfig('ENABLE_POSTGRES_READ', 'boolean'),
  };
}

module.exports = {
  validateEnvironment,
  validateOrExit,
  printValidationResults,
  getConfig,
  getTypedConfig,
};
