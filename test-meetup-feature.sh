#!/bin/bash

# Test Meetup Feature
# This script tests the new meetup functionality

echo "========================================="
echo "MEETUP FEATURE TESTING"
echo "========================================="
echo ""

# Step 1: Create a test group
echo "1️⃣  Creating test group..."
GROUP_RESPONSE=$(curl -s -X POST http://localhost:3000/api/groups/create \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device-1","userName":"TestUser"}')

GROUP_CODE=$(echo $GROUP_RESPONSE | jq -r '.code')
echo "✅ Group created: $GROUP_CODE"
echo ""

# Step 2: Regular check-in (no scheduled_for)
echo "2️⃣  Creating regular check-in..."
CHECKIN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/groups/$GROUP_CODE/checkin \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId":"test-device-1",
    "userName":"Alice",
    "placeId":"123",
    "placeName":"Pension Schnee"
  }')

echo "Response: $CHECKIN_RESPONSE" | jq '.'
echo ""

# Step 3: Create a future meetup (1 hour from now)
echo "3️⃣  Creating future meetup..."
FUTURE_TIME=$(date -u -v+1H '+%Y-%m-%dT%H:%M:%SZ')
echo "Scheduled for: $FUTURE_TIME"

MEETUP_RESPONSE=$(curl -s -X POST http://localhost:3000/api/groups/$GROUP_CODE/checkin \
  -H "Content-Type: application/json" \
  -d "{
    \"deviceId\":\"test-device-2\",
    \"userName\":\"Bob\",
    \"placeId\":\"456\",
    \"placeName\":\"Yamabiko Restaurant\",
    \"scheduledFor\":\"$FUTURE_TIME\",
    \"meetupNote\":\"Let's meet for lunch! 🍜\"
  }")

echo "Response: $MEETUP_RESPONSE" | jq '.'
echo ""

# Step 4: Test GET /members endpoint
echo "4️⃣  Testing GET /members endpoint..."
MEMBERS_RESPONSE=$(curl -s http://localhost:3000/api/groups/$GROUP_CODE/members)
echo "Members response:"
echo "$MEMBERS_RESPONSE" | jq '{
  group_code,
  member_count: .count,
  meetup_count: .meetup_count,
  members: .members | map({device_id, user_name, is_checked_in}),
  meetups: .meetups | map({username, place: .place.name, scheduledFor, note})
}'
echo ""

# Step 5: Test GET /checkins endpoint
echo "5️⃣  Testing GET /checkins endpoint..."
CHECKINS_RESPONSE=$(curl -s http://localhost:3000/api/groups/$GROUP_CODE/checkins)
echo "Check-ins response:"
echo "$CHECKINS_RESPONSE" | jq '{
  group_code,
  count,
  checkins: .checkins | map({
    user_name,
    place_name,
    is_active,
    scheduled_for,
    meetup_note
  })
}'
echo ""

echo "========================================="
echo "✅ TESTING COMPLETE"
echo "========================================="
echo ""
echo "Summary:"
echo "- Group code: $GROUP_CODE"
echo "- Regular check-in: Alice @ Pension Schnee"
echo "- Future meetup: Bob @ Yamabiko Restaurant ($FUTURE_TIME)"
echo ""
echo "You can manually verify:"
echo "  curl http://localhost:3000/api/groups/$GROUP_CODE/members | jq"
echo "  curl http://localhost:3000/api/groups/$GROUP_CODE/checkins | jq"

