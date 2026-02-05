/** @jest-environment jsdom */

// tests/ui/calendar.picker.test.ts
//
// TZ=UTC npx jest tests/ui/calendar.picker.test.ts --runInBand --no-cache;
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
    (window as any).webviewApi = {
        postMessage: jest.fn(),
        onMessage: jest.fn(),
    };
    return (window as any).webviewApi;
}

function loadCalendarJsFresh() {
    jest.resetModules();
    delete (window as any).__mcUiSettings;
    delete (window as any).__mcMsgHandlers;
    delete (window as any).__mcMsgDispatcherInstalled;
    (window as any).__mcTestMode = true;
    require('../../src/ui/calendar.js');
}

describe('Calendar Month-Year Picker', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-02-02T12:00:00Z'));
        setupDom();
        const api = installWebviewApi();
        loadCalendarJsFresh();

        // Trigger initial render with settings
        const onMessage = api.onMessage.mock.calls[0][0];
        onMessage({message: {name: 'uiSettings', weekStart: 'monday'}});
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        delete (window as any).webviewApi;
    });

    test('picker opens when clicking the title', () => {
        const trigger = document.getElementById('mc-picker-trigger');
        expect(trigger).toBeTruthy();

        expect(document.querySelector('.mc-picker-dropdown')).toBeFalsy();

        trigger!.click();

        expect(document.querySelector('.mc-picker-dropdown')).toBeTruthy();
        expect(document.querySelector('.mc-picker-year')!.textContent).toBe('2026');
    });

    test('changing year in picker updates the picker view but not yet the calendar', () => {
        const trigger = document.getElementById('mc-picker-trigger');
        trigger!.click();

        const nextYearBtn = document.querySelector('.mc-picker-year-row button[title="Next year"]') as HTMLElement;
        nextYearBtn.click();

        expect(document.querySelector('.mc-picker-year')!.textContent).toBe('2027');

        // Calendar title should still show 2026 until a month is selected
        expect(trigger!.textContent).toContain('February 2026');
    });

    test('selecting a month updates the calendar and closes picker', () => {
        const trigger = document.getElementById('mc-picker-trigger');
        trigger!.click();

        // Select March (index 2)
        const months = document.querySelectorAll('.mc-picker-month');
        (months[2] as HTMLElement).click();

        expect(document.querySelector('.mc-picker-dropdown')).toBeFalsy();
        const updatedTrigger = document.getElementById('mc-picker-trigger');
        expect(updatedTrigger!.textContent).toContain('March 2026');

        // Check if it triggered a range request
        const postMessage = (window as any).webviewApi.postMessage;
        const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1][0];
        expect(lastCall.name).toBe('requestRangeEvents');

        // March 2026 starts around 1740787200000 (UTC)
        // We just need to check if month changed.
        const dateFrom = new Date(lastCall.fromUtc);
        expect(dateFrom.getMonth()).toBe(1); // Feb (since it's a 42-day grid)
    });

    test('clicking outside closes the picker', () => {
        const trigger = document.getElementById('mc-picker-trigger');
        trigger!.click();
        expect(document.querySelector('.mc-picker-dropdown')).toBeTruthy();

        document.body.click();
        expect(document.querySelector('.mc-picker-dropdown')).toBeFalsy();
    });

    // test('Today button inside picker closes picker and resets to current month', () => {
    //     const trigger = document.getElementById('mc-picker-trigger');
    //     trigger!.click();
    //
    //     const todayBtn = document.querySelector('.mc-picker-dropdown button[title="Go to current month"]') as HTMLElement;
    //     expect(todayBtn).toBeTruthy();
    //     todayBtn.click();
    //
    //     expect(document.querySelector('.mc-picker-dropdown')).toBeFalsy();
    //     const updatedTrigger = document.getElementById('mc-picker-trigger');
    //     expect(updatedTrigger!.textContent).toContain('February 2026');
    // });

    test('picker shows active class for the currently selected month/year', () => {
        const trigger = document.getElementById('mc-picker-trigger');
        trigger!.click();

        const activeMonth = document.querySelector('.mc-picker-month.mc-active');
        expect(activeMonth).toBeTruthy();
        expect(activeMonth!.textContent).toBe('Feb');
    });
});
