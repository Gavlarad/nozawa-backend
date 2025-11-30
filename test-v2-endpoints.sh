#!/bin/bash

# V2 API Testing Script
# Quick validation of all V2 endpoints for frontend integration

BASE_URL="https://nozawa-backend-production.up.railway.app"

echo "=================================="
echo "Testing V2 API Endpoints"
echo "=================================="
echo ""

# 1. Health Check
echo "1. Testing /api/v2/health..."
curl -s "$BASE_URL/api/v2/health" | jq .
echo ""

# 2. Database Stats
echo "2. Testing /api/v2/stats..."
curl -s "$BASE_URL/api/v2/stats" | jq .
echo ""

# 3. Get All Restaurants (first 5)
echo "3. Testing /api/v2/places/category/restaurant (first 5)..."
curl -s "$BASE_URL/api/v2/places/category/restaurant?limit=5&visible=true" | jq '{
  success,
  count: (.data | length),
  pagination,
  first_restaurant: .data[0] | {id, name, category, rating, cuisine}
}'
echo ""

# 4. Get All Onsens
echo "4. Testing /api/v2/places/category/onsen..."
curl -s "$BASE_URL/api/v2/places/category/onsen?visible=true" | jq '{
  success,
  count: (.data | length),
  onsens: [.data[] | {id, name, external_id, visible_in_app}]
}'
echo ""

# 5. Get Lifts
echo "5. Testing /api/v2/lifts..."
curl -s "$BASE_URL/api/v2/lifts" | jq '{
  success,
  count: (.data | length),
  cached,
  lifts: [.data[] | {id, name, external_id, status}]
}'
echo ""

# 6. Get Single Place (first restaurant)
echo "6. Testing /api/v2/places/:id (place #1)..."
curl -s "$BASE_URL/api/v2/places/1" | jq '{
  success,
  place: .data | {id, name, category, location, rating, phone}
}'
echo ""

# 7. Weather
echo "7. Testing /api/v2/weather..."
curl -s "$BASE_URL/api/v2/weather" | jq '{
  success,
  cached,
  current: .data.current | {temperature, conditions, snow_depth},
  forecast_days: (.data.forecast | length)
}'
echo ""

# 8. Pagination Test
echo "8. Testing pagination (limit=3, offset=0 vs offset=3)..."
echo "First page:"
curl -s "$BASE_URL/api/v2/places/category/restaurant?limit=3&offset=0" | jq '{
  pagination,
  restaurants: [.data[] | .name]
}'
echo ""
echo "Second page:"
curl -s "$BASE_URL/api/v2/places/category/restaurant?limit=3&offset=3" | jq '{
  pagination,
  restaurants: [.data[] | .name]
}'
echo ""

# 9. Visibility Filter Test
echo "9. Testing visibility filter..."
echo "All places:"
curl -s "$BASE_URL/api/v2/places?limit=100" | jq '{total: .pagination.total}'
echo ""
echo "Only visible:"
curl -s "$BASE_URL/api/v2/places?limit=100&visible=true" | jq '{total: .pagination.total}'
echo ""

echo "=================================="
echo "✅ All V2 endpoints tested!"
echo "=================================="
echo ""
echo "Next steps for frontend:"
echo "1. Review FRONTEND_MIGRATION_HANDOFF.md"
echo "2. Create API service layer with feature flag"
echo "3. Migrate one component at a time"
echo "4. Test thoroughly before deploying"
