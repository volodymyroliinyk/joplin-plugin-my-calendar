#!/bin/bash
#
# Changelog Preview Script
#
# Runs standard-version in dry-run mode to show what the changelog update will look like
# without actually modifying any files or creating git tags.
#

TYPE=${1:-patch}

# Ensure we are in the project root (optional, but good practice if called from elsewhere)
# cd "$(dirname "$0")/.."

echo "======================================================="
echo "👀 PREVIEWING CHANGELOG GENERATION (Dry Run)"
echo "   Release Type: $TYPE"
echo "======================================================="
echo ""

# Run standard-version with dry-run flag
# passing arguments to npm run release (which calls standard-version)
npm run release -- --dry-run --release-as "$TYPE"

echo ""
echo "======================================================="
echo "ℹ️  NOTE: This was a dry run. No files were changed."
echo "   Real changelog will be updated in CHANGELOG.md when you run scripts/release.sh"
echo "======================================================="
