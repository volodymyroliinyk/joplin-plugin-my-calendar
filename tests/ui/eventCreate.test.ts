/** @jest-environment jsdom */

// tests/ui/eventCreate.test.ts
//
// src/ui/eventCreate.js
//
// TZ=UTC npx jest tests/ui/eventCreate.test.ts --runInBand --no-cache;
//

export {};

function setupDom(hasRoot = true) {
    document.body.innerHTML = hasRoot ? '<div id="mc-event-form-root"></div>' : '<div></div>';
}

function resetMyCalendarUiGlobals() {
    delete (window as any).__mcMsgDispatcherInstalled;
    delete (window as any).__mcMsgHandlers;
    delete (window as any).__mcUiSettings;
    delete (window as any).__mcEventCreateLogger;
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
        postMessage: (window as any).webviewApi.postMessage as jest.Mock,
        getOnMessageCb: () => onMessageCb as ((msg: any) => void) | null,
    };
}

function sendPluginMessage(getOnMessageCb: any, msg: any) {
    const cb = getOnMessageCb();
    if (!cb) throw new Error('onMessage callback not installed');
    cb(msg);
}

function loadEventCreateFresh() {
    jest.resetModules();
    resetMyCalendarUiGlobals();
    require('../../src/ui/eventCreate.js');
}

function qs(sel: string) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
}

describe('src/ui/eventCreate.js', () => {
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        localStorage.clear();
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        delete (window as any).__mcMsgHandlers;
        delete (window as any).__mcMsgDispatcherInstalled;
        delete (window as any).webviewApi;
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        delete (window as any).webviewApi;
    });

    test('no root -> does nothing', () => {
        setupDom(false);
        const {postMessage} = installWebviewApi();

        loadEventCreateFresh();

        expect(postMessage).not.toHaveBeenCalled();
    });

    test('renders event form and asks for folders on init', () => {
        setupDom(true);
        const {postMessage} = installWebviewApi();

        loadEventCreateFresh();

        expect(document.querySelector('#mc-event-create-form')).toBeTruthy();
        expect(document.querySelector('#mc-event-target-folder')).toBeTruthy();
        expect(document.querySelector('#mc-event-tags')).toBeTruthy();
        expect(document.querySelectorAll('input[type="date"]').length).toBeGreaterThanOrEqual(2);
        expect(document.querySelectorAll('select').length).toBeGreaterThanOrEqual(3);
        expect(document.querySelector('textarea')).toBeTruthy();
        expect(document.querySelectorAll('fieldset')).toHaveLength(4);
        expect(document.querySelectorAll('fieldset > legend')).toHaveLength(4);
        expect((qs('#mc-event-title') as HTMLInputElement).required).toBe(true);
        expect(document.querySelector('label[for="mc-event-title"]')).toBeTruthy();
        expect(qs('#mc-event-form-status').getAttribute('aria-live')).toBe('polite');
        expect(postMessage).toHaveBeenCalledWith({name: 'uiReady'});
        expect(postMessage).toHaveBeenCalledWith({name: 'requestFolders'});
        expect(postMessage).toHaveBeenCalledWith({name: 'requestTags'});
    });

    test('timezone select has an empty first option and auto-selects device timezone', () => {
        setupDom(true);
        installWebviewApi();

        loadEventCreateFresh();

        const select = qs('#mc-event-timezone') as HTMLSelectElement;
        const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

        expect(select.options[0].value).toBe('');
        expect(select.options[0].textContent).toBe('');
        expect(Array.from(select.options).some((option) => option.value === deviceTz)).toBe(true);
        expect(select.value).toBe(deviceTz);
    });

    test('populates folders, restores desired notebook, and persists selection', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();
        localStorage.setItem('mycalendar.eventTargetFolderId', 'b');

        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [
                {id: 'a', title: 'A', depth: 0},
                {id: 'b', title: 'B', depth: 0},
                {id: 'c', title: 'Child', depth: 2},
            ],
        });

        const sel = qs('#mc-event-target-folder') as HTMLSelectElement;
        expect(sel.value).toBe('b');
        expect(Array.from(sel.options).find(o => o.value === 'c')?.textContent).toContain('- - Child');

        sel.value = 'a';
        sel.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('mycalendar.eventTargetFolderId')).toBe('a');
    });

    test('selects and filters tags through the custom picker', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        loadEventCreateFresh();
        sendPluginMessage(getOnMessageCb, {
            name: 'tags',
            tags: [
                {id: 'tag-a', title: 'Alpha'},
                {id: 'tag-b', title: 'Beta'},
            ],
        });

        (qs('.mc-event-tags-toggle') as HTMLButtonElement).click();
        const search = qs('.mc-event-tags-search') as HTMLInputElement;
        search.value = 'bet';
        search.dispatchEvent(new Event('input'));

        const options = document.querySelectorAll('.mc-event-tag-option');
        expect(options).toHaveLength(1);
        expect(options[0].textContent).toContain('Beta');

        (options[0].querySelector('input') as HTMLInputElement).click();
        expect(Array.from((qs('#mc-event-tags') as HTMLSelectElement).selectedOptions).map(option => option.value)).toEqual(['tag-b']);
        expect(document.querySelector('.mc-event-tag-badge')?.textContent).toContain('Beta');
    });

    test('loads tag results in pages and resets pagination when searching', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();
        loadEventCreateFresh();
        const tags = Array.from({length: 319}, (_, index) => ({id: `tag-${index}`, title: `Tag ${index}`}));
        sendPluginMessage(getOnMessageCb, {name: 'tags', tags});

        expect(document.querySelectorAll('.mc-event-tag-option')).toHaveLength(0);
        (qs('.mc-event-tags-toggle') as HTMLButtonElement).click();
        expect(document.querySelectorAll('.mc-event-tag-option')).toHaveLength(100);
        expect(document.querySelector('.mc-event-tags-limit')?.textContent).toContain('100 of 319');

        (qs('.mc-event-tags-load-more') as HTMLButtonElement).click();
        expect(document.querySelectorAll('.mc-event-tag-option')).toHaveLength(200);
        expect(document.querySelector('.mc-event-tags-limit')?.textContent).toContain('200 of 319');
        expect(qs('.mc-event-tags-load-more').textContent).toBe('Load 100 more');
        expect((qs('#mc-event-tags-dropdown') as HTMLElement).hidden).toBe(false);

        (qs('.mc-event-tags-load-more') as HTMLButtonElement).click();
        expect(document.querySelectorAll('.mc-event-tag-option')).toHaveLength(300);
        expect(qs('.mc-event-tags-load-more').textContent).toBe('Load 19 more');

        (qs('.mc-event-tags-load-more') as HTMLButtonElement).click();
        expect(document.querySelectorAll('.mc-event-tag-option')).toHaveLength(319);
        expect(document.querySelector('.mc-event-tags-load-more')).toBeNull();

        const search = qs('.mc-event-tags-search') as HTMLInputElement;
        search.value = 'Tag 318';
        search.dispatchEvent(new Event('input'));
        expect(document.querySelectorAll('.mc-event-tag-option')).toHaveLength(1);
        expect(document.querySelector('.mc-event-tag-option')?.textContent).toContain('Tag 318');
    });

    test('submits calendarEventCreate payload', () => {
        setupDom(true);
        const {postMessage, getOnMessageCb} = installWebviewApi();

        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [{id: 'folder1', title: 'Events', depth: 0}],
        });
        sendPluginMessage(getOnMessageCb, {
            name: 'tags',
            tags: [
                {id: 'tag-work', title: 'Work'},
                {id: 'tag-important', title: 'Important'},
            ],
        });

        const tagSelect = qs('#mc-event-tags') as HTMLSelectElement;
        tagSelect.options[0].selected = true;
        tagSelect.options[1].selected = true;
        tagSelect.dispatchEvent(new Event('change'));

        const form = qs('#mc-event-create-form') as HTMLFormElement;
        const textInputs = Array.from(form.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
        textInputs[0].value = 'Planning';

        form.dispatchEvent(new Event('submit', {cancelable: true}));

        const call = postMessage.mock.calls.find(c => c[0]?.name === 'calendarEventCreate')?.[0];
        expect(call).toBeTruthy();
        expect(call.payload).toMatchObject({
            targetFolderId: 'folder1',
            title: 'Planning',
            repeat: 'none',
            all_day: false,
            tagIds: ['tag-work', 'tag-important'],
        });
        expect(call.payload.start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    test('blocks invalid submit, announces the error, and focuses title', () => {
        setupDom(true);
        const {postMessage, getOnMessageCb} = installWebviewApi();

        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [{id: 'folder1', title: 'Events', depth: 0}],
        });

        const form = qs('#mc-event-create-form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', {cancelable: true}));

        const createCalls = postMessage.mock.calls.filter(c => c[0]?.name === 'calendarEventCreate');
        expect(createCalls).toHaveLength(0);
        expect(qs('#mc-event-form-status').textContent).toContain('Title is required');
        expect(qs('#mc-event-title').getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(qs('#mc-event-title'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[MyCalendar Event] Title is required.'));
    });

    test('announces backend success and error messages inline', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {name: 'calendarEventCreateDone', title: 'Planning'});
        expect(qs('#mc-event-form-status').textContent).toContain('Event note created: Planning');
        expect(qs('#mc-event-form-status').dataset.kind).toBe('success');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[MyCalendar Event] Event note created: Planning'));

        sendPluginMessage(getOnMessageCb, {
            name: 'calendarEventCreateDone',
            title: 'Planning with tags',
            warnings: [{code: 'tag_attachment_failed', tagId: 'tag-b', message: 'denied'}],
        });
        expect(qs('#mc-event-form-status').textContent).toContain('Event note created: Planning with tags. 1 tag could not be attached.');
        expect(qs('#mc-event-form-status').dataset.kind).toBe('warning');

        sendPluginMessage(getOnMessageCb, {name: 'calendarEventCreateError', error: 'bad date'});
        expect(qs('#mc-event-form-status').textContent).toContain('bad date');
        expect(qs('#mc-event-form-status').dataset.kind).toBe('error');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[MyCalendar Event] bad date'));
    });

    test('time picker labels follow uiSettings timeFormat while payload remains normalized', () => {
        setupDom(true);
        const {postMessage, getOnMessageCb} = installWebviewApi();

        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', timeFormat: '12h'});
        sendPluginMessage(getOnMessageCb, {
            name: 'folders',
            folders: [{id: 'folder1', title: 'Events', depth: 0}],
        });

        const startTimeSelect = Array.from(document.querySelectorAll('select'))
            .find((select) => Array.from(select.options).some((option) => option.value === '13:00')) as HTMLSelectElement;
        expect(startTimeSelect).toBeTruthy();
        expect(Array.from(startTimeSelect.options).find((option) => option.value === '13:00')?.textContent).toBe('1:00 PM');

        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', timeFormat: '24h'});
        expect(Array.from(startTimeSelect.options).find((option) => option.value === '13:00')?.textContent).toBe('13:00');

        const form = qs('#mc-event-create-form') as HTMLFormElement;
        const titleInput = form.querySelector('input[type="text"]') as HTMLInputElement;
        const dateInputs = Array.from(form.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
        const timeSelects = Array.from(form.querySelectorAll('select'))
            .filter((select) => Array.from(select.options).some((option) => option.value === '13:00')) as HTMLSelectElement[];
        titleInput.value = 'Planning';
        dateInputs[0].value = '2026-06-16';
        dateInputs[1].value = '2026-06-16';
        timeSelects[0].value = '13:00';
        timeSelects[1].value = '14:00';

        form.dispatchEvent(new Event('submit', {cancelable: true}));

        const call = postMessage.mock.calls.find(c => c[0]?.name === 'calendarEventCreate')?.[0];
        expect(call).toBeTruthy();
        expect(call.payload.start).toBe('2026-06-16 13:00');
        expect(call.payload.end).toBe('2026-06-16 14:00');
    });

    test('uiSettings updates default color picker', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {name: 'uiSettings', debug: false, defaultEventColor: '#99ff66'});

        const picker = qs('input[type="color"]') as HTMLInputElement;
        expect(picker.value.toLowerCase()).toBe('#99ff66');
    });

    test('uiSettings uses light and dark default colors based on Joplin background color', () => {
        setupDom(true);
        const {getOnMessageCb} = installWebviewApi();

        document.documentElement.style.setProperty('--joplin-background-color', '#ffffff');
        loadEventCreateFresh();

        sendPluginMessage(getOnMessageCb, {
            name: 'uiSettings',
            defaultEventColorLight: '#007c7c',
            defaultEventColorDark: '#00e5e5',
        });

        const picker = qs('input[type="color"]') as HTMLInputElement;
        expect(picker.value.toLowerCase()).toBe('#007c7c');

        document.documentElement.style.setProperty('--joplin-background-color', '#101010');
        sendPluginMessage(getOnMessageCb, {
            name: 'uiSettings',
            defaultEventColorLight: '#007c7c',
            defaultEventColorDark: '#00e5e5',
        });

        expect(picker.value.toLowerCase()).toBe('#00e5e5');
    });
});
