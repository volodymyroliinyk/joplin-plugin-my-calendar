/** @jest-environment jsdom */

// tests/ui/calendar.backendReady.test.ts
//
// src/ui/calendar.js
//
// npx jest tests/ui/calendar.backendReady.test.ts --runInBand --no-cache;
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

function loadCalendarJsFreshWithoutWebview() {
    jest.resetModules();
    (window as any).__mcTestMode = true;
    require('../../src/ui/calendar.js');
}

test('ensureBackendReady: waits for webviewApi then posts uiReady once', () => {
    jest.useFakeTimers();
    setupDom();

    // No webviewApi at load time
    loadCalendarJsFreshWithoutWebview();
    const hooks = (window as any).__mcTest;
    expect(hooks).toBeTruthy();

    // Install webviewApi later
    let onMessageCb: any = null;
    (window as any).webviewApi = {
        postMessage: jest.fn(),
        onMessage: jest.fn((cb: any) => {
            onMessageCb = cb;
        }),
    };

    hooks.ensureBackendReady(() => {
    });

    // Let polling run
    jest.advanceTimersByTime(500);

    const calls = (window as any).webviewApi.postMessage.mock.calls.map((c: any[]) => c[0]);
    const uiReadyCalls = calls.filter((m: any) => m && m.name === 'uiReady');
    expect(uiReadyCalls.length).toBe(1);
    expect(typeof onMessageCb).toBe('function');
});
