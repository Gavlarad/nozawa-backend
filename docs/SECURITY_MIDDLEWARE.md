# Security Middleware Documentation

## Overview

Comprehensive security implementation protecting the Nozawa backend API from common web vulnerabilities and attacks. This includes rate limiting, CORS configuration, input validation, security headers, and IP blocking.

## Security Features Implemented

### 1. Rate Limiting (DDoS & Brute Force Protection)

**Three-tiered rate limiting system:**

#### Authentication Rate Limiter
- **Endpoint**: `/api/admin/login`
- **Window**: 15 minutes
- **Limit**: 5 attempts
- **Purpose**: Prevent brute force password attacks
- **Response**: HTTP 429 with retry-after info

#### Admin Rate Limiter
- **Endpoints**: All `/api/admin/*` routes
- **Window**: 5 minutes
- **Limit**: 50 requests
- **Purpose**: Prevent admin endpoint abuse
- **Response**: HTTP 429 with retry-after info

#### API Rate Limiter
- **Endpoints**: Public API endpoints (`/api/places`, `/api/restaurants`, `/api/groups/*`)
- **Window**: 1 minute
- **Limit**: 100 requests per IP
- **Purpose**: Prevent API abuse and DDoS
- **Response**: HTTP 429 with retry-after info

**Rate Limit Headers:**
All responses include:
- `RateLimit-Limit`: Maximum requests allowed
- `RateLimit-Remaining`: Requests remaining in window
- `RateLimit-Reset`: When the limit resets (Unix timestamp)

### 2. CORS (Cross-Origin Resource Sharing)

**Environment-based configuration:**

**Development Mode:**
- Allows localhost ports: 3000, 3001, 5173, 8080
- Allows 127.0.0.1 variants
- Useful for local frontend development

**Production Mode:**
- Whitelist only:
  - `https://nozawa.app`
  - `https://www.nozawa.app`
  - Your Railway frontend URL
- Blocks all other origins
- Logs blocked origins for monitoring

**CORS Settings:**
- **Credentials**: Enabled (allows cookies)
- **Methods**: GET, POST, PUT, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization
- **Exposed Headers**: Rate limit information
- **Preflight Cache**: 24 hours

**To add production frontend URLs:**
```javascript
// In middleware/security.js
const productionOrigins = [
  'https://nozawa.app',
  'https://www.nozawa.app',
  'https://your-frontend.railway.app', // Add your URL here
];
```

### 3. Input Validation

**Validation Rules:**

#### Login Validation
```javascript
POST /api/admin/login
{
  "email": "admin@nozawa.com",  // Must be valid email format
  "password": "password123"      // Min 8 characters
}
```

**Validation Rules:**
- Email: Must be valid format, normalized
- Password: Minimum 8 characters, required

#### Group Creation Validation
```javascript
POST /api/groups/create
{
  "deviceId": "device-123",  // Required, max 255 chars
  "userName": "John Doe"     // Required, 1-100 chars
}
```

**Validation Rules:**
- deviceId: Required, trimmed, max 255 characters
- userName: Required, trimmed, 1-100 characters

#### Check-in Validation
```javascript
POST /api/groups/:code/checkin
{
  "deviceId": "device-123",  // Required
  "userName": "John Doe",    // Required
  "placeId": "place-456",    // Required
  "placeName": "Ramen Shop" // Required
}
```

**Validation Rules:**
- All fields required
- All fields trimmed
- Cannot be empty strings

**Validation Error Response:**
```json
{
  "error": "Validation failed",
  "message": "Invalid input data",
  "details": [
    {
      "field": "email",
      "message": "Valid email is required",
      "value": "notanemail"
    }
  ]
}
```

### 4. Security Headers (Helmet.js)

**Headers Applied:**

#### Content Security Policy (CSP)
- Restricts resource loading to same origin
- Blocks inline scripts (XSS protection)
- Allows HTTPS images for maps/photos
- Blocks iframes (clickjacking protection)

#### HTTP Strict Transport Security (HSTS)
- Enforces HTTPS for 1 year
- Includes subdomains
- Preload enabled

#### X-Content-Type-Options
- Set to `nosniff`
- Prevents MIME type sniffing attacks

#### X-Frame-Options
- Set to `DENY`
- Prevents clickjacking

#### Referrer Policy
- Set to `strict-origin-when-cross-origin`
- Privacy protection for referrer headers

#### Cross-Origin Policies
- `Cross-Origin-Embedder-Policy`: false (allows external resources)
- `Cross-Origin-Resource-Policy`: cross-origin (allows sharing)

**Security Headers in Action:**
```bash
curl -I http://localhost:3000/api/health

HTTP/1.1 200 OK
X-DNS-Prefetch-Control: off
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-XSS-Protection: 0
Cross-Origin-Resource-Policy: cross-origin
Referrer-Policy: strict-origin-when-cross-origin
```

### 5. IP Blocking (Optional)

**Manual IP blocking capability:**

```javascript
// In middleware/security.js
const blockedIPs = new Set([
  '192.168.1.100',  // Add malicious IPs here
  '10.0.0.50',
]);
```

**Features:**
- Blocks specific IP addresses
- Logs all blocked attempts
- Returns HTTP 403 (Forbidden)
- Useful for banning abusive clients

**To block an IP:**
1. Identify IP from logs
2. Add to `blockedIPs` Set in `middleware/security.js`
3. Restart server
4. IP will receive 403 on all requests

### 6. Proxy Trust Configuration

**Railway deployment support:**

```javascript
app.set('trust proxy', 1);
```

**Why this matters:**
- Railway uses reverse proxy
- Without this, all IPs appear as Railway's proxy IP
- With this, actual client IPs are used for rate limiting
- Essential for accurate rate limiting by IP

## File Structure

```
middleware/
├── auth.js              # JWT authentication
└── security.js          # Security middleware (NEW)
    ├── Rate limiters
    ├── CORS configuration
    ├── Input validators
    ├── Helmet config
    └── IP blocker
```

## Protected Endpoints

### Public Endpoints (API Rate Limited)
- `GET /api/places`
- `GET /api/restaurants`
- `GET /api/restaurants/:id`
- `GET /api/restaurants/stats`
- `GET /api/weather/*`
- `GET /api/lifts/*`
- `GET /api/groups/:code`
- `POST /api/groups/create` (validated)
- `POST /api/groups/:code/checkin` (validated)
- `POST /api/groups/:code/checkout`

### Admin Endpoints (Admin Rate Limited + JWT Auth)
- `POST /api/admin/login` (auth rate limited + validated)
- `POST /api/admin/reload-data`
- `GET /api/admin/places-data`
- `POST /api/admin/save-places`

### Unprotected Endpoints
- `GET /` (root, API documentation)
- `GET /api/health` (health check)

## Testing

### Test Suite: test-security.sh

**Automated tests for:**
1. Input validation (email format, password length)
2. Security headers (Helmet)
3. Rate limiting (login attempts)
4. Form validation (groups, check-ins)

**Run tests:**
```bash
chmod +x test-security.sh
./test-security.sh
```

**Expected output:**
```
✓ PASS - Correctly rejected invalid email
✓ PASS - Correctly rejected short password
✓ PASS - Valid login successful
✓ PASS - Security headers present
✓ PASS - HSTS header present
✓ PASS - Request rate limited (HTTP 429)
✓ PASS - Empty fields correctly rejected
✓ PASS - Invalid check-in rejected
```

### Manual Testing

**Test rate limiting:**
```bash
# Make 6 rapid login attempts (limit is 5)
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/admin/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"12345678"}'
  echo "Attempt $i"
  sleep 0.5
done

# 6th attempt should return HTTP 429
```

**Test CORS:**
```bash
# From different origin (should be blocked in production)
curl -X GET http://localhost:3000/api/places \
  -H "Origin: https://malicious-site.com"

# Should see CORS error in browser console
```

**Test validation:**
```bash
# Invalid email
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"notanemail","password":"12345678"}'

# Expected: {"error":"Validation failed",...}
```

**Test security headers:**
```bash
curl -I http://localhost:3000/api/health

# Should see:
# X-Content-Type-Options: nosniff
# Strict-Transport-Security: max-age=31536000
# X-Frame-Options: SAMEORIGIN
```

## Security Best Practices

### 1. Monitor Rate Limit Logs

Check server logs for:
```
Rate limit exceeded for IP: 123.45.67.89
CORS blocked origin: https://suspicious-site.com
Blocked access from IP: 192.168.1.100
```

### 2. Adjust Rate Limits

Based on traffic patterns, you may need to adjust:

```javascript
// middleware/security.js

// Increase for high-traffic apps
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200, // Increase from 100
});

// Decrease for stricter security
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3, // Decrease from 5
});
```

### 3. Update CORS Whitelist

When deploying new frontends:

```javascript
const productionOrigins = [
  'https://nozawa.app',
  'https://www.nozawa.app',
  'https://nozawa-frontend-v2.railway.app', // Add new URLs
];
```

### 4. Regular Security Audits

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Fix vulnerabilities
npm audit fix
```

### 5. Monitor Failed Requests

Set up alerts for:
- High rate of 429 responses (potential DDoS)
- Many 401 responses (potential brute force)
- CORS blocks from unknown origins (potential scraping)

## Common Issues & Solutions

### Issue: Rate limit triggering too early

**Symptom**: Legitimate users getting HTTP 429

**Solution**: Increase rate limits
```javascript
const apiLimiter = rateLimit({
  max: 200, // Increase limit
});
```

### Issue: Frontend can't connect (CORS error)

**Symptom**: Browser console shows CORS error

**Solution**: Add frontend URL to whitelist
```javascript
const productionOrigins = [
  'https://your-frontend.com', // Add this
];
```

### Issue: Can't test locally

**Symptom**: CORS blocks localhost

**Solution**: Set NODE_ENV=development
```bash
# .env file
NODE_ENV=development
```

### Issue: Rate limits persist after restart

**Symptom**: Still rate limited after server restart

**Explanation**: Rate limits are in-memory, reset on restart
**Solution**: Wait for window to expire OR restart server

## Advanced Configuration

### Custom Rate Limit per Endpoint

```javascript
// Define custom rate limiter
const customLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 requests
});

// Apply to specific endpoint
app.post('/api/expensive-operation', customLimiter, async (req, res) => {
  // Handle request
});
```

### Dynamic Rate Limits

```javascript
const dynamicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    // Admins get higher limits
    if (req.admin && req.admin.role === 'super_admin') {
      return 1000;
    }
    return 100;
  }
});
```

### Skip Rate Limiting

```javascript
const apiLimiter = rateLimit({
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  }
});
```

## Production Checklist

Before deploying to production:

- [ ] Set `NODE_ENV=production` in Railway environment
- [ ] Update CORS whitelist with production frontend URLs
- [ ] Review and adjust rate limits for expected traffic
- [ ] Set up monitoring for security events
- [ ] Enable HTTPS (required for HSTS)
- [ ] Test all endpoints with security middleware
- [ ] Document any blocked IPs
- [ ] Set up log aggregation for security analysis
- [ ] Configure alerts for unusual patterns
- [ ] Review and update security headers if needed

## Migration Notes

### Changes from Previous Version

**Before (No Security):**
- No rate limiting
- Open CORS (all origins allowed)
- No input validation
- No security headers
- No IP blocking

**After (Secured):**
- Rate limiting on all key endpoints
- CORS whitelist by environment
- Input validation on forms
- Helmet security headers
- Optional IP blocking

**Breaking Changes:**
- None - All security features are additive
- Existing API calls will work
- Validation may reject malformed requests that previously succeeded

## Dependencies

```json
{
  "helmet": "^8.1.0",              // Security headers
  "express-rate-limit": "^8.2.1",  // Rate limiting
  "express-validator": "^7.3.1"    // Input validation
}
```

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [Express Rate Limit](https://github.com/express-rate-limit/express-rate-limit)
- [Express Validator](https://express-validator.github.io/)
- [CORS Best Practices](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

**Version:** 1.0
**Last Updated:** 2025-11-29
**Status:** Production Ready
