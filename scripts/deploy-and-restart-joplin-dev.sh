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

    echo "Завершення Joplin..."

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
        echo "Не всі процеси Joplin відповіли на SIGTERM; надсилаю SIGKILL..."
        pkill -KILL -u "$current_uid" -x joplin 2>/dev/null || true
        pkill -KILL -u "$current_uid" -f "$joplin_snap_process" 2>/dev/null || true
        pkill -KILL -u "$current_uid" -f "$joplin_renderer_process" 2>/dev/null || true
        sleep 2
    fi

    if pgrep -u "$current_uid" -x joplin >/dev/null \
        || pgrep -u "$current_uid" -f "$joplin_snap_process" >/dev/null \
        || pgrep -u "$current_uid" -f "$joplin_renderer_process" >/dev/null; then
        echo "Не вдалося завершити всі процеси Joplin/Electron"
        return 1
    fi

    sleep 3

    echo "Запуск Joplin через snap..."

    setsid -f snap run joplin-desktop \
        </dev/null \
        >/tmp/joplin-desktop-dev.log 2>&1

    echo "Очікую головне вікно Joplin..."

    joplin_window=""

    # У поточній snap-збірці перший запуск іноді зависає до створення
    # BrowserWindow. Один повторний запуск активує single-instance handler і
    # доводить уже запущений Joplin до показу головного вікна.
    sleep 5
    echo "Повторно активую single-instance Joplin..."
    setsid -f snap run joplin-desktop \
        </dev/null \
        >>/tmp/joplin-desktop-dev.log 2>&1

    # _NET_CLIENT_LIST_STACKING містить лише top-level вікна window manager.
    # WM_CLASS у snap-збірці нестабільний, тому звіряємо PID вікна з реальним
    # командним рядком Joplin/Electron.
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
        echo "Головне вікно Joplin не з’явилося протягом 20 секунд"
        echo "Останні повідомлення snap launcher:"
        tail -n 50 /tmp/joplin-desktop-dev.log
        echo "Останні повідомлення Joplin:"
        tail -n 50 "$HOME/snap/joplin-desktop/current/.config/joplin-desktop/log.txt"
        return 1
    fi

    echo "Знайдено top-level вікно desktop Joplin: $joplin_window"
    echo "Показую, активую вікно та відкриваю Developer Tools..."

    xdotool windowmap "$joplin_window" 2>/dev/null || true
    xdotool windowraise "$joplin_window" 2>/dev/null || true
    if ! xdotool windowfocus --sync "$joplin_window"; then
        echo "Не вдалося активувати головне вікно Joplin"
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
        echo "Фокус не перейшов до Joplin; Developer Tools не викликаю"
        return 1
    fi

    # BrowserWindow з'являється раніше, ніж Joplin завершує побудову меню та
    # створення стартових renderer/zygote процесів. Чекаємо стабільного UI,
    # інакше клік потрапляє в ще неготове меню, а стартовий zygote дає хибне
    # підтвердження відкриття DevTools.
    echo "Очікую завершення завантаження інтерфейсу Joplin..."
    sleep 8

    xdotool windowraise "$joplin_window" 2>/dev/null || true
    if ! xdotool windowfocus --sync "$joplin_window"; then
        echo "Не вдалося повторно сфокусувати Joplin перед відкриттям DevTools"
        return 1
    fi

    zygote_count_before="$(
        pgrep -u "$current_uid" -f \
            '/snap/joplin-desktop/.*/joplin --type=zygote' |
            wc -l |
            tr -d ' '
    )"

    # Координати отримані з реального вікна Joplin 3.6.15 на цьому laptop:
    # спочатку Help, потім Toggle development tools у відкритому popup-меню.
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
        echo "Developer Tools не підтверджено: новий zygote-процес не з’явився"
        return 1
    fi

    echo "Desktop Joplin перезапущений, DevTools відкрито й підтверджено процесом"
    return 0
}

if ! command -v xdotool >/dev/null 2>&1; then
    echo "Не знайдено xdotool. Встанови його командою: sudo apt install xdotool"
    exit 1
fi

if ! command -v snap >/dev/null 2>&1; then
    echo "Не знайдено snap, потрібний для запуску Joplin"
    exit 1
fi

cd -- "$project_dir" || exit 1

npm run pre-pack \
    && cp ./publish/com.volodymyroliinyk.joplin.plugin.my-calendar.jpl \
        "$HOME/snap/joplin-desktop/current/.config/joplin-desktop/plugins/" \
    && restart_joplin
