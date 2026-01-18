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

function qs(sel: string) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
}

function expectConsoleLogContains(spy: jest.SpyInstance, needle: string) {
    const hit = spy.mock.calls.some((c: any[]) => typeof c?.[0] === 'string' && c[0].includes(needle));
    expect(hit).toBe(true);
}

function expectConsoleErrorContains(spy: jest.SpyInstance, needle: string) {
    const hit = spy.mock.calls.some((c: any[]) => typeof c?.[0] === 'string' && c[0].includes(needle));
    expect(hit).toBe(true);
}

function loadIcsImportKeepGlobals() {
    jest.resetModules();
    require('../../src/ui/icsImport.js');
}


describe('src/ui/icsImport.js', () => {
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        localStorage.clear();

        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        delete (window as any).__mcMsgHandlers;
        delete (window as any).__mcMsgDispatcherInstalled;
        delete (window as any).webviewApi;
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        delete (window as any).webviewApi;
    });

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

    test('renders safe ICS export link buttons above Debug log and blocks javascript: URLs', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        loadIcsImportFresh();

        // Send safe links
        sendPluginMessage(getOnMessageCb, {
            name: 'uiSettings',
            debug: true,
            icsExportLinks: [
                {title: 'Google Calendar', url: 'https://calendar.google.com/calendar/u/1/r/settings/export'},
                {title: 'Work', url: 'https://example.test/work/export'},
            ],
        });

        const linkBox = document.querySelector('#mc-ics-export-link') as HTMLElement;
        expect(linkBox).toBeTruthy();

        const btns = Array.from(linkBox.querySelectorAll('a')) as HTMLAnchorElement[];
        expect(btns.length).toBe(2);

        expect(btns[0].href).toBe('https://calendar.google.com/calendar/u/1/r/settings/export');
        expect(btns[0].textContent).toBe('Google Calendar');
        expect(btns[0].rel).toContain('noopener');

        expect(btns[1].href).toBe('https://example.test/work/export');
        expect(btns[1].textContent).toBe('Work');

        // Link box should be before Debug log header
        const debugHeader = Array.from(document.querySelectorAll('div')).find(
            d => (d.textContent || '').trim() === 'Debug log',
        ) as HTMLElement;
        expect(debugHeader).toBeTruthy();
        expect(linkBox.compareDocumentPosition(debugHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        // Now send an unsafe URL - it should not render
        sendPluginMessage(getOnMessageCb, {
            name: 'uiSettings',
            debug: true,
            icsExportLinks: [{title: 'Bad', url: 'javascript:alert(1)'}],
        });

        const linkBox2 = document.querySelector('#mc-ics-export-link') as HTMLElement;
        const a2 = linkBox2 ? (linkBox2.querySelector('a') as HTMLAnchorElement) : null;
        expect(a2).toBeNull();
    });

    test('no root (#ics-root missing) -> does nothing (no postMessage)', () => {
        setupDom(false);
        const {postMessage} = installWebviewApi();

        loadIcsImportFresh();

        expect(postMessage).not.toHaveBeenCalled();
    });

    test('init renders UI and posts requestFolders once', () => {
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
        expect(postMessage).toHaveBeenCalledWith({name: 'requestFolders'});
    });

    test('Reload button posts requestFolders', () => {
        setupDom(true);
        const {postMessage} = installWebviewApi();
        loadIcsImportFresh();

        const reloadBtn = Array.from(document.querySelectorAll('button'))
            .find(b => (b.textContent || '').trim() === 'Reload') as HTMLButtonElement;

        expect(reloadBtn).toBeTruthy();
        reloadBtn.click();

        // init requestFolders + reload requestFolders
        const calls = postMessage.mock.calls.filter(c => c[0]?.name === 'requestFolders');
        expect(calls.length).toBe(2);
    });

    test('populateFolders: adds placeholder, formats depth prefix, restores desired selection', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        // set desired folder id
        localStorage.setItem('mycalendar.targetFolderId', 'b');

        loadIcsImportFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [
                {id: 'a', title: 'A', parent_id: null, depth: 0},
                {id: 'b', title: 'B', parent_id: null, depth: 0},
                {id: 'c', title: 'Child', parent_id: 'a', depth: 2},
            ],
        });

        const sel = qs('#mc-target-folder') as HTMLSelectElement;

        // placeholder exists and disabled
        expect(sel.options[0].value).toBe('');
        expect(sel.options[0].disabled).toBe(true);

        // depth prefix for child: "- - " (depth=2)
        const childOpt = Array.from(sel.options).find(o => o.value === 'c')!;
        expect(childOpt.textContent).toContain('- - ');
        expect(childOpt.textContent).toContain('Child');

        // restored selection
        expect(sel.value).toBe('b');
    });

    test('populateFolders: when desired missing, selects first real folder', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        localStorage.setItem('mycalendar.targetFolderId', 'missing');

        loadIcsImportFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [
                {id: 'x', title: 'X', depth: 0},
                {id: 'y', title: 'Y', depth: 0},
            ],
        });

        const sel = qs('#mc-target-folder') as HTMLSelectElement;
        expect(sel.value).toBe('x');
    });

    test('folder selection change writes localStorage', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();
        loadIcsImportFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [
                {id: 'x', title: 'X', depth: 0},
                {id: 'y', title: 'Y', depth: 0},
            ],
        });

        const sel = qs('#mc-target-folder') as HTMLSelectElement;
        sel.value = 'y';
        sel.dispatchEvent(new Event('change'));

        expect(localStorage.getItem('mycalendar.targetFolderId')).toBe('y');
    });

    test('preserve local color default ON; localStorage "0" makes it OFF and toggling persists', () => {
        setupDom(true);
        installWebviewApi();

        // force OFF
        localStorage.setItem('mycalendar_preserve_local_color', '0');

        loadIcsImportFresh();

        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
        const preserve = checkboxes[0]; // first checkbox in Options

        expect(preserve.checked).toBe(false);

        preserve.click(); // toggles to true
        expect(localStorage.getItem('mycalendar_preserve_local_color')).toBe('1');

        preserve.click(); // back to false
        expect(localStorage.getItem('mycalendar_preserve_local_color')).toBe('0');
    });

    test('import default color: restore enabled/value from localStorage; checkbox toggles picker disabled and persists', () => {
        setupDom(true);
        installWebviewApi();

        localStorage.setItem('mycalendar_import_color_enabled', '1');
        localStorage.setItem('mycalendar_import_color_value', '#aabbcc');

        loadIcsImportFresh();

        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
        const enabled = checkboxes[1]; // second checkbox
        const picker = qs('input[type="color"]') as HTMLInputElement;

        expect(enabled.checked).toBe(true);
        expect(picker.disabled).toBe(false);
        expect(picker.value.toLowerCase()).toBe('#aabbcc');

        // disable
        enabled.click();
        expect(localStorage.getItem('mycalendar_import_color_enabled')).toBe('0');
        expect(picker.disabled).toBe(true);

        // enable back
        enabled.click();
        expect(localStorage.getItem('mycalendar_import_color_enabled')).toBe('1');
        expect(picker.disabled).toBe(false);
    });

    test('color picker change persists value', () => {
        setupDom(true);
        installWebviewApi();

        loadIcsImportFresh();

        const picker = qs('input[type="color"]') as HTMLInputElement;
        picker.value = '#112233';
        picker.dispatchEvent(new Event('change'));

        expect(localStorage.getItem('mycalendar_import_color_value')).toBe('#112233');
    });

    test('Import button: no file selected -> logs "No file selected." and does not post message', async () => {
        setupDom(true);
        const {postMessage} = installWebviewApi();
        loadIcsImportFresh();

        const importBtn = Array.from(document.querySelectorAll('button'))
            .find(b => (b.textContent || '').trim() === 'Import') as HTMLButtonElement;

        expect(importBtn).toBeTruthy();
        importBtn.click();

        // no extra postMessage(icsImport)
        const importCalls = postMessage.mock.calls.filter(c => c[0]?.name === 'icsImport');
        expect(importCalls.length).toBe(0);

        expectConsoleLogContains(logSpy, 'No file selected.');
    });

    test('Import button: reads file and posts icsImport with correct payload (preserveLocalColor + targetFolderId + default color disabled)', async () => {
        setupDom(true);
        const {postMessage, getOnMessageCb} = installWebviewApi();

        // Mock FileReader
        const fr: any = {
            result: null,
            error: null,
            onload: null,
            onerror: null,
            readAsText: jest.fn(function () {
                fr.result = 'BEGIN:VCALENDAR\nEND:VCALENDAR';
                // simulate async-ish
                if (typeof fr.onload === 'function') fr.onload();
            }),
        };

        (global as any).FileReader = function () {
            return fr;
        };

        loadIcsImportFresh();

        // populate folders and choose one
        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [{id: 'f1', title: 'Folder1', depth: 0}],
        });

        const folderSel = qs('#mc-target-folder') as HTMLSelectElement;
        expect(folderSel.value).toBe('f1');

        const fileInput = qs('#ics-file') as HTMLInputElement;

        const fileObj: any = {name: 'a.ics', size: 12};
        Object.defineProperty(fileInput, 'files', {value: [fileObj], configurable: true});

        const importBtn = Array.from(document.querySelectorAll('button'))
            .find(b => (b.textContent || '').trim() === 'Import') as HTMLButtonElement;

        importBtn.click();

        const importCalls = postMessage.mock.calls.filter(c => c[0]?.name === 'icsImport');
        expect(importCalls.length).toBe(1);

        expect(importCalls[0][0]).toEqual({
            name: 'icsImport',
            mode: 'text',
            ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
            source: 'filepicker:a.ics',
            targetFolderId: 'f1',
            preserveLocalColor: true,          // default ON
            importDefaultColor: undefined,      // default color feature is OFF by default
        });

        expect(fr.readAsText).toHaveBeenCalledWith(fileObj);
    });

    test('Import button: when default color enabled -> posts importDefaultColor', async () => {
        setupDom(true);
        const {postMessage} = installWebviewApi();

        // enable default import color
        localStorage.setItem('mycalendar_import_color_enabled', '1');
        localStorage.setItem('mycalendar_import_color_value', '#abcdef');

        const fr: any = {
            result: null,
            error: null,
            onload: null,
            onerror: null,
            readAsText: jest.fn(function () {
                fr.result = 'ICS';
                if (typeof fr.onload === 'function') fr.onload();
            }),
        };
        (global as any).FileReader = function () {
            return fr;
        };

        loadIcsImportFresh();

        const fileInput = qs('#ics-file') as HTMLInputElement;
        const fileObj: any = {name: 'x.ics', size: 1};
        Object.defineProperty(fileInput, 'files', {value: [fileObj], configurable: true});

        const importBtn = Array.from(document.querySelectorAll('button'))
            .find(b => (b.textContent || '').trim() === 'Import') as HTMLButtonElement;

        importBtn.click();

        const call = postMessage.mock.calls.find(c => c[0]?.name === 'icsImport')?.[0];
        expect(call.importDefaultColor).toBe('#abcdef');
    });

    test('backend messages: importStatus/importDone/importError are logged', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();
        loadIcsImportFresh();

        sendPluginMessage(getOnMessageCb, {name: 'importStatus', text: 'Parsing'});
        sendPluginMessage(getOnMessageCb, {name: 'importDone', added: 1, updated: 2, skipped: 3, errors: 0});
        sendPluginMessage(getOnMessageCb, {name: 'importError', error: 'boom'});

        expectConsoleLogContains(logSpy, '[STATUS]');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[STATUS]'), 'Parsing');
        expectConsoleLogContains(logSpy, '[DONE]');
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('[DONE]'),
            'added=1 updated=2 skipped=3 errors=0'
        );

        expectConsoleLogContains(logSpy, '[ERROR]');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'), 'boom');
    });

    test('mcRegisterOnMessage: supports multiple handlers; errors in handler are caught', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();
        loadIcsImportFresh();

        // add handler that throws
        (window as any).__mcMsgHandlers.push(() => {
            throw new Error('handler fail');
        });

        sendPluginMessage(getOnMessageCb, {name: 'folders', folders: []});

        expectConsoleErrorContains(errorSpy, 'handler error');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('handler error'), expect.any(Error));

    });

    test('mcRegisterOnMessage: dispatcher installed only once even if script re-registers handlers', () => {
        setupDom(true);
        const {postMessage} = installWebviewApi();

        loadIcsImportFresh();
        const firstOnMessageCalls = (window as any).webviewApi.onMessage.mock.calls.length;

        // Reload module without clearing window globals (__mcMsgDispatcherInstalled must persist)
        loadIcsImportKeepGlobals();
        const secondOnMessageCalls = (window as any).webviewApi.onMessage.mock.calls.length;

        expect(secondOnMessageCalls).toBe(firstOnMessageCalls);

        // still posts requestFolders on init of second load (root exists)
        const reqCalls = postMessage.mock.calls.filter(c => c[0]?.name === 'requestFolders');
        expect(reqCalls.length).toBeGreaterThanOrEqual(2);
    });

});
