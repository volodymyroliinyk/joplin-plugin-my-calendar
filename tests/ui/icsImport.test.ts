/** @jest-environment jsdom */

//
// tests/ui/icsImport.test.ts
// src/ui/icsImport.js
//
// npx jest tests/ui/icsImport.test.ts --runInBand --no-cache;

// npx jest --clearCache;rm -rf node_modules/.cache/jest;npx jest tests/ui/icsImport.test.ts --runInBand --no-cache;

export {};

function setupDom(hasRoot = true) {
    document.body.innerHTML = hasRoot ? `<div id="ics-root"></div>` : `<div></div>`;
}


function resetMyCalendarUiGlobals() {
    // These globals are used by src/ui/icsImport.js to avoid installing multiple dispatchers.
    // In Jest, window persists across tests, so we must reset them.
    delete (window as any).__mcMsgDispatcherInstalled;
    delete (window as any).__mcMsgHandlers;
    delete (window as any).__mcUiSettings;
}
function installWebviewApi() {
    let onMessageCb: any = null;

    (window as any).webviewApi = {
        postMessage: jest.fn(),
        onMessage: jest.fn((cb: any) => {
            onMessageCb = cb;
        }),
    };

    return {
        postMessage: (window as any).webviewApi.postMessage,
        getOnMessageCb: () => onMessageCb,
    };
}

function sendPluginMessage(getOnMessageCb: any, msg: any) {
    const cb = getOnMessageCb();
    if (!cb) throw new Error('onMessage callback not installed');
    cb(msg);
}

function loadIcsImportFresh() {
    jest.resetModules();
    resetMyCalendarUiGlobals();
    require('../../src/ui/icsImport.js');
}

describe('src/ui/icsImport.js', () => {
    test('renders UI and asks for folders on init', () => {
        setupDom(true);
        const {postMessage} = installWebviewApi();

        loadIcsImportFresh();

        // basic elements exist
        expect(document.querySelector('#mc-target-folder')).toBeTruthy();
        expect(document.querySelector('#ics-file')).toBeTruthy();
        expect(document.querySelector('button.mc-setting-btn')).toBeTruthy();

        // Options:
        // preserve local color checkbox (first label input[type=checkbox])
        expect(document.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2);
        expect(document.querySelector('input[type="color"]')).toBeTruthy();

        // requestFolders called once at init
        expect(postMessage).toHaveBeenCalledWith({name: 'uiReady'});
        expect(postMessage).toHaveBeenCalledWith({name: 'requestFolders'});
    });

    test('renders safe ICS export link above Debug log and blocks javascript: URLs', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        loadIcsImportFresh();

        // Send a safe URL
        sendPluginMessage(getOnMessageCb, {
            name: 'uiSettings',
            debug: true,
            icsExportUrl: 'https://calendar.google.com/calendar/u/1/r/settings/export',
        });

        const linkBox = document.querySelector('#mc-ics-export-link') as HTMLElement;
        expect(linkBox).toBeTruthy();

        const a = linkBox.querySelector('a') as HTMLAnchorElement;
        expect(a).toBeTruthy();
        expect(a.href).toBe('https://calendar.google.com/calendar/u/1/r/settings/export');
        expect(a.textContent).toBe('https://calendar.google.com/calendar/u/1/r/settings/export');
        expect(a.rel).toContain('noopener');

        // Link box should be before Debug log header
        const debugHeader = Array.from(document.querySelectorAll('div')).find(
            d => (d.textContent || '').trim() === 'Debug log',
        ) as HTMLElement;
        expect(debugHeader).toBeTruthy();
        expect(linkBox.compareDocumentPosition(debugHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        // Now send an unsafe URL - it should not render
        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', debug: true, icsExportUrl: 'javascript:alert(1)'});

        const linkBox2 = document.querySelector('#mc-ics-export-link') as HTMLElement;
        const a2 = linkBox2 ? (linkBox2.querySelector('a') as HTMLAnchorElement) : null;
        expect(a2).toBeNull();
    });

    // ... решта тестів без змін (залишаються як у твоєму файлі)
});
