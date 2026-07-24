#!/usr/bin/env bash

set -o pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"

restart_joplin() {
    local current_uid
    local joplin_window
    local joplin_snap_process
    local joplin_renderer_process
    local candidate_window
    local candidate_pid
    local candidate_process
    local candidate_type
    local candidate_desktop
    local active_window
    local zygote_count_before
    local zygote_count_after

    current_uid="$(id -u)"
    joplin_snap_process='^/snap/joplin-desktop/[0-9]+/opt/joplin-desktop/'
    joplin_renderer_process='^/proc/self/exe .*--user-data-dir=.*/snap/joplin-desktop/'

    echo "Stopping Joplin..."

    pkill -TERM -u "$current_uid" -x joplin 2>/dev/null || true
    pkill -TERM -u "$current_uid" -f "$joplin_snap_process" 2>/dev/null || true
    pkill -TERM -u "$current_uid" -f "$joplin_renderer_process" 2>/dev/null || true

    for _i in $(seq 1 50); do
        if ! pgrep -u "$current_uid" -x joplin >/dev/null \
            && ! pgrep -u "$current_uid" -f "$joplin_snap_process" >/dev/null \
            && ! pgrep -u "$current_uid" -f "$joplin_renderer_process" >/dev/null; then
            break
        fi
        sleep 0.2
    done

    if pgrep -u "$current_uid" -x joplin >/dev/null \
        || pgrep -u "$current_uid" -f "$joplin_snap_process" >/dev/null \
        || pgrep -u "$current_uid" -f "$joplin_renderer_process" >/dev/null; then
        echo "Not all Joplin processes responded to SIGTERM; sending SIGKILL..."
        pkill -KILL -u "$current_uid" -x joplin 2>/dev/null || true
        pkill -KILL -u "$current_uid" -f "$joplin_snap_process" 2>/dev/null || true
        pkill -KILL -u "$current_uid" -f "$joplin_renderer_process" 2>/dev/null || true
        sleep 2
    fi

    if pgrep -u "$current_uid" -x joplin >/dev/null \
        || pgrep -u "$current_uid" -f "$joplin_snap_process" >/dev/null \
        || pgrep -u "$current_uid" -f "$joplin_renderer_process" >/dev/null; then
        echo "Failed to stop all Joplin/Electron processes"
        return 1
    fi

    sleep 3

    echo "Starting Joplin via snap..."

    setsid -f snap run joplin-desktop \
        </dev/null \
        >/tmp/joplin-desktop-dev.log 2>&1

    echo "Waiting for the main Joplin window..."

    joplin_window=""

    # In the current snap build, the first launch sometimes stalls before
    # creating the BrowserWindow. One repeated launch activates the
    # single-instance handler and makes the running Joplin show its main window.
    sleep 5
    echo "Activating the single Joplin instance again..."
    setsid -f snap run joplin-desktop \
        </dev/null \
        >>/tmp/joplin-desktop-dev.log 2>&1

    # _NET_CLIENT_LIST_STACKING contains only top-level window-manager windows.
    # WM_CLASS is unstable in the snap build, so match the window PID against
    # the actual Joplin/Electron process command line.
    for _i in $(seq 1 100); do
        for candidate_window in $(
            xprop -root _NET_CLIENT_LIST_STACKING 2>/dev/null |
                tr ',' '\n' |
                sed -n 's/.*\(0x[0-9a-fA-F][0-9a-fA-F]*\).*/\1/p'
        ); do
            candidate_type="$(
                xprop -id "$candidate_window" _NET_WM_WINDOW_TYPE 2>/dev/null ||
                    true
            )"
            case "$candidate_type" in
                *"_NET_WM_WINDOW_TYPE_NORMAL"*) ;;
                *) continue ;;
            esac

            candidate_desktop="$(
                xprop -id "$candidate_window" _NET_WM_DESKTOP 2>/dev/null |
                    sed -n \
                        's/^_NET_WM_DESKTOP(CARDINAL) = \([0-9][0-9]*\)$/\1/p'
            )"
            [ -n "$candidate_desktop" ] || continue

            candidate_pid="$(
                xprop -id "$candidate_window" _NET_WM_PID 2>/dev/null |
                    sed -n 's/.*= \([0-9][0-9]*\).*/\1/p'
            )"
            [ -n "$candidate_pid" ] || continue

            candidate_process="$(
                tr '\0' ' ' <"/proc/$candidate_pid/cmdline" 2>/dev/null || true
            )"

            case "$candidate_process" in
                *"/snap/joplin-desktop/"*|*"snap/joplin-desktop/common/"*)
                    joplin_window="$candidate_window"
                    break
                    ;;
            esac
        done

        [ -n "$joplin_window" ] && break
        sleep 0.2
    done

    if [ -z "$joplin_window" ]; then
        echo "The main Joplin window did not appear within 20 seconds"
        echo "Latest snap launcher messages:"
        tail -n 50 /tmp/joplin-desktop-dev.log
        echo "Latest Joplin messages:"
        tail -n 50 "$HOME/snap/joplin-desktop/current/.config/joplin-desktop/log.txt"
        return 1
    fi

    echo "Found the top-level Joplin desktop window: $joplin_window"
    echo "Showing and focusing the window, then opening Developer Tools..."

    xdotool windowmap "$joplin_window" 2>/dev/null || true
    xdotool windowraise "$joplin_window" 2>/dev/null || true
    if ! xdotool windowfocus --sync "$joplin_window"; then
        echo "Failed to focus the main Joplin window"
        return 1
    fi

    active_window=""
    for _i in $(seq 1 20); do
        active_window="$(xdotool getactivewindow 2>/dev/null || true)"
        if [ -n "$active_window" ] \
            && [ "$((active_window))" -eq "$((joplin_window))" ]; then
            break
        fi
        sleep 0.1
    done

    if [ -z "$active_window" ] \
        || [ "$((active_window))" -ne "$((joplin_window))" ]; then
        echo "Focus did not move to Joplin; Developer Tools will not be opened"
        return 1
    fi

    # BrowserWindow appears before Joplin finishes building its menus and
    # creating the initial renderer/zygote processes. Wait for a stable UI;
    # otherwise the click reaches an unready menu and a startup zygote produces
    # a false confirmation that DevTools opened.
    echo "Waiting for the Joplin interface to finish loading..."
    sleep 8

    xdotool windowraise "$joplin_window" 2>/dev/null || true
    if ! xdotool windowfocus --sync "$joplin_window"; then
        echo "Failed to refocus Joplin before opening DevTools"
        return 1
    fi

    zygote_count_before="$(
        pgrep -u "$current_uid" -f \
            '/snap/joplin-desktop/.*/joplin --type=zygote' |
            wc -l |
            tr -d ' '
    )"

    # Coordinates captured from the actual Joplin 3.6.15 window on this laptop:
    # first Help, then Toggle development tools in the open popup menu.
    xdotool keyup ctrl keyup shift keyup alt 2>/dev/null || true
    xdotool mousemove --window "$joplin_window" 348 15 click 1
    sleep 0.5
    xdotool mousemove --window "$joplin_window" 450 287 click 1

    zygote_count_after="$zygote_count_before"
    for _i in $(seq 1 50); do
        zygote_count_after="$(
            pgrep -u "$current_uid" -f \
                '/snap/joplin-desktop/.*/joplin --type=zygote' |
                wc -l |
                tr -d ' '
        )"
        [ "$zygote_count_after" -gt "$zygote_count_before" ] && break
        sleep 0.1
    done

    if [ "$zygote_count_after" -le "$zygote_count_before" ]; then
        echo "Developer Tools not confirmed: no new zygote process appeared"
        return 1
    fi

    echo "Joplin Desktop restarted; DevTools opened and confirmed by a process"
    echo "Opening a new Chromium window at chrome://inspect/#devices..."

    nohup chromium --new-window 'chrome://inspect/#devices' \
        </dev/null \
        >/tmp/joplin-mobile-devtools.log 2>&1 &
    disown "$!" 2>/dev/null || true

    echo "Chromium launched directly at chrome://inspect/#devices"
    return 0
}

if ! command -v xdotool >/dev/null 2>&1; then
    echo "xdotool not found. Install it with: sudo apt install xdotool"
    exit 1
fi

if ! command -v snap >/dev/null 2>&1; then
    echo "snap not found; it is required to start Joplin"
    exit 1
fi

if ! command -v chromium >/dev/null 2>&1; then
    echo "Chromium not found; it is required for chrome://inspect/#devices"
    exit 1
fi

cd -- "$project_dir" || exit 1

npm run pre-pack \
    && cp ./publish/com.volodymyroliinyk.joplin.plugin.my-calendar.jpl \
        "$HOME/snap/joplin-desktop/current/.config/joplin-desktop/plugins/" \
    && restart_joplin
