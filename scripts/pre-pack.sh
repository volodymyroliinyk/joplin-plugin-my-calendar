#!/bin/bash
#
# Pre-pack Script
#
# This script ensures code quality before packaging the plugin.
# It can optionally apply npm audit fixes, then runs the linter
# (failing on any warnings), and finally executes the test suite.
# Only if all steps pass will the plugin be packed.
#
# Usage:
#   npm run pre-pack
#   npm run pre-pack -- --audit-fix
#

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

RUN_AUDIT_FIX=false

for arg in "$@"; do
    case "$arg" in
        --audit-fix)
            RUN_AUDIT_FIX=true
            ;;
        *)
            echo -e "${RED}❌ Unknown argument: $arg${NC}"
            echo "Usage: $0 [--audit-fix]"
            exit 1
            ;;
    esac
done

if [ "$RUN_AUDIT_FIX" = true ]; then
    echo -e "${YELLOW}🔐 Applying security fixes with npm audit...${NC}"
    npm audit fix --force
    echo -e "${GREEN}✅ Security fixes applied.${NC}"
else
    echo -e "${YELLOW}⏭️ Skipping npm audit fix. Use --audit-fix to enable it.${NC}"
fi

echo -e "${YELLOW}🔍 Running Lint...${NC}"

# Run eslint with --max-warnings=0 to ensure strict code quality
if npm run lint -- --max-warnings=0; then
    echo -e "${GREEN}✅ Lint passed.${NC}"

    echo -e "${YELLOW}🧪 Running Stable Tests...${NC}"
    if npm run test:stable; then
        echo -e "${GREEN}✅ Tests passed.${NC}"

        echo -e "${YELLOW}📦 Packing the plugin...${NC}"
        # This will trigger 'prepack' (build:jpl) and then create the .tgz
        npm pack

        echo -e "${GREEN}✅ Done! Your .jpl file is ready in the 'publish' folder.${NC}"
    else
        echo -e "${RED}❌ Tests failed!${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Lint failed (errors or warnings found)!${NC}"
    exit 1
fi
