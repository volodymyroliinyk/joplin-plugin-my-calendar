#!/bin/bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_PID="$$"
MIN_AGE_SECONDS="${JEST_CLEANUP_MIN_AGE_SECONDS:-15}"
TERM_GRACE_SECONDS="${JEST_CLEANUP_TERM_GRACE_SECONDS:-2}"
declare -A ANCESTOR_PIDS=()

trim() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

get_ps_field() {
    local pid="$1"
    local format="$2"

    ps -o "$format=" -p "$pid" 2>/dev/null | head -n 1
}

SELF_PGID="$(trim "$(get_ps_field "$SELF_PID" pgid)")"
SELF_SID="$(trim "$(get_ps_field "$SELF_PID" sid)")"

build_ancestor_pid_map() {
    local current_pid="$SELF_PID"
    local parent_pid

    while [ -r "/proc/$current_pid/stat" ]; do
        ANCESTOR_PIDS["$current_pid"]=1
        parent_pid="$(awk '{ print $4 }' "/proc/$current_pid/stat" 2>/dev/null || true)"
        if [ -z "$parent_pid" ] || [ "$parent_pid" = "0" ]; then
            return 0
        fi

        current_pid="$parent_pid"
    done
}

is_jest_process() {
    local cmdline="$1"

    [[ "$cmdline" == *"/node_modules/.bin/jest"* ]] ||
    [[ "$cmdline" == *"jest/bin/jest.js"* ]] ||
    [[ "$cmdline" == *"jest-worker/build/workers/processChild.js"* ]] ||
    [[ "$cmdline" == *" jest "* ]] ||
    [[ "$cmdline" == jest\ * ]]
}

find_repo_test_processes() {
    local pid pgid sid etimes stat cmdline cwd

    ps -eo pid=,pgid=,sid=,etimes=,stat=,args= | while read -r pid pgid sid etimes stat cmdline; do
        if [ -z "$pid" ] || [ "$pid" = "$SELF_PID" ] || [ -n "${ANCESTOR_PIDS[$pid]:-}" ]; then
            continue
        fi

        if [ -z "$cmdline" ] || ! is_jest_process "$cmdline"; then
            continue
        fi

        cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
        if [[ "$cwd" != "$REPO_ROOT"* ]]; then
            continue
        fi

        if [ -z "$pgid" ] || [ -z "$sid" ] || [ -z "$etimes" ] || [ -z "$stat" ]; then
            continue
        fi

        # Never kill processes tied to the current invocation session/group.
        if [ "$pgid" = "$SELF_PGID" ] || [ "$sid" = "$SELF_SID" ]; then
            continue
        fi

        # Only touch processes that had enough time to become genuinely stale.
        if [ "$etimes" -lt "$MIN_AGE_SECONDS" ]; then
            continue
        fi

        # Ignore zombies; they cannot be terminated here.
        if [[ "$stat" == Z* ]]; then
            continue
        fi

        printf '%s\t%s\t%s\n' "$pid" "$etimes" "$cmdline"
    done
}

build_ancestor_pid_map

PROCESSES="$(find_repo_test_processes)"

if [ -z "$PROCESSES" ]; then
    exit 0
fi

echo "Cleaning up stale Jest processes for this repo:"
echo "$PROCESSES" | while IFS=$'\t' read -r pid age cmdline; do
    echo "  PID $pid (${age}s): $cmdline"
done

PIDS="$(echo "$PROCESSES" | cut -f1 | tr '\n' ' ')"

kill -TERM $PIDS 2>/dev/null || true
sleep "$TERM_GRACE_SECONDS"

REMAINING="$(find_repo_test_processes)"
if [ -n "$REMAINING" ]; then
    echo "Force killing remaining stale Jest processes:"
    echo "$REMAINING" | while IFS=$'\t' read -r pid age cmdline; do
        echo "  PID $pid (${age}s): $cmdline"
    done

    REMAINING_PIDS="$(echo "$REMAINING" | cut -f1 | tr '\n' ' ')"
    kill -KILL $REMAINING_PIDS 2>/dev/null || true
fi
