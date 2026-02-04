/** @jest-environment jsdom */

// tests/ui/calendar.weekStart.test.ts
//
// src/ui/calendar.js
//
// npx jest tests/ui/calendar.weekStart.test.ts --runInBand --no-cache;
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
    // If calendar.js attached init to DOMContentLoaded (readyState === 'loading'), trigger it.
    document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('calendar UI wiring diagnostics', () => {
    beforeEach(() => {
        jest.resetModules();
        setupDom();

        // Reset sticky globals used across reloads (calendar.js keeps them on window)
        delete (window as any).__mcUiSettings;
        delete (window as any).__mcUiReadySent;
        delete (window as any).__mcOnMessageRegistered;
        delete (window as any).__mcBackendReady;

        // Critical for this file: message dispatcher is one-time and will otherwise "stick"
        delete (window as any).__mcMsgDispatcherInstalled;
        delete (window as any).__mcMsgHandlers;
    });

    test('webviewApi path updates window.__mcUiSettings.weekStart (event-object shape)', () => {
        const api = installWebviewApi();
        loadCalendarInstrumentedFresh();

        // Initially, weekStart should be 'monday' (default)
        expect((window as any).__mcUiSettings.weekStart).toBe('monday');

        // After receiving settings, it should be updated
        api.emitEventObject({name: 'uiSettings', weekStart: 'monday'});
        expect((window as any).__mcUiSettings.weekStart).toBe('monday');

        api.emitEventObject({name: 'uiSettings', weekStart: 'sunday'});

        expect((window as any).__mcUiSettings.weekStart).toBe('sunday');
    });

    test('webviewApi path updates window.__mcUiSettings.weekStart (direct message shape)', () => {
        const api = installWebviewApi();
        delete (window as any).__mcUiSettings;
        delete (window as any).__mcUiReadySent;
        delete (window as any).__mcOnMessageRegistered;
        delete (window as any).__mcBackendReady;

        loadCalendarInstrumentedFresh();
        document.dispatchEvent(new Event('DOMContentLoaded'));

        expect((window as any).__mcUiSettings.weekStart).toBe('monday');

        api.emitDirectMessage({name: 'uiSettings', weekStart: 'monday'});
        expect((window as any).__mcUiSettings.weekStart).toBe('monday');
    });

});
