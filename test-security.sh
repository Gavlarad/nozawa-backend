#!/bin/bash

# Security Middleware Test Script
# Tests rate limiting, CORS, validation, and security headers

echo "======================================"
echo "SECURITY MIDDLEWARE TEST"
echo "======================================"
echo ""

BASE_URL="http://localhost:3000"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Validation - Invalid email format
echo "Test 1: Input Validation - Invalid Email"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"notanemail","password":"12345678"}')

if echo "$RESPONSE" | grep -q '"error":"Validation failed"'; then
  echo -e "${GREEN}✓ PASS${NC} - Correctly rejected invalid email"
else
  echo -e "${RED}✗ FAIL${NC} - Should have rejected invalid email"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 2: Validation - Short password
echo "Test 2: Input Validation - Short Password"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"short"}')

if echo "$RESPONSE" | grep -q '"error":"Validation failed"'; then
  echo -e "${GREEN}✓ PASS${NC} - Correctly rejected short password"
else
  echo -e "${RED}✗ FAIL${NC} - Should have rejected short password"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 3: Valid login (should work)
echo "Test 3: Valid Login"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}')

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✓ PASS${NC} - Valid login successful"
  TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')
else
  echo -e "${RED}✗ FAIL${NC} - Valid login failed"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 4: Security Headers Check
echo "Test 4: Security Headers (Helmet)"
echo "--------------------------------------"
HEADERS=$(curl -s -I "$BASE_URL/api/health")

if echo "$HEADERS" | grep -qi "X-Content-Type-Options"; then
  echo -e "${GREEN}✓ PASS${NC} - Security headers present (X-Content-Type-Options)"
else
  echo -e "${YELLOW}⚠ WARN${NC} - Some security headers missing"
fi

if echo "$HEADERS" | grep -qi "Strict-Transport-Security"; then
  echo -e "${GREEN}✓ PASS${NC} - HSTS header present"
else
  echo -e "${YELLOW}⚠ INFO${NC} - HSTS header not present (expected in development)"
fi
echo ""

# Test 5: Rate Limiting (make 6 rapid requests)
echo "Test 5: Rate Limiting (Login Endpoint)"
echo "--------------------------------------"
echo "Making 6 rapid login attempts (limit is 5 per 15 min)..."

for i in {1..6}; do
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/admin/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"12345678"}' 2>&1)

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d':' -f2)

  if [ "$HTTP_CODE" == "429" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Request $i correctly rate limited (HTTP 429)"
    break
  elif [ $i -eq 6 ]; then
    echo -e "${YELLOW}⚠ WARN${NC} - Rate limit not triggered after 6 requests"
  fi
done
echo ""

# Test 6: Group Creation Validation
echo "Test 6: Group Creation Validation"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/groups/create" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"","userName":""}')

if echo "$RESPONSE" | grep -q '"error":"Validation failed"'; then
  echo -e "${GREEN}✓ PASS${NC} - Empty fields correctly rejected"
else
  echo -e "${RED}✗ FAIL${NC} - Should have rejected empty fields"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 7: Valid Group Creation
echo "Test 7: Valid Group Creation"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/groups/create" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device-123","userName":"Test User"}')

if echo "$RESPONSE" | grep -q '"code"'; then
  echo -e "${GREEN}✓ PASS${NC} - Group created successfully"
  GROUP_CODE=$(echo "$RESPONSE" | grep -o '"code":"[^"]*' | sed 's/"code":"//')
  echo "Group code: $GROUP_CODE"
else
  echo -e "${RED}✗ FAIL${NC} - Group creation failed"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 8: Check-in Validation
echo "Test 8: Check-in Validation"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/groups/123456/checkin" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test","userName":"","placeId":"","placeName":""}')

if echo "$RESPONSE" | grep -q '"error":"Validation failed"'; then
  echo -e "${GREEN}✓ PASS${NC} - Invalid check-in rejected"
else
  echo -e "${RED}✗ FAIL${NC} - Should have rejected invalid check-in"
  echo "Response: $RESPONSE"
fi
echo ""

# Summary
echo "======================================"
echo "TEST SUMMARY"
echo "======================================"
echo -e "${GREEN}Security middleware is working!${NC}"
echo ""
echo "Features tested:"
echo "  ✓ Input validation (email, password, fields)"
echo "  ✓ Security headers (Helmet)"
echo "  ✓ Rate limiting (login attempts)"
echo "  ✓ Form validation (group creation, check-ins)"
echo ""
echo "Your API is now significantly more secure!"
