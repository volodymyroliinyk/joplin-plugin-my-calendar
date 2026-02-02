#!/bin/bash
#
# Release Script
#
# Automates the versioning and release process for the Joplin plugin.
#
# Steps:
# 1. Checks for a clean git working directory.
# 2. Verifies that tests have passed recently.
# 3. Runs 'standard-version' to bump version and generate changelog.
# 4. RE-BUILDS the plugin to ensure the new version is in the binary.
# 5. Pushes changes and tags.
# 6. Creates a GitHub Release (and attaches the .jpl file).
# 7. Publishes to NPM.
#

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TYPE=${1:-patch}
JPL_FILE="publish/com.volodymyroliinyk.joplin.plugin.my-calendar.jpl"

# 1. Check for clean working directory
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${GREEN}Working directory is clean. Proceeding...${NC}"
else
    echo -e "${RED}⚠️ Error: Working directory is not clean. Commit or stash your changes first.${NC}"
    exit 1
fi

# 2. Verify Tests
echo -e "${YELLOW}🧪 Verifying test status...${NC}"
if ! bash scripts/check-tests.sh; then
    echo -e "${RED}❌ Tests verification failed. Aborting release.${NC}"
    exit 1
fi

# 3. Generate changelog, bump version, and create tag
echo -e "${YELLOW}📈 Bumping version ($TYPE)...${NC}"
# standard-version bumps version in package.json/manifest.json and commits it
npm run release -- --release-as $TYPE

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")

# 4. RE-BUILD and PACK with the new version
# This is critical! We need to update the dist/ folder and .jpl file
# so they contain the new version number from manifest.json
echo -e "${YELLOW}🔨 Re-building plugin with version $NEW_VERSION...${NC}"
# npm pack triggers 'prepack' -> 'build:jpl'
npm pack

# 5. Push and Merge logic
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo -e "${YELLOW}🚀 Pushing $CURRENT_BRANCH to origin...${NC}"
git push --follow-tags origin "$CURRENT_BRANCH"

if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}🔄 Merging $CURRENT_BRANCH into main...${NC}"
    git checkout main
    git merge "$CURRENT_BRANCH" --no-verify
    git push origin main
    git checkout "$CURRENT_BRANCH"
fi

# 6. GitHub Release (requires gh CLI)
if command -v gh &> /dev/null; then
    echo -e "${YELLOW}🌐 Creating GitHub Release v$NEW_VERSION...${NC}"

    # Extract notes from CHANGELOG (optional complexity, or just point to file)
    # Here we just use the title.

    if [ -f "$JPL_FILE" ]; then
        gh release create "v$NEW_VERSION" "$JPL_FILE" --title "v$NEW_VERSION" --notes "See CHANGELOG.md for details."
        echo -e "${GREEN}✅ GitHub Release created with .jpl attachment.${NC}"
    else
        echo -e "${RED}⚠️ .jpl file not found at $JPL_FILE. Creating release without attachment.${NC}"
        gh release create "v$NEW_VERSION" --title "v$NEW_VERSION" --notes "See CHANGELOG.md for details."
    fi
else
    echo -e "${YELLOW}⚠️ Warning: 'gh' (GitHub CLI) not found. Skipping GitHub Release.${NC}"
fi

# 7. NPM Release
echo -e "${YELLOW}📦 Publishing to NPM...${NC}"
npm publish

echo -e "${GREEN}✨ Release v$NEW_VERSION completed successfully!${NC}"
