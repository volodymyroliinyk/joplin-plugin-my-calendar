/** @jest-environment jsdom */

// tests/ui/calendar.messages.test.ts
//
// npx jest tests/ui/calendar.messages.test.ts --runInBand --no-cache;
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
    const handlers: ((ev: any) => void)[] = [];
    (window as any).webviewApi = {
        postMessage: jest.fn(),
        onMessage: (cb: any) => handlers.push(cb),
    };
    return {
        emit: (ev: any) => handlers.forEach((h) => h(ev)),
        getHandlers: () => handlers,
    };
}

function requireCalendarUi() {
    require('../../src/ui/calendar.js');
}

describe('calendar.js message unwrapping', () => {
    beforeEach(() => {
        jest.resetModules();
        setupDom();


        // reset calendar.js singleton dispatcher state between tests
        delete (window as any).__mcMsgDispatcherInstalled;
        delete (window as any).__mcMsgHandlers;
        delete (window as any).__mcOnMessageRegistered;

        // optional: ensure fresh api each time
        delete (window as any).webviewApi;
    });

    test('accepts wrapped messages: { message: payload }', () => {
        const api = installWebviewApi();
        requireCalendarUi();

        // initial settings should exist
        expect((window as any).__mcUiSettings).toBeTruthy();

        api.emit({message: {name: 'uiSettings', weekStart: 'monday'}});

        expect((window as any).__mcUiSettings.weekStart).toBe('monday');
    });


    test('accepts direct payload messages (not wrapped in {message: ...})', () => {
        const api = installWebviewApi();
        requireCalendarUi();

        api.emit({name: 'uiSettings', weekStart: 'sunday'});
        expect((window as any).__mcUiSettings.weekStart).toBe('sunday');
    });

    test('unwraps implicit rangeEvents when payload has events[] but no name', () => {
        const api = installWebviewApi();
        requireCalendarUi();

        // required for draw
        api.emit({message: {name: 'uiSettings', weekStart: 'sunday'}});
        const sel = document.querySelector('#mc-grid .mc-cell.mc-selected') as HTMLElement;
        const dayTs = Number(sel.dataset.utc);

        api.emit({
            message: {
                events: [{
                    id: 'n1',
                    title: 'Implicit',
                    startUtc: dayTs + 1_000,
                    endUtc: dayTs + 2_000,
                    tz: 'UTC',
                }]
            }
        });

        const items = document.querySelectorAll('#mc-events-list .mc-event');
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('Implicit');
    });

    test('renders rangeEvents message with events array', () => {
        const api = installWebviewApi();
        requireCalendarUi();

        const uiLogger = (window as any).__mcUiLogger;
        expect(uiLogger).toBeTruthy();

        uiLogger.error = (...args: any[]) => {
            // show the actual error that the dispatcher is currently swallowing
            const msg = args
                .map((a) => (a instanceof Error ? a.stack || a.message : String(a)))
                .join(' ');
            throw new Error(`calendar.js handler error: ${msg}`);
        };


        // calendar.js renders the grid only after uiSettings arrives
        api.emit({message: {name: 'uiSettings', weekStart: 'monday', debug: false}});

        // Ensure grid exists
        const body = document.querySelector('#mc-grid');
        expect(body).toBeTruthy();

        // Pick a day in the current rendered month: use "selected cell" if exists
        const sel = document.querySelector('#mc-grid .mc-cell.mc-selected') as HTMLElement | null;
        expect(sel).toBeTruthy();
        const dayTs = Number(sel!.dataset.utc);

        const ev = {
            id: 'n1',
            title: 'Event 1',
            startUtc: dayTs + 10 * 60 * 1000,
            endUtc: dayTs + 70 * 60 * 1000,
            color: '#ff0000',
            tz: 'UTC',
        };

        // Send without "name"
        api.emit({message: {name: 'rangeEvents', events: [ev]}});

        // A counter badge should appear in that cell
        const cell = document.querySelector(`#mc-grid .mc-cell[data-utc="${dayTs}"]`) as HTMLElement | null;
        expect(cell).toBeTruthy();

        const badge = cell!.querySelector('.mc-count') as HTMLElement | null;
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toBe('1');
        expect(badge!.style.display).toBe('block');
    });
});
