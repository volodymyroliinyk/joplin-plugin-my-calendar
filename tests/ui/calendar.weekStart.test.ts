/** @jest-environment jsdom */

// tests/ui/calendar.weekStart.test.ts
//
// npx jest tests/ui/calendar.weekStart.test.ts --runInBand --no-cache;
//
// Diagnostic: verify that webviewApi.onMessage path delivers msg.weekStart into UI closure.
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
        emitEventObject: (message: any) => handlers.forEach((h) => h({message})),
        emitDirectMessage: (message: any) => handlers.forEach((h) => h(message)),
    };
}

function loadCalendarInstrumentedFresh() {
    jest.resetModules();
    require('../../src/ui/calendar.js');
}

describe('calendar UI wiring diagnostics', () => {
    beforeEach(() => {
        jest.resetModules();
        setupDom();
    });

    test('webviewApi path updates window.__mcUiSettings.weekStart (event-object shape)', () => {
        const api = installWebviewApi();
        loadCalendarInstrumentedFresh();

        // Initially, weekStart should be undefined
        expect((window as any).__mcUiSettings.weekStart).toBeUndefined();

        // After receiving settings, it should be updated
        api.emitEventObject({name: 'uiSettings', weekStart: 'monday'});
        expect((window as any).__mcUiSettings.weekStart).toBe('monday');

        api.emitEventObject({name: 'uiSettings', weekStart: 'sunday'});

        expect((window as any).__mcUiSettings.weekStart).toBe('sunday');
    });
});
