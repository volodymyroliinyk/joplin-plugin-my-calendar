#!/bin/bash

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_FILE="$REPO_ROOT/.test-status"
LOG_FILE="$(mktemp)"
JEST_ARGS=("$@")

cleanup() {
    rm -f "$LOG_FILE"
}

trap cleanup EXIT

record_status() {
    local status="$1"
    echo "$(date +%s)|$status" > "$STATUS_FILE"
}

run_jest() {
    local mode="$1"
    shift

    case "$mode" in
        parallel)
            TZ=UTC jest --maxWorkers=50% --no-cache "$@" 2>&1 | tee "$LOG_FILE"
            return "${PIPESTATUS[0]}"
            ;;
        serial)
            TZ=UTC jest --runInBand --no-cache "$@" 2>&1 | tee "$LOG_FILE"
            return "${PIPESTATUS[0]}"
            ;;
        *)
            echo "Unknown test mode: $mode" >&2
            return 2
            ;;
    esac
}

bash "$REPO_ROOT/scripts/cleanup-jest.sh"

if run_jest parallel "${JEST_ARGS[@]}"; then
    record_status PASS
    exit 0
fi

if grep -q 'signal=SIGSEGV' "$LOG_FILE"; then
    echo "Detected Jest worker SIGSEGV. Retrying in-band after cleanup..."
    bash "$REPO_ROOT/scripts/cleanup-jest.sh"

    if run_jest serial "${JEST_ARGS[@]}"; then
        record_status PASS
        exit 0
    fi
fi

record_status FAIL
exit 1
