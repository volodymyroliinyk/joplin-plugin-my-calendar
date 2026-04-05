#!/bin/bash

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_PID="$$"

is_ancestor_pid() {
    local target_pid="$1"
    local current_pid="$SELF_PID"
    local stat_line parent_pid

    while [ -r "/proc/$current_pid/stat" ]; do
        stat_line="$(cat "/proc/$current_pid/stat" 2>/dev/null || true)"
        if [ -z "$stat_line" ]; then
            return 1
        fi

        parent_pid="$(echo "$stat_line" | awk '{ print $4 }')"
        if [ -z "$parent_pid" ] || [ "$parent_pid" = "0" ]; then
            return 1
        fi

        if [ "$parent_pid" = "$target_pid" ]; then
            return 0
        fi

        current_pid="$parent_pid"
    done

    return 1
}

find_repo_test_pids() {
    local proc_dir pid cmdline cwd

    for proc_dir in /proc/[0-9]*; do
        pid="${proc_dir##*/}"

        if [ "$pid" = "$SELF_PID" ] || is_ancestor_pid "$pid"; then
            continue
        fi

        if [ ! -r "$proc_dir/cmdline" ]; then
            continue
        fi

        cmdline="$(tr '\0' ' ' < "$proc_dir/cmdline" 2>/dev/null || true)"
        if [[ "$cmdline" != *jest* ]] && [[ "$cmdline" != *jest-worker* ]] && [[ "$cmdline" != *processChild.js* ]]; then
            continue
        fi

        cwd="$(readlink -f "$proc_dir/cwd" 2>/dev/null || true)"
        if [[ "$cwd" == "$REPO_ROOT"* ]]; then
            echo "$pid"
        fi
    done
}

PIDS="$(find_repo_test_pids)"

if [ -z "$PIDS" ]; then
    exit 0
fi

echo "Cleaning up stale Jest processes for this repo: $PIDS"

kill -TERM $PIDS 2>/dev/null || true
sleep 1

REMAINING="$(find_repo_test_pids)"
if [ -n "$REMAINING" ]; then
    echo "Force killing remaining processes: $REMAINING"
    kill -KILL $REMAINING 2>/dev/null || true
fi
