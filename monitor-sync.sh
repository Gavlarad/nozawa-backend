#!/bin/bash

# Monitor Dual-Write Sync Status
# Run this daily in production to ensure JSON and PostgreSQL stay in sync

# Usage:
#   ./monitor-sync.sh                    # Check localhost
#   ./monitor-sync.sh https://your-api.railway.app  # Check production

API_URL="${1:-http://localhost:3000}"

echo "=========================================="
echo "DUAL-WRITE SYNC MONITOR"
echo "API: $API_URL"
echo "Time: $(date)"
echo "=========================================="
echo ""

# Get admin token (you should use environment variable in production)
echo "Authenticating..."
TOKEN=$(curl -s -X POST "$API_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nozawa.com","password":"NozawaAdmin2024!"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Authentication failed"
  exit 1
fi
echo "✅ Authenticated"
echo ""

# Check consistency
echo "Checking data consistency..."
RESULT=$(curl -s "$API_URL/api/admin/validate-data-consistency" \
  -H "Authorization: Bearer $TOKEN")

# Parse results
CONSISTENT=$(echo $RESULT | grep -o '"consistent":[^,}]*' | cut -d':' -f2)
JSON_COUNT=$(echo $RESULT | grep -o '"jsonCount":[0-9]*' | cut -d':' -f2)
PG_COUNT=$(echo $RESULT | grep -o '"postgresCount":[0-9]*' | cut -d':' -f2)

echo ""
echo "Results:"
echo "  JSON count:       $JSON_COUNT places"
echo "  PostgreSQL count: $PG_COUNT places"
echo "  Status:           $([ "$CONSISTENT" = "true" ] && echo "✅ CONSISTENT" || echo "❌ INCONSISTENT")"
echo ""

# Check feature flags
echo "Checking feature flags..."
HEALTH=$(curl -s "$API_URL/api/v2/health")
PG_READ=$(echo $HEALTH | grep -o '"postgresRead":[^,}]*' | cut -d':' -f2)
DUAL_WRITE_STATUS=$(echo $HEALTH | grep -o '"dualWrite":[^,}]*' | cut -d':' -f2)

echo "  PostgreSQL Read:  $([ "$PG_READ" = "true" ] && echo "✅ Enabled" || echo "❌ Disabled")"
echo "  Dual Write:       $([ "$DUAL_WRITE_STATUS" = "true" ] && echo "✅ Enabled" || echo "❌ Disabled")"
echo ""

# Alert if inconsistent
if [ "$CONSISTENT" != "true" ]; then
  echo "=========================================="
  echo "⚠️  ALERT: DATA IS INCONSISTENT!"
  echo "=========================================="
  echo ""
  echo "Recommended actions:"
  echo "  1. Check server logs for sync errors"
  echo "  2. Verify ENABLE_DUAL_WRITE=true in production"
  echo "  3. Review recent admin edits"
  echo "  4. Consider re-syncing: node migrations/run-migrations.js"
  echo ""

  # Log to file
  echo "[$(date)] INCONSISTENT: JSON=$JSON_COUNT PG=$PG_COUNT" >> sync-monitor.log

  # Exit with error code for alerting systems
  exit 1
else
  echo "✅ All systems operational"
  echo "[$(date)] CONSISTENT: JSON=$JSON_COUNT PG=$PG_COUNT" >> sync-monitor.log
fi

echo ""
echo "Log saved to: sync-monitor.log"
