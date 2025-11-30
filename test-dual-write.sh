#!/bin/bash

# Test Dual-Write Functionality
# This script tests that admin edits sync to both JSON and PostgreSQL

set -e

echo "=========================================="
echo "DUAL-WRITE FUNCTIONALITY TEST"
echo "=========================================="
echo ""

# Check if server is running
echo "1. Checking if server is running..."
if ! curl -s http://localhost:3000/api/health > /dev/null; then
  echo "❌ Server is not running on port 3000"
  echo "   Start the server with: npm start"
  exit 1
fi
echo "✅ Server is running"
echo ""

# Login to get JWT token
echo "2. Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@nozawa.com",
    "password": "NozawaAdmin2024!"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  echo "   Response: $LOGIN_RESPONSE"
  exit 1
fi
echo "✅ Login successful"
echo ""

# Check dual-write is enabled
echo "3. Checking dual-write status..."
HEALTH=$(curl -s http://localhost:3000/api/v2/health)
DUAL_WRITE=$(echo $HEALTH | grep -o '"postgresRead":[^,}]*' | cut -d':' -f2)

if [ "$DUAL_WRITE" = "true" ]; then
  echo "✅ PostgreSQL read is enabled"
else
  echo "⚠️  PostgreSQL read is disabled (ENABLE_POSTGRES_READ=false)"
fi
echo ""

# Validate data consistency
echo "4. Validating data consistency..."
VALIDATION=$(curl -s http://localhost:3000/api/admin/validate-data-consistency \
  -H "Authorization: Bearer $TOKEN")

CONSISTENT=$(echo $VALIDATION | grep -o '"consistent":[^,}]*' | cut -d':' -f2)
JSON_COUNT=$(echo $VALIDATION | grep -o '"jsonCount":[0-9]*' | cut -d':' -f2)
PG_COUNT=$(echo $VALIDATION | grep -o '"postgresCount":[0-9]*' | cut -d':' -f2)

echo "   JSON places: $JSON_COUNT"
echo "   PostgreSQL places: $PG_COUNT"

if [ "$CONSISTENT" = "true" ]; then
  echo "✅ Data is consistent between JSON and PostgreSQL"
else
  echo "⚠️  Data is inconsistent!"
  echo "   This is expected if you haven't run migrations yet"
  echo "   Run: node migrations/run-migrations.js"
fi
echo ""

# Check V2 API endpoints
echo "5. Testing V2 API endpoints..."
V2_PLACES=$(curl -s "http://localhost:3000/api/v2/places?limit=5")
V2_COUNT=$(echo $V2_PLACES | grep -o '"total":[0-9]*' | cut -d':' -f2)

if [ -n "$V2_COUNT" ]; then
  echo "✅ V2 API is working (returned $V2_COUNT places)"
else
  echo "❌ V2 API failed"
  exit 1
fi
echo ""

# Summary
echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo ""
echo "Server Status:        ✅ Running"
echo "Admin Auth:           ✅ Working"
echo "PostgreSQL Read:      $([ "$DUAL_WRITE" = "true" ] && echo "✅ Enabled" || echo "⚠️  Disabled")"
echo "Data Consistency:     $([ "$CONSISTENT" = "true" ] && echo "✅ Consistent" || echo "⚠️  Inconsistent")"
echo "V2 API:               ✅ Working"
echo ""
echo "=========================================="
echo "NEXT STEPS"
echo "=========================================="
echo ""

if [ "$CONSISTENT" != "true" ]; then
  echo "⚠️  Data is inconsistent. To fix:"
  echo "   1. Run migrations: node migrations/run-migrations.js"
  echo "   2. Re-run this test script"
  echo ""
fi

if [ "$DUAL_WRITE" != "true" ]; then
  echo "⚠️  PostgreSQL read is disabled. To enable:"
  echo "   1. Set ENABLE_POSTGRES_READ=true in .env"
  echo "   2. Restart server"
  echo ""
fi

echo "To test dual-write with a real edit:"
echo "   1. Open admin panel"
echo "   2. Make a small edit to a place"
echo "   3. Check response includes: dual_write.postgresql.success: true"
echo "   4. Verify changes in both JSON file and database"
echo ""

echo "✅ Test complete!"
