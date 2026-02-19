// src/ui/calendar.js

(function () {
    // Ensure a single shared settings object across all UI scripts.
    window.__mcUiSettings = window.__mcUiSettings || {
        weekStart: 'monday', // Default to Monday instead of undefined
        debug: false,
        dayEventsRefreshMinutes: 1,
        showEventTimeline: true,
        showWeekNumbers: false,
        timeFormat: '24h',
        dayEventsViewMode: 'single',
    };

    const uiSettings = window.__mcUiSettings;

    let __mcHasUiSettings = false;

    const MSG = Object.freeze({
        UI_READY: 'uiReady',
        UI_ACK: 'uiAck',
        UI_SETTINGS: 'uiSettings',
        REDRAW_MONTH: 'redrawMonth',
        IMPORT_DONE: 'importDone',
        IMPORT_ERROR: 'importError',
        RANGE_EVENTS: 'rangeEvents',
        SHOW_EVENTS: 'showEvents',
        RANGE_ICS: 'rangeIcs',
        CLEAR_EVENTS_CACHE: 'clearEventsCache',
    });


    function createUiLogger(prefix, outputBoxId) {

        function appendToBox(args) {
            if (!outputBoxId) return;
            const box = document.getElementById(outputBoxId);
            if (!box) return;
            try {
                const div = document.createElement('div');
                div.textContent = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                box.appendChild(div);
                box.scrollTop = box.scrollHeight;
            } catch {
                // ignore
            }
        }

        function forwardToMain(level, args) {
            try {
                // Tolerance: forward only in debug mode
                if (uiSettings.debug !== true) return;

                const pm = window.webviewApi?.postMessage;
                if (typeof pm !== 'function') return;

                const safeArgs = (args || []).map(a => {
                    if (a && typeof a === 'object' && a.message && a.stack) {
                        return {__error: true, message: a.message, stack: a.stack};

                    }
                    if (typeof a === 'string') return a;
                    try {
                        return JSON.stringify(a);
                    } catch {
                        return String(a);
                    }
                });

                pm({name: 'uiLog', source: 'calendar', level, args: safeArgs});
            } catch {
                // ignore
            }
        }


        function write(consoleFn, args) {
            if (args.length > 0 && typeof args[0] === 'string') {
                const [msg, ...rest] = args;
                consoleFn(`${prefix} ${msg}`, ...rest);
                // the level is determined by consoleFn or by the method (see below)
            } else {
                consoleFn(prefix, ...args);
                // the level is determined by consoleFn or by the method (see below)
            }
            appendToBox(args);
        }

        return {
            log: (...args) => {
                write(console.log, args);
                forwardToMain('log', args);
            },
            info: (...args) => {
                write(console.info, args);
                forwardToMain('info', args);
            },
            debug: (...args) => {
                write(console.log, args);
                forwardToMain('debug', args);
            },
            warn: (...args) => {
                write(console.warn, args);
                forwardToMain('warn', args);
            },
            error: (...args) => {
                write(console.error, args);
                forwardToMain('error', args);
            }
        };
    }

    // Expose for unit tests; keep singleton across reloads
    const uiLogger = window.__mcUiLogger || (window.__mcUiLogger = createUiLogger('[MyCalendar]', 'mc-log'));

    // console.log('[MyCalendar][DBG][weekStart] uiSettings 3::', uiSettings);


    function log(...args) {
        if (uiSettings.debug !== true) return;
        uiLogger.log(...args);
    }

    function applyDebugUI() {
        const box = document.getElementById('mc-log');
        if (box) box.style.display = (uiSettings.debug === true) ? '' : 'none';
    }


    function mcRegisterOnMessage(handler) {
        window.__mcMsgHandlers = window.__mcMsgHandlers || [];
        window.__mcMsgHandlers.push(handler);

        if (window.__mcMsgDispatcherInstalled) return;
        window.__mcMsgDispatcherInstalled = true;

        if (window.webviewApi?.onMessage) {
            window.webviewApi.onMessage((ev) => {
                const msg = (ev && ev.message) ? ev.message : ev;
                for (const h of window.__mcMsgHandlers) {
                    try {
                        h(msg);
                    } catch (e) {
                        uiLogger.error('handler error', e);
                    }
                }
            });
        }
    }

    function init() {
        try {
            log('init start');

            const DAY = 24 * 60 * 60 * 1000;

            function getWeekdayMeta() {
                // JS Date.getDay(): Sun=0..Sat=6
                // We keep the UI labels stable (short English) because the grid is compact;
                // actual date formatting elsewhere is localized via toLocaleDateString.
                if (uiSettings.weekStart === 'sunday') {
                    return [
                        {label: 'Sun', dow: 0},
                        {label: 'Mon', dow: 1},
                        {label: 'Tue', dow: 2},
                        {label: 'Wed', dow: 3},
                        {label: 'Thu', dow: 4},
                        {label: 'Fri', dow: 5},
                        {label: 'Sat', dow: 6},
                    ];
                }

                // Default: Monday week start
                return [
                    {label: 'Mon', dow: 1},
                    {label: 'Tue', dow: 2},
                    {label: 'Wed', dow: 3},
                    {label: 'Thu', dow: 4},
                    {label: 'Fri', dow: 5},
                    {label: 'Sat', dow: 6},
                    {label: 'Sun', dow: 0},
                ];
            }

            function getWeekNumber(date) {
                if (uiSettings.weekStart === 'sunday') {
                    // Traditional (US/Standard) numbering: Week containing Jan 1 is W1.
                    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    const sun = new Date(d.getTime());
                    sun.setDate(d.getDate() - d.getDay());

                    const sat = new Date(sun.getTime());
                    sat.setDate(sun.getDate() + 6);

                    const targetJan1 = (sat.getFullYear() > sun.getFullYear())
                        ? new Date(sat.getFullYear(), 0, 1)
                        : new Date(sun.getFullYear(), 0, 1);

                    const startOfFirstWeek = new Date(targetJan1.getTime());
                    startOfFirstWeek.setDate(targetJan1.getDate() - targetJan1.getDay());

                    const diff = sun.getTime() - startOfFirstWeek.getTime();
                    return Math.floor(diff / (7 * 86400000)) + 1;
                }

                // ISO week number (Monday start): Thursday of the week determines the year.
                const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                const dayNum = d.getUTCDay() || 7;
                d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
            }

            // Local North (00:00) in MS of the era
            function localMidnightTs(d) {
                return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            }

            // The first day of the month (locally)
            function startOfMonthLocal(d) {
                return new Date(d.getFullYear(), d.getMonth(), 1);
            }

            // shift months (locally) and normalization on the first day
            function addMonthsLocal(dateLocal, delta) {
                const d = new Date(dateLocal.getTime());
                d.setMonth(d.getMonth() + delta);
                return startOfMonthLocal(d);
            }

            // Beginning 6-week mesh (Monday)-locally
            function startOfCalendarGridLocal(current) {
                const first = new Date(current.getFullYear(), current.getMonth(), 1);

                // console.log('[MyCalendar][DBG][weekStart] uiSettings.weekStart 4::', uiSettings.weekStart);

                const firstDayJs = (uiSettings.weekStart === 'sunday') ? 0 : 1; // Sun=0, Mon=1
                const jsDow = first.getDay(); // Sun=0..Sat=6
                const offset = (jsDow - firstDayJs + 7) % 7;

                const start = new Date(first.getTime() - offset * DAY);
                return new Date(start.getFullYear(), start.getMonth(), start.getDate());
            }

            // End of the grid (42 cells)
            function endOfCalendarGridLocal(current) {
                const s = startOfCalendarGridLocal(current);
                return new Date(s.getTime() + 42 * DAY - 1);
            }


            const $toolbar = () => document.getElementById('mc-toolbar');
            const $grid = () => document.getElementById('mc-grid');
            const $elist = () => document.getElementById('mc-events-list');
            const $dayLabel = () => document.getElementById('mc-events-day-label');

            function setGridLoading(isLoading) {
                const grid = $grid();
                if (!grid) return;
                grid.classList.toggle('mc-loading', !!isLoading);
            }

            function updateDayEventsHeader(dayStartTs) {
                const el = $dayLabel();
                if (!el) return;

                const d = new Date(dayStartTs);

                // Shows only "day + month" (localized by UI/system language)
                el.textContent = d.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                });
            }


            let current = startOfMonthLocal(new Date());
            let selectedDayUtc = localMidnightTs(new Date());

            let isPickerOpen = false;
            let pickerYear = null;

            // Events received for the current range of calendar grid (42 days)
            let gridEvents = [];


            // Local device TZ
            function monthLabel(d) {
                return d.toLocaleString(undefined, {month: 'long', year: 'numeric'});
            }

            let dayEventsRefreshTimer = null;

            function clearDayEventsRefreshTimer() {
                if (dayEventsRefreshTimer) {
                    clearTimeout(dayEventsRefreshTimer);
                    dayEventsRefreshTimer = null;
                }
            }

            function applyDayTimelineVisibility() {
                const ul = document.getElementById('mc-events-list');
                if (!ul) return;

                const hidden = uiSettings.showEventTimeline === false;
                ul.classList.toggle('mc-hide-timeline', hidden);

                // Ensure immediate behavior on settings toggle without requiring a full re-render.
                if (hidden) {
                    ul.querySelectorAll('.mc-event-timeline').forEach((el) => el.remove());
                    ul.querySelectorAll('.mc-events-timeline-now-line-wrap').forEach((el) => el.remove());
                }
            }

            function markPastDayEvents() {
                const ul = document.getElementById('mc-events-list');
                if (!ul) return;
                const now = Date.now();

                ul.querySelectorAll('.mc-event').forEach((li) => {
                    const start = Number(li.dataset.startUtc || '');
                    const fallback = Number.isFinite(start) ? start : Number(li.dataset.endUtc || '');
                    const end = Number(li.dataset.endUtc || fallback || '');
                    const isPast = Number.isFinite(end) && end <= now;
                    li.classList.toggle('mc-event-past', isPast);
                });

                regroupDayEventsByStatus(ul, now);
            }

            function scheduleDayEventsRefresh() {
                clearDayEventsRefreshTimer();
                if (document.hidden) return;

                // When event timeline is hidden, skip scheduling these UI update timers.
                // They depend on dayEventsRefreshMinutes and are only useful when timeline markers are shown.
                if (uiSettings.showEventTimeline === false && uiSettings.dayEventsViewMode !== 'grouped') {
                    return;
                }

                const ul = document.getElementById('mc-events-list');
                if (!ul) return;

                const now = Date.now();
                let nextChange = Number.POSITIVE_INFINITY;

                ul.querySelectorAll('.mc-event').forEach((li) => {
                    const start = Number(li.dataset.startUtc || '');
                    const fallback = Number.isFinite(start) ? start : Number(li.dataset.endUtc || '');
                    const end = Number(li.dataset.endUtc || fallback || '');
                    if (!Number.isFinite(end)) return;

                    if (uiSettings.dayEventsViewMode === 'grouped' && Number.isFinite(start)) {
                        if (start >= now && start < nextChange) nextChange = start;
                    }
                    if (end >= now && end < nextChange) nextChange = end;
                });

                if (!Number.isFinite(nextChange)) return;

                const refreshMin = Number(uiSettings.dayEventsRefreshMinutes);
                const fallbackMs = (Number.isFinite(refreshMin) && refreshMin > 0 ? refreshMin : 1) * 60 * 1000;

                const delay = Math.max(1000, Math.min((nextChange - now) + 1000, fallbackMs));

                dayEventsRefreshTimer = setTimeout(() => {
                    markPastDayEvents();
                    scheduleDayEventsRefresh();
                }, delay);
            }

            // Updates "current time" dot inside per-event 24h timelines (day list)
            let dayNowTimelineTimer = null;

            function clearDayNowTimelineTimer() {
                if (dayNowTimelineTimer) {
                    clearTimeout(dayNowTimelineTimer);
                    dayNowTimelineTimer = null;
                }
            }

            function getDayEventsRefreshMs() {
                const refreshMin = Number(uiSettings.dayEventsRefreshMinutes);
                const minutes = (Number.isFinite(refreshMin) && refreshMin > 0) ? refreshMin : 1;
                return minutes * 60 * 1000;
            }

            function clampPct(p) {
                if (!Number.isFinite(p)) return 0;
                return Math.max(0, Math.min(100, p));
            }

            function getDayEventsViewMode() {
                return uiSettings.dayEventsViewMode === 'grouped' ? 'grouped' : 'single';
            }

            function getEventStatus(startUtc, endUtc, now) {
                if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc)) return 'past';
                if (now < startUtc) return 'feature';
                if (now < endUtc) return 'ongoing';
                return 'past';
            }

            function createGroupSection(label, status) {
                const section = document.createElement('li');
                section.className = 'mc-day-events-group';
                section.dataset.group = status;

                const title = document.createElement('div');
                title.className = 'mc-day-events-group-title';
                title.textContent = label;

                const list = document.createElement('ul');
                list.className = 'mc-day-events-group-list';
                list.dataset.groupList = status;

                section.appendChild(title);
                section.appendChild(list);
                return section;
            }

            function getGroupedLists(ul) {
                return {
                    ongoing: ul.querySelector('[data-group-list="ongoing"]'),
                    feature: ul.querySelector('[data-group-list="feature"]'),
                    past: ul.querySelector('[data-group-list="past"]'),
                };
            }

            function appendEventToGroup(ul, li, status) {
                const lists = getGroupedLists(ul);
                const list = lists[status];
                if (!list) return;
                list.appendChild(li);
            }

            function updateGroupedSectionVisibility(ul) {
                if (getDayEventsViewMode() !== 'grouped') return;
                const sections = Array.from(ul.querySelectorAll('.mc-day-events-group'));
                for (const section of sections) {
                    const list = section.querySelector('.mc-day-events-group-list');
                    if (!list) continue;
                    const hasEvents = list.querySelector('.mc-event') !== null;
                    section.style.display = hasEvents ? '' : 'none';
                }
            }

            function regroupDayEventsByStatus(ul, now) {
                if (getDayEventsViewMode() !== 'grouped') return;
                const events = Array.from(ul.querySelectorAll('.mc-event'));
                for (const li of events) {
                    const start = Number(li.dataset.startUtc || '');
                    const fallback = Number.isFinite(start) ? start : Number(li.dataset.endUtc || '');
                    const end = Number(li.dataset.endUtc || fallback || '');
                    const status = getEventStatus(start, end, now);
                    appendEventToGroup(ul, li, status);
                }
                updateGroupedSectionVisibility(ul);
            }

            function updateDayNowTimelineDot() {
                if (uiSettings.showEventTimeline === false) return;

                const ul = document.getElementById('mc-events-list');
                if (!ul) return;

                const dayStartUtc = Number(ul.dataset.dayStartUtc || '');
                applyDayTimelineVisibility();
                if (!Number.isFinite(dayStartUtc)) return;

                const now = Date.now();
                const inDay = now >= dayStartUtc && now < (dayStartUtc + DAY);
                const pct = Math.max(0, Math.min(100, ((now - dayStartUtc) / DAY) * 100));

                const line = ul.querySelector('.mc-events-timeline-now-line');
                if (line) {
                    const el = /** @type {HTMLElement} */ (line);
                    if (!inDay) {
                        el.style.display = 'none';
                    } else {
                        el.style.display = 'block';
                        el.style.left = pct + '%';
                    }
                }
            }

            function scheduleDayNowTimelineTick() {
                clearDayNowTimelineTimer();
                if (document.hidden) return;

                if (uiSettings.showEventTimeline === false) return;

                const delay = Math.max(1000, getDayEventsRefreshMs());

                dayNowTimelineTimer = setTimeout(() => {
                    updateDayNowTimelineDot();
                    scheduleDayNowTimelineTick();
                }, delay);
            }

            if (window.webviewApi?.onMessage) {
                mcRegisterOnMessage(onPluginMessage);
            } else {
                log('webviewApi.onMessage missing');
            }

            // Connecting with backend.
            if (window.webviewApi?.postMessage) {
                applyDebugUI();
                window.webviewApi.postMessage({name: 'uiReady'});
                log('uiReady sent');

                // Desktop/Mobile: panel can be hidden/shown without reloading the plugin backend.
                // When UI becomes visible again, re-announce readiness so backend re-sends uiSettings.
                let _uiReadyDebounce = 0;

                function sendUiReadyAgain() {
                    clearTimeout(_uiReadyDebounce);
                    _uiReadyDebounce = setTimeout(() => {
                        try {
                            log('sending uiReady again (visibility/focus)');
                            window.webviewApi?.postMessage?.({name: 'uiReady'});
                            // Also trigger a redraw to ensure UI is not stuck
                            drawMonth();
                        } catch (_err) {
                            // ignore
                        }
                    }, 50);
                }

                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) sendUiReadyAgain();

                    if (document.hidden) {
                        clearDayEventsRefreshTimer();
                        clearDayNowTimelineTimer();
                        return;
                    }
                    markPastDayEvents();
                    scheduleDayEventsRefresh();
                    updateDayNowTimelineDot();
                    scheduleDayNowTimelineTick();
                });
                // window.addEventListener('focus', () => sendUiReadyAgain());

            } else {
                log('webviewApi.postMessage missing at init');
            }

            // ---- Backend readiness (webviewApi race fix) ----
            // Sometimes on first Joplin start the panel DOM is ready earlier than webviewApi injection.
            // Then initial uiReady/requestRangeEvents are lost until user clicks "Today".
            function ensureBackendReady(cb) {
                // shared flags across reloads
                window.__mcBackendReady = window.__mcBackendReady || false;
                window.__mcUiReadySent = window.__mcUiReadySent || false;
                window.__mcOnMessageRegistered = window.__mcOnMessageRegistered || false;

                const tryNow = () => {
                    const canPost = !!window.webviewApi?.postMessage;
                    const canOnMsg = !!window.webviewApi?.onMessage;
                    if (!canPost || !canOnMsg) return false;

                    if (!window.__mcOnMessageRegistered) {
                        mcRegisterOnMessage(onPluginMessage);
                        window.__mcOnMessageRegistered = true;
                    }

                    if (!window.__mcUiReadySent) {
                        window.webviewApi.postMessage({name: 'uiReady'});
                        window.__mcUiReadySent = true;
                        log('uiReady sent');
                    }

                    window.__mcBackendReady = true;
                    return true;
                };

                if (window.__mcBackendReady && window.__mcUiReadySent && window.__mcOnMessageRegistered) {
                    if (cb) cb();
                    return;
                }

                if (tryNow()) {
                    if (cb) cb();
                    return;
                }

                log('backend not ready yet; waiting for webviewApi...');
                let attempts = 0;
                const timer = setInterval(() => {
                    attempts++;
                    if (tryNow()) {
                        clearInterval(timer);
                        if (cb) cb();
                        return;
                    }
                    // ~15 seconds max (increased from 5s to fix Android resume race)
                    if (attempts >= 150) {
                        clearInterval(timer);
                        log('backend still not ready after waiting; will keep UI visible, user action may trigger later');
                        // Force stop loading spinner so it doesn't spin forever
                        setGridLoading(false);
                    }
                }, 100);
            }

            // ---- Test hooks (enabled only in Jest/jsdom) ----
            // Must be inside init() because many helpers are function-scoped here.
            try {
                if (typeof window !== 'undefined' && window.__mcTestMode === true) {
                    window.__mcTest = {
                        ensureBackendReady,
                        getDayEventsRefreshMs,
                        updateDayNowTimelineDot,
                    };
                }
            } catch (_e) {
                // ignore
            }


            function unwrapPluginMessage(msg) {
                // Joplin sometimes wraps as { message: <payload> }
                if (msg && typeof msg === 'object' && msg.message) return msg.message;

                // Defensive: sometimes events can arrive without a name
                if (msg && typeof msg === 'object' && !msg.name && Array.isArray(msg.events)) {
                    return {name: MSG.RANGE_EVENTS, events: msg.events};
                }

                return msg;
            }

            function onPluginMessage(msg) {
                msg = unwrapPluginMessage(msg);

                log('onMessage:', msg && msg.name ? msg.name : msg);
                if (!msg || !msg.name) return;

                const handlers = {
                    [MSG.UI_ACK]: () => {
                        log('uiAck received');
                    },

                    [MSG.UI_SETTINGS]: () => {
                        const prevWeekStart = uiSettings.weekStart;
                        const prevShowEventTimeline = uiSettings.showEventTimeline;
                        const prevShowWeekNumbers = uiSettings.showWeekNumbers;
                        const prevTimeFormat = uiSettings.timeFormat;
                        const prevDayEventsViewMode = getDayEventsViewMode();

                        if (msg.weekStart === 'monday' || msg.weekStart === 'sunday') {
                            uiSettings.weekStart = msg.weekStart;
                        }

                        if (typeof msg.showWeekNumbers === 'boolean') {
                            uiSettings.showWeekNumbers = msg.showWeekNumbers;
                        }

                        if (typeof msg.debug === 'boolean') {
                            uiSettings.debug = msg.debug;
                            applyDebugUI();
                        }

                        if (msg.dayEventsRefreshMinutes !== undefined) {
                            const v = Number(msg.dayEventsRefreshMinutes);
                            if (Number.isFinite(v) && v > 0) {
                                uiSettings.dayEventsRefreshMinutes = v;
                            }
                        }

                        if (typeof msg.showEventTimeline === 'boolean') {
                            uiSettings.showEventTimeline = msg.showEventTimeline;
                        }

                        if (msg.timeFormat === '12h' || msg.timeFormat === '24h') {
                            uiSettings.timeFormat = msg.timeFormat;
                        }

                        if (msg.dayEventsViewMode === 'single' || msg.dayEventsViewMode === 'grouped') {
                            uiSettings.dayEventsViewMode = msg.dayEventsViewMode;
                        }

                        // Apply immediately (no re-render required)
                        if (prevShowEventTimeline !== uiSettings.showEventTimeline) {
                            applyDayTimelineVisibility();
                        }

                        const dayEventsViewModeChanged = prevDayEventsViewMode !== getDayEventsViewMode();
                        if (dayEventsViewModeChanged) {
                            renderDayEvents(selectedDayUtc);
                        }

                        // Recompute day-list UI markers and timers according to new settings
                        if (!dayEventsViewModeChanged) {
                            clearDayEventsRefreshTimer();
                            clearDayNowTimelineTimer();
                            markPastDayEvents();
                            updateDayNowTimelineDot();
                            scheduleDayNowTimelineTick();
                            scheduleDayEventsRefresh();
                        }

                        const weekStartChanged = prevWeekStart !== uiSettings.weekStart;
                        const showWeekNumbersChanged = prevShowWeekNumbers !== uiSettings.showWeekNumbers;
                        const timeFormatChanged = prevTimeFormat !== uiSettings.timeFormat;
                        const firstSettingsArrived = !__mcHasUiSettings;
                        __mcHasUiSettings = true;

                        if (weekStartChanged || showWeekNumbersChanged || timeFormatChanged || (firstSettingsArrived && !gridEvents.length)) {
                            drawMonth();
                        }
                    },

                    [MSG.REDRAW_MONTH]: () => {
                        drawMonth();
                    },

                    // --- ICS import complete (success or error) -> restart grid ---
                    [MSG.IMPORT_DONE]: () => {
                        log('import finished -> refreshing calendar grid');
                        gridEvents = [];
                        setGridLoading(true);
                        drawMonth();
                    },
                    [MSG.IMPORT_ERROR]: () => {
                        log('import finished -> refreshing calendar grid');
                        gridEvents = [];
                        setGridLoading(true);
                        drawMonth();
                    },

                    [MSG.RANGE_EVENTS]: () => {
                        log('got rangeEvents:', (msg.events || []).length);
                        gridEvents = msg.events || [];

                        if (rangeRequestTimer) {
                            clearTimeout(rangeRequestTimer);
                            rangeRequestTimer = null;
                        }

                        setGridLoading(false);

                        paintGrid();
                        renderDayEvents(selectedDayUtc);
                    },

                    [MSG.SHOW_EVENTS]: () => {
                        log('got showEvents:', (msg.events || []).length);
                        renderDayEvents(msg.dateUtc);
                    },

                    [MSG.RANGE_ICS]: () => {
                        log('got ICS bytes:', (msg.ics || '').length);
                    },
                };

                const handler = handlers[msg.name];
                if (handler) handler();
            }

            function button(text, title, onClick) {
                const b = document.createElement('button');
                b.className = 'mc-btn';
                b.type = 'button';
                b.title = title;
                b.textContent = text;
                b.addEventListener('click', onClick);
                b.classList.add('mc-calendar-nav-btn');
                return b;
            }

            function renderMonthYearPicker() {
                const dropdown = document.createElement('div');
                dropdown.className = 'mc-picker-dropdown';
                dropdown.addEventListener('click', (e) => e.stopPropagation());

                if (pickerYear === null) {
                    pickerYear = current.getFullYear();
                }

                const yearRow = document.createElement('div');
                yearRow.className = 'mc-picker-year-row';

                const btnPrevYear = button('‹', 'Previous year', () => {
                    pickerYear--;
                    renderToolbar();
                });
                const yearLabel = document.createElement('div');
                yearLabel.className = 'mc-picker-year';
                yearLabel.textContent = String(pickerYear);
                const btnNextYear = button('›', 'Next year', () => {
                    pickerYear++;
                    renderToolbar();
                });

                yearRow.appendChild(btnPrevYear);
                yearRow.appendChild(yearLabel);
                yearRow.appendChild(btnNextYear);
                dropdown.appendChild(yearRow);

                const monthsGrid = document.createElement('div');
                monthsGrid.className = 'mc-picker-months';

                const monthNames = [];
                for (let m = 0; m < 12; m++) {
                    const d = new Date(2000, m, 1);
                    monthNames.push(d.toLocaleString(undefined, {month: 'short'}));
                }

                monthNames.forEach((name, idx) => {
                    const mBtn = document.createElement('div');
                    mBtn.className = 'mc-picker-month';
                    if (idx === current.getMonth() && pickerYear === current.getFullYear()) {
                        mBtn.classList.add('mc-active');
                    }
                    mBtn.textContent = name;
                    mBtn.addEventListener('click', () => {
                        current = new Date(pickerYear, idx, 1);
                        isPickerOpen = false;
                        pickerYear = null;
                        drawMonth();
                    });
                    monthsGrid.appendChild(mBtn);
                });

                dropdown.appendChild(monthsGrid);

                // const footer = document.createElement('div');
                // footer.style.display = 'flex';
                // footer.style.justifyContent = 'center';
                // footer.style.marginTop = '8px';
                // footer.style.paddingTop = '8px';
                // footer.style.borderTop = '1px solid var(--joplin-divider-color)';
                //
                // const btnTodayPicker = button('Go to Today', 'Go to current month', () => {
                //     current = startOfMonthLocal(new Date());
                //     selectedDayUtc = localMidnightTs(new Date());
                //     isPickerOpen = false;
                //     pickerYear = null;
                //     drawMonth();
                // });
                // btnTodayPicker.style.width = '100%';
                // footer.appendChild(btnTodayPicker);
                // dropdown.appendChild(footer);

                return dropdown;
            }

            function renderToolbar() {
                const root = $toolbar();
                if (!root) return;
                root.innerHTML = '';
                const wrap = document.createElement('div');
                wrap.className = 'mc-toolbar-inner';

                const btnPrev = button('‹', 'Previous month', () => {
                    isPickerOpen = false;
                    current = addMonthsLocal(current, -1);
                    drawMonth();
                });
                const btnToday = button('Today', 'Today', () => {
                    isPickerOpen = false;
                    current = startOfMonthLocal(new Date());
                    selectedDayUtc = localMidnightTs(new Date());
                    drawMonth();
                });
                const btnNext = button('›', 'Next month', () => {
                    isPickerOpen = false;
                    current = addMonthsLocal(current, +1);
                    drawMonth();
                });

                // Month YYYY title.
                const title = document.createElement('div');
                title.className = 'mc-title';
                title.id = 'mc-picker-trigger';
                title.innerHTML = `${monthLabel(current)} <span class="mc-picker-arrow">▾</span>`;
                title.addEventListener('click', (e) => {
                    e.stopPropagation();
                    isPickerOpen = !isPickerOpen;
                    if (isPickerOpen) {
                        pickerYear = current.getFullYear();
                    }
                    renderToolbar();
                });

                wrap.appendChild(btnPrev);
                wrap.appendChild(btnToday);
                wrap.appendChild(btnNext);
                wrap.appendChild(title);

                const btnClearCache = button('⟳', 'Clear events cache', () => {
                    isPickerOpen = false;
                    gridEvents = [];
                    setGridLoading(true);
                    window.webviewApi?.postMessage?.({name: MSG.CLEAR_EVENTS_CACHE});
                });
                btnClearCache.classList.add('mc-cache-clear-btn');
                btnClearCache.setAttribute('aria-label', 'Clear events cache');
                wrap.appendChild(btnClearCache);

                if (isPickerOpen) {
                    const picker = renderMonthYearPicker();
                    title.appendChild(picker);
                }

                root.appendChild(wrap);
            }

            document.addEventListener('click', () => {
                if (isPickerOpen) {
                    isPickerOpen = false;
                    renderToolbar();
                }
            });

            function drawMonth() {
                // We no longer skip if weekStart is missing; getWeekdayMeta/startOfCalendarGridLocal have defaults.
                // This ensures the loader and toolbar are visible immediately.
                renderToolbar();
                renderGridSkeleton();

                setGridLoading(true);

                const from = startOfCalendarGridLocal(current);
                const to = endOfCalendarGridLocal(current);

                requestMonthRangeWithRetry(from, to);
            }

            let rangeRequestTimer = null;

            function requestMonthRangeWithRetry(from, to) {
                // First request
                ensureBackendReady(() => {
                    log('requestRange', from.toISOString(), '→', to.toISOString());
                    window.webviewApi.postMessage({
                        name: 'requestRangeEvents',
                        fromUtc: from.getTime(),
                        toUtc: to.getTime(),
                    });

                    // Retry logic moved inside to ensure sequential execution
                    if (rangeRequestTimer) clearTimeout(rangeRequestTimer);
                    rangeRequestTimer = setTimeout(() => {
                        if (!Array.isArray(gridEvents) || gridEvents.length === 0) {
                            log('rangeEvents timeout - retrying once');
                            // Backend is already confirmed ready here
                            window.webviewApi.postMessage({
                                name: 'requestRangeEvents',
                                fromUtc: from.getTime(),
                                toUtc: to.getTime(),
                            });
                        }
                    }, 2000);
                });
            }

            function renderGridSkeleton() {
                const start = startOfCalendarGridLocal(current);
                const todayTs = localMidnightTs(new Date());
                const grid = $grid();
                if (!grid) return;
                grid.innerHTML = '';
                grid.classList.toggle('mc-show-week-numbers', !!uiSettings.showWeekNumbers);

                // Loader overlay (accessibility-friendly)
                const loader = document.createElement('div');
                loader.className = 'mc-grid-loader';
                loader.setAttribute('role', 'status');
                loader.setAttribute('aria-live', 'polite');
                loader.setAttribute('aria-label', 'Loading calendar');
                loader.innerHTML = '<div class="mc-grid-spinner"></div>';
                grid.appendChild(loader);

                const head = document.createElement('div');
                head.className = 'mc-grid-head';
                if (uiSettings.showWeekNumbers) {
                    const c = document.createElement('div');
                    c.className = 'mc-grid-head-cell mc-week-num-head';
                    c.textContent = 'W';
                    head.appendChild(c);
                }
                for (const {label, dow} of getWeekdayMeta()) {
                    const c = document.createElement('div');
                    c.className = 'mc-grid-head-cell';
                    c.textContent = label;
                    c.dataset.dow = String(dow);
                    // Weekend header cells (Sat/Sun)
                    if (dow === 0 || dow === 6) c.classList.add('mc-weekend');

                    head.appendChild(c);
                }
                grid.appendChild(head);

                const body = document.createElement('div');
                body.className = 'mc-grid-body';


                for (let i = 0; i < 42; i++) {
                    const cellDate = new Date(start);
                    cellDate.setDate(start.getDate() + i);

                    if (uiSettings.showWeekNumbers && i % 7 === 0) {
                        const wn = document.createElement('div');
                        wn.className = 'mc-week-num-cell';
                        wn.textContent = String(getWeekNumber(cellDate));
                        body.appendChild(wn);
                    }

                    const cellTs = localMidnightTs(cellDate);

                    const cell = document.createElement('div');
                    cell.className = 'mc-cell';
                    cell.dataset.utc = String(cellTs);

                    const dow = cellDate.getDay(); // Sun=0..Sat=6
                    if (dow === 0 || dow === 6) cell.classList.add('mc-weekend');

                    const inThisMonth = cellDate.getMonth() === current.getMonth();
                    if (!inThisMonth) cell.classList.add('mc-out');

                    // Visually mute all days before today (including leading/trailing days
                    // from adjacent months shown in the 6-week grid).
                    if (cellTs < todayTs) cell.classList.add('mc-past');

                    if (selectedDayUtc === cellTs) cell.classList.add('mc-selected');
                    if (todayTs === cellTs) cell.classList.add('mc-today');

                    const n = document.createElement('div');
                    n.className = 'mc-daynum';
                    n.textContent = String(cellDate.getDate());
                    cell.appendChild(n);

                    cell.addEventListener('click', () => {
                        selectedDayUtc = cellTs;
                        window.webviewApi?.postMessage?.({name: 'dateClick', dateUtc: selectedDayUtc});
                        renderDayEvents(selectedDayUtc);
                        paintSelection();
                    });

                    body.appendChild(cell);
                }

                grid.appendChild(body);
            }


            function paintSelection() {
                const body = document.querySelector('#mc-grid .mc-grid-body');
                if (!body) return;
                body.querySelectorAll('.mc-cell').forEach(c => c.classList.remove('mc-selected'));
                const sel = body.querySelector(`.mc-cell[data-utc="${selectedDayUtc}"]`);
                if (sel) sel.classList.add('mc-selected');
            }

            function fmtHM(ts, tz) {
                try {
                    // tz expected like "America/Toronto"
                    if (tz) {
                        return new Intl.DateTimeFormat(undefined, {
                            timeZone: tz,
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: uiSettings.timeFormat === '12h',
                        }).format(new Date(ts));
                    }
                } catch {
                    // ignore invalid tz and fallback
                }

                // fallback: environment timezone
                return new Date(ts).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: uiSettings.timeFormat === '12h'
                });
            }

            // Slice an event interval into a specific local-day interval.
            // dayStartTs is epoch ms for local midnight of the day cell.
            // Returns null if the event does not intersect the day.
            function sliceEventForDay(ev, dayStartTs) {
                const dayEndTs = dayStartTs + 24 * 3600 * 1000 - 1;
                const evStart = ev.startUtc;
                const evEnd = (ev.endUtc ?? ev.startUtc);
                const segStart = Math.max(evStart, dayStartTs);
                const segEnd = Math.min(evEnd, dayEndTs);
                if (segEnd < segStart) return null;
                return {startUtc: segStart, endUtc: segEnd};
            }

            function paintGrid() {
                const body = document.querySelector('#mc-grid .mc-grid-body');
                if (!body) return;

                // Clean the previous indicators
                // body.querySelectorAll('.mc-bars').forEach(b => b.innerHTML = '');
                // body.querySelectorAll('.mc-count').forEach(c => {
                //     c.textContent = '';
                //     c.style.display = 'none';
                // });

                // Gather events by day (store per-day slices so multi-day events render correctly)
                const byDay = new Map(); // dayStartTs (local midnight epoch ms) -> [{ ev, slice }]
                for (const ev of gridEvents) {
                    const startDay = localMidnightTs(new Date(ev.startUtc));
                    const endDay = localMidnightTs(new Date((ev.endUtc ?? ev.startUtc)));
                    for (let ts = startDay; ts <= endDay; ts += 24 * 3600 * 1000) {
                        const slice = sliceEventForDay(ev, ts);
                        if (!slice) continue;
                        if (!byDay.has(ts)) byDay.set(ts, []);
                        byDay.get(ts).push({ev, slice});
                    }
                }

                // Auxiliary: Get/create subsidiaries in a cell
                function ensureParts(cell) {
                    // let bars = cell.querySelector(':scope > .mc-bars');
                    let badge = cell.querySelector('.mc-count');
                    // if (!bars) {
                    //     bars = document.createElement('div');
                    //     bars.className = 'mc-bars';
                    //     cell.appendChild(bars);
                    // }
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.className = 'mc-count';
                        cell.appendChild(badge);
                    }
                    // return {bars, badge};
                    return {badge};
                    // return {bars};
                }

                // To paint
                byDay.forEach((events, dayUtc) => {
                    const cell = body.querySelector(`.mc-cell[data-utc="${dayUtc}"]`);
                    if (!cell) return;

                    // const {bars,badge} = ensureParts(cell);
                    const {badge} = ensureParts(cell);
                    // const {bars} = ensureParts(cell);

                    // Color Event indicators in the calendar grid
                    // const top = events.slice().sort((a, b) => a.slice.startUtc - b.slice.startUtc);
                    // for (const item of top) {
                    //     const ev = item.ev;
                    //     const bar = document.createElement('div');
                    //     bar.className = 'mc-bar';
                    //     if (ev.color) bar.style.background = ev.color;
                    //     bars.appendChild(bar);
                    // }

                    // Counter in the upper right corner
                    badge.textContent = String(events.length);
                    badge.style.display = 'block';
                });
            }

            function renderDayEvents(dayStartUtc) {
                clearDayEventsRefreshTimer();
                clearDayNowTimelineTimer();
                updateDayEventsHeader(dayStartUtc);

                const ul = $elist();
                if (!ul) return;
                ul.innerHTML = '';
                ul.dataset.dayStartUtc = String(dayStartUtc);
                // const dayEndUtc = dayStartUtc + 24 * 3600 * 1000 - 1;

                if (!Array.isArray(gridEvents) || gridEvents.length === 0) {
                    log('source EMPTY - gridEvents not ready yet');
                    return;
                }
                const source = gridEvents;
                log('source LENGTH', source.length);
                // The event belongs to the day if the interval [Start, end] intersects [daystart, daynd]

                const daySlices = [];
                for (const ev of source) {
                    const slice = sliceEventForDay(ev, dayStartUtc);
                    if (!slice) continue;
                    daySlices.push({ev, slice});
                }

                daySlices.sort((a, b) => a.slice.startUtc - b.slice.startUtc);

                log('renderDayEvents', new Date(dayStartUtc).toISOString().slice(0, 10), 'count=', daySlices.length);

                if (!daySlices.length) {
                    const li = document.createElement('li');
                    li.className = 'mc-empty';
                    li.textContent = 'There are no events';
                    ul.appendChild(li);
                    return;
                }

                if (uiSettings.showEventTimeline !== false) {
                    const wrap = document.createElement('div');
                    wrap.className = 'mc-events-timeline-now-line-wrap';
                    const line = document.createElement('div');
                    line.className = 'mc-events-timeline-now-line';
                    wrap.appendChild(line);
                    ul.appendChild(wrap);
                }

                const isGrouped = getDayEventsViewMode() === 'grouped';
                if (isGrouped) {
                    ul.appendChild(createGroupSection('Ongoing', 'ongoing'));
                    ul.appendChild(createGroupSection('Feature', 'feature'));
                    ul.appendChild(createGroupSection('Past', 'past'));
                }

                for (const item of daySlices) {
                    const ev = item.ev;
                    const slice = item.slice;
                    const li = document.createElement('li');
                    li.className = 'mc-event';
                    const color = document.createElement('span');
                    color.className = 'mc-color';
                    color.style.background = ev.color || 'var(--mc-default-event-color)';
                    const title = document.createElement('span');
                    title.className = 'mc-title';
                    title.textContent = ev.title || '(without a title)';
                    const t = document.createElement('span');
                    t.className = 'mc-time';
                    const tz = ev.tz; // comes from plugin-side events
                    const label = (slice.endUtc !== slice.startUtc)
                        ? `${fmtHM(slice.startUtc, tz)}–${fmtHM(slice.endUtc, tz)}`
                        : fmtHM(slice.startUtc, tz);

                    t.textContent = label;
                    li.appendChild(color);
                    li.appendChild(title);

                    if (ev.hasAlarms) {
                        const alarm = document.createElement('span');
                        alarm.className = 'mc-alarm-icon';
                        alarm.innerHTML = `<svg viewBox="0 0 448 512"><path fill="currentColor" d="M224 512c35.3 0 64-28.7 64-64H160c0 35.3 28.7 64 64 64zm176-128v-152c0-82.8-51.7-152.6-123.5-177.1V40c0-22.1-17.9-40-40-40s-40 17.9-40 40v14.9C101.7 79.4 50 149.2 50 232v152l-37.6 56.4c-8.7 13.1 0.7 31.6 16.5 31.6h390.2c15.8 0 25.2-18.5 16.5-31.6L400 384z"/></svg>`;
                        li.appendChild(alarm);
                    }

                    li.appendChild(t);

                    // 24h timeline under the event (segment = event slice)
                    if (uiSettings.showEventTimeline !== false) {
                        const timeline = document.createElement('div');
                        timeline.className = 'mc-event-timeline';

                        const seg = document.createElement('div');
                        seg.className = 'mc-event-timeline-seg';
                        seg.style.background = ev.color || 'var(--mc-default-event-color)';

                        const startPct = clampPct(((slice.startUtc - dayStartUtc) / DAY) * 100);
                        const endPct = clampPct(((slice.endUtc - dayStartUtc) / DAY) * 100);
                        const left = Math.min(startPct, endPct);
                        const right = Math.max(startPct, endPct);

                        seg.style.left = left + '%';
                        seg.style.width = Math.max(0, (right - left)) + '%';

                        timeline.appendChild(seg);
                        li.appendChild(timeline);
                    }

                    li.addEventListener('click', () => {
                        window.webviewApi?.postMessage?.({name: 'openNote', id: ev.id});
                    });

                    li.dataset.startUtc = String(slice.startUtc);
                    li.dataset.endUtc = String(slice.endUtc ?? slice.startUtc);

                    if (isGrouped) {
                        const status = getEventStatus(slice.startUtc, slice.endUtc ?? slice.startUtc, Date.now());
                        appendEventToGroup(ul, li, status);
                    } else {
                        ul.appendChild(li);
                    }

                    // log('DAY ev.title=', ev.title, 'ev.tz=', ev.tz, 'startUtc=', ev.startUtc);
                }

                updateGroupedSectionVisibility(ul);
                updateDayNowTimelineDot();
                scheduleDayNowTimelineTick();

                markPastDayEvents();
                scheduleDayEventsRefresh();
            }

            // Launch
            // Ensure backend handshake is not lost on first start.
            // We only show the preliminary skeleton state here to avoid total empty screen.
            renderToolbar();
            renderGridSkeleton();
            setGridLoading(true);

            ensureBackendReady(() => {
                // Handshake will trigger uiSettings, which will then trigger full drawMonth()
            });

            log('init done');
        } catch (e) {
            console.error('[MyCalendar UI] init error', e);
            log('init error', e && e.message ? e.message : String(e));
        }
    }

    // Init check
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
