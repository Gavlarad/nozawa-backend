/**
 * JWT Authentication Middleware
 *
 * Protects admin endpoints by verifying JWT tokens.
 * Token should be sent in Authorization header: "Bearer <token>"
 */

const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('⚠️  WARNING: JWT_SECRET not set in environment variables!');
}

/**
 * Middleware to verify JWT token
 *
 * Usage: app.get('/api/admin/route', authenticateAdmin, (req, res) => {...})
 */
function authenticateAdmin(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'No authorization header',
        message: 'Please provide a valid JWT token'
      });
    }

    // Expected format: "Bearer <token>"
    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        error: 'Invalid authorization header format',
        message: 'Format should be: Bearer <token>'
      });
    }

    const token = parts[1];

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Attach admin info to request object for use in route handlers
    req.admin = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      resortAccess: decoded.resortAccess
    };

    // Continue to the route handler
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'The provided token is invalid'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.'
      });
    }

    return res.status(500).json({
      error: 'Authentication error',
      message: error.message
    });
  }
}

/**
 * Optional middleware to verify super admin role
 * Use after authenticateAdmin middleware
 */
function requireSuperAdmin(req, res, next) {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Super admin access required'
    });
  }
  next();
}

module.exports = {
  authenticateAdmin,
  requireSuperAdmin
};
