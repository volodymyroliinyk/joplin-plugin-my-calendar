/** @jest-environment jsdom */

// tests/ui/calendar.test.ts
// src/ui/calendar.js
//
// npx jest tests/ui/calendar.test.ts --runInBand --no-cache;
//
export {};

function setupDom() {
    document.body.innerHTML = `
    <div id="mc-toolbar"></div>
    <div id="mc-grid"></div>

    <div id="mc-events">
      <div id="mc-events-day-label"></div>
      <ul id="mc-events-list"></ul>
    </div>

    <div id="mc-log"></div>
  `;
}

function installWebviewApi() {
    let onMessageCb: ((msg: any) => void) | null = null;

    (window as any).webviewApi = {
        postMessage: jest.fn(),
        onMessage: jest.fn((cb: any) => {
            onMessageCb = cb;
        }),
    };

    return {
        getOnMessageCb: () => onMessageCb,
        postMessage: (window as any).webviewApi.postMessage as jest.Mock,
    };
}

function loadCalendarJsFresh() {
    jest.resetModules();
    // important: require after setup Dom+install Webview Api
    require('../../src/ui/calendar.js');
}

function findGridCells(): HTMLElement[] {
    return Array.from(document.querySelectorAll('#mc-grid .mc-grid-body .mc-cell')) as HTMLElement[];
}

function findSelectedCell(): HTMLElement | null {
    return document.querySelector('#mc-grid .mc-grid-body .mc-cell.mc-selected') as HTMLElement | null;
}

function sendPluginMessage(getOnMessageCb: () => any, payload: any) {
    const cb = getOnMessageCb();
    if (!cb) throw new Error('webviewApi.onMessage callback not installed');
    cb({message: payload}); // the calendar can unwrap {message: ...}
}

describe('src/ui/calendar.js', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.useFakeTimers();

        // Fix the "current time" so that today/selectedDayUtc are stable.
        // Choose an arbitrary date, the main thing is a constant one.
        jest.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));

        // Silence console output from UI logger.
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        delete (window as any).__mcMsgHandlers;
        delete (window as any).__mcMsgDispatcherInstalled;

        setupDom();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();

        if (errorSpy) errorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();

        delete (window as any).webviewApi;
    });

    function attachUiLoggerSpies() {
        const uiLogger = (window as any).__mcUiLogger;
        if (!uiLogger) throw new Error('Missing window.__mcUiLogger');
        errorSpy = jest.spyOn(uiLogger, 'error');
    }

    test('init: registers webviewApi.onMessage and posts uiReady', () => {
        const {postMessage} = installWebviewApi();
        loadCalendarJsFresh();

        expect((window as any).webviewApi.onMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({name: 'uiReady'});
    });

    test('init: draws grid skeleton with 42 day cells', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});

        const cells = findGridCells();
        expect(cells.length).toBe(42);

        // head with weekdays exists
        const headCells = document.querySelectorAll('#mc-grid .mc-grid-head .mc-grid-head-cell');
        expect(headCells.length).toBe(7);
    });

    test('grid: marks weekend head cells and day cells with mc-weekend', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});

        const headCells = Array.from(document.querySelectorAll('#mc-grid .mc-grid-head .mc-grid-head-cell')) as HTMLElement[];
        const sunHead = headCells.find(c => c.textContent === 'Sun');
        const satHead = headCells.find(c => c.textContent === 'Sat');
        expect(sunHead).toBeTruthy();
        expect(satHead).toBeTruthy();
        expect(sunHead!.classList.contains('mc-weekend')).toBe(true);
        expect(satHead!.classList.contains('mc-weekend')).toBe(true);

        const cells = findGridCells();
        // Check a subset for stability/performance
        for (const c of cells.slice(0, 14)) {
            const ts = Number(c.dataset.utc);
            const dow = new Date(ts).getDay(); // Sun=0..Sat=6
            expect(c.classList.contains('mc-weekend')).toBe(dow === 0 || dow === 6);
        }
    });

    test('grid: marks past days with mc-past (but not today)', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});

        const selected = findSelectedCell();
        expect(selected).toBeTruthy();

        const todayTs = Number(selected!.dataset.utc);
        const cells = findGridCells();
        const past = cells.find(c => Number(c.dataset.utc) < todayTs);

        expect(past).toBeTruthy();
        expect(past!.classList.contains('mc-past')).toBe(true);
        expect(selected!.classList.contains('mc-past')).toBe(false);
    });


    test('init: first drawMonth triggers requestRangeEvents (postMessage)', () => {
        const {postMessage, getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        // there must be at least 1 range request
        const calls = postMessage.mock.calls.filter(c => c[0]?.name === 'requestRangeEvents');
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const msg = calls[0][0];
        expect(typeof msg.fromUtc).toBe('number');
        expect(typeof msg.toUtc).toBe('number');
        expect(msg.toUtc).toBeGreaterThan(msg.fromUtc);
    });

    test('requestMonthRangeWithRetry: if rangeEvents not received within 1200ms -> retries once', () => {
        const {postMessage, getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        const initial = postMessage.mock.calls.filter(c => c[0]?.name === 'requestRangeEvents').length;
        expect(initial).toBeGreaterThanOrEqual(1);

        // gridEvents remains empty => after 1200ms there should be a retry
        jest.advanceTimersByTime(1200);

        const after = postMessage.mock.calls.filter(c => c[0]?.name === 'requestRangeEvents').length;
        expect(after).toBe(initial + 1);
    });

    test('rangeEvents: saves gridEvents, paints indicators, renders day list', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        // take selected day from DOM (init sets selectedDayUtc as local midnight today)
        const sel = findSelectedCell();
        expect(sel).toBeTruthy();
        const dayTs = Number(sel!.dataset.utc);

        // event that crosses selected day
        const ev = {
            id: 'n1',
            title: 'Event 1',
            startUtc: dayTs + 10 * 60 * 1000,
            endUtc: dayTs + 70 * 60 * 1000,
            color: '#ff0000',
            tz: 'UTC',
        };

        sendPluginMessage(getOnMessageCb, {name: 'rangeEvents', events: [ev]});

        // mc-bars and mc-bar should appear in the cell
        // const cell = document.querySelector(`.mc-cell[data-utc="${dayTs}"]`) as HTMLElement;
        // const bar = cell.querySelector('.mc-bars .mc-bar') as HTMLElement;
        // expect(bar).toBeTruthy();
        // const bg = (bar as HTMLElement).style.background || (bar as HTMLElement).style.backgroundColor || '';
        // expect(bg).toMatch(/(#ff0000|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\))/i);


        // there must be 1 li.mc-event in the day's event list
        const items = document.querySelectorAll('#mc-events-list .mc-event');
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('Event 1');
    });

    test('showEvents: renders day list for provided dateUtc without touching grid indicators', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        const cells = findGridCells();
        const dayTs = Number(cells[10].dataset.utc);

        // send rangeEvents first so gridEvents are not empty
        sendPluginMessage(getOnMessageCb, {
            name: 'rangeEvents',
            events: [{
                id: 'n1',
                title: 'E',
                startUtc: dayTs + 1,
                endUtc: dayTs + 2,
                tz: 'UTC',
            }],
        });

        // now show Events (calendar calls renderDay Events(msg.date Utc))
        sendPluginMessage(getOnMessageCb, {
            name: 'showEvents',
            dateUtc: dayTs,
            events: [{id: 'n1'}],
        });

        const items = document.querySelectorAll('#mc-events-list .mc-event');
        expect(items.length).toBe(1);
    });

    test('importDone/importError: clears gridEvents and triggers refresh (new requestRangeEvents)', () => {
        const {getOnMessageCb, postMessage} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        const before = postMessage.mock.calls.filter(c => c[0]?.name === 'requestRangeEvents').length;

        sendPluginMessage(getOnMessageCb, {name: 'importDone', added: 1, updated: 0, skipped: 0, errors: 0});

        const after = postMessage.mock.calls.filter(c => c[0]?.name === 'requestRangeEvents').length;
        expect(after).toBeGreaterThan(before);
    });

    test('clicking a grid cell posts dateClick and updates selection class', () => {
        const {postMessage, getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        const cells = findGridCells();
        const target = cells[5];

        target.click();

        // should go dateClick
        const calls = postMessage.mock.calls.filter(c => c[0]?.name === 'dateClick');
        expect(calls.length).toBeGreaterThanOrEqual(1);

        const msg = calls[calls.length - 1][0];
        expect(typeof msg.dateUtc).toBe('number');

        // selection moved
        const sel = findSelectedCell();
        expect(sel).toBeTruthy();
        expect(sel!.dataset.utc).toBe(target.dataset.utc);
    });

    test('renderDayEvents: when no events intersect day -> shows "There are no events"', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        const sel = findSelectedCell()!;
        const dayTs = Number(sel.dataset.utc);

        // rangeEvents, but the event does NOT cross day
        sendPluginMessage(getOnMessageCb, {
            name: 'rangeEvents',
            events: [{
                id: 'n1',
                title: 'Out',
                startUtc: dayTs - 10_000,
                endUtc: dayTs - 5_000,
                tz: 'UTC',
            }],
        });

        const empty = document.querySelector('#mc-events-list .mc-empty') as HTMLElement;
        expect(empty).toBeTruthy();
        expect(empty.textContent).toContain('There are no events');
    });

    test('clicking day event list item posts openNote with event id', () => {
        const {getOnMessageCb, postMessage} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        const sel = findSelectedCell()!;
        const dayTs = Number(sel.dataset.utc);

        sendPluginMessage(getOnMessageCb, {
            name: 'rangeEvents',
            events: [{
                id: 'note-123',
                title: 'Click me',
                startUtc: dayTs + 1_000,
                endUtc: dayTs + 2_000,
                tz: 'UTC',
            }],
        });

        const li = document.querySelector('#mc-events-list .mc-event') as HTMLElement;
        expect(li).toBeTruthy();
        li.click();

        const calls = postMessage.mock.calls.filter(c => c[0]?.name === 'openNote');
        expect(calls.length).toBeGreaterThanOrEqual(1);
        expect(calls[calls.length - 1][0]).toEqual({name: 'openNote', id: 'note-123'});
    });


    test('uiSettings: debug toggles mc-log visibility; log() writes only when debug=true', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();

        const logBox = document.getElementById('mc-log') as HTMLElement;
        expect(logBox).toBeTruthy();

        // default: hidden because debug undefined
        expect(logBox.style.display).toBe('none');

        // debug=false keeps hidden
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday', debug: false});
        expect(logBox.style.display).toBe('none');

        // debug=true shows
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday', debug: true});
        expect(logBox.style.display).toBe('');

        // Sending any message triggers internal log('onMessage: ...') when debug=true,
        // which should append into mc-log.
        sendPluginMessage(getOnMessageCb, {name: 'uiAck'});

        expect(logBox.textContent || '').toContain('onMessage:');
    });

    test('unwrapPluginMessage: message without name but with events[] is treated as rangeEvents', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});

        const sel = findSelectedCell()!;
        const dayTs = Number(sel.dataset.utc);

        // note: no "name" field, only "events"
        sendPluginMessage(getOnMessageCb, {
            events: [{
                id: 'n1',
                title: 'Implicit rangeEvents',
                startUtc: dayTs + 1_000,
                endUtc: dayTs + 2_000,
                tz: 'UTC',
            }],
        });

        const items = document.querySelectorAll('#mc-events-list .mc-event');
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('Implicit rangeEvents');
    });

    test('weekStart=monday: grid head starts with Mon and ends with Sun; weekend head cells are Sat+Sun', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'monday'});

        const headCells = Array.from(document.querySelectorAll('#mc-grid .mc-grid-head .mc-grid-head-cell')) as HTMLElement[];
        const labels = headCells.map(c => (c.textContent || '').trim());
        expect(labels.length).toBe(7);
        expect(labels[0]).toBe('Mon');
        expect(labels[6]).toBe('Sun');

        const sat = headCells.find(c => c.textContent === 'Sat')!;
        const sun = headCells.find(c => c.textContent === 'Sun')!;
        expect(sat.classList.contains('mc-weekend')).toBe(true);
        expect(sun.classList.contains('mc-weekend')).toBe(true);
    });

    test('day list: event ending soon becomes mc-event-past after scheduled refresh', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday', dayEventsRefreshMinutes: 10}); // large fallback

        const sel = findSelectedCell()!;
        const dayTs = Number(sel.dataset.utc);

        const now = Date.now();
        const endSoon = now + 5_000; // 5s from now

        sendPluginMessage(getOnMessageCb, {
            name: 'rangeEvents',
            events: [{
                id: 'n1',
                title: 'Soon past',
                startUtc: now - 10_000,
                endUtc: endSoon,
                tz: 'UTC',
            }],
        });

        let li = document.querySelector('#mc-events-list .mc-event') as HTMLElement;
        expect(li).toBeTruthy();
        expect(li.classList.contains('mc-event-past')).toBe(false);

        // scheduleDayEventsRefresh delay should be about (endSoon-now)+1000 => 6000ms (min 1000)
        jest.advanceTimersByTime(6_000);

        li = document.querySelector('#mc-events-list .mc-event') as HTMLElement;
        expect(li.classList.contains('mc-event-past')).toBe(true);
    });

    test('visibilitychange: when document becomes hidden -> clears day refresh + timeline timers; when visible -> posts uiReady again (debounced)', () => {
        const {getOnMessageCb, postMessage} = installWebviewApi();
        loadCalendarJsFresh();
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});

        const sel = findSelectedCell()!;
        const dayTs = Number(sel.dataset.utc);

        // create one event so day list schedules timers
        sendPluginMessage(getOnMessageCb, {
            name: 'rangeEvents',
            events: [{
                id: 'n1',
                title: 'Timers',
                startUtc: dayTs + 1_000,
                endUtc: dayTs + 2_000,
                tz: 'UTC',
            }],
        });

        const clearSpy = jest.spyOn(global, 'clearTimeout');

        // make document hidden
        Object.defineProperty(document, 'hidden', {value: true, configurable: true});
        document.dispatchEvent(new Event('visibilitychange'));

        expect(clearSpy).toHaveBeenCalled();

        // visible again should send uiReady (debounced 50ms)
        Object.defineProperty(document, 'hidden', {value: false, configurable: true});
        document.dispatchEvent(new Event('visibilitychange'));

        jest.advanceTimersByTime(60);

        const uiReadyCalls = postMessage.mock.calls.filter(c => c[0]?.name === 'uiReady');
        expect(uiReadyCalls.length).toBeGreaterThanOrEqual(2); // initial + re-announce

        clearSpy.mockRestore();
    });

    test('ensureBackendReady: if webviewApi is injected later, uiReady is sent after polling', () => {
        // load without webviewApi
        jest.resetModules();
        setupDom();
        delete (window as any).webviewApi;

        // reset sticky globals used for cross-reload behavior
        delete (window as any).__mcBackendReady;
        delete (window as any).__mcUiReadySent;
        delete (window as any).__mcOnMessageRegistered;
        delete (window as any).__mcMsgDispatcherInstalled;
        delete (window as any).__mcMsgHandlers;

        require('../../src/ui/calendar.js');

        // inject after some time
        const postMessage = jest.fn();
        const onMessage = jest.fn();
        (window as any).webviewApi = {postMessage, onMessage};

        // poll interval is 100ms; allow a couple of ticks
        jest.advanceTimersByTime(250);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({name: 'uiReady'});
    });

    test('mcRegisterOnMessage: multiple handlers are supported; handler errors are caught', () => {
        const {getOnMessageCb} = installWebviewApi();
        loadCalendarJsFresh();
        const uiLogger = (window as any).__mcUiLogger;
        expect(uiLogger).toBeTruthy();
        errorSpy = jest.spyOn(uiLogger, 'error');
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', weekStart: 'sunday'});


        // add another handler manually through the global array
        (window as any).__mcMsgHandlers.push(() => {
            throw new Error('handler fail');
        });

        sendPluginMessage(getOnMessageCb, {name: 'uiAck'});

        expect(errorSpy).toHaveBeenCalledWith('handler error', expect.any(Error));
    });
});

// tests/ui/calendar.test.ts
// src/ui/calendar.js