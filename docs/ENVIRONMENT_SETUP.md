# Environment Variables Setup Guide

## Overview

This guide covers all environment variables required and optional for the Nozawa backend application. Proper configuration is essential for security and functionality.

## Quick Start

### 1. Copy Template

```bash
cp .env.example .env
```

### 2. Generate Secrets

**JWT Secret (required):**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output and paste it as your `JWT_SECRET` in `.env`.

### 3. Fill in Values

Edit `.env` and replace all placeholder values with real credentials.

### 4. Validate

Start the server - it will automatically validate your environment:

```bash
npm start
```

If any required variables are missing or invalid, you'll see an error and the server won't start.

## Required Variables

### DATABASE_URL
**PostgreSQL connection string**

```bash
DATABASE_URL=postgresql://user:password@host:port/database
```

**Where to get it:**
- Railway dashboard → your PostgreSQL service → Connect → Connection String
- Make sure to use the PUBLIC connection string (not internal)

**Format:**
- Must start with `postgres://` or `postgresql://`
- Include username, password, host, port, and database name

**Example:**
```bash
DATABASE_URL=postgresql://postgres:abc123@metro.proxy.rlwy.net:49069/railway
```

### JWT_SECRET
**Secret key for signing JWT tokens**

```bash
JWT_SECRET=your_64_character_random_hex_string_here
```

**Security requirements:**
- **Minimum 32 characters** (64+ recommended)
- Must be cryptographically random
- NEVER use example/placeholder values in production
- Change regularly (e.g., monthly)

**Generate securely:**
```bash
# Option 1: Node.js (recommended)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Option 2: OpenSSL
openssl rand -hex 64

# Option 3: Online (use with caution)
# https://www.grc.com/passwords.htm
```

**CRITICAL:**
- Never commit to git
- Never share publicly
- Rotate if compromised
- Use different secrets for dev/production

### GOOGLE_PLACES_API_KEY
**Google Places API key for accommodation search**

```bash
GOOGLE_PLACES_API_KEY=AIza...your_key_here
```

**Where to get it:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable "Places API"
4. Create credentials → API Key
5. Restrict key to Places API only (security best practice)

**Security:**
- Restrict by IP or HTTP referrer
- Set usage quotas to prevent abuse
- Monitor usage regularly

## Optional Variables (with Defaults)

### Application Settings

#### NODE_ENV
**Application environment**

```bash
NODE_ENV=development  # or 'production' or 'test'
```

**Default:** `development`

**Effects:**
- `development`: Allows localhost CORS, verbose logging, lenient security
- `production`: Strict CORS whitelist, minimal logging, enhanced security
- `test`: Special mode for automated testing

#### PORT
**Server port**

```bash
PORT=3000
```

**Default:** `3000`

**Railway note:** Railway automatically sets this, don't override in production

### Authentication Settings

#### JWT_EXPIRY
**How long JWT tokens remain valid**

```bash
JWT_EXPIRY=24h
```

**Default:** `24h`

**Formats:**
- `60` (60 seconds)
- `10m` (10 minutes)
- `24h` (24 hours)
- `7d` (7 days)

**Recommendations:**
- Development: `24h` or `7d` (convenience)
- Production: `1h` to `24h` (security vs. UX)
- Never exceed `30d` for security

### CORS Settings

#### ALLOWED_ORIGINS
**Comma-separated list of allowed frontend URLs**

```bash
ALLOWED_ORIGINS=https://nozawa.app,https://www.nozawa.app,https://nozawa-frontend.railway.app
```

**Default:** None (uses hardcoded list in `middleware/security.js`)

**Format:**
- Comma-separated, no spaces
- Include protocol (https://)
- Include all subdomains separately
- No trailing slashes

**Example:**
```bash
# Multiple origins
ALLOWED_ORIGINS=https://nozawa.app,https://www.nozawa.app,https://admin.nozawa.app

# Local development (if needed)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Rate Limiting

All rate limits are optional with sensible defaults.

#### AUTH_RATE_LIMIT_MAX
**Maximum login attempts per window**

```bash
AUTH_RATE_LIMIT_MAX=5
```

**Default:** `5`

**Purpose:** Prevent brute force password attacks

#### AUTH_RATE_LIMIT_WINDOW_MS
**Login rate limit window in milliseconds**

```bash
AUTH_RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
```

**Default:** `900000` (15 minutes)

#### API_RATE_LIMIT_MAX
**Maximum API requests per window**

```bash
API_RATE_LIMIT_MAX=100
```

**Default:** `100`

**Purpose:** Prevent API abuse and DDoS

#### API_RATE_LIMIT_WINDOW_MS
**API rate limit window in milliseconds**

```bash
API_RATE_LIMIT_WINDOW_MS=60000  # 1 minute
```

**Default:** `60000` (1 minute)

#### ADMIN_RATE_LIMIT_MAX
**Maximum admin requests per window**

```bash
ADMIN_RATE_LIMIT_MAX=50
```

**Default:** `50`

#### ADMIN_RATE_LIMIT_WINDOW_MS
**Admin rate limit window in milliseconds**

```bash
ADMIN_RATE_LIMIT_WINDOW_MS=300000  # 5 minutes
```

**Default:** `300000` (5 minutes)

### Logging

#### LOG_LEVEL
**Logging verbosity**

```bash
LOG_LEVEL=info
```

**Default:** `info`

**Options:**
- `error`: Only errors
- `warn`: Warnings and errors
- `info`: Normal operations (recommended for production)
- `debug`: Detailed debugging (development only)

#### ENABLE_REQUEST_LOGGING
**Log all HTTP requests**

```bash
ENABLE_REQUEST_LOGGING=true
```

**Default:** `true`

**Values:** `true` or `false`

### Feature Flags

#### ENABLE_DUAL_WRITE
**Write to both JSON and PostgreSQL**

```bash
ENABLE_DUAL_WRITE=false
```

**Default:** `false`

**Purpose:** Transition period feature - write to both data sources

**When to enable:**
- During PostgreSQL migration
- For safety net before fully switching
- Testing phase

#### ENABLE_POSTGRES_READ
**Read from PostgreSQL instead of JSON**

```bash
ENABLE_POSTGRES_READ=false
```

**Default:** `false`

**Purpose:** Gradually switch reads to PostgreSQL

## Environment-Specific Configurations

### Development (.env)

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/nozawa_dev
JWT_SECRET=dev_secret_at_least_32_characters_long_please
JWT_EXPIRY=7d
GOOGLE_PLACES_API_KEY=AIza...
LOG_LEVEL=debug
ENABLE_REQUEST_LOGGING=true
ENABLE_DUAL_WRITE=false
ENABLE_POSTGRES_READ=false
```

### Production (Railway Environment Variables)

**Set in Railway dashboard:**

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...railway.app...
JWT_SECRET=<64-char-random-hex>
JWT_EXPIRY=24h
GOOGLE_PLACES_API_KEY=AIza...
ALLOWED_ORIGINS=https://nozawa.app,https://www.nozawa.app
LOG_LEVEL=info
ENABLE_REQUEST_LOGGING=false
ENABLE_DUAL_WRITE=false
ENABLE_POSTGRES_READ=true
```

**Note:** PORT is automatically set by Railway, don't override.

## Validation

### Automatic Validation

The server automatically validates environment variables on startup using `config/env-validation.js`.

**What it checks:**
- All required variables are present
- DATABASE_URL format is correct
- JWT_SECRET is strong enough (min 32 chars)
- NODE_ENV is valid value
- PORT is valid number
- No placeholder values in production

**If validation fails:**
- Server prints detailed error messages
- Server exits with code 1 (won't start)
- You must fix errors before proceeding

**Example output:**
```
==================================================
ENVIRONMENT VALIDATION
==================================================

Environment: development

❌ ERRORS:
   - Missing required environment variable: JWT_SECRET
   - DATABASE_URL must start with postgres:// or postgresql://

⚠️  WARNINGS:
   - JWT_SECRET should be at least 64 characters in production
   - Using default for PORT: 3000

❌ Environment validation failed - see errors above

💡 TIP: Copy .env.example to .env and fill in your values
==================================================
```

### Manual Validation

Test your environment anytime:

```bash
node -e "require('./config/env-validation').validateOrExit()"
```

## Security Best Practices

### 1. Never Commit Secrets

**.gitignore already includes:**
```
.env
.env.local
.env.*.local
```

**Verify:**
```bash
git status  # .env should NOT appear
```

### 2. Rotate Secrets Regularly

**JWT_SECRET rotation:**
```bash
# Generate new secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Update .env
# Update Railway environment
# Restart server
# All existing tokens will be invalidated (users need to re-login)
```

**When to rotate:**
- Monthly (recommended)
- After suspected breach
- When team member leaves
- Before major deployment

### 3. Use Different Secrets

**Never use the same secrets for:**
- Development vs. Production
- Different environments
- Different applications

### 4. Restrict API Keys

**Google Places API:**
- Set IP restrictions (Railway IP)
- Set HTTP referrer restrictions
- Enable only required APIs
- Set daily quotas

### 5. Monitor Usage

**Check regularly:**
- Google API quota usage
- Database connection usage
- JWT token generation rate
- Rate limit violations

## Troubleshooting

### Server Won't Start

**Error: "Missing required environment variable: DATABASE_URL"**

**Solution:**
```bash
# Check .env file exists
ls -la .env

# Verify content
cat .env | grep DATABASE_URL

# If missing, add it
echo "DATABASE_URL=your_connection_string" >> .env
```

### Validation Fails

**Error: "JWT_SECRET appears to be a placeholder"**

**Solution:**
```bash
# Generate real secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Update .env with generated value
```

### CORS Errors in Production

**Error: "Origin not allowed by CORS policy"**

**Solution:**
```bash
# Add your frontend URL to ALLOWED_ORIGINS in Railway
ALLOWED_ORIGINS=https://your-frontend.com,https://www.your-frontend.com
```

### Rate Limits Too Strict

**Error: HTTP 429 Too Many Requests**

**Solution:**
```bash
# Increase limits in .env or Railway
API_RATE_LIMIT_MAX=200
API_RATE_LIMIT_WINDOW_MS=60000
```

## Railway Deployment

### Setting Environment Variables

1. Go to Railway dashboard
2. Select your backend service
3. Click "Variables" tab
4. Click "New Variable"
5. Add each variable one by one
6. Click "Deploy" to apply changes

### Required for Railway

```
NODE_ENV=production
DATABASE_URL=<from Railway PostgreSQL service>
JWT_SECRET=<64-char random hex>
GOOGLE_PLACES_API_KEY=<your API key>
ALLOWED_ORIGINS=<your frontend URLs>
```

### Viewing Current Variables

Railway dashboard → Service → Variables tab

### Updating Variables

Changes trigger automatic redeployment.

## Testing

### Test Environment Setup

```bash
# Create test environment file
cp .env .env.test

# Edit .env.test with test database
# Run tests with test env
NODE_ENV=test npm test
```

### Verify Configuration

```bash
# Test validation
node -e "require('./config/env-validation').validateOrExit()"

# Test server startup
npm start

# Check health endpoint
curl http://localhost:3000/api/health
```

## Migration from Old System

### Before (Hardcoded)

```javascript
// Old way - INSECURE
const JWT_SECRET = 'nozawa2024';
if (admin_key !== 'nozawa2024') {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### After (Environment Variables)

```javascript
// New way - SECURE
const JWT_SECRET = process.env.JWT_SECRET;
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY });
```

## FAQ

**Q: Can I use .env in production?**
A: No. Use Railway's environment variables feature instead.

**Q: How do I change JWT_SECRET without breaking everything?**
A: Update it in Railway, redeploy. All users will need to re-login (existing tokens become invalid).

**Q: What if I accidentally commit .env?**
A: 1. Immediately revoke all secrets, 2. Generate new ones, 3. Update Railway, 4. Remove .env from git history

**Q: Can I have multiple .env files?**
A: Yes. Use `.env.local`, `.env.development`, `.env.production`. The `.env.local` overrides `.env`.

**Q: How do I test with different environments?**
A: Use `NODE_ENV` to switch: `NODE_ENV=test npm start`

## Resources

- [dotenv documentation](https://github.com/motdotla/dotenv)
- [Railway environment variables](https://docs.railway.app/develop/variables)
- [OWASP Secret Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

---

**Last Updated:** 2025-11-29
**Version:** 1.0
**Status:** Production Ready
