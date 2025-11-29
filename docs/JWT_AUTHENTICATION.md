# JWT Authentication Implementation

## Overview

The Nozawa backend now uses JWT (JSON Web Tokens) for secure admin authentication, replacing the hardcoded password system. This provides:
- Secure, stateless authentication
- 24-hour token expiry
- Role-based access control
- Audit trail of admin actions

## Files Created/Modified

### New Files
1. **middleware/auth.js** - JWT authentication middleware
2. **docs/JWT_AUTHENTICATION.md** - This documentation

### Modified Files
1. **server.js** - Added login endpoint and JWT-protected routes
2. **.env** - Added JWT_SECRET environment variable

## API Endpoints

### 1. Admin Login
**POST /api/admin/login**

Authenticates admin and returns JWT token.

**Request:**
```json
{
  "email": "admin@nozawa.com",
  "password": "YourPassword"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "admin": {
    "id": 1,
    "email": "admin@nozawa.com",
    "name": "Admin User",
    "role": "super_admin",
    "resortAccess": [1]
  },
  "expiresIn": "24h"
}
```

**Error Responses:**
- **400**: Missing credentials
- **401**: Invalid email/password
- **403**: Account disabled
- **500**: Server error

### 2. Protected Admin Endpoints

All admin endpoints now require JWT authentication:
- **POST /api/admin/reload-data**
- **GET /api/admin/places-data**
- **POST /api/admin/save-places**

**Authorization Header:**
```
Authorization: Bearer <your_jwt_token>
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/admin/places-data \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Usage Examples

### JavaScript (Fetch API)

```javascript
// 1. Login
const loginResponse = await fetch('http://localhost:3000/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@nozawa.com',
    password: 'YourPassword'
  })
});

const { token } = await loginResponse.json();

// 2. Use token for authenticated requests
const placesResponse = await fetch('http://localhost:3000/api/admin/places-data', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const placesData = await placesResponse.json();
```

### cURL

```bash
# 1. Login and save token
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"YourPassword"}' \
  | jq -r '.token')

# 2. Use token
curl -X GET http://localhost:3000/api/admin/places-data \
  -H "Authorization: Bearer $TOKEN"
```

## Security Features

### 1. Password Hashing
- Passwords stored with bcrypt (10 salt rounds)
- Never stored in plaintext
- Secure password verification

### 2. Token Expiry
- Tokens expire after 24 hours
- Must re-login after expiry
- Prevents long-term token theft

### 3. Account Status
- Admin accounts can be deactivated
- Deactivated accounts cannot login
- Existing tokens become invalid

### 4. Audit Trail
- All admin logins logged
- Admin actions include email address
- Trackable changes to data

## Environment Variables

Add to `.env` file:

```bash
JWT_SECRET=your_secure_secret_key_here
DATABASE_URL=postgresql://...
```

**Important:**
- Never commit `.env` to git
- Use a strong, random JWT_SECRET in production
- Change JWT_SECRET regularly

## Admin User Management

### Create New Admin
```bash
node scripts/createAdminUser-simple.js "email@example.com" "Full Name" "SecurePassword123"
```

### Check Existing Admins
```sql
SELECT id, email, name, role, active
FROM admin_users
ORDER BY created_at DESC;
```

### Deactivate Admin
```sql
UPDATE admin_users
SET active = false
WHERE email = 'admin@example.com';
```

### Reactivate Admin
```sql
UPDATE admin_users
SET active = true
WHERE email = 'admin@example.com';
```

## Frontend Integration

### Store Token Securely
```javascript
// Store in memory (recommended for SPA)
let authToken = null;

async function login(email, password) {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();
  authToken = data.token;
  return data;
}

// Use token in requests
async function fetchProtectedData() {
  const response = await fetch('/api/admin/places-data', {
    headers: {
      'Authorization': `Bearer ${authToken}`
    }
  });
  return response.json();
}
```

### Handle Token Expiry
```javascript
async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${authToken}`
    }
  });

  if (response.status === 401) {
    // Token expired, redirect to login
    window.location.href = '/admin/login';
    return;
  }

  return response.json();
}
```

## Troubleshooting

### "No authorization header"
- Missing Authorization header
- Add: `Authorization: Bearer <token>`

### "Invalid token"
- Token is malformed or incorrect
- Token may have been tampered with
- Re-login to get new token

### "Token expired"
- Token has exceeded 24-hour lifetime
- Login again to get fresh token

### "Invalid credentials"
- Wrong email or password
- Check credentials and try again

### "Account disabled"
- Admin account has been deactivated
- Contact super admin to reactivate

## Next Steps

The following enhancements are planned:
1. Rate limiting on login endpoint
2. Password reset functionality
3. Multi-factor authentication (MFA)
4. Refresh tokens for extended sessions
5. IP-based security restrictions

## Testing

### Test Login
```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}'
```

### Test Protected Endpoint (Should Fail)
```bash
curl -X GET http://localhost:3000/api/admin/places-data
# Expected: {"error":"No authorization header",...}
```

### Test with Token (Should Succeed)
```bash
curl -X GET http://localhost:3000/api/admin/places-data \
  -H "Authorization: Bearer <your_token>"
# Expected: {"success":true,"data":{...}}
```

## Migration Notes

### Old System (Hardcoded Password)
```javascript
// OLD - Don't use anymore
const { admin_key } = req.body;
if (admin_key !== 'nozawa2024') {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### New System (JWT)
```javascript
// NEW - Use this approach
app.get('/api/admin/endpoint', authenticateAdmin, (req, res) => {
  // req.admin contains authenticated admin info
  console.log(`Request by: ${req.admin.email}`);
});
```

## Security Best Practices

1. **Never log tokens** - Keep JWTs out of logs
2. **Use HTTPS in production** - Prevent token interception
3. **Rotate JWT_SECRET** - Change periodically
4. **Strong passwords** - Require 12+ characters, mixed case, symbols
5. **Monitor admin activity** - Review audit logs regularly

---

**Generated:** 2025-11-29
**Version:** 1.0
**Status:** Production Ready
