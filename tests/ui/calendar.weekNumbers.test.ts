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
    (window as any).__mcTestMode = true;
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
        delete (window as any).__mcTest;
        delete (window as any).__mcTestMode;

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

    test('Sunday numbering does not skip week 45 after DST ends', () => {
        installWebviewApi();
        loadCalendarInstrumentedFresh();
        (window as any).__mcUiSettings.weekStart = 'sunday';
        const getWeekNumber = (window as any).__mcTest.getWeekNumber;

        expect([
            new Date(2026, 9, 25),
            new Date(2026, 10, 1),
            new Date(2026, 10, 8),
            new Date(2026, 10, 15),
        ].map(getWeekNumber)).toEqual([44, 45, 46, 47]);
    });

    test.each([
        ['monday', 2020, 11, 28, 53],
        ['monday', 2021, 0, 4, 1],
        ['monday', 2022, 0, 1, 52],
        ['sunday', 2026, 11, 20, 52],
        ['sunday', 2026, 11, 27, 1],
        ['sunday', 2027, 0, 3, 2],
    ])('%s week numbering at a year boundary: %i-%i-%i is week %i',
        (weekStart, year, month, day, expected) => {
            installWebviewApi();
            loadCalendarInstrumentedFresh();
            (window as any).__mcUiSettings.weekStart = weekStart;

            expect((window as any).__mcTest.getWeekNumber(new Date(year, month, day))).toBe(expected);
        });

    test.each([
        // 1900 is not a leap year; 2000 and 2024 are leap years.
        ['monday', 1900, 1, 26, 9],
        ['monday', 1900, 2, 5, 10],
        ['monday', 2000, 1, 28, 9],
        ['monday', 2000, 2, 6, 10],
        ['monday', 2024, 1, 26, 9],
        ['monday', 2024, 2, 4, 10],
        ['sunday', 1900, 1, 25, 9],
        ['sunday', 1900, 2, 4, 10],
        ['sunday', 2000, 1, 27, 10],
        ['sunday', 2000, 2, 5, 11],
        ['sunday', 2024, 1, 25, 9],
        ['sunday', 2024, 2, 3, 10],
    ])('%s numbering handles leap-year shift: %i-%i-%i is week %i',
        (weekStart, year, month, day, expected) => {
            installWebviewApi();
            loadCalendarInstrumentedFresh();
            (window as any).__mcUiSettings.weekStart = weekStart;

            expect((window as any).__mcTest.getWeekNumber(new Date(year, month, day))).toBe(expected);
        });

    test.each(['monday', 'sunday'])('%s week numbers remain consecutive across 1900-2100', (weekStart) => {
        installWebviewApi();
        loadCalendarInstrumentedFresh();
        (window as any).__mcUiSettings.weekStart = weekStart;
        const getWeekNumber = (window as any).__mcTest.getWeekNumber;
        const date = new Date(1900, 0, weekStart === 'monday' ? 1 : 7);
        let previous = getWeekNumber(date);
        const discontinuities: string[] = [];

        while (date.getFullYear() < 2101) {
            date.setDate(date.getDate() + 7);
            const current = getWeekNumber(date);
            if (!(current === previous + 1 || current === 1) || current < 1 || current > 53) {
                discontinuities.push(`${date.toISOString().slice(0, 10)}: ${previous} -> ${current}`);
            }
            previous = current;
        }

        expect(discontinuities).toEqual([]);
    });
});
