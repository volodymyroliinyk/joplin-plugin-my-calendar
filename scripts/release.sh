#!/bin/bash
#
# Release Script
#
# Automates versioning and publication for the Joplin plugin. A tagged version
# is resumed when GitHub or NPM publication did not finish.
#

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

TYPE=${1:-patch}
JPL_FILE="publish/com.volodymyroliinyk.joplin.plugin.my-calendar.jpl"
RESUME_RELEASE=false
GITHUB_RELEASE_STATE="missing"
NPM_RELEASE_EXISTS=false
NPM_TFA_MODE=""
PACKAGE_TARBALL=""
NPM_USER_CONFIG=""

fail() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

github_release_state() {
    local is_draft

    if is_draft=$(gh release view "$1" --json isDraft --jq '.isDraft' 2>/dev/null); then
        if [ "$is_draft" = "true" ]; then
            echo "draft"
        else
            echo "public"
        fi
    else
        echo "missing"
    fi
}

npm_release_exists() {
    local output

    if output=$(npm view "$PACKAGE_NAME@$1" version 2>&1); then
        [ "$output" = "$1" ] || fail "NPM returned an unexpected version for $PACKAGE_NAME@$1: $output"
        return 0
    fi

    case "$output" in
        *E404*|*"is not in this registry"*)
            return 1
            ;;
        *)
            fail "Could not check $PACKAGE_NAME@$1 on NPM: $output"
            ;;
    esac
}

npm_tfa_mode() {
    npm profile get --json | node -e '
        let input = "";
        process.stdin.on("data", chunk => input += chunk);
        process.stdin.on("end", () => {
            const profile = JSON.parse(input);
            process.stdout.write(profile.tfa?.mode || "");
        });
    '
}

cleanup() {
    if [ -n "$NPM_USER_CONFIG" ] && [ -f "$NPM_USER_CONFIG" ]; then
        rm -f "$NPM_USER_CONFIG"
    fi
}

configure_npm_token() {
    if [ -z "${NPM_TOKEN:-}" ]; then
        return
    fi

    NPM_USER_CONFIG=$(mktemp)
    chmod 600 "$NPM_USER_CONFIG"
    printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$NPM_USER_CONFIG"
    export NPM_CONFIG_USERCONFIG="$NPM_USER_CONFIG"
}

publish_to_npm() {
    if ! npm publish "$PACKAGE_TARBALL"; then
        fail "NPM publish failed. Complete the interactive 2FA prompt, or use NPM_TOKEN with package read/write permission and Bypass 2FA enabled."
    fi
}

release_safe_paths_only() {
    local path

    if [ "$#" -eq 0 ]; then
        return 0
    fi

    for path in "$@"; do
        case "$path" in
            scripts/release.sh|docs/*)
                ;;
            *)
                return 1
                ;;
        esac
    done
}

release_tag_matches_head() {
    local tag_commit
    local head_commit
    local -a changed_files

    tag_commit=$(git rev-list -n 1 "$1")
    head_commit=$(git rev-parse HEAD)

    if [ "$tag_commit" = "$head_commit" ]; then
        return 0
    fi

    mapfile -t changed_files < <(git diff --name-only "$1"..HEAD)
    release_safe_paths_only "${changed_files[@]}"
}

working_tree_is_release_safe() {
    local -a changed_files

    mapfile -t changed_files < <(
        {
            git diff --name-only
            git diff --cached --name-only
            git ls-files --others --exclude-standard
        } | sort -u
    )
    release_safe_paths_only "${changed_files[@]}"
}

# Validate external authentication before changing repository or release state.
echo -e "${YELLOW}Checking GitHub CLI and NPM authentication...${NC}"
trap cleanup EXIT
configure_npm_token

for required_command in git gh npm node; do
    command_exists "$required_command" || fail "'$required_command' is required for a release."
done

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
    fail "GitHub CLI authentication is invalid. Run: gh auth login --hostname github.com"
fi

if ! npm whoami >/dev/null 2>&1; then
    fail "NPM authentication is invalid. Run: npm login"
fi
echo -e "${GREEN}GitHub CLI and NPM authentication are valid.${NC}"

PACKAGE_NAME=$(node -p "require('./package.json').name")
CURRENT_VERSION=$(node -p "require('./package.json').version")
CURRENT_TAG="v$CURRENT_VERSION"

if [ -n "${NPM_TOKEN:-}" ]; then
    NPM_TFA_MODE="token"
else
    NPM_TFA_MODE=$(npm_tfa_mode)
fi

if ! npm access get status "$PACKAGE_NAME" >/dev/null 2>&1; then
    fail "The authenticated NPM account does not have access to $PACKAGE_NAME."
fi

if [ "$NPM_TFA_MODE" = "token" ]; then
    echo -e "${GREEN}Using NPM_TOKEN for publishing without an interactive OTP.${NC}"
elif [ "$NPM_TFA_MODE" = "auth-and-writes" ]; then
    echo -e "${GREEN}NPM 2FA is enabled; publishing will request security-key authentication.${NC}"
fi

# Resume the current version only when its tag exists and publication is incomplete.
if git rev-parse -q --verify "refs/tags/$CURRENT_TAG" >/dev/null; then
    GITHUB_RELEASE_STATE=$(github_release_state "$CURRENT_TAG")

    if npm_release_exists "$CURRENT_VERSION"; then
        NPM_RELEASE_EXISTS=true
    fi

    if [ "$GITHUB_RELEASE_STATE" != "public" ] || [ "$NPM_RELEASE_EXISTS" = false ]; then
        if ! release_tag_matches_head "$CURRENT_TAG"; then
            fail "$CURRENT_TAG is incomplete, but plugin files changed after the tag. Check out the release commit before retrying."
        fi

        RESUME_RELEASE=true
        echo -e "${YELLOW}Resuming incomplete release $CURRENT_TAG; the version will not be bumped.${NC}"
    fi
fi

if [ -z "$(git status --porcelain)" ]; then
    echo -e "${GREEN}Working directory is clean. Proceeding...${NC}"
elif [ "$RESUME_RELEASE" = true ] && working_tree_is_release_safe; then
    echo -e "${YELLOW}Only release-safe script/documentation changes are present; continuing recovery.${NC}"
else
    echo -e "${RED}Changed files:${NC}" >&2
    git status --short >&2
    fail "Working directory contains files that can affect the release. Commit or stash them first."
fi

echo -e "${YELLOW}Verifying test status...${NC}"
if ! bash scripts/check-tests.sh; then
    fail "Tests verification failed. Aborting release."
fi

if [ "$RESUME_RELEASE" = false ]; then
    echo -e "${YELLOW}Bumping version ($TYPE)...${NC}"
    export SKIP_MAIN_CHECK=1
    npm run release -- --release-as "$TYPE"

    CURRENT_VERSION=$(node -p "require('./package.json').version")
    CURRENT_TAG="v$CURRENT_VERSION"
    GITHUB_RELEASE_STATE="missing"
    NPM_RELEASE_EXISTS=false
fi

echo -e "${YELLOW}Re-building plugin with version $CURRENT_VERSION...${NC}"
npm pack
PACKAGE_TARBALL="${PACKAGE_NAME}-${CURRENT_VERSION}.tgz"
[ -f "$PACKAGE_TARBALL" ] || fail "Expected package archive $PACKAGE_TARBALL was not created."

# During recovery, publish only the tag. The branch may have moved since the
# release commit was created and does not need to be pushed again.
if [ "$RESUME_RELEASE" = true ]; then
    echo -e "${YELLOW}Pushing release tag $CURRENT_TAG to origin...${NC}"
    git push origin "refs/tags/$CURRENT_TAG"
else
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo -e "${YELLOW}Pushing $CURRENT_BRANCH and release tags to origin...${NC}"
    git push --follow-tags origin "$CURRENT_BRANCH"

    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo -e "${YELLOW}Merging $CURRENT_BRANCH into main...${NC}"
        git checkout main
        git merge "$CURRENT_BRANCH" --no-verify
        git push origin main
        git checkout "$CURRENT_BRANCH"
    fi
fi

# Keep GitHub non-public until NPM publication succeeds. This is the closest
# available equivalent to an atomic release across the two independent services.
if [ "$GITHUB_RELEASE_STATE" = "missing" ]; then
    echo -e "${YELLOW}Creating draft GitHub Release $CURRENT_TAG...${NC}"
    if [ -f "$JPL_FILE" ]; then
        gh release create "$CURRENT_TAG" "$JPL_FILE" --draft --title "$CURRENT_TAG" --notes "See CHANGELOG.md for details."
    else
        gh release create "$CURRENT_TAG" --draft --title "$CURRENT_TAG" --notes "See CHANGELOG.md for details."
    fi
    GITHUB_RELEASE_STATE="draft"
elif [ "$GITHUB_RELEASE_STATE" = "public" ] && [ "$NPM_RELEASE_EXISTS" = false ]; then
    echo -e "${YELLOW}Temporarily returning GitHub Release $CURRENT_TAG to draft until NPM succeeds...${NC}"
    gh release edit "$CURRENT_TAG" --draft
    GITHUB_RELEASE_STATE="draft"
fi

if [ "$NPM_RELEASE_EXISTS" = false ]; then
    echo -e "${YELLOW}Publishing $PACKAGE_NAME@$CURRENT_VERSION to NPM...${NC}"
    publish_to_npm
else
    echo -e "${GREEN}$PACKAGE_NAME@$CURRENT_VERSION is already published; skipping.${NC}"
fi

if [ "$GITHUB_RELEASE_STATE" = "draft" ]; then
    echo -e "${YELLOW}Publishing GitHub Release $CURRENT_TAG...${NC}"
    gh release edit "$CURRENT_TAG" --draft=false
else
    echo -e "${GREEN}GitHub Release $CURRENT_TAG is already public; skipping.${NC}"
fi

echo "https://www.npmjs.com/package/joplin-plugin-my-calendar?activeTab=readme"
echo -e "${GREEN}Release $CURRENT_TAG completed successfully!${NC}"
