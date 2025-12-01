/**
 * Security Middleware Configuration
 *
 * Implements comprehensive security measures:
 * - Rate limiting (prevent brute force and DDoS)
 * - CORS configuration (control cross-origin access)
 * - Security headers (helmet.js)
 * - Input validation helpers
 */

const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

// ============================================
// RATE LIMITING
// ============================================

/**
 * Strict rate limiter for authentication endpoints
 * Prevents brute force attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many login attempts',
    message: 'Please try again after 15 minutes',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skipSuccessfulRequests: false, // Count successful requests too
  handler: (req, res) => {
    console.log(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many login attempts',
      message: 'Please try again after 15 minutes',
      retryAfter: '15 minutes'
    });
  }
});

/**
 * General API rate limiter
 * Prevents abuse of public endpoints
 */
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: {
    error: 'Too many requests',
    message: 'Please slow down and try again shortly',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`API rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please slow down and try again shortly',
      retryAfter: '1 minute'
    });
  }
});

/**
 * Admin endpoint rate limiter
 * More restrictive for admin operations
 */
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes
  message: {
    error: 'Too many admin requests',
    message: 'Please wait a few minutes before continuing',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false,
  handler: (req, res) => {
    console.log(`Admin rate limit exceeded for: ${req.admin?.email || req.ip}`);
    res.status(429).json({
      error: 'Too many admin requests',
      message: 'Please wait a few minutes before continuing',
      retryAfter: '5 minutes'
    });
  }
});

// ============================================
// CORS CONFIGURATION
// ============================================

/**
 * CORS configuration based on environment
 * Production: Whitelist specific origins
 * Development: Allow localhost
 */
const getCorsOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';

  // Production whitelist (update with your actual frontend domains)
  const productionOrigins = [
    'https://nozawa.app',
    'https://www.nozawa.app',
    'https://nozawa-frontend.railway.app',
    'https://nozawa-backend-production.up.railway.app', // Allow Railway backend itself (for admin.html)
    'null', // Allow local file:// access for admin.html
    // Add your Railway frontend URL here
  ];

  // Development origins
  const developmentOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173', // Vite default
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'null', // Allow local file:// access
  ];

  const allowedOrigins = isProduction ? productionOrigins : developmentOrigins;

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      // Allow null origin (local file:// URLs) or whitelisted origins
      if (origin === 'null' || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      }
    },
    credentials: true, // Allow cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 86400 // Cache preflight requests for 24 hours
  };
};

// ============================================
// INPUT VALIDATION
// ============================================

/**
 * Validation rules for login endpoint
 */
const validateLogin = [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

/**
 * Validation rules for creating groups
 */
const validateGroupCreation = [
  body('deviceId')
    .trim()
    .notEmpty()
    .withMessage('Device ID is required')
    .isLength({ max: 255 })
    .withMessage('Device ID too long'),
  body('userName')
    .trim()
    .notEmpty()
    .withMessage('User name is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('User name must be 1-100 characters'),
];

/**
 * Validation rules for check-ins
 */
const validateCheckin = [
  body('deviceId')
    .trim()
    .notEmpty()
    .withMessage('Device ID is required'),
  body('userName')
    .trim()
    .notEmpty()
    .withMessage('User name is required'),
  body('placeId')
    .trim()
    .notEmpty()
    .withMessage('Place ID is required'),
  body('placeName')
    .trim()
    .notEmpty()
    .withMessage('Place name is required'),
];

/**
 * Middleware to check validation results
 * Use after validation rules
 */
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Invalid input data',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }

  next();
};

/**
 * Sanitize user input to prevent XSS
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  return str
    .replace(/[<>]/g, '') // Remove < and >
    .trim()
    .substring(0, 1000); // Limit length
};

// ============================================
// SECURITY HEADERS (Helmet Configuration)
// ============================================

/**
 * Helmet configuration for security headers
 */
const getHelmetOptions = () => {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for admin.html
        scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onsubmit, onclick, etc.)
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow external resources
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  };
};

// ============================================
// IP BLOCKING (Optional)
// ============================================

/**
 * Blocked IPs list (for manual blocking)
 * Update this list to block specific IPs
 */
const blockedIPs = new Set([
  // Add IPs to block here
  // '192.168.1.1',
]);

/**
 * Middleware to block specific IPs
 */
const ipBlocker = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;

  if (blockedIPs.has(clientIP)) {
    console.warn(`Blocked access from IP: ${clientIP}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address has been blocked'
    });
  }

  next();
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Rate limiters
  authLimiter,
  apiLimiter,
  adminLimiter,

  // CORS
  getCorsOptions,

  // Validation
  validateLogin,
  validateGroupCreation,
  validateCheckin,
  checkValidation,
  sanitizeString,

  // Helmet
  getHelmetOptions,

  // IP blocking
  ipBlocker,
  blockedIPs,
};
