/** @jest-environment jsdom */

// tests/ui/calendar.weekNumbers.test.ts
//
// TZ=UTC npx jest tests/ui/calendar.weekNumbers.test.ts --runInBand --no-cache;
//

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
        emitDirectMessage: (message: any) => handlers.forEach((h) => h(message)),
    };
}

function loadCalendarInstrumentedFresh() {
    jest.resetModules();
    require('../../src/ui/calendar.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('calendar UI Week Numbers', () => {
    beforeEach(() => {
        jest.resetModules();
        setupDom();

        delete (window as any).__mcUiSettings;
        delete (window as any).__mcUiReadySent;
        delete (window as any).__mcOnMessageRegistered;
        delete (window as any).__mcBackendReady;
        delete (window as any).__mcMsgDispatcherInstalled;
        delete (window as any).__mcMsgHandlers;

        // Mock Date to be stable
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-02-01T12:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('updates uiSettings.showWeekNumbers and redrawing grid', () => {
        const api = installWebviewApi();
        loadCalendarInstrumentedFresh();

        expect((window as any).__mcUiSettings.showWeekNumbers).toBe(false);

        api.emitDirectMessage({
            name: 'uiSettings',
            showWeekNumbers: true,
            weekStart: 'monday'
        });

        expect((window as any).__mcUiSettings.showWeekNumbers).toBe(true);

        const grid = document.getElementById('mc-grid')!;
        expect(grid.classList.contains('mc-show-week-numbers')).toBe(true);
        expect(grid.querySelector('.mc-week-num-head')).not.toBeNull();

        // 42 days grid is exactly 6 weeks
        const weekCells = grid.querySelectorAll('.mc-week-num-cell');
        expect(weekCells.length).toBe(6);

        // Check first week number for 2024-02-01 (Feb 2024)
        // Feb 1 2024 is Thursday. Monday of that week is Jan 29.
        // Jan 29 2024 is Week 5 of 2024.
        expect(weekCells[0].textContent).toBe('5');
    });

    test('disabling week numbers removes them from grid', () => {
        const api = installWebviewApi();
        loadCalendarInstrumentedFresh();

        api.emitDirectMessage({
            name: 'uiSettings',
            showWeekNumbers: true,
            weekStart: 'monday'
        });
        expect(document.querySelectorAll('.mc-week-num-cell').length).toBe(6);

        api.emitDirectMessage({
            name: 'uiSettings',
            showWeekNumbers: false,
            weekStart: 'monday'
        });
        expect(document.querySelectorAll('.mc-week-num-cell').length).toBe(0);
        expect(document.getElementById('mc-grid')!.classList.contains('mc-show-week-numbers')).toBe(false);
    });

    test('Sunday start week numbers (2026-02-04 case)', () => {
        // Now: 2026-02-04 (Wed)
        jest.setSystemTime(new Date('2026-02-04T12:00:00Z'));

        const api = installWebviewApi();
        loadCalendarInstrumentedFresh();

        api.emitDirectMessage({
            name: 'uiSettings',
            showWeekNumbers: true,
            weekStart: 'sunday'
        });

        const weekCells = document.querySelectorAll('.mc-week-num-cell');

        // Feb 2026 with Sunday start:
        // Row 1 starts Feb 1 (Sun). 
        // In US system, Feb 1 2026 is Week 6.
        expect(weekCells[0].textContent).toBe('6');
    });
});
