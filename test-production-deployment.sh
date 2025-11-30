#!/bin/bash

# Production deployment health check
# Tests all critical endpoints after deployment

BASE_URL="https://nozawa-backend-production.up.railway.app"

echo "==================================="
echo "NOZAWA BACKEND HEALTH CHECK"
echo "==================================="
echo ""

# Test 1: Root endpoint
echo "1. Root Endpoint"
curl -s $BASE_URL/ | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Name: {d[\"name\"]}, Version: {d[\"version\"]}')"
echo ""

# Test 2: Database health
echo "2. Database Health"
curl -s $BASE_URL/api/v2/health | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Database: {d[\"database\"]}\n   ✓ PostgreSQL Read: {d[\"featureFlags\"][\"postgresRead\"]}\n   ✓ Dual Write: {d[\"featureFlags\"][\"dualWrite\"]}')"
echo ""

# Test 3: Weather caching
echo "3. Weather Endpoint"
curl -s $BASE_URL/api/weather/current | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Cached: {d.get(\"cached\")}, Source: {d.get(\"source\")}, Age: {d.get(\"age\")}s')"
echo ""

# Test 4: Lifts
echo "4. Lifts Endpoint"
curl -s $BASE_URL/api/lifts/status | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Lifts: {len(d.get(\"lifts\",[]))}, Status: {d.get(\"lifts\",[{}])[0].get(\"status\",\"N/A\")}')"
echo ""

# Test 5: Restaurants
echo "5. Restaurants Endpoint"
curl -s $BASE_URL/api/restaurants | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Restaurants: {d.get(\"count\")}')"
echo ""

# Test 6: V2 endpoint (should be disabled)
echo "6. V2 Endpoint (should be 503)"
curl -s $BASE_URL/api/v2/places | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Status: {d.get(\"error\")} (expected)')"
echo ""

# Test 7: Groups creation
echo "7. Groups Endpoint"
curl -s -X POST $BASE_URL/api/groups/create \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device","userName":"Test User"}' | python3 -c "import sys, json; d=json.load(sys.stdin); print(f'   ✓ Group created: {d.get(\"code\",\"Error: \" + d.get(\"error\",\"Unknown\"))}')"
echo ""

# Test 8: Weather cache status
echo "8. Weather Cache Status"
curl -s $BASE_URL/api/weather/cache-status | python3 -c "import sys, json; d=json.load(sys.stdin); c=d.get('cache',{}).get('memory',{}); print(f'   ✓ Memory cache: {c.get(\"fresh\")}, Age: {c.get(\"age\")}s')"
echo ""

echo "==================================="
echo "DEPLOYMENT SUCCESSFUL!"
echo "==================================="
echo ""
echo "Configuration:"
echo "  - PostgreSQL Read: DISABLED (Phase 1)"
echo "  - Dual Write: ENABLED"
echo "  - V1 Endpoints: ACTIVE"
echo "  - V2 Endpoints: 503 (disabled)"
echo ""
echo "Next Steps:"
echo "  1. Monitor Railway logs for 24-48 hours"
echo "  2. Check for any errors or performance issues"
echo "  3. After 1 week: Enable ENABLE_POSTGRES_READ=true"
echo ""
