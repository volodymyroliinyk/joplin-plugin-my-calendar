// src/ui/calendar.js

(function () {
    // Ensure a single shared settings object across all UI scripts.
    window.__mcUiSettings = window.__mcUiSettings || {weekStart: undefined, debug: undefined};
    const uiSettings = window.__mcUiSettings;
    let __mcHasUiSettings = false;


    function createUiLogger(prefix, outputBoxId) {
        let outputBox = null;

        function appendToBox(args) {
            if (!outputBoxId) return;
            const box = document.getElementById(outputBoxId);
            if (!box) return;
            try {
                const div = document.createElement('div');
                div.textContent = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                box.appendChild(div);
                box.scrollTop = box.scrollHeight;
            } catch (e) {
                // ignore
            }
        }

        function setOutputBox(el) {
            outputBox = el || null;
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
            setOutputBox,
            log: (...args) => {
                write(console.log, args);
                forwardToMain('log', args);
            },
            info: (...args) => {
                write(console.info, args);
                forwardToMain('info', args);
            },
            debug: (...args) => {
                write(console.debug, args);
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

            // Events received for the current range of calendar grid (42 days)
            let gridEvents = [];


            // Local device TZ
            function monthLabel(d) {
                return d.toLocaleString(undefined, {month: 'long', year: 'numeric'});
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
                            window.webviewApi?.postMessage?.({name: 'uiReady'});
                        } catch {
                        }
                    }, 50);
                }

                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) sendUiReadyAgain();
                });
                window.addEventListener('focus', () => sendUiReadyAgain());

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
                    cb && cb();
                    return;
                }

                if (tryNow()) {
                    cb && cb();
                    return;
                }

                log('backend not ready yet; waiting for webviewApi...');
                let attempts = 0;
                const timer = setInterval(() => {
                    attempts++;
                    if (tryNow()) {
                        clearInterval(timer);
                        cb && cb();
                        return;
                    }
                    // ~5 seconds max
                    if (attempts >= 50) {
                        clearInterval(timer);
                        log('backend still not ready after waiting; will keep UI visible, user action may trigger later');
                    }
                }, 100);
            }

            function onPluginMessage(msg) {
                // Joplin Sometimes a sealing { message: <payload> }
                if (msg && typeof msg === 'object' && 'message' in msg && msg.message) {
                    msg = msg.message;
                }
                // If suddenly array of events without Name (should not, but just in case)
                if (!msg.name && Array.isArray(msg.events)) {
                    msg = {name: 'rangeEvents', events: msg.events};
                }

                log('onMessage:', msg && msg.name ? msg.name : msg);
                if (!msg || !msg.name) return;

                if (msg.name === 'uiAck') {
                    log('uiAck received');
                    return;
                }

                if (msg.name === 'uiSettings') {
                    const prevWeekStart = uiSettings.weekStart;

                    // console.log('[MyCalendar][DBG][weekStart] msg.name 5::', msg.name);
                    // console.log('[MyCalendar][DBG][weekStart] msg.weekStart 6::', msg.weekStart);

                    if (msg.weekStart === 'monday' || msg.weekStart === 'sunday') {
                        uiSettings.weekStart = msg.weekStart;
                    }

                    // console.log('[MyCalendar][DBG][weekStart] uiSettings.weekStart 6::', uiSettings.weekStart);

                    if (typeof msg.debug === 'boolean') {
                        uiSettings.debug = msg.debug;
                        applyDebugUI();
                    }

                    const weekStartChanged = prevWeekStart !== uiSettings.weekStart;
                    const firstSettingsArrived = !__mcHasUiSettings;
                    __mcHasUiSettings = true;

                    if (firstSettingsArrived || weekStartChanged) {
                        drawMonth();
                    }

                    // console.log('[MyCalendar][DBG][weekStart] uiSettings.weekStart 7::', uiSettings.weekStart);

                    return;
                }

                if (msg.name === 'redrawMonth') {
                    drawMonth();
                    return;
                }


                // --- ICS import complete (success or error) -> restart grid ---
                if (msg.name === 'importDone' || msg.name === 'importError') {
                    log('import finished -> refreshing calendar grid');
                    // reset so that the retry logic does not think that the data already exists
                    gridEvents = [];
                    // redraw the current month and request the range again
                    drawMonth();
                    return;
                }

                if (msg.name === 'rangeEvents') {
                    log('got rangeEvents:', (msg.events || []).length);
                    gridEvents = msg.events || [];
                    paintGrid();
                    renderDayEvents(selectedDayUtc);
                    return;
                }

                if (msg.name === 'showEvents') {
                    log('got showEvents:', (msg.events || []).length);
                    renderDayEvents(msg.dateUtc);
                    return;
                }

                if (msg.name === 'rangeIcs') {
                    log('got ICS bytes:', (msg.ics || '').length);
                    return;
                }
            }

            if (window.webviewApi?.onMessage) {
                mcRegisterOnMessage(onPluginMessage);

            } else {
                log('webviewApi.onMessage missing');
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

            function renderToolbar() {
                const root = $toolbar();
                if (!root) return;
                root.innerHTML = '';
                const wrap = document.createElement('div');
                wrap.className = 'mc-toolbar-inner';

                const btnPrev = button('‹', 'Previous month', () => {
                    current = addMonthsLocal(current, -1);
                    drawMonth();
                });
                const btnToday = button('Today', 'Today', () => {
                    current = startOfMonthLocal(new Date());
                    selectedDayUtc = localMidnightTs(new Date());
                    drawMonth();
                });
                const btnNext = button('›', 'Next month', () => {
                    current = addMonthsLocal(current, +1);
                    drawMonth();
                });

                // Month YYYY title.
                const title = document.createElement('div');
                title.className = 'mc-title';
                title.textContent = monthLabel(current);

                wrap.appendChild(btnPrev);
                wrap.appendChild(btnToday);
                wrap.appendChild(btnNext);
                wrap.appendChild(title);
                root.appendChild(wrap);
            }

            function drawMonth() {
                if (!uiSettings.weekStart) {
                    log('drawMonth skipped: weekStart not set');
                    return;
                }
                renderToolbar();
                renderGridSkeleton();

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
                });
                //If for 1200ms did not come rageevents - repeat once
                if (rangeRequestTimer) clearTimeout(rangeRequestTimer);
                rangeRequestTimer = setTimeout(() => {
                    if (!Array.isArray(gridEvents) || gridEvents.length === 0) {
                        log('rangeEvents timeout - retrying once');
                        ensureBackendReady(() => {
                            window.webviewApi.postMessage({
                                name: 'requestRangeEvents',
                                fromUtc: from.getTime(),
                                toUtc: to.getTime(),
                            });
                        });
                    }
                }, 1200);
            }

            function getWeekdayNames() {
                const base = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                return uiSettings.weekStart === 'sunday'
                    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                    : base;
            }

            function renderGridSkeleton() {
                const grid = $grid();
                if (!grid) return;
                grid.innerHTML = '';


                const head = document.createElement('div');
                head.className = 'mc-grid-head';
                for (const n of getWeekdayNames()) {
                    const c = document.createElement('div');
                    c.className = 'mc-grid-head-cell';
                    c.textContent = n;
                    head.appendChild(c);
                }
                grid.appendChild(head);

                const body = document.createElement('div');
                body.className = 'mc-grid-body';

                const start = startOfCalendarGridLocal(current);
                const todayTs = localMidnightTs(new Date());

                for (let i = 0; i < 42; i++) {
                    const cellDate = new Date(start);
                    cellDate.setDate(start.getDate() + i);
                    const cellTs = localMidnightTs(cellDate);

                    const cell = document.createElement('div');
                    cell.className = 'mc-cell';
                    cell.dataset.utc = String(cellTs);

                    const inThisMonth = cellDate.getMonth() === current.getMonth();
                    if (!inThisMonth) cell.classList.add('mc-out');

                    if (selectedDayUtc === cellTs) cell.classList.add('mc-selected');
                    if (todayTs === cellTs) cell.classList.add('mc-today');

                    const n = document.createElement('div');
                    n.className = 'mc-daynum';
                    n.textContent = String(cellDate.getDate());
                    cell.appendChild(n);

                    const dots = document.createElement('div');
                    dots.className = 'mc-dots';
                    dots.dataset.utc = String(cellTs);
                    cell.appendChild(dots);

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
                            hour12: false,
                        }).format(new Date(ts));
                    }
                } catch (e) {
                    // ignore invalid tz and fallback
                }

                // fallback: environment timezone
                return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
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
                    let badge = cell.querySelector(':scope > .mc-count');
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
                updateDayEventsHeader(dayStartUtc);

                const ul = $elist();
                if (!ul) return;
                ul.innerHTML = '';
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
                    li.appendChild(t);
                    li.addEventListener('click', () => {
                        window.webviewApi?.postMessage?.({name: 'openNote', id: ev.id});
                    });
                    ul.appendChild(li);

                    // log('DAY ev.title=', ev.title, 'ev.tz=', ev.tz, 'startUtc=', ev.startUtc);
                }
            }

            // Launch
            // Ensure backend handshake is not lost on first start
            ensureBackendReady(() => {
            });
            drawMonth();

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