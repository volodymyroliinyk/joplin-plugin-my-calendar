#!/bin/bash
#
# Pre-pack Script
#
# This script ensures code quality before packaging the plugin.
# It runs the linter (failing on any warnings) and then executes the test suite.
# Only if both pass will the plugin be packed into a .jpl file.
#
# Usage: npm run pre-pack (usually invoked via 'npm run pack' if configured, or manually)
#

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔍 Running Lint...${NC}"

# Run eslint with --max-warnings=0 to ensure strict code quality
if npm run lint -- --max-warnings=0; then
    echo -e "${GREEN}✅ Lint passed.${NC}"

    echo -e "${YELLOW}🧪 Running Tests...${NC}"
    if npm run test; then
        echo -e "${GREEN}✅ Tests passed.${NC}"

        echo -e "${YELLOW}📦 Packing the plugin...${NC}"
        npm run pack

        echo -e "${GREEN}✅ Done! Your .jpl file is ready in the 'publish' folder.${NC}"
    else
        echo -e "${RED}❌ Tests failed!${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Lint failed (errors or warnings found)!${NC}"
    exit 1
fi
