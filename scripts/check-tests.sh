#!/bin/bash
#
# Check Test Status Script
#
# Reads .test-status file to verify if tests passed recently.
# Used as a safeguard before critical operations (push, release, pack).
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

STATUS_FILE=".test-status"
MAX_AGE_SECONDS=3600 # 1 hour

if [ ! -f "$STATUS_FILE" ]; then
    echo -e "${RED}❌ Error: Test status file not found. Please run 'npm run test' first.${NC}"
    exit 1
fi

CONTENT=$(cat "$STATUS_FILE")
TIMESTAMP=$(echo "$CONTENT" | cut -d'|' -f1)
STATUS=$(echo "$CONTENT" | cut -d'|' -f2)

if [ "$STATUS" != "PASS" ]; then
    echo -e "${RED}❌ Error: Last test run FAILED. Please fix tests and run 'npm run test'.${NC}"
    exit 1
fi

# Check age
CURRENT_TIME=$(date +%s)
AGE=$((CURRENT_TIME - TIMESTAMP))

if [ "$AGE" -gt "$MAX_AGE_SECONDS" ]; then
    echo -e "${RED}❌ Error: Test results are too old ($((AGE / 60)) minutes ago). Please run 'npm run test' again.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Tests passed $((AGE / 60)) minutes ago. Proceeding...${NC}"
exit 0
