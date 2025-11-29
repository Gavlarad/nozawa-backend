#!/bin/bash

# Test script for PostgreSQL-backed API endpoints
# Tests v2 API with feature flag control

echo "========================================"
echo "PostgreSQL API Endpoints Test"
echo "========================================"
echo ""

BASE_URL="http://localhost:3000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function for tests
test_endpoint() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local expected_status="$4"
  local extra_args="$5"

  echo "Test: $name"

  response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" $extra_args)
  body=$(echo "$response" | head -n -1)
  status=$(echo "$response" | tail -n 1)

  if [ "$status" -eq "$expected_status" ]; then
    echo -e "${GREEN}✓ PASSED${NC} (HTTP $status)"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗ FAILED${NC} (Expected: $expected_status, Got: $status)"
    FAILED=$((FAILED + 1))
  fi

  # Show response preview (first 200 chars)
  echo "Response: $(echo "$body" | jq -c '.' 2>/dev/null | head -c 200)..."
  echo ""
}

echo "========================================"
echo "1. Health Check"
echo "========================================"
test_endpoint "PostgreSQL health check" "GET" "/api/v2/health" 200

echo "========================================"
echo "2. Feature Flag Tests (ENABLE_POSTGRES_READ=false)"
echo "========================================"
test_endpoint "Places list (should be disabled)" "GET" "/api/v2/places" 503
test_endpoint "Single place (should be disabled)" "GET" "/api/v2/places/1" 503
test_endpoint "Stats (should be disabled)" "GET" "/api/v2/stats" 503

echo "========================================"
echo "3. Enabling PostgreSQL Read..."
echo "========================================"
echo -e "${YELLOW}Setting ENABLE_POSTGRES_READ=true in .env${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo -e "${RED}Error: .env file not found${NC}"
  exit 1
fi

# Update .env
if grep -q "^ENABLE_POSTGRES_READ=" .env; then
  sed -i '' 's/^ENABLE_POSTGRES_READ=.*/ENABLE_POSTGRES_READ=true/' .env
else
  echo "ENABLE_POSTGRES_READ=true" >> .env
fi

echo -e "${YELLOW}⚠️  Please restart the server with the updated .env${NC}"
echo -e "${YELLOW}⚠️  Then run this script again to test the enabled endpoints${NC}"
echo ""
echo "To restart:"
echo "1. Kill current server (Ctrl+C)"
echo "2. Run: node server.js"
echo "3. Run: ./test-postgres-api.sh"
echo ""

# Check if server needs restart
echo "Attempting to test with current server..."
echo ""

echo "========================================"
echo "4. Testing Enabled Endpoints"
echo "========================================"

# Wait a moment for potential env reload
sleep 1

# Test places list
test_endpoint "List all places" "GET" "/api/v2/places" 200
test_endpoint "List places with limit" "GET" "/api/v2/places?limit=10" 200
test_endpoint "Filter by category (restaurant)" "GET" "/api/v2/places?category=restaurant" 200
test_endpoint "Filter by category (onsen)" "GET" "/api/v2/places?category=onsen" 200
test_endpoint "Search by name" "GET" "/api/v2/places?search=fuji" 200
test_endpoint "Sort by rating desc" "GET" "/api/v2/places?sort=rating&order=desc" 200

echo "========================================"
echo "5. Single Place Tests"
echo "========================================"
test_endpoint "Get place by ID (1)" "GET" "/api/v2/places/1" 200
test_endpoint "Get non-existent place (999999)" "GET" "/api/v2/places/999999" 404
test_endpoint "Get place with invalid ID" "GET" "/api/v2/places/abc" 400

echo "========================================"
echo "6. Category Tests"
echo "========================================"
test_endpoint "Get restaurants" "GET" "/api/v2/places/category/restaurant" 200
test_endpoint "Get onsens" "GET" "/api/v2/places/category/onsen" 200
test_endpoint "Get lifts" "GET" "/api/v2/places/category/lift" 200
test_endpoint "Get invalid category" "GET" "/api/v2/places/category/invalid" 400

echo "========================================"
echo "7. Statistics Test"
echo "========================================"
test_endpoint "Get database stats" "GET" "/api/v2/stats" 200

echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed! ✓${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed${NC}"
  exit 1
fi
